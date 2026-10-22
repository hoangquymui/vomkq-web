import test from "node:test";
import assert from "node:assert/strict";
import { createConversationPersistence } from "../src/conversation-persistence.js";

function fixture() {
  const rows = new Map(); let sequence = 0;
  const server = { revision: 0, payload: null, operation_id: null };
  const journal = {
    getAll: async () => structuredClone([...rows.values()]),
    put: async row => rows.set(row.id, structuredClone(row)),
    delete: async id => rows.delete(id),
  };
  const api = { request: async (_path, options) => {
    if (!options) return structuredClone(server);
    const body = options.body;
    if (body.operation_id === server.operation_id) return { revision: server.revision };
    if (body.expected_revision !== server.revision) throw Object.assign(new Error("conflict"), { status: 409 });
    Object.assign(server, { revision: server.revision + 1, payload: structuredClone(body.payload), operation_id: body.operation_id });
    return { revision: server.revision };
  } };
  const create = () => createConversationPersistence({ api, journal, makeId: () => `op-${++sequence}` });
  return { rows, server, journal, api, create };
}
const payload = title => ({ generalChats: [{ id: "chat", title, messages: [] }], workspaces: [], activeWorkspaceId: null });

test("imports legacy once, then restores SQLite as authoritative", async () => {
  const f = fixture(), client = f.create();
  assert.deepEqual(await client.initialize(payload("legacy")), payload("legacy"));
  await client.save(payload("new"));
  const reopened = f.create();
  assert.deepEqual(await reopened.initialize(payload("stale-cache")), payload("new"));
  assert.equal(f.server.revision, 2);
  assert.equal([...f.rows.values()][0].kind, "recovery");
});

test("multiple queued saves remain ordered without overwriting newest snapshot", async () => {
  const f = fixture(), client = f.create();
  await client.initialize(payload("initial"));
  await Promise.all([client.save(payload("one")), client.save(payload("two")), client.save(payload("three"))]);
  assert.equal(f.server.payload.generalChats[0].title, "three");
  assert.equal(f.server.revision, 4);
  assert.equal(f.rows.size, 0);
});

test("lost acknowledgement replays same operation instead of double saving", async () => {
  const f = fixture(), client = f.create();
  await client.initialize(payload("initial"));
  const original = f.api.request;
  let fail = true;
  f.api.request = async (...args) => {
    const result = await original(...args);
    if (args[1] && fail) { fail = false; throw new Error("network lost after commit"); }
    return result;
  };
  await assert.rejects(client.save(payload("saved")), /network/);
  assert.equal(f.server.revision, 2);
  await f.create().initialize(payload("saved"));
  assert.equal(f.server.revision, 2);
  assert.equal(f.rows.size, 0);
});

test("server conflict preserves pending edits until explicit recovery choice", async () => {
  const f = fixture(), client = f.create();
  await client.initialize(payload("initial"));
  f.server.revision++;
  f.server.payload = payload("other window");
  await assert.rejects(client.save(payload("unsynced")), error => error.status === 409);
  assert.equal(f.server.payload.generalChats[0].title, "other window");
  await assert.rejects(f.create().initialize(payload("unsynced")), error => error.status === 409);
  await client.keepServerVersion();
  assert.equal([...f.rows.values()][0].kind, "recovery");
  assert.deepEqual(await f.create().initialize(payload("unsynced")), payload("other window"));
});

test("explicit backup restore writes restored state with current revision", async () => {
  const f = fixture();
  await f.create().initialize(payload("before"));
  await f.create().initialize(payload("backup"), { restoreLocal: true });
  assert.equal(f.server.payload.generalChats[0].title, "backup");
});

test("key ordering does not create duplicate recovery snapshots", async () => {
  const f = fixture();
  const local = payload("same");
  await f.create().initialize(local);
  const reordered = { workspaces: local.workspaces, activeWorkspaceId: null, generalChats: local.generalChats };
  await f.create().initialize(reordered);
  assert.equal(f.rows.size, 0);
});
