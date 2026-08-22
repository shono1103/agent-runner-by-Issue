import assert from "node:assert/strict";
import { after as afterAll, test } from "node:test";
import { changedFiles } from "./git.ts";
import { cleanupTestWorkspaces, makeGitWorkspace, writeFiles } from "./test-helpers/workspace.ts";

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
