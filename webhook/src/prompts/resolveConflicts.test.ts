import assert from "node:assert/strict";
import { test } from "node:test";
import { buildResolveConflictPrompt } from "./resolveConflicts.ts";

const CONFLICTED = [
  "line1",
  "<<<<<<< HEAD",
  "pr change",
  "=======",
  "main change",
  ">>>>>>> origin/main",
  "line3",
].join("\n");

test("buildResolveConflictPrompt: 対象ファイルパスとコンフリクト内容がuserPromptに含まれる", () => {
  const { userPrompt } = buildResolveConflictPrompt("src/shared.ts", CONFLICTED);

  assert.match(userPrompt, /src\/shared\.ts/);
  assert.ok(userPrompt.includes(CONFLICTED));
});

test("buildResolveConflictPrompt: systemPromptがmainとPRブランチ両方の意図を汲むよう指示する", () => {
  const { systemPrompt } = buildResolveConflictPrompt("src/shared.ts", CONFLICTED);

  assert.match(systemPrompt, /main/);
  assert.match(systemPrompt, /PR ブランチ/);
  assert.match(systemPrompt, /unresolvable/);
});
