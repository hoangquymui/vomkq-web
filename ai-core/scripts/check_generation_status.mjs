import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitUserStop } from "../src/generation-status.js";

test("HTTP/model failures before pass returns must not look cancelled", () => {
  assert.equal(isExplicitUserStop(null, null, "backend-run"), false);
  assert.equal(isExplicitUserStop(null, null, null), false);
  assert.equal(isExplicitUserStop(undefined, undefined, undefined), false);
});
test("stop while waiting for backend uses live request ID", () => {
  assert.equal(isExplicitUserStop("backend-run", null, "backend-run"), true);
});
test("stop during answer reveal uses completed pass ID", () => {
  assert.equal(isExplicitUserStop("pass-run", "pass-run", "other"), true);
});
test("unrelated or empty cancellation IDs cannot swallow errors", () => {
  assert.equal(isExplicitUserStop("old-run", null, "new-run"), false);
  assert.equal(isExplicitUserStop("", "", ""), false);
});
