import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDraftPrompt, DRAFT_JSON_SCHEMA } from "./draft.ts";

test("buildDraftPrompt: userPrompt に issue の title/body の内容が含まれる", () => {
  const { userPrompt } = buildDraftPrompt({
    title: "ユニークなタイトル文字列XYZ",
    body: "ユニークな本文文字列ABC",
  });

  assert.match(userPrompt, /ユニークなタイトル文字列XYZ/);
  assert.match(userPrompt, /ユニークな本文文字列ABC/);
});

test("DRAFT_JSON_SCHEMA: requirements/architecture/tests の3フィールドを持つ", () => {
  assert.deepEqual(Object.keys(DRAFT_JSON_SCHEMA.properties).sort(), [
    "architecture",
    "requirements",
    "tests",
  ]);
  assert.deepEqual([...DRAFT_JSON_SCHEMA.required].sort(), [
    "architecture",
    "requirements",
    "tests",
  ]);
});

test("buildDraftPrompt: systemPrompt に3文書間の用語・粒度の整合性に配慮する旨の指示が含まれる", () => {
  const { systemPrompt } = buildDraftPrompt({ title: "t", body: "b" });

  assert.match(systemPrompt, /用語/);
  assert.match(systemPrompt, /粒度/);
});
