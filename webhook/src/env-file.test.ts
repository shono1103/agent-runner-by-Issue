import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEnvFile } from "./env-file.ts";

test("applyEnvFile: 未設定のキーはファイルの値で埋まる", () => {
  const env: NodeJS.ProcessEnv = {};
  const overridden = applyEnvFile("AGENT_RUNNER_DRY_RUN=false\n", env);
  assert.equal(env.AGENT_RUNNER_DRY_RUN, "false");
  assert.deepEqual(overridden, []);
});

test("applyEnvFile: 既にプロセス側にある値もファイルの値で上書きする", () => {
  // node の --env-file はここで "true" のままにしてしまう。それを直すのがこの関数。
  const env: NodeJS.ProcessEnv = { AGENT_RUNNER_DRY_RUN: "true" };
  const overridden = applyEnvFile("AGENT_RUNNER_DRY_RUN=false\n", env);
  assert.equal(env.AGENT_RUNNER_DRY_RUN, "false");
  assert.deepEqual(overridden, ["AGENT_RUNNER_DRY_RUN"]);
});

test("applyEnvFile: 同じ値なら上書き扱いにしない", () => {
  const env: NodeJS.ProcessEnv = { PORT: "8787" };
  assert.deepEqual(applyEnvFile("PORT=8787\n", env), []);
});

test("applyEnvFile: ファイルに無いキーはプロセス側の値を残す", () => {
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", PORT: "8787" };
  applyEnvFile("HOST=127.0.0.1\n", env);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.PORT, "8787");
  assert.equal(env.HOST, "127.0.0.1");
});

test("applyEnvFile: コメント行と空行は無視する", () => {
  const env: NodeJS.ProcessEnv = {};
  applyEnvFile("# コメント\n\nHOST=127.0.0.1\n", env);
  assert.deepEqual(env, { HOST: "127.0.0.1" });
});
