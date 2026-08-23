import assert from "node:assert/strict";
import { test } from "node:test";
import type { GithubClient, IssueComment } from "../github.ts";
import { buildSourceMarker } from "../markers.ts";
import { extractSections, requireSections } from "../sections.ts";
import type { IssueRef } from "../types/api.ts";
import type { DraftJobDeps } from "./draft.ts";
import { runDraftJob } from "./draft.ts";
import { jobStore } from "./store.ts";

const REF: IssueRef = { owner: "acme", repo: "widgets", issueNumber: 42 };
const CLIENT: GithubClient = { octokit: {} as GithubClient["octokit"], selfLogin: "agent-runner-bot" };

const STRUCTURED = {
  requirements: "## 要件定義\n\nダミーの要件です。",
  architecture: "## システムアーキテクチャ定義\n\nダミーのアーキテクチャです。",
  tests: "## テスト定義\n\nダミーのテストです。",
};

function comment(id: number, body: string, login = "someone"): IssueComment {
  return { id, body, login, authorAssociation: "OWNER" };
}

const defaultCreateIssueComment: DraftJobDeps["createIssueComment"] = async (
  _client,
  _ref,
  body,
) => comment(Date.now(), body, "agent-runner-bot");

function makeDeps(overrides: Partial<DraftJobDeps> = {}): DraftJobDeps {
  return {
    getIssue: overrides.getIssue ?? (async () => ({ title: "タイトル", body: "本文" })),
    listIssueComments: overrides.listIssueComments ?? (async () => []),
    createIssueComment: overrides.createIssueComment ?? defaultCreateIssueComment,
    runClaude:
      overrides.runClaude ??
      (async () => ({
        ok: true,
        structured: STRUCTURED,
        text: "",
        costUsd: 0.01,
        raw: {},
      })),
  };
}

test("runDraftJob: 正常系 (既存sourceコメントなし) - requirements/architecture/tests の3件が新規投稿される", async () => {
  const job = jobStore.create("draft");
  const posted: { kind: string; body: string }[] = [];
  const deps = makeDeps({
    createIssueComment: async (_client, _ref, body) => {
      posted.push({ kind: "?", body });
      return comment(posted.length, body, "agent-runner-bot");
    },
  });

  await runDraftJob(job, CLIENT, REF, deps);

  assert.equal(jobStore.get(job.id)?.status, "succeeded");
  assert.equal(posted.length, 3);
  const firstLines = posted.map((p) => p.body.split("\n", 1)[0]);
  assert.ok(firstLines.includes(buildSourceMarker("requirements")));
  assert.ok(firstLines.includes(buildSourceMarker("architecture")));
  assert.ok(firstLines.includes(buildSourceMarker("tests")));
});

test("runDraftJob: 冪等性 - 一部 (requirements) が既存の場合、既存のkindは投稿されず不足分のみ投稿される", async () => {
  const job = jobStore.create("draft");
  const existing = [comment(1, `${buildSourceMarker("requirements")}\n\n既存の要件`, "human")];
  const posted: string[] = [];
  const deps = makeDeps({
    listIssueComments: async () => existing,
    createIssueComment: async (_client, _ref, body) => {
      posted.push(body);
      return comment(100 + posted.length, body, "agent-runner-bot");
    },
  });

  await runDraftJob(job, CLIENT, REF, deps);

  assert.equal(jobStore.get(job.id)?.status, "succeeded");
  assert.equal(posted.length, 2);
  const firstLines = posted.map((p) => p.split("\n", 1)[0]);
  assert.ok(!firstLines.includes(buildSourceMarker("requirements")));
  assert.ok(firstLines.includes(buildSourceMarker("architecture")));
  assert.ok(firstLines.includes(buildSourceMarker("tests")));
});

test("runDraftJob: 全件存在時のスキップ - runClaude が呼ばれず、コメントも投稿されない", async () => {
  const job = jobStore.create("draft");
  const existing = [
    comment(1, `${buildSourceMarker("requirements")}\n\n既存`, "human"),
    comment(2, `${buildSourceMarker("architecture")}\n\n既存`, "human"),
    comment(3, `${buildSourceMarker("tests")}\n\n既存`, "human"),
  ];
  let runClaudeCalled = false;
  let createCalled = false;
  const deps = makeDeps({
    listIssueComments: async () => existing,
    runClaude: async () => {
      runClaudeCalled = true;
      return { ok: true, structured: STRUCTURED, text: "", costUsd: 0, raw: {} };
    },
    createIssueComment: async (_client, _ref, body) => {
      createCalled = true;
      return comment(999, body, "agent-runner-bot");
    },
  });

  await runDraftJob(job, CLIENT, REF, deps);

  assert.equal(jobStore.get(job.id)?.status, "succeeded");
  assert.equal(runClaudeCalled, false);
  assert.equal(createCalled, false);
});

test("runDraftJob: 入力範囲 - getIssue/listIssueComments/createIssueComment/runClaude 以外の呼び出しを行わない (コードを読むAPIが無い)", async () => {
  const job = jobStore.create("draft");
  let getIssueCalled = false;
  const deps = makeDeps({
    getIssue: async () => {
      getIssueCalled = true;
      return { title: "t", body: "b" };
    },
  });

  await runDraftJob(job, CLIENT, REF, deps);

  assert.equal(getIssueCalled, true);
  assert.equal(jobStore.get(job.id)?.status, "succeeded");
});

test("runDraftJob: 接続テスト - 生成したsourceコメント3件が extractSections/requireSections を通過する", async () => {
  const job = jobStore.create("draft");
  const posted: IssueComment[] = [];
  const deps = makeDeps({
    createIssueComment: async (_client, _ref, body) => {
      const c = comment(posted.length + 1, body, "agent-runner-bot");
      posted.push(c);
      return c;
    },
  });

  await runDraftJob(job, CLIENT, REF, deps);

  const sections = extractSections(posted);
  const check = requireSections(sections, ["requirements", "architecture", "tests"]);
  assert.equal(check.ok, true);
});

test("runDraftJob: 失敗系 - runClaude が失敗を返したとき、ジョブが failed になりコメントが1件も投稿されない", async () => {
  const job = jobStore.create("draft");
  let createCalled = false;
  const deps = makeDeps({
    runClaude: async () => ({
      ok: false,
      costUsd: 0,
      failure: { kind: "agent", detail: "boom" },
    }),
    createIssueComment: async (_client, _ref, body) => {
      createCalled = true;
      return comment(1, body, "agent-runner-bot");
    },
  });

  await runDraftJob(job, CLIENT, REF, deps);

  assert.equal(jobStore.get(job.id)?.status, "failed");
  assert.equal(createCalled, false);
});
