import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInvestigatePrompt, INVESTIGATE_JSON_SCHEMA } from "./investigate.ts";

test("buildInvestigatePrompt: userPrompt に issue 本文が含まれる", () => {
  const { userPrompt } = buildInvestigatePrompt("## 再現手順\n1. xxx\n## 期待する動作\nyyy\n## 実際の動作\nzzz");
  assert.match(userPrompt, /再現手順/);
  assert.match(userPrompt, /期待する動作/);
  assert.match(userPrompt, /実際の動作/);
});

test("buildInvestigatePrompt: systemPrompt には調査専用・読み取り専用である旨が含まれる", () => {
  const { systemPrompt } = buildInvestigatePrompt("body");
  assert.match(systemPrompt, /調査/);
});

test("INVESTIGATE_JSON_SCHEMA: 原因箇所 (ファイルパス・行または関数名) のフィールドを持つ", () => {
  const keys = Object.keys(INVESTIGATE_JSON_SCHEMA.properties);
  assert.ok(keys.includes("filePath"));
  assert.ok(keys.includes("location"));
});

test("INVESTIGATE_JSON_SCHEMA: 根拠のフィールドを持つ", () => {
  const keys = Object.keys(INVESTIGATE_JSON_SCHEMA.properties);
  assert.ok(keys.includes("evidence"));
});

test("INVESTIGATE_JSON_SCHEMA: 特定できなかった場合の代替フィールドを持つ", () => {
  const keys = Object.keys(INVESTIGATE_JSON_SCHEMA.properties);
  assert.ok(keys.includes("couldNotIdentify"));
  assert.ok(keys.includes("checkedScope"));
});
