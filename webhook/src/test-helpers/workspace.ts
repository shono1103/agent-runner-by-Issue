import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GitWorkspace } from "../git.ts";

const cleanupDirs: string[] = [];

export async function cleanupTestWorkspaces(): Promise<void> {
  await Promise.all(cleanupDirs.map((d) => rm(d, { recursive: true, force: true })));
}

export async function writeFiles(cloneDir: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cloneDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
}

export async function makeGitWorkspace(
  initialFiles: Record<string, string>,
): Promise<GitWorkspace> {
  const runtimeDir = await mkdtemp(join(tmpdir(), "agent-runner-test-"));
  cleanupDirs.push(runtimeDir);
  const cloneDir = join(runtimeDir, "repo");
  await mkdir(cloneDir, { recursive: true });

  const git = (...args: string[]) => execFileSync("git", args, { cwd: cloneDir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.com");
  await writeFiles(cloneDir, initialFiles);
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  return { runtimeDir, cloneDir, env: process.env };
}

export type PrWorkspace = {
  /** PRブランチを checkout 済みの GitWorkspace ("origin" remote あり)。 */
  ws: GitWorkspace;
  /** "GitHub 上の main" を模したローカルリポジトリのパス。直接 commit して進めてよい。 */
  originDir: string;
};

/**
 * `mergeMain()` / `resolve-conflicts` ジョブ結合テスト向けに、
 * "main" を持つローカル origin と、そこから分岐した PR ブランチの clone を用意する。
 * ネットワークアクセス無しで `git fetch origin main` 相当を再現するための test helper。
 */
export async function makePrWorkspace(opts: {
  base: Record<string, string>;
  branchName: string;
  branchChanges: Record<string, string>;
}): Promise<PrWorkspace> {
  // origin と ws.runtimeDir (clone 側) は別ディレクトリにする。
  // `cleanupWorkspace(ws)` が ws.runtimeDir ごと削除するため、同じ親を共有すると
  // ジョブ成功後の origin 側アサーション (push 結果の確認など) が壊れてしまう。
  const originParentDir = await mkdtemp(join(tmpdir(), "agent-runner-test-origin-"));
  cleanupDirs.push(originParentDir);
  const runtimeDir = await mkdtemp(join(tmpdir(), "agent-runner-test-"));
  cleanupDirs.push(runtimeDir);
  const originDir = join(originParentDir, "origin");
  const cloneDir = join(runtimeDir, "repo");

  await mkdir(originDir, { recursive: true });
  const originGit = (...args: string[]) =>
    execFileSync("git", args, { cwd: originDir, stdio: "pipe" });
  originGit("init", "-q", "-b", "main");
  originGit("config", "user.name", "test");
  originGit("config", "user.email", "test@example.com");
  await writeFiles(originDir, opts.base);
  originGit("add", "-A");
  originGit("commit", "-q", "-m", "init");

  execFileSync("git", ["clone", "-q", originDir, cloneDir], { stdio: "pipe" });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: cloneDir, stdio: "pipe" });
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.com");
  git("switch", "-c", opts.branchName);
  await writeFiles(cloneDir, opts.branchChanges);
  git("add", "-A");
  git("commit", "-q", "-m", "pr change");
  git("push", "-q", "-u", "origin", opts.branchName);

  return { ws: { runtimeDir, cloneDir, env: process.env }, originDir };
}

/** `makePrWorkspace` で作った origin (main) に直接 commit を積む。他PRのマージを模す。 */
export async function commitToOrigin(
  originDir: string,
  files: Record<string, string>,
  message: string,
): Promise<void> {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: originDir, stdio: "pipe" });
  await writeFiles(originDir, files);
  git("add", "-A");
  git("commit", "-q", "-m", message);
}
