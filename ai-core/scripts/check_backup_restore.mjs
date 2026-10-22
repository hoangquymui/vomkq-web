import assert from "node:assert/strict";
import test from "node:test";
import { createBackupRestore } from "../src/backup-restore.js";

function fixture() {
  const values = new Map([["vector.ai.chats", "old"], ["unrelated", "keep"]]);
  const storage = {
    get length() { return values.size; }, key: i => [...values.keys()][i],
    getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k),
  };
  const rows = new Map();
  const journal = { getAll: async () => structuredClone([...rows.values()]), getMany: async ids => ids.map(id => structuredClone(rows.get(id))), put: async r => rows.set(r.id, structuredClone(r)) };
  let documents = [{ id: "old-file", chatId: "old-chat" }];
  const files = { getAll: async () => structuredClone(documents), replaceAll: async records => { documents = structuredClone(records); } };
  return { storage, journal, files, restore: createBackupRestore({ journal, storage, files }) };
}
const incoming = { id: "restore-1", records: [{ id: "new-file", chatId: "new-chat" }], values: { "vector.ai.chats": "new" } };

test("v2 staging preserves live data until matching Core restart", async () => {
  const f = fixture();
  await f.restore.stage(incoming);
  assert.equal(f.storage.getItem("vector.ai.chats"), "old");
  assert.equal(await f.restore.resume(async () => ({ result: { applied: true, frontend_restore_id: "another" } })), "waiting");
  assert.equal((await f.files.getAll())[0].id, "old-file");
  assert.equal(await f.restore.resume(async () => ({ result: { applied: true, frontend_restore_id: incoming.id } })), "applied");
  assert.equal(f.storage.getItem("vector.ai.chats"), "new");
  assert.equal(f.storage.getItem("unrelated"), "keep");
  assert.equal((await f.journal.getAll())[0].previous.files[0].id, "old-file");
  assert.equal(await f.restore.resume(), "none");
});

test("failed localStorage write rolls files and chats back; retry succeeds", async () => {
  const f = fixture();
  await f.restore.stage({ ...incoming, coreRequired: false });
  const write = f.storage.setItem;
  f.storage.setItem = (k,v) => { if (v === "new") throw new Error("quota"); write(k,v); };
  await assert.rejects(f.restore.resume(), /quota/);
  assert.equal(f.storage.getItem("vector.ai.chats"), "old");
  assert.equal((await f.files.getAll())[0].id, "old-file");
  f.storage.setItem = write;
  await f.restore.resume();
  assert.equal(f.storage.getItem("vector.ai.chats"), "new");
});

test("interrupted apply restarts from its preserved rollback image", async () => {
  const f = fixture();
  await f.restore.stage({ ...incoming, coreRequired: false });
  const [row] = await f.journal.getAll();
  await f.journal.put({ ...row, phase: "applying", previous: { storage: { "vector.ai.chats": "old" }, files: await f.files.getAll() } });
  f.storage.setItem("vector.ai.chats", "half-written");
  const reopened = createBackupRestore(f);
  assert.equal(await reopened.resume(), "applied");
  assert.equal((await f.journal.getAll())[0].previous.storage["vector.ai.chats"], "old");
});

test("pending restore cannot be overwritten and definitive rejection can be abandoned", async () => {
  const f = fixture();
  await f.restore.stage(incoming);
  await assert.rejects(f.restore.stage({ ...incoming, id: "another" }), /khôi phục/);
  await f.restore.abandon(incoming.id);
  await f.restore.stage({ ...incoming, id: "another" });
  assert.equal(f.storage.getItem("vector.ai.chats"), "old");
});
