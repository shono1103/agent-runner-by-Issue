import assert from "node:assert/strict";
import { test } from "node:test";
import { checkFiveW1H } from "./five-w1h.ts";

const FULL_MESSAGE = [
  "feat: add commit splitting",
  "",
  "Who: agent-runner (claude cli)",
  "What: split the rough diff into per-concern commits",
  "When: 2026-08-24",
  "Where: webhook/src/git.ts and webhook/src/jobs/createPr.ts",
  "Why: to satisfy the minimal-commit requirement of issue #7",
  "How: plan groups with claude, then git add + git commit per group",
].join("\n");

test("checkFiveW1H: 6要素すべて揃っている場合 satisfies が true になる", () => {
  const result = checkFiveW1H(FULL_MESSAGE);
  assert.equal(result.hasWho, true);
  assert.equal(result.hasWhat, true);
  assert.equal(result.hasWhen, true);
  assert.equal(result.hasWhere, true);
  assert.equal(result.hasWhy, true);
  assert.equal(result.hasHow, true);
  assert.equal(result.satisfies, true);
});

test("checkFiveW1H: Why が欠落している場合 hasWhy=false かつ satisfies=false になる", () => {
  const withoutWhy = FULL_MESSAGE.split("\n")
    .filter((line) => !line.startsWith("Why:"))
    .join("\n");

  const result = checkFiveW1H(withoutWhy);

  assert.equal(result.hasWhy, false);
  assert.equal(result.satisfies, false);
  // 他の要素は引き続き true のまま (Why 以外は欠落していない)
  assert.equal(result.hasWho, true);
  assert.equal(result.hasWhat, true);
});

test("checkFiveW1H: ラベルはあるが値が空の場合はその要素を欠落として扱う", () => {
  const withEmptyWhen = FULL_MESSAGE.replace(/^When:.*$/im, "When:");

  const result = checkFiveW1H(withEmptyWhen);

  assert.equal(result.hasWhen, false);
  assert.equal(result.satisfies, false);
});

test("checkFiveW1H: 何も要素を含まない従来型のメッセージはすべて false になる", () => {
  const legacy = "feat: implement #42\n\nCloses #42\n\nCo-Authored-By: claude <noreply@anthropic.com>";

  const result = checkFiveW1H(legacy);

  assert.equal(result.satisfies, false);
  assert.equal(result.hasWho, false);
  assert.equal(result.hasWhat, false);
  assert.equal(result.hasWhen, false);
  assert.equal(result.hasWhere, false);
  assert.equal(result.hasWhy, false);
  assert.equal(result.hasHow, false);
});
