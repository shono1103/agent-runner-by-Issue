import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGithubToken } from "./config.ts";

test("resolveGithubToken: source=pat かつ GITHUB_TOKEN があればそれを返す", () => {
  const token = resolveGithubToken("pat", "my-pat-token");
  assert.equal(token, "my-pat-token");
});

test("resolveGithubToken: source=pat かつ GITHUB_TOKEN が無ければ例外を投げる", () => {
  assert.throws(() => resolveGithubToken("pat", undefined), /GITHUB_TOKEN が必須です/);
});

test("resolveGithubToken: source=pat かつ GITHUB_TOKEN が空文字なら例外を投げる", () => {
  assert.throws(() => resolveGithubToken("pat", "   "), /GITHUB_TOKEN が必須です/);
});

test("resolveGithubToken: source=gh なら gh auth token の出力 (trim 済み) を返す", () => {
  const token = resolveGithubToken("gh", undefined, () => "gho_xxxxx\n");
  assert.equal(token, "gho_xxxxx");
});

test("resolveGithubToken: source=gh で gh auth token が失敗したら例外を投げる", () => {
  assert.throws(
    () =>
      resolveGithubToken("gh", undefined, () => {
        throw new Error("not logged in");
      }),
    /gh auth token.*失敗しました/,
  );
});

test("resolveGithubToken: source=gh で出力が空文字なら例外を投げる", () => {
  assert.throws(() => resolveGithubToken("gh", undefined, () => "\n"), /出力が空でした/);
});
