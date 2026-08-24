import assert from "node:assert/strict";
import { after as afterAll, test } from "node:test";
import { config } from "../config.ts";
import type { ClaudeErr, ClaudeOk } from "../claude/run-claude.ts";
import type { GithubClient, IssueComment } from "../github.ts";
import { buildSourceMarker } from "../markers.ts";
import type { CommitPlan } from "../prompts/commitPlan.ts";
import type { IssueRef } from "../types/api.ts";
import { cleanupTestWorkspaces, makeGitWorkspace, writeFiles } from "../test-helpers/workspace.ts";
import { runCreatePrJob, type CreatePrDeps } from "./createPr.ts";
import { jobStore } from "./store.ts";

afterAll(cleanupTestWorkspaces);

const REF: IssueRef = { owner: "o", repo: "r", issueNumber: 7 };
const FAKE_CLIENT = {} as unknown as GithubClient;

function trustedComments(): IssueComment[] {
  const mk = (kind: "requirements" | "architecture" | "tests", id: number): IssueComment => ({
    id,
    login: "test-user",
    authorAssociation: "OWNER",
    body: `${buildSourceMarker(kind)}\n## ${kind}\n本文 (${kind})`,
  });
  return [mk("requirements", 1), mk("architecture", 2), mk("tests", 3)];
}

function pushShouldNotBeCalled(): CreatePrDeps["push"] {
  return async () => {
    throw new Error("push は呼ばれてはいけません");
  };
}

function createPullRequestShouldNotBeCalled(): CreatePrDeps["createPullRequest"] {
  return async () => {
    throw new Error("createPullRequest は呼ばれてはいけません");
  };
}

type FakeRunClaudeOpts = {
  implementFiles: Record<string, string>;
  commitPlan: CommitPlan;
  commitReviewConcerns: string[][];
  branchReviewConcerns: string[];
  failImplement?: boolean;
  failCommitPlan?: boolean;
  failCommitReview?: boolean;
  failBranchReview?: boolean;
};

function fakeRunClaude(opts: FakeRunClaudeOpts): CreatePrDeps["runClaude"] {
  let commitReviewIndex = 0;
  const impl = async (callOpts: {
    prompt: string;
    cwd: string;
    tools?: string[];
  }): Promise<ClaudeOk<unknown> | ClaudeErr> => {
    if ((callOpts.tools ?? []).length > 0) {
      // ラフ実装呼び出し (implement)
      if (opts.failImplement) {
        return { ok: false, costUsd: 0, failure: { kind: "agent", detail: "implement failed" } };
      }
      await writeFiles(callOpts.cwd, opts.implementFiles);
      return { ok: true, structured: undefined, text: "done", costUsd: 0.01, raw: {} };
    }
    if (callOpts.prompt.includes("分割対象の変更ファイル一覧")) {
      if (opts.failCommitPlan) {
        return { ok: false, costUsd: 0, failure: { kind: "agent", detail: "commit-plan failed" } };
      }
      return { ok: true, structured: opts.commitPlan, text: "", costUsd: 0.01, raw: {} };
    }
    if (callOpts.prompt.includes("# commit メッセージ")) {
      if (opts.failCommitReview) {
        return { ok: false, costUsd: 0, failure: { kind: "agent", detail: "commit-review failed" } };
      }
      const concerns = opts.commitReviewConcerns[commitReviewIndex] ?? [];
      commitReviewIndex++;
      return { ok: true, structured: { concerns }, text: "", costUsd: 0.01, raw: {} };
    }
    if (callOpts.prompt.includes("ブランチ全体のdiff")) {
      if (opts.failBranchReview) {
        return { ok: false, costUsd: 0, failure: { kind: "agent", detail: "branch-review failed" } };
      }
      return {
        ok: true,
        structured: { concerns: opts.branchReviewConcerns },
        text: "",
        costUsd: 0.01,
        raw: {},
      };
    }
    throw new Error(`予期しない claude cli 呼び出し: ${callOpts.prompt.slice(0, 100)}`);
  };
  return impl as unknown as CreatePrDeps["runClaude"];
}

const TWO_FILE_PLAN: CommitPlan = {
  commits: [
    {
      files: ["a.ts"],
      who: "agent-runner",
      what: "add a.ts",
      when: "2026-08-24",
      where: "a.ts",
      why: "issue #7",
      how: "wrote a.ts",
    },
    {
      files: ["b.ts"],
      who: "agent-runner",
      what: "add b.ts",
      when: "2026-08-24",
      where: "b.ts",
      why: "issue #7",
      how: "wrote b.ts",
    },
  ],
};

test("runCreatePrJob: 正常系 - 全フェーズがログに記録され、複数commit・レビュー・PR作成・懸念コメント投稿が行われる", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);
  const pushCalls: { branch: string }[] = [];
  const prCalls: unknown[] = [];
  const commentCalls: { prNumber: number; body: string }[] = [];

  config.dryRun = false;
  try {
    await runCreatePrJob(job, FAKE_CLIENT, REF, {
      getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
      listIssueComments: async () => trustedComments(),
      prepareGitWorkspace: async () => ws,
      runClaude: fakeRunClaude({
        implementFiles: { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 2;\n" },
        commitPlan: TWO_FILE_PLAN,
        commitReviewConcerns: [[], ["nit: consider renaming a"]],
        branchReviewConcerns: [],
      }),
      push: async (_ws, branch) => {
        pushCalls.push({ branch });
      },
      getDefaultBranch: async () => "main",
      createPullRequest: async (_client, input) => {
        prCalls.push(input);
        return { url: "https://github.com/o/r/pull/1", number: 1 };
      },
      createPrComment: async (_client, _ref, prNumber, body) => {
        commentCalls.push({ prNumber, body });
      },
    });
  } finally {
    config.dryRun = true;
  }

  const finished = jobStore.get(job.id)!;
  const logs = finished.logs.join("\n");
  assert.equal(finished.status, "succeeded");
  assert.match(logs, /ラフ実装完了/);
  assert.match(logs, /コミット分割完了: 2件/);
  assert.match(logs, /CI確認/);
  assert.match(logs, /commitレビュー 1\/2完了/);
  assert.match(logs, /commitレビュー 2\/2完了/);
  assert.match(logs, /ブランチdiffレビュー完了/);
  assert.equal(pushCalls.length, 1);
  assert.equal(prCalls.length, 1);
  assert.equal(commentCalls.length, 1);
  assert.match(commentCalls[0]!.body, /nit: consider renaming a/);
  const result = finished.result as { commitCount: number; concernCount: number; prUrl: string };
  assert.equal(result.commitCount, 2);
  assert.equal(result.concernCount, 1);
  assert.equal(result.prUrl, "https://github.com/o/r/pull/1");
});

test("runCreatePrJob: 懸念が0件の場合、PRコメントは投稿されない", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);
  const commentCalls: unknown[] = [];

  config.dryRun = false;
  try {
    await runCreatePrJob(job, FAKE_CLIENT, REF, {
      getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
      listIssueComments: async () => trustedComments(),
      prepareGitWorkspace: async () => ws,
      runClaude: fakeRunClaude({
        implementFiles: { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 2;\n" },
        commitPlan: TWO_FILE_PLAN,
        commitReviewConcerns: [[], []],
        branchReviewConcerns: [],
      }),
      push: async () => {},
      getDefaultBranch: async () => "main",
      createPullRequest: async () => ({ url: "https://github.com/o/r/pull/2", number: 2 }),
      createPrComment: async (_client, _ref, prNumber, body) => {
        commentCalls.push({ prNumber, body });
      },
    });
  } finally {
    config.dryRun = true;
  }

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "succeeded");
  assert.equal(commentCalls.length, 0);
  const result = finished.result as { concernCount: number };
  assert.equal(result.concernCount, 0);
});

test("runCreatePrJob: ラフ実装のclaude cli呼び出しが失敗した場合、コミット分割以降に進まずfailedになる", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);

  await runCreatePrJob(job, FAKE_CLIENT, REF, {
    getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
    listIssueComments: async () => trustedComments(),
    prepareGitWorkspace: async () => ws,
    runClaude: fakeRunClaude({
      implementFiles: {},
      commitPlan: { commits: [] },
      commitReviewConcerns: [],
      branchReviewConcerns: [],
      failImplement: true,
    }),
    push: pushShouldNotBeCalled(),
    createPullRequest: createPullRequestShouldNotBeCalled(),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  assert.match(finished.error ?? "", /claude cli 失敗/);
  assert.doesNotMatch(finished.logs.join("\n"), /コミット分割完了/);
});

test("runCreatePrJob: 生成されたcommitメッセージが5W1Hを満たさない場合、failedになる", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);

  await runCreatePrJob(job, FAKE_CLIENT, REF, {
    getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
    listIssueComments: async () => trustedComments(),
    prepareGitWorkspace: async () => ws,
    runClaude: fakeRunClaude({
      implementFiles: { "a.ts": "export const a = 1;\n" },
      commitPlan: {
        commits: [
          {
            files: ["a.ts"],
            who: "agent-runner",
            what: "add a.ts",
            when: "2026-08-24",
            where: "a.ts",
            why: "", // 欠落させる
            how: "wrote a.ts",
          },
        ],
      },
      commitReviewConcerns: [],
      branchReviewConcerns: [],
    }),
    push: pushShouldNotBeCalled(),
    createPullRequest: createPullRequestShouldNotBeCalled(),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  assert.match(finished.error ?? "", /5W1H/);
});

test("runCreatePrJob: コミットレビューのclaude cli呼び出しが失敗した場合、failedになる", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);

  await runCreatePrJob(job, FAKE_CLIENT, REF, {
    getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
    listIssueComments: async () => trustedComments(),
    prepareGitWorkspace: async () => ws,
    runClaude: fakeRunClaude({
      implementFiles: { "a.ts": "export const a = 1;\n" },
      commitPlan: {
        commits: [
          {
            files: ["a.ts"],
            who: "agent-runner",
            what: "add a.ts",
            when: "2026-08-24",
            where: "a.ts",
            why: "issue #7",
            how: "wrote a.ts",
          },
        ],
      },
      commitReviewConcerns: [],
      branchReviewConcerns: [],
      failCommitReview: true,
    }),
    push: pushShouldNotBeCalled(),
    createPullRequest: createPullRequestShouldNotBeCalled(),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  assert.match(finished.error ?? "", /commitレビューに失敗/);
});

test("runCreatePrJob: ブランチdiffレビューのclaude cli呼び出しが失敗した場合、failedになる", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);

  await runCreatePrJob(job, FAKE_CLIENT, REF, {
    getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
    listIssueComments: async () => trustedComments(),
    prepareGitWorkspace: async () => ws,
    runClaude: fakeRunClaude({
      implementFiles: { "a.ts": "export const a = 1;\n" },
      commitPlan: {
        commits: [
          {
            files: ["a.ts"],
            who: "agent-runner",
            what: "add a.ts",
            when: "2026-08-24",
            where: "a.ts",
            why: "issue #7",
            how: "wrote a.ts",
          },
        ],
      },
      commitReviewConcerns: [[]],
      branchReviewConcerns: [],
      failBranchReview: true,
    }),
    push: pushShouldNotBeCalled(),
    createPullRequest: createPullRequestShouldNotBeCalled(),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  assert.match(finished.error ?? "", /ブランチdiffレビューに失敗/);
});

test("runCreatePrJob: assertSafeDiffが禁止パスへの変更を検出した場合、引き続きfailedになる (非リグレッション)", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);

  await runCreatePrJob(job, FAKE_CLIENT, REF, {
    getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
    listIssueComments: async () => trustedComments(),
    prepareGitWorkspace: async () => ws,
    runClaude: fakeRunClaude({
      implementFiles: { ".github/workflows/ci.yml": "name: ci\nfeature: true\n" },
      commitPlan: { commits: [] },
      commitReviewConcerns: [],
      branchReviewConcerns: [],
    }),
    push: pushShouldNotBeCalled(),
    createPullRequest: createPullRequestShouldNotBeCalled(),
  });

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "failed");
  assert.match(finished.error ?? "", /許可されていない/);
});

test("runCreatePrJob: 懸念のPRコメント投稿に失敗しても、PR作成済みのためsucceededのままになる", async () => {
  const ws = await makeGitWorkspace({ "README.md": "# repo\n" });
  const job = jobStore.create("create-pr", REF);

  config.dryRun = false;
  try {
    await runCreatePrJob(job, FAKE_CLIENT, REF, {
      getIssue: async () => ({ title: "Fix bug", body: "", labels: [] }),
      listIssueComments: async () => trustedComments(),
      prepareGitWorkspace: async () => ws,
      runClaude: fakeRunClaude({
        implementFiles: { "a.ts": "export const a = 1;\n" },
        commitPlan: {
          commits: [
            {
              files: ["a.ts"],
              who: "agent-runner",
              what: "add a.ts",
              when: "2026-08-24",
              where: "a.ts",
              why: "issue #7",
              how: "wrote a.ts",
            },
          ],
        },
        commitReviewConcerns: [["懸念あり"]],
        branchReviewConcerns: [],
      }),
      push: async () => {},
      getDefaultBranch: async () => "main",
      createPullRequest: async () => ({ url: "https://github.com/o/r/pull/3", number: 3 }),
      createPrComment: async () => {
        throw new Error("comment post failed");
      },
    });
  } finally {
    config.dryRun = true;
  }

  const finished = jobStore.get(job.id)!;
  assert.equal(finished.status, "succeeded");
  assert.match(finished.logs.join("\n"), /懸念のPRコメント投稿に失敗しました/);
});
