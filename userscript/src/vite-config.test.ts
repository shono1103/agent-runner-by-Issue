import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// vite.config.ts は vite / vite-plugin-monkey に依存しており、依存パッケージが
// インストールされていない環境でも実行できるよう、設定ファイルをソーステキストとして
// 読み込み、userscript.match の値を検証する (実際のビルド結果の検証は手動E2Eで行う)。
const configPath = fileURLToPath(new URL("../vite.config.ts", import.meta.url));
const configSource = readFileSync(configPath, "utf-8");

function extractMatch(source: string): string[] {
  const m = /match:\s*(\[[^\]]*\])/.exec(source);
  if (!m || !m[1]) throw new Error("match フィールドが見つかりません");
  return JSON.parse(m[1].replace(/'/g, '"'));
}

test("vite.config.ts: userscriptのmatchがGitHubドメイン全体 (https://github.com/*) をカバーする", () => {
  const match = extractMatch(configSource);
  assert.deepEqual(match, ["https://github.com/*"]);
});

test("vite.config.ts: matchが旧来のissue詳細ページ限定パターンに狭められていない", () => {
  const match = extractMatch(configSource);
  assert.equal(match.includes("https://github.com/*/*/issues/*"), false);
});
