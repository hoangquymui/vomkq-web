// SQLite is authoritative. IndexedDB is a durable retry queue/recovery archive,
// not an independent second version of chat history.
export function createConversationPersistence({ api, journal, makeId = () => crypto.randomUUID() }) {
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  let revision = 0, ready = false, fault = null, chain = Promise.resolve();
  const send = async record => {
    const response = await api.request("/conversations/state", { method: "PUT", body: {
      payload: record.payload, expected_revision: record.expected_revision, operation_id: record.id,
    } });
    await journal.delete(record.id);
    return response;
  };
  function save(payload) {
    if (!ready) return Promise.reject(new Error("Kho hội thoại chưa sẵn sàng"));
    const record = { id: makeId(), kind: "pending", expected_revision: revision++, payload: structuredClone(payload) };
    // Persist even if an earlier request failed. Replay uses the original
    // operation ID/revision, so a lost HTTP acknowledgement cannot double-save.
    const durable = journal.put(record);
    durable.catch(() => {});
    chain = chain.catch(() => {}).then(async () => {
      await durable;
      if (fault) throw fault;
      try { return await send(record); }
      catch (error) { fault = error; throw error; }
    });
    return chain;
  }
  return {
    save,
    flush: () => chain,
    async initialize(localPayload, { restoreLocal = false } = {}) {
      // Do not supersede unsent edits with a snapshot from another window.
      const pending = (await journal.getAll()).filter(row => row.kind === "pending")
        .sort((a,b) => a.expected_revision - b.expected_revision);
      for (const row of pending) await send(row);
      const remote = await api.request("/conversations/state");
      revision = remote.revision;
      ready = true;
      fault = null;
      if (restoreLocal || remote.payload === null) {
        await save(localPayload);
        return localPayload;
      }
      if (canonical(localPayload) !== canonical(remote.payload)) {
        await journal.put({ id: `recovery-${makeId()}`, kind: "recovery", payload: structuredClone(localPayload), createdAt: new Date().toISOString() });
      }
      return remote.payload;
    },
    async recoveryRecords() { return await journal.getAll(); },
    async keepServerVersion() {
      // Explicit UI choice only: archive unsent edits, never silently erase them.
      for (const row of await journal.getAll()) {
        if (row.kind === "pending") await journal.put({ ...row, kind: "recovery" });
      }
    },
  };
}
