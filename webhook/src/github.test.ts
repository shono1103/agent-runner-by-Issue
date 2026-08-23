import assert from "node:assert/strict";
import { test } from "node:test";
import type { Octokit } from "@octokit/rest";
import { findOpenPrForIssue, type GithubClient } from "./github.ts";

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
