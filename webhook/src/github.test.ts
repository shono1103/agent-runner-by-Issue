import assert from "node:assert/strict";
import { test } from "node:test";
import type { Octokit } from "@octokit/rest";
import { createPrComment, findIssueForPr, findOpenPrForIssue, type GithubClient } from "./github.ts";

type FakePr = {
  number: number;
  body: string | null;
  head: { ref: string };
};

function makeFakeClient(prs: FakePr[]): GithubClient {
  const list = async (_params: unknown) => ({ data: prs });
  const octokit = {
    rest: { pulls: { list } },
    paginate: async (fn: unknown, params: unknown) =>
      (await (fn as typeof list)(params)).data,
  } as unknown as Octokit;
  return { octokit, selfLogin: "agent-runner-bot" };
}

function makeFakeClientForGet(pr: FakePr): GithubClient {
  const get = async (_params: unknown) => ({ data: pr });
  const octokit = {
    rest: { pulls: { get } },
  } as unknown as Octokit;
  return { octokit, selfLogin: "agent-runner-bot" };
}

test("findOpenPrForIssue: head ブランチが agent-runner/issue-<N>- で始まるPRを返す", async () => {
  const client = makeFakeClient([
    { number: 20, body: "", head: { ref: "agent-runner/issue-3-aaaa1111" } },
  ]);

  const result = await findOpenPrForIssue(client, { owner: "o", repo: "r", issueNumber: 3 });

  assert.deepEqual(result, { number: 20, branch: "agent-runner/issue-3-aaaa1111" });
});

test("findOpenPrForIssue: 本文に Closes #<N> を含むPRを返す", async () => {
  const client = makeFakeClient([
    { number: 21, body: "実装しました。\n\nCloses #7", head: { ref: "some-other-branch" } },
  ]);

  const result = await findOpenPrForIssue(client, { owner: "o", repo: "r", issueNumber: 7 });

  assert.deepEqual(result, { number: 21, branch: "some-other-branch" });
});

test("findOpenPrForIssue: 対応するPRが存在しない場合は null を返す", async () => {
  const client = makeFakeClient([
    { number: 22, body: "Closes #99", head: { ref: "agent-runner/issue-99-bbbb2222" } },
  ]);

  const result = await findOpenPrForIssue(client, { owner: "o", repo: "r", issueNumber: 3 });

  assert.equal(result, null);
});

test("findOpenPrForIssue: 複数該当した場合は番号が最大の (最新の) PRを採用する", async () => {
  const client = makeFakeClient([
    { number: 20, body: "", head: { ref: "agent-runner/issue-3-aaaa1111" } },
    { number: 25, body: "", head: { ref: "agent-runner/issue-3-cccc3333" } },
    { number: 18, body: "Closes #3", head: { ref: "unrelated-branch" } },
  ]);

  const result = await findOpenPrForIssue(client, { owner: "o", repo: "r", issueNumber: 3 });

  assert.deepEqual(result, { number: 25, branch: "agent-runner/issue-3-cccc3333" });
});

test("findIssueForPr: PR本文に Closes #<N> が含まれる場合、その issue 番号を返す", async () => {
  const client = makeFakeClientForGet({
    number: 30,
    body: "実装しました。\n\nCloses #12",
    head: { ref: "some-other-branch" },
  });

  const result = await findIssueForPr(client, "o", "r", 30);

  assert.equal(result, 12);
});

test("findIssueForPr: 本文に無いが head ブランチ名が agent-runner/issue-<N>- の場合、その issue 番号を返す", async () => {
  const client = makeFakeClientForGet({
    number: 31,
    body: "説明のみ",
    head: { ref: "agent-runner/issue-9-dddd4444" },
  });

  const result = await findIssueForPr(client, "o", "r", 31);

  assert.equal(result, 9);
});

test("findIssueForPr: どちらの手がかりも無い場合は null を返す", async () => {
  const client = makeFakeClientForGet({
    number: 32,
    body: "手動で作成したPRです",
    head: { ref: "manual-fix" },
  });

  const result = await findIssueForPr(client, "o", "r", 32);

  assert.equal(result, null);
});

test("createPrComment: issues.createComment をPR番号をissue_numberとして呼ぶ", async () => {
  const calls: unknown[] = [];
  const createComment = async (params: unknown) => {
    calls.push(params);
    return { data: {} };
  };
  const octokit = { rest: { issues: { createComment } } } as unknown as Octokit;
  const client: GithubClient = { octokit, selfLogin: "agent-runner-bot" };

  await createPrComment(client, { owner: "o", repo: "r", issueNumber: 3 }, 42, "懸念があります");

  assert.deepEqual(calls, [
    { owner: "o", repo: "r", issue_number: 42, body: "懸念があります" },
  ]);
});
