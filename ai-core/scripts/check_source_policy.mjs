import test from "node:test";
import assert from "node:assert/strict";
import { onlyDocumentSources, SOURCE_POLICY_KEY } from "../src/source-policy.js";

test("new chats default to documents; model knowledge is an explicit preference", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null };
  assert.equal(onlyDocumentSources(null, storage), true);
  assert.equal(onlyDocumentSources({ strictReferences: false }, storage), true);
  assert.equal(onlyDocumentSources({ sourcePolicy: "allow-model" }, storage), false);
  values.set(SOURCE_POLICY_KEY, "allow-model");
  assert.equal(onlyDocumentSources(null, storage), false);
  assert.equal(onlyDocumentSources({ strictReferences: true }, storage), true);
  assert.equal(onlyDocumentSources({ sourcePolicy: "documents-only" }, storage), true);
  values.set(SOURCE_POLICY_KEY, "unknown");
  assert.equal(onlyDocumentSources(null, storage), true);
});
