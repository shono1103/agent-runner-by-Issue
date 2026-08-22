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
