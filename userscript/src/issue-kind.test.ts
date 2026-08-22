import assert from "node:assert/strict";
import { test } from "node:test";
import { issueKind } from "./issue-kind.ts";

test("issueKind: type:bug のみ → bug", () => {
  assert.equal(issueKind(["type:bug"]), "bug");
});

test("issueKind: type:feature のみ → feature", () => {
  assert.equal(issueKind(["type:feature"]), "feature");
});

test("issueKind: type:task のみ → task", () => {
  assert.equal(issueKind(["type:task"]), "task");
});

test("issueKind: ラベルなし (テンプレート導入前の既存issue) → task (後方互換のデフォルト)", () => {
  assert.equal(issueKind([]), "task");
});

test("issueKind: type:bug と type:feature の両方 (異常系) → bug が優先", () => {
  assert.equal(issueKind(["type:bug", "type:feature"]), "bug");
});

test("issueKind: 未知のラベルのみ → task", () => {
  assert.equal(issueKind(["enhancement"]), "task");
});
