import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after as afterAll, test } from "node:test";
import type { GithubClient, OpenPrRef } from "../github.ts";
import type { IssueRef } from "../types/api.ts";
import {
  cleanupTestWorkspaces,
  commitToOrigin,
  makePrWorkspace,
  type PrWorkspace,
} from "../test-helpers/workspace.ts";
import { runResolveConflictsJob, type ResolveConflictsDeps } from "./resolveConflicts.ts";
import { jobStore } from "./store.ts";
import type { ClaudeOk } from "../claude/run-claude.ts";
import type { ResolveConflictStructuredOutput } from "../prompts/resolveConflicts.ts";

afterAll(cleanupTestWorkspaces);

const REF: IssueRef = { owner: "o", repo: "r", issueNumber: 42 };
const FAKE_CLIENT = {} as unknown as GithubClient;

function pushShouldNotBeCalled(): ResolveConflictsDeps["push"] {
  return async () => {
    throw new Error("push は呼ばれてはいけません");
  };
}

function fakeRunClaude(
  byFile: Record<string, ResolveConflictStructuredOutput>,
): ResolveConflictsDeps["runClaude"] {
  const impl = async (opts: { prompt: string }) => {
    const match = Object.entries(byFile).find(([path]) => opts.prompt.includes(path));
    if (!match) throw new Error(`予期しない claude cli 呼び出し: ${opts.prompt.slice(0, 200)}`);
    const structured = match[1];
    return {
      ok: true,
      structured,
      text: "",
      costUsd: 0,
      raw: {},
    } satisfies ClaudeOk<ResolveConflictStructuredOutput>;
  };
  return impl as unknown as ResolveConflictsDeps["runClaude"];
}

async function makeConflictingPr(opts: {
  branchName: string;
  base: Record<string, string>;
  branchChanges: Record<string, string>;
  mainChanges: Record<string, string>;
}): Promise<PrWorkspace> {
  const pw = await makePrWorkspace({
    base: opts.base,
    branchName: opts.branchName,
    branchChanges: opts.branchChanges,
  });
  await commitToOrigin(pw.originDir, opts.mainChanges, "main change");
  return pw;
}

test("runResolveConflictsJob: 対象issueにPRが存在しない場合、failedになり理由が明示される", async () => {
  const job = jobStore.create("resolve-conflicts");

  await runResolveConflictsJob(job, FAKE_CLIENT, REF, {
    findOpenPrForIssue: async () => null,
    push: pushShouldNotBeCalled(),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  assert.match(finished.error ?? "", /見つかりません/);
});

test("runResolveConflictsJob: コンフリクトが無い場合、pushを行わずsucceededになる", async () => {
  const pw = await makeConflictingPr({
    branchName: "agent-runner/issue-42-aaaa1111",
    base: { "a.txt": "base\n", "b.txt": "b-base\n" },
    branchChanges: { "a.txt": "base\nfeature change\n" },
    mainChanges: { "b.txt": "b-base\nmain change\n" },
  });
  const job = jobStore.create("resolve-conflicts");
  const pr: OpenPrRef = { number: 20, branch: "agent-runner/issue-42-aaaa1111" };

  await runResolveConflictsJob(job, FAKE_CLIENT, REF, {
    findOpenPrForIssue: async () => pr,
    prepareGitWorkspaceFromBranch: async () => pw.ws,
    push: pushShouldNotBeCalled(),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "succeeded");
  const result = finished.result as { resolved: boolean; pushed: boolean; message: string };
  assert.equal(result.resolved, false);
  assert.equal(result.pushed, false);
  assert.match(result.message, /解決不要/);
});

test("runResolveConflictsJob: コンフリクトがあり全て解決できた場合、commit・pushされsucceededになる", async () => {
  const pw = await makeConflictingPr({
    branchName: "agent-runner/issue-42-bbbb2222",
    base: { "a.txt": "base\n" },
    branchChanges: { "a.txt": "feature change\n" },
    mainChanges: { "a.txt": "main change\n" },
  });
  const job = jobStore.create("resolve-conflicts");
  const pr: OpenPrRef = { number: 21, branch: "agent-runner/issue-42-bbbb2222" };

  await runResolveConflictsJob(job, FAKE_CLIENT, REF, {
    findOpenPrForIssue: async () => pr,
    prepareGitWorkspaceFromBranch: async () => pw.ws,
    runClaude: fakeRunClaude({
      "a.txt": { resolvedContent: "resolved together\n", unresolvable: false, reason: "" },
    }),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "succeeded");
  const result = finished.result as { resolved: boolean; pushed: boolean; resolvedFiles: string[] };
  assert.equal(result.resolved, true);
  assert.equal(result.pushed, true);
  assert.deepEqual(result.resolvedFiles, ["a.txt"]);

  const pushedContent = execFileSync(
    "git",
    ["-C", pw.originDir, "show", `${pr.branch}:a.txt`],
    { encoding: "utf8" },
  );
  assert.equal(pushedContent, "resolved together\n");
});

test("runResolveConflictsJob: 一部のファイルがunresolvableな場合、pushを行わずfailedになり一覧が含まれる", async () => {
  const pw = await makeConflictingPr({
    branchName: "agent-runner/issue-42-cccc3333",
    base: { "a.txt": "base\n" },
    branchChanges: { "a.txt": "feature change\n" },
    mainChanges: { "a.txt": "main change\n" },
  });
  const job = jobStore.create("resolve-conflicts");
  const pr: OpenPrRef = { number: 22, branch: "agent-runner/issue-42-cccc3333" };

  await runResolveConflictsJob(job, FAKE_CLIENT, REF, {
    findOpenPrForIssue: async () => pr,
    prepareGitWorkspaceFromBranch: async () => pw.ws,
    push: pushShouldNotBeCalled(),
    runClaude: fakeRunClaude({
      "a.txt": {
        resolvedContent: "",
        unresolvable: true,
        reason: "意味的に両立できません",
      },
    }),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  assert.match(finished.error ?? "", /自動解決できない/);
  const result = finished.result as { unresolvableFiles: string[]; reasons: Record<string, string> };
  assert.deepEqual(result.unresolvableFiles, ["a.txt"]);
  assert.equal(result.reasons["a.txt"], "意味的に両立できません");
});

test("runResolveConflictsJob: assertSafeDiffが拒否する変更が含まれる場合、pushを行わずfailedになる", async () => {
  const pw = await makeConflictingPr({
    branchName: "agent-runner/issue-42-dddd4444",
    base: { ".github/workflows/ci.yml": "name: ci\n" },
    branchChanges: { ".github/workflows/ci.yml": "name: ci\nfeature: true\n" },
    mainChanges: { ".github/workflows/ci.yml": "name: ci\nmain: true\n" },
  });
  const job = jobStore.create("resolve-conflicts");
  const pr: OpenPrRef = { number: 23, branch: "agent-runner/issue-42-dddd4444" };

  await runResolveConflictsJob(job, FAKE_CLIENT, REF, {
    findOpenPrForIssue: async () => pr,
    prepareGitWorkspaceFromBranch: async () => pw.ws,
    push: pushShouldNotBeCalled(),
    runClaude: fakeRunClaude({
      ".github/workflows/ci.yml": {
        resolvedContent: "name: ci\nfeature: true\nmain: true\n",
        unresolvable: false,
        reason: "",
      },
    }),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  const result = finished.result as { rejectedFiles: string[] };
  assert.deepEqual(result.rejectedFiles, [".github/workflows/ci.yml"]);
});
