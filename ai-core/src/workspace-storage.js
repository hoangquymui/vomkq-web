export function createWorkspaceStorage(name, factory = globalThis.indexedDB) {
  let connection;
  let opening;

  function open() {
    if (connection) return Promise.resolve(connection);
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("files")) {
            db.createObjectStore("files", { keyPath: "id" }).createIndex("workspaceId", "workspaceId");
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          connection = db;
          db.onversionchange = () => { db.close(); if (connection === db) connection = undefined; };
          db.onclose = () => { if (connection === db) connection = undefined; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
      }).finally(() => { opening = undefined; });
    }
    return opening;
  }

  async function transact(mode, issueRequests) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("files", mode);
      const store = transaction.objectStore("files");
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Không thể truy cập kho tài liệu"));
      transaction.onabort = () => reject(transaction.error || new Error("Thao tác kho tài liệu đã bị hủy"));
      try {
        issueRequests(store, (value) => { result = value; });
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  return {
    put: (record) => transact("readwrite", (store) => { store.put(record); }),
    delete: (fileId) => transact("readwrite", (store) => { store.delete(fileId); }),
    getMany: (fileIds) => {
      if (!fileIds.length) return Promise.resolve([]);
      return transact("readonly", (store, result) => {
        const records = new Array(fileIds.length);
        result(records);
        // Queue synchronously so IndexedDB cannot close the transaction between gets.
        fileIds.forEach((fileId, index) => {
          store.get(fileId).onsuccess = (event) => { records[index] = event.target.result; };
        });
      });
    },
    getAll: () => transact("readonly", (store, result) => {
      store.getAll().onsuccess = (event) => result(event.target.result || []);
    }),
    replaceAll: (records) => transact("readwrite", (store) => {
      store.clear();
      records.forEach((record) => store.put(record));
    }),
  };
}
