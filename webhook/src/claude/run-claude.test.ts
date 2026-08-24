import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runClaude } from "./run-claude.ts";

/**
 * claude cli 本体は呼ばない (課金とネットワークが要るため)。
 * ここで担保したいのは spawn に失敗したときの原因の切り分けだけ。
 * spawn はコマンド名の解決に子プロセスへ渡す env の PATH を使うので、
 * PATH を差し替えれば systemd 常駐時の状況をそのまま再現できる。
 */
async function withPath<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.PATH;
  process.env.PATH = path;
  try {
    return await fn();
  } finally {
    process.env.PATH = original;
  }
}

function makeFakeClaudeDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "run-claude-")), "bin");
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, "claude");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
  return dir;
}

test("claude が PATH に無いとき、PATH の問題だと分かる spawn 失敗を返す", async () => {
  const result = await withPath("/nonexistent-dir-for-run-claude-test", () =>
    runClaude({
      prompt: "テスト",
      cwd: process.cwd(),
      systemPrompt: "テスト",
      timeoutMs: 10_000,
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.kind, "spawn");
  assert.match(result.failure.detail, /claude コマンドが PATH 上に見つかりません/);
  // 何を直せばいいか (unit の PATH) と、今の PATH の実際の値が読み取れること。
  assert.match(result.failure.detail, /install-service\.sh/);
  assert.match(result.failure.detail, /PATH=\/nonexistent-dir-for-run-claude-test/);
  assert.equal(result.costUsd, 0);
});

test("claude はあるが cwd が無いときは、PATH のせいにしない", async () => {
  // cwd が存在しない場合も spawn は "spawn claude ENOENT" を投げる。
  // メッセージが同じなので、claude を解決できるかどうかで切り分ける必要がある。
  const result = await withPath(makeFakeClaudeDir(), () =>
    runClaude({
      prompt: "テスト",
      cwd: "/nonexistent-cwd-for-run-claude-test",
      systemPrompt: "テスト",
      timeoutMs: 10_000,
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.kind, "spawn");
  assert.doesNotMatch(result.failure.detail, /PATH 上に見つかりません/);
  assert.match(result.failure.detail, /cwd=\/nonexistent-cwd-for-run-claude-test/);
});
