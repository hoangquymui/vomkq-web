// Durable frontend staging. Never overwrite live chats while the Core still
// serves the old database. Dependencies are injected for browser-free tests.
export function createBackupRestore({ journal, storage, files }) {
  const snapshotStorage = () => Object.fromEntries(
    Array.from({ length: storage.length }, (_, i) => storage.key(i))
      .filter(key => key?.startsWith("vector.ai."))
      .map(key => [key, storage.getItem(key)]),
  );
  function writeStorage(values) {
    for (const key of Object.keys(snapshotStorage())) storage.removeItem(key);
    for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
  }
  async function apply(record) {
    // Persist the rollback image before touching either storage engine. Keep it
    // after success too; the user can recover it without the original ZIP.
    const previous = record.previous || { storage: snapshotStorage(), files: await files.getAll() };
    const applying = { ...record, previous, phase: "applying" };
    await journal.put(applying);
    try {
      await files.replaceAll(record.records);
      writeStorage({ ...previous.storage, ...record.values });
      for (const key of record.removeKeys || []) storage.removeItem(key);
      await journal.put({ ...applying, phase: "applied" });
    } catch (error) {
      // If rollback itself fails, the persisted image is still available and
      // the next startup retries before mounting the interactive UI.
      await files.replaceAll(previous.files);
      writeStorage(previous.storage);
      await journal.put({ ...applying, phase: "staged" });
      throw error;
    }
  }
  return {
    async abandon(id) {
      const [record] = await journal.getMany([id]);
      if (record?.phase === "staged") await journal.put({ ...record, phase: "abandoned" });
    },
    async stage({ id, records, values, removeKeys = [], coreRequired = true }) {
      if ((await journal.getAll()).some(row => row.phase !== "applied" && row.phase !== "abandoned")) {
        throw new Error("Đã có dữ liệu chờ khôi phục. Hãy khởi động lại VECTOR AI trước.");
      }
      await journal.put({ id, records, values, removeKeys, coreRequired, phase: "staged", createdAt: new Date().toISOString() });
    },
    async resume(getStatus) {
      const record = (await journal.getAll()).find(row => row.phase !== "applied" && row.phase !== "abandoned");
      if (!record) return "none";
      if (record.coreRequired) {
        const status = await getStatus();
        if (!status.result?.applied || status.result.frontend_restore_id !== record.id) {
          // Unknown/failed HTTP response may still have staged the server; do
          // not discard the candidate or let stale in-memory state overwrite it.
          return "waiting";
        }
      }
      await apply(record);
      return "applied";
    },
  };
}
