import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after as afterAll, test } from "node:test";
import {
  changedFiles,
  commitEach,
  diffSince,
  mergeMain,
  revParseHead,
  showCommitDiff,
  stageAllAndDiff,
} from "./git.ts";
import {
  cleanupTestWorkspaces,
  commitToOrigin,
  makeGitWorkspace,
  makePrWorkspace,
  writeFiles,
} from "./test-helpers/workspace.ts";

afterAll(cleanupTestWorkspaces);

test("changedFiles: 新規の未追跡ディレクトリを1エントリに丸めず、個々のファイルパスを返す", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# x\n" });
  await writeFiles(ws.cloneDir, {
    ".github/ISSUE_TEMPLATE/bug_report.yml": "name: bug\n",
    ".github/ISSUE_TEMPLATE/feature_request.yml": "name: feature\n",
  });

  const files = await changedFiles(ws);

  assert.deepEqual(
    [...files].sort(),
    [".github/ISSUE_TEMPLATE/bug_report.yml", ".github/ISSUE_TEMPLATE/feature_request.yml"],
  );
});

test("mergeMain: コンフリクトが無い場合、conflicted: false を返し、作業ツリーに変更を残さない", async () => {
  const { ws, originDir } = await makePrWorkspace({
    base: { "a.txt": "base\n", "b.txt": "b-base\n" },
    branchName: "agent-runner/issue-1-aaaa1111",
    branchChanges: { "a.txt": "base\nfeature change\n" },
  });
  await commitToOrigin(originDir, { "b.txt": "b-base\nmain change\n" }, "main change");

  const result = await mergeMain(ws);

  assert.equal(result.conflicted, false);
  assert.deepEqual(result.conflictFiles, []);
  const status = execFileSync("git", ["-C", ws.cloneDir, "status", "--porcelain"], {
    encoding: "utf8",
  });
  assert.equal(status.trim(), "");
});

test("mergeMain: コンフリクトがある場合、conflicted: true とコンフリクトファイル一覧を返す", async () => {
  const { ws, originDir } = await makePrWorkspace({
    base: { "a.txt": "base\n" },
    branchName: "agent-runner/issue-2-bbbb2222",
    branchChanges: { "a.txt": "feature change\n" },
  });
  await commitToOrigin(originDir, { "a.txt": "main change\n" }, "main change");

  const result = await mergeMain(ws);

  assert.equal(result.conflicted, true);
  assert.deepEqual(result.conflictFiles, ["a.txt"]);
});

test("stageAllAndDiff: 全変更 (未追跡含む) をdiffで返し、indexは元に戻す (unstaged)", async () => {
  const ws = await makeGitWorkspace({ "a.txt": "base\n" });
  await writeFiles(ws.cloneDir, { "a.txt": "base\nchanged\n", "new.txt": "new file\n" });

  const diff = await stageAllAndDiff(ws);

  assert.match(diff, /a\.txt/);
  assert.match(diff, /new\.txt/);
  const status = execFileSync("git", ["-C", ws.cloneDir, "status", "--porcelain"], {
    encoding: "utf8",
  });
  // 全行が unstaged (先頭カラムが空白か "?") であること
  for (const line of status.trim().split("\n").filter((l) => l.length > 0)) {
    assert.ok(line[0] === " " || line[0] === "?", `unexpected staged line: ${line}`);
  }
});

test("commitEach: 複数のファイルグループをそれぞれ個別のcommitとして記録する", async () => {
  const ws = await makeGitWorkspace({ "a.txt": "base\n", "b.txt": "base\n" });
  await writeFiles(ws.cloneDir, { "a.txt": "base\na-change\n", "b.txt": "base\nb-change\n" });

  const created = await commitEach(ws, [
    { message: "change a", files: ["a.txt"] },
    { message: "change b", files: ["b.txt"] },
  ]);

  assert.equal(created.length, 2);
  assert.equal(created[0]?.message, "change a");
  assert.equal(created[1]?.message, "change b");
  assert.notEqual(created[0]?.sha, created[1]?.sha);

  const log = execFileSync("git", ["-C", ws.cloneDir, "log", "--format=%s", "-n", "2"], {
    encoding: "utf8",
  });
  assert.deepEqual(log.trim().split("\n"), ["change b", "change a"]);
});

test("commitEach: filesが空のグループはcommitを作らずスキップする", async () => {
  const ws = await makeGitWorkspace({ "a.txt": "base\n" });
  await writeFiles(ws.cloneDir, { "a.txt": "base\nchanged\n" });

  const created = await commitEach(ws, [
    { message: "empty group", files: [] },
    { message: "change a", files: ["a.txt"] },
  ]);

  assert.equal(created.length, 1);
  assert.equal(created[0]?.message, "change a");
});

test("showCommitDiff: 指定したcommitの差分だけを返す", async () => {
  const ws = await makeGitWorkspace({ "a.txt": "base\n" });
  await writeFiles(ws.cloneDir, { "a.txt": "changed\n" });
  const [created] = await commitEach(ws, [{ message: "change a", files: ["a.txt"] }]);

  const diff = await showCommitDiff(ws, created!.sha);

  assert.match(diff, /-base/);
  assert.match(diff, /\+changed/);
});

test("diffSince: baseSha からHEADまでの累積差分を返す (複数commitをまたぐ)", async () => {
  const ws = await makeGitWorkspace({ "a.txt": "base\n", "b.txt": "base\n" });
  const baseSha = await revParseHead(ws);
  await writeFiles(ws.cloneDir, { "a.txt": "base\na-change\n", "b.txt": "base\nb-change\n" });
  await commitEach(ws, [
    { message: "change a", files: ["a.txt"] },
    { message: "change b", files: ["b.txt"] },
  ]);

  const diff = await diffSince(ws, baseSha);

  assert.match(diff, /a-change/);
  assert.match(diff, /b-change/);
});
