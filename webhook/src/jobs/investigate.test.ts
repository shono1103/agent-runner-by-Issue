import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClaudeErr, ClaudeOk } from "../claude/run-claude.ts";
import type { GithubClient, IssueComment } from "../github.ts";
import type { InvestigateStructuredOutput } from "../prompts/investigate.ts";
import type { GitWorkspace } from "../git.ts";
import type { IssueRef } from "../types/api.ts";
import { runInvestigateJob, type InvestigateDeps } from "./investigate.ts";
import { jobStore } from "./store.ts";

const ref: IssueRef = { owner: "o", repo: "r", issueNumber: 1 };
const client: GithubClient = {
  octokit: {} as unknown as GithubClient["octokit"],
  selfLogin: "agent-runner-bot",
};

function makeWorkspace(): GitWorkspace {
  return { runtimeDir: "/tmp/fake-runtime", cloneDir: "/tmp/fake-runtime/repo", env: {} };
}

function makeDeps(overrides: Partial<InvestigateDeps>): InvestigateDeps {
  const base: InvestigateDeps = {
    getIssue: async () => ({ title: "t", body: "## 再現手順\nxxx" }),
    listIssueComments: async () => [],
    upsertGeneratedComments: async () => {},
    prepareGitWorkspace: async () => makeWorkspace(),
    cleanupWorkspace: async () => {},
    runClaude: async () =>
      ({
        ok: true,
        text: "",
        costUsd: 0.01,
        raw: {},
        structured: {
          couldNotIdentify: false,
          filePath: "src/foo.ts",
          location: "line 10",
          evidence: "xxx",
          checkedScope: "",
        },
      }) satisfies ClaudeOk<InvestigateStructuredOutput>,
  };
  return { ...base, ...overrides };
}

test("正常系: runClaude が構造化出力を返したとき、upsertGeneratedComments が investigation kind で呼ばれ、ジョブが succeeded になる", async () => {
  const job = jobStore.create("investigate");
  let capturedKind: string | undefined;
  const deps = makeDeps({
    upsertGeneratedComments: async (_client, _ref, kind) => {
      capturedKind = kind;
    },
  });

  await runInvestigateJob(job, client, ref, deps);

  const finished = jobStore.get(job.id);
  assert.equal(finished?.status, "succeeded");
  assert.equal(capturedKind, "investigation");
});

test("再実行時: listIssueComments が返した既存コメント一覧がそのまま upsertGeneratedComments に渡される (dedup は upsert 側に委ねる)", async () => {
  const job = jobStore.create("investigate");
  const existingComment: IssueComment = {
    id: 1,
    body: "<!-- agent-runner:generated:investigation:1/1 -->\n\n古い調査結果",
    login: "agent-runner-bot",
    authorAssociation: "NONE",
  };
  let capturedExisting: IssueComment[] | undefined;
  const deps = makeDeps({
    listIssueComments: async () => [existingComment],
    upsertGeneratedComments: async (_client, _ref, _kind, _content, existing) => {
      capturedExisting = existing;
    },
  });

  await runInvestigateJob(job, client, ref, deps);

  assert.deepEqual(capturedExisting, [existingComment]);
});

test("失敗系: runClaude が失敗を返したとき、ジョブが failed になり、コメントは投稿されない", async () => {
  const job = jobStore.create("investigate");
  let upsertCalled = false;
  const deps = makeDeps({
    runClaude: async () =>
      ({
        ok: false,
        costUsd: 0,
        failure: { kind: "agent", detail: "boom" },
      }) satisfies ClaudeErr,
    upsertGeneratedComments: async () => {
      upsertCalled = true;
    },
  });

  await runInvestigateJob(job, client, ref, deps);

  const finished = jobStore.get(job.id);
  assert.equal(finished?.status, "failed");
  assert.equal(upsertCalled, false);
});

test("clone 後は成功経路でも cleanupWorkspace が呼ばれる", async () => {
  const job = jobStore.create("investigate");
  let cleanupCalled = 0;
  const deps = makeDeps({
    cleanupWorkspace: async () => {
      cleanupCalled++;
    },
  });

  await runInvestigateJob(job, client, ref, deps);

  assert.equal(cleanupCalled, 1);
});

test("clone 後は失敗経路でも cleanupWorkspace が呼ばれる", async () => {
  const job = jobStore.create("investigate");
  let cleanupCalled = 0;
  const deps = makeDeps({
    runClaude: async () =>
      ({
        ok: false,
        costUsd: 0,
        failure: { kind: "agent", detail: "boom" },
      }) satisfies ClaudeErr,
    cleanupWorkspace: async () => {
      cleanupCalled++;
    },
  });

  await runInvestigateJob(job, client, ref, deps);

  assert.equal(cleanupCalled, 1);
});

test("repository_modified: jobs/investigate.ts は git の変更系関数 (createBranch/commitAll/push) を import しない", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const source = await readFile(fileURLToPath(new URL("./investigate.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /\bcreateBranch\b/);
  assert.doesNotMatch(source, /\bcommitAll\b/);
  const gitImport = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.\.\/git\.ts["']/.exec(source);
  const importedNames = (gitImport?.[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]);
  assert.ok(!importedNames.includes("push"));
});
