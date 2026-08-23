import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after as afterAll, test } from "node:test";
import { changedFiles, mergeMain } from "./git.ts";
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
