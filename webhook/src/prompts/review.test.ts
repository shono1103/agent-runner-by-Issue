import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBranchDiffReviewPrompt, buildCommitReviewPrompt } from "./review.ts";

test("buildCommitReviewPrompt: commitメッセージとdiffがuserPromptに含まれる", () => {
  const { userPrompt } = buildCommitReviewPrompt("feat: x", "diff --git a/x b/x");
  assert.match(userPrompt, /feat: x/);
  assert.match(userPrompt, /diff --git a\/x b\/x/);
});

test("buildCommitReviewPrompt: 構造化出力のみを返すよう指示する", () => {
  const { systemPrompt } = buildCommitReviewPrompt("m", "d");
  assert.match(systemPrompt, /構造化出力/);
});

test("buildBranchDiffReviewPrompt: ブランチ全体のdiffがuserPromptに含まれる", () => {
  const { userPrompt } = buildBranchDiffReviewPrompt("diff --git a/y b/y");
  assert.match(userPrompt, /diff --git a\/y b\/y/);
});
