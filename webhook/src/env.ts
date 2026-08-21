/**
 * claude cli / git を子プロセスとして起動するときに渡す環境変数を作る。
 *
 * このプロセス (webhook サーバー) が Claude Code のセッション内で起動された場合、
 * CLAUDECODE=1 等が継承され、子の claude cli が入れ子セッション扱いになりうる。
 * また GITHUB_TOKEN / AGENT_RUNNER_TOKEN を子プロセスに渡すと、
 * claude cli がツール経由でそれを読み取れてしまう (漏洩経路)。
 * どちらも子プロセスには不要な情報なので、明示的に除去する。
 */
const DROP_KEYS = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "AI_AGENT",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AGENT_RUNNER_TOKEN",
  "GITHUB_PAT",
]);

export function scrubEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (DROP_KEYS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
