import test from "node:test";
import assert from "node:assert/strict";
import { resolveVersion } from "../version.js";

test("resolveVersion: GIT_COMMIT env wins and is shortened to seven characters", () => {
  const v = resolveVersion({ GIT_COMMIT: "15150ab87b2d50ed8fee71408afbd2f6aba54a14" });
  assert.equal(v.short, "15150ab");
  assert.equal(v.commit, "15150ab87b2d50ed8fee71408afbd2f6aba54a14");
  assert.equal(v.source, "env");
});

test("resolveVersion: without env it still returns a short label", () => {
  assert.ok(resolveVersion({}).short.length > 0);
});
