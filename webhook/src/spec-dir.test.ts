import assert from "node:assert/strict";
import { test } from "node:test";
import { specDirFor } from "./spec-dir.ts";

test("specDirFor: issue 番号ごとに別のディレクトリを返す", () => {
  assert.equal(specDirFor(3), ".agent-runner/issues/3");
  assert.equal(specDirFor(28), ".agent-runner/issues/28");
});

test("specDirFor: 異なる issue が同じパスに衝突しない", () => {
  assert.notEqual(specDirFor(3), specDirFor(4));
});

test("specDirFor: safety.ts の .agent-runner/ 許可プレフィックスに収まる", () => {
  assert.ok(specDirFor(9).startsWith(".agent-runner/"));
});
