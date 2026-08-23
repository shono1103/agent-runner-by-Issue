import assert from "node:assert/strict";
import { test } from "node:test";
import type { Octokit } from "@octokit/rest";
import type { GithubClient } from "../github.ts";
import { buildGeneratedMarker } from "../markers.ts";
import type { ClarifyStructuredOutput } from "../prompts/clarify.ts";
import type { RunClaudeOptions, ClaudeOk, ClaudeErr } from "../claude/run-claude.ts";
import type { IssueRef } from "../types/api.ts";
import { runClarifyJob } from "./clarify.ts";
import { jobStore } from "./store.ts";

const REF: IssueRef = { owner: "acme", repo: "widgets", issueNumber: 42 };
const SELF_LOGIN = "agent-runner-bot";

type FakeComment = {
  id: number;
  body: string;
  login: string | null;
  authorAssociation: string;
};

function makeFakeClient(opts: {
  issueBody: string;
  labels: string[];
  comments?: FakeComment[];
}): { client: GithubClient; comments: FakeComment[] } {
  const comments = opts.comments ?? [];
  let nextId = 1000;

  const octokit = {
    paginate: async (
      routeFn: (params: unknown) => Promise<{ data: unknown[] }>,
      params: unknown,
    ) => {
      const res = await routeFn(params);
      return res.data;
    },
    rest: {
      issues: {
        get: async () => ({
          data: {
            title: "テストissue",
            body: opts.issueBody,
            labels: opts.labels.map((name) => ({ name })),
          },
        }),
        listComments: async () => ({
          data: comments.map((c) => ({
            id: c.id,
            body: c.body,
            user: c.login ? { login: c.login } : null,
            author_association: c.authorAssociation,
          })),
        }),
        createComment: async ({ body }: { body: string }) => {
          const created: FakeComment = {
            id: nextId++,
            body,
            login: SELF_LOGIN,
            authorAssociation: "NONE",
          };
          comments.push(created);
          return { data: { id: created.id, body: created.body, user: { login: SELF_LOGIN }, author_association: "NONE" } };
        },
        updateComment: async ({
          comment_id,
          body,
        }: {
          comment_id: number;
          body: string;
        }) => {
          const existing = comments.find((c) => c.id === comment_id);
          if (existing) existing.body = body;
          return { data: {} };
        },
      },
    },
  };

  const client = { octokit: octokit as unknown as Octokit, selfLogin: SELF_LOGIN };
  return { client, comments };
}

function fakeRunClaudeOk(
  structured: ClarifyStructuredOutput,
): (opts: RunClaudeOptions) => Promise<ClaudeOk<ClarifyStructuredOutput> | ClaudeErr> {
  return async () => ({
    ok: true,
    structured,
    text: "",
    costUsd: 0.01,
    raw: {},
  });
}

function fakeRunClaudeFail(): (
  opts: RunClaudeOptions,
) => Promise<ClaudeOk<ClarifyStructuredOutput> | ClaudeErr> {
  return async () => ({
    ok: false,
    costUsd: 0,
    failure: { kind: "agent", detail: "boom" },
  });
}

test("初回実行: 質問コメントが存在しない状態で実行すると、新規コメントが1件作成される", async () => {
  const { client, comments } = makeFakeClient({
    issueBody: "この機能はXXXを実現したい",
    labels: ["type:feature"],
  });
  const job = jobStore.create("clarify");

  await runClarifyJob(job, client, REF, {
    runClaude: fakeRunClaudeOk({
      questions: [{ text: "対象ユーザーは誰ですか？", resolved: false }],
      allResolved: false,
    }),
  });

  assert.equal(jobStore.get(job.id)?.status, "succeeded");
  const clarify = comments.filter((c) => c.body.includes(buildGeneratedMarker("clarify", 1, 1)));
  assert.equal(clarify.length, 1);
  assert.match(clarify[0]!.body, /対象ユーザーは誰ですか？/);
});

test("再実行 (未解消あり): 既存の質問コメントがある状態で実行すると、新規コメントが増えず既存コメントが更新される", async () => {
  const existing: FakeComment = {
    id: 1,
    body: `${buildGeneratedMarker("clarify", 1, 1)}\n\n## 機能要望への質問\n\n- [ ] 質問A\n- [ ] 質問B`,
    login: SELF_LOGIN,
    authorAssociation: "NONE",
  };
  const { client, comments } = makeFakeClient({
    issueBody: "issue本文",
    labels: ["type:feature"],
    comments: [existing],
  });
  const job = jobStore.create("clarify");

  await runClarifyJob(job, client, REF, {
    runClaude: fakeRunClaudeOk({
      questions: [
        { text: "質問A", resolved: true },
        { text: "質問B", resolved: false },
      ],
      allResolved: false,
    }),
  });

  assert.equal(jobStore.get(job.id)?.status, "succeeded");
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.id, existing.id);
});

test("再実行 (未解消あり): 未解決の質問はチェックなし、解消済みの質問はチェック付きで本文に反映される", async () => {
  const existing: FakeComment = {
    id: 1,
    body: `${buildGeneratedMarker("clarify", 1, 1)}\n\n## 機能要望への質問\n\n- [ ] 質問A\n- [ ] 質問B`,
    login: SELF_LOGIN,
    authorAssociation: "NONE",
  };
  const { client, comments } = makeFakeClient({
    issueBody: "issue本文",
    labels: ["type:feature"],
    comments: [existing],
  });
  const job = jobStore.create("clarify");

  await runClarifyJob(job, client, REF, {
    runClaude: fakeRunClaudeOk({
      questions: [
        { text: "質問A", resolved: true },
        { text: "質問B", resolved: false },
      ],
      allResolved: false,
    }),
  });

  const body = comments[0]!.body;
  assert.match(body, /- \[x\] 質問A/);
  assert.match(body, /- \[ \] 質問B/);
});

test("再実行 (全解消): allResolved: true が返ったとき、コメント本文に解消済みである旨が明示される", async () => {
  const existing: FakeComment = {
    id: 1,
    body: `${buildGeneratedMarker("clarify", 1, 1)}\n\n## 機能要望への質問\n\n- [ ] 質問A`,
    login: SELF_LOGIN,
    authorAssociation: "NONE",
  };
  const { client, comments } = makeFakeClient({
    issueBody: "issue本文",
    labels: ["type:feature"],
    comments: [existing],
  });
  const job = jobStore.create("clarify");

  await runClarifyJob(job, client, REF, {
    runClaude: fakeRunClaudeOk({
      questions: [{ text: "質問A", resolved: true }],
      allResolved: true,
    }),
  });

  assert.match(comments[0]!.body, /解消/);
});

test("失敗系: runClaude が失敗を返したとき、ジョブが failed になる", async () => {
  const { client } = makeFakeClient({ issueBody: "issue本文", labels: ["type:feature"] });
  const job = jobStore.create("clarify");

  await runClarifyJob(job, client, REF, { runClaude: fakeRunClaudeFail() });

  assert.equal(jobStore.get(job.id)?.status, "failed");
});

test("失敗系: runClaude が失敗を返したとき、既存の質問コメントが更新されない", async () => {
  const existing: FakeComment = {
    id: 1,
    body: `${buildGeneratedMarker("clarify", 1, 1)}\n\n## 機能要望への質問\n\n- [ ] 質問A`,
    login: SELF_LOGIN,
    authorAssociation: "NONE",
  };
  const { client, comments } = makeFakeClient({
    issueBody: "issue本文",
    labels: ["type:feature"],
    comments: [existing],
  });
  const originalBody = existing.body;
  const job = jobStore.create("clarify");

  await runClarifyJob(job, client, REF, { runClaude: fakeRunClaudeFail() });

  assert.equal(comments[0]!.body, originalBody);
});

test("type:feature ラベルが外れている場合、ジョブを実行せず failed になる", async () => {
  const { client, comments } = makeFakeClient({ issueBody: "issue本文", labels: ["type:task"] });
  const job = jobStore.create("clarify");

  let called = false;
  const runClaude: (opts: RunClaudeOptions) => Promise<ClaudeOk<ClarifyStructuredOutput> | ClaudeErr> =
    async () => {
      called = true;
      return { ok: true, structured: { questions: [], allResolved: true }, text: "", costUsd: 0, raw: {} };
    };

  await runClarifyJob(job, client, REF, { runClaude });

  assert.equal(jobStore.get(job.id)?.status, "failed");
  assert.equal(called, false);
  assert.equal(comments.length, 0);
});
