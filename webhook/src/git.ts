import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.ts";
import { scrubEnv } from "./env.ts";

export type GitResult = { exitCode: number | null; stdout: string; stderr: string };

async function execGit(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<GitResult> {
  const child = spawn("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c: string) => (stdout += c));
  child.stderr.on("data", (c: string) => (stderr += c));
  const [exitCode] = (await once(child, "close")) as [number | null];
  return { exitCode, stdout, stderr };
}

function assertOk(result: GitResult, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`git ${action} failed (exit=${result.exitCode}): ${result.stderr || result.stdout}`);
  }
}

export type GitWorkspace = {
  runtimeDir: string;
  cloneDir: string;
  env: NodeJS.ProcessEnv;
};

/**
 * リポジトリを隔離ディレクトリに HTTPS + GIT_ASKPASS で clone する。
 *
 * SSH ではなく HTTPS を選ぶのは、clone した .git/config に平文トークンを残さないため。
 * GIT_ASKPASS スクリプトは clone ディレクトリの外 (claude の cwd 境界の外) に置くので、
 * claude が --tools Read を持っていてもトークンを読めない。
 */
export async function prepareGitWorkspace(owner: string, repo: string): Promise<GitWorkspace> {
  const runtimeDir = await mkdtemp(join(tmpdir(), "agent-runner-pr-"));
  const cloneDir = join(runtimeDir, "repo");
  const askpassPath = join(runtimeDir, "askpass.sh");

  await writeFile(askpassPath, `#!/bin/sh\nprintf '%s' "$AGENT_RUNNER_GIT_TOKEN"\n`, {
    mode: 0o700,
  });
  await chmod(askpassPath, 0o700);

  const env: NodeJS.ProcessEnv = {
    ...scrubEnv(process.env),
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    AGENT_RUNNER_GIT_TOKEN: config.githubToken,
  };

  const url = `https://github.com/${owner}/${repo}.git`;
  assertOk(
    await execGit(["clone", "--depth", "50", "--single-branch", url, cloneDir], env),
    "clone",
  );
  assertOk(
    await execGit(["-C", cloneDir, "config", "user.name", config.botName], env),
    "config user.name",
  );
  assertOk(
    await execGit(["-C", cloneDir, "config", "user.email", config.botEmail], env),
    "config user.email",
  );

  return { runtimeDir, cloneDir, env };
}

export async function createBranch(ws: GitWorkspace, branch: string): Promise<void> {
  assertOk(await execGit(["-C", ws.cloneDir, "switch", "-c", branch], ws.env), "switch -c");
}

/**
 * `prepareGitWorkspace` で clone した後、既存のブランチを checkout する版。
 * `--single-branch` clone で作った remote の fetch refspec はデフォルトブランチ限定なので、
 * 対象ブランチは明示的な refspec で `FETCH_HEAD` に取得してから local branch を作る。
 */
export async function prepareGitWorkspaceFromBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<GitWorkspace> {
  const ws = await prepareGitWorkspace(owner, repo);
  assertOk(
    await execGit(["-C", ws.cloneDir, "fetch", "origin", branch], ws.env),
    "fetch branch",
  );
  assertOk(
    await execGit(["-C", ws.cloneDir, "checkout", "-b", branch, "FETCH_HEAD"], ws.env),
    "checkout branch",
  );
  return ws;
}

export type MergeMainResult = {
  conflicted: boolean;
  conflictFiles: string[];
};

/**
 * 現在 checkout しているブランチに `origin/main` を merge する (`--no-commit`)。
 * コンフリクトが無ければ merge の結果を破棄し、作業ツリーをクリーンなまま保つ
 * (このジョブはコンフリクト解決以外の変更を意図せず持ち込まないため)。
 * コンフリクトがあれば、マーカーが書き込まれた状態のまま呼び出し側に返す。
 */
export async function mergeMain(ws: GitWorkspace): Promise<MergeMainResult> {
  assertOk(
    await execGit(
      ["-C", ws.cloneDir, "fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"],
      ws.env,
    ),
    "fetch main",
  );
  await execGit(
    ["-C", ws.cloneDir, "merge", "--no-commit", "--no-ff", "origin/main"],
    ws.env,
  );

  const diff = await execGit(
    ["-C", ws.cloneDir, "diff", "--name-only", "--diff-filter=U"],
    ws.env,
  );
  const conflictFiles = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (conflictFiles.length === 0) {
    // コンフリクトが無ければ (「Already up to date」やクリーンマージ含め) merge を中断し、
    // 作業ツリー・インデックスを HEAD の状態に戻す。MERGE_HEAD が無い場合の失敗は無害。
    await execGit(["-C", ws.cloneDir, "merge", "--abort"], ws.env);
    return { conflicted: false, conflictFiles: [] };
  }

  return { conflicted: true, conflictFiles };
}

/**
 * git status --porcelain の変更ファイル一覧 (未ステージ・未追跡も含む)。
 * --untracked-files=all を指定し、新規の未追跡ディレクトリを1エントリに丸めず
 * 個々のファイルパスとして展開する (safety.ts がファイル単位で安全性を判定するため)。
 */
export async function changedFiles(ws: GitWorkspace): Promise<string[]> {
  const result = await execGit(
    ["-C", ws.cloneDir, "status", "--porcelain=v1", "--untracked-files=all"],
    ws.env,
  );
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())
    .filter((path) => path.length > 0);
}

/** HEAD 時点でのファイル内容。存在しなければ null (新規ファイル)。 */
export async function showFileAtHead(ws: GitWorkspace, path: string): Promise<string | null> {
  const result = await execGit(["-C", ws.cloneDir, "show", `HEAD:${path}`], ws.env);
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

export async function commitAll(ws: GitWorkspace, message: string): Promise<void> {
  assertOk(await execGit(["-C", ws.cloneDir, "add", "-A"], ws.env), "add -A");
  assertOk(await execGit(["-C", ws.cloneDir, "commit", "-m", message], ws.env), "commit");
}

export async function diffStatSinceParent(ws: GitWorkspace): Promise<string> {
  const result = await execGit(["-C", ws.cloneDir, "diff", "--stat", "HEAD~1"], ws.env);
  return result.stdout;
}

export async function push(ws: GitWorkspace, branch: string): Promise<void> {
  assertOk(await execGit(["-C", ws.cloneDir, "push", "-u", "origin", branch], ws.env), "push");
}

export async function cleanupWorkspace(ws: GitWorkspace): Promise<void> {
  await rm(ws.runtimeDir, { recursive: true, force: true });
}
