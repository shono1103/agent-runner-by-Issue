import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClarifyPrompt } from "./clarify.ts";

test("buildClarifyPrompt: previousQa が null の場合、issue本文のみを入力にし、前回の質問コメントに関する文言を含まない", () => {
  const { userPrompt } = buildClarifyPrompt("この機能はXXXを実現したい", null);

  assert.match(userPrompt, /この機能はXXXを実現したい/);
  assert.doesNotMatch(userPrompt, /前回の質問/);
});

test("buildClarifyPrompt: previousQa がある場合、その内容 (人間の回答を含む編集後本文) が userPrompt に含まれる", () => {
  const previousQa = "- [ ] 質問A\n- [x] 質問B 回答: こうします";
  const { userPrompt } = buildClarifyPrompt("issue本文", previousQa);

  assert.match(userPrompt, /質問A/);
  assert.match(userPrompt, /回答: こうします/);
});

test("buildClarifyPrompt: schema が questions (text, resolved を持つ配列) と allResolved を持つ", () => {
  const { schema } = buildClarifyPrompt("issue本文", null);
  // schema は as const 相当の readonly 構造なので、mutable 型へ直接 as できない。
  const s = schema as unknown as {
    type: string;
    properties: {
      questions: { type: string; items: { properties: { text: unknown; resolved: unknown } } };
      allResolved: { type: string };
    };
    required: readonly string[];
  };

  assert.equal(s.type, "object");
  assert.equal(s.properties.questions.type, "array");
  assert.ok(s.properties.questions.items.properties.text);
  assert.ok(s.properties.questions.items.properties.resolved);
  assert.equal(s.properties.allResolved.type, "boolean");
  assert.deepEqual([...s.required].sort(), ["allResolved", "questions"]);
});

test("buildClarifyPrompt: systemPrompt は空でない", () => {
  const { systemPrompt } = buildClarifyPrompt("issue本文", null);
  assert.ok(systemPrompt.length > 0);
});
