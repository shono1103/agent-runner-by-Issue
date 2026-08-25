import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFiveW1H } from "../five-w1h.ts";
import { buildCommitMessage, buildCommitPlanPrompt, type CommitPlanEntry } from "./commitPlan.ts";

test("buildCommitPlanPrompt: 変更ファイル一覧とdiffがuserPromptに含まれる", () => {
  const { userPrompt } = buildCommitPlanPrompt(["a.ts", "b.ts"], "diff --git a/a.ts b/a.ts");

  assert.match(userPrompt, /- a\.ts/);
  assert.match(userPrompt, /- b\.ts/);
  assert.match(userPrompt, /diff --git a\/a\.ts b\/a\.ts/);
});

test("buildCommitPlanPrompt: commit を実行しない (構造化出力のみ) ことを指示する", () => {
  const { systemPrompt } = buildCommitPlanPrompt([], "");
  assert.match(systemPrompt, /構造化出力/);
});

const ENTRY: CommitPlanEntry = {
  files: ["a.ts"],
  who: "agent-runner",
  what: "add a.ts",
  when: "2026-08-24",
  where: "webhook/src",
  why: "to satisfy the issue",
  how: "wrote a.ts",
};

test("buildCommitMessage: 5W1Hすべて揃ったエントリから生成したメッセージはcheckFiveW1Hを満たす", () => {
  const message = buildCommitMessage(ENTRY);
  const check = checkFiveW1H(message);
  assert.equal(check.satisfies, true);
});

test("buildCommitMessage: 1行目 (subject) にwhatの内容が含まれる", () => {
  const message = buildCommitMessage(ENTRY);
  assert.equal(message.split("\n")[0], "add a.ts");
});

test("buildCommitMessage: whyが空文字のエントリから生成したメッセージはcheckFiveW1Hを満たさない", () => {
  const message = buildCommitMessage({ ...ENTRY, why: "" });
  const check = checkFiveW1H(message);
  assert.equal(check.hasWhy, false);
  assert.equal(check.satisfies, false);
});
