import { config } from "../config.ts";
import { runClaude, type ClaudeErr, type ClaudeOk, type RunClaudeOptions } from "../claude/run-claude.ts";
import { cleanupWorkspace, prepareGitWorkspace, type GitWorkspace } from "../git.ts";
import {
  getIssue,
  listIssueComments,
  upsertGeneratedComments,
  type GithubClient,
} from "../github.ts";
import {
  buildInvestigatePrompt,
  INVESTIGATE_JSON_SCHEMA,
  type InvestigateStructuredOutput,
} from "../prompts/investigate.ts";
import type { IssueRef } from "../types/api.ts";
import { jobStore, type Job } from "./store.ts";

/** 調査ジョブでは読み取り専用ツールのみを渡す (Write/Edit/Bash は含めない)。 */
const INVESTIGATE_TOOLS = ["Read", "Grep", "Glob"];

/**
 * テストで GitHub API / claude cli / git clone をモックに差し替えるための依存注入。
 * 実運用ではデフォルト実装 (defaultInvestigateDeps) がそのまま使われる。
 */
export type InvestigateDeps = {
  getIssue: typeof getIssue;
  listIssueComments: typeof listIssueComments;
  upsertGeneratedComments: typeof upsertGeneratedComments;
  prepareGitWorkspace: typeof prepareGitWorkspace;
  cleanupWorkspace: typeof cleanupWorkspace;
  runClaude: (
    opts: RunClaudeOptions,
  ) => Promise<ClaudeOk<InvestigateStructuredOutput> | ClaudeErr>;
};

const defaultInvestigateDeps: InvestigateDeps = {
  getIssue,
  listIssueComments,
  upsertGeneratedComments,
  prepareGitWorkspace,
  cleanupWorkspace,
  runClaude,
};

function renderInvestigationBody(result: InvestigateStructuredOutput): string {
  if (result.couldNotIdentify) {
    return [
      "## 調査結果",
      "",
      "コード上の根拠から原因箇所を特定できませんでした。",
      "",
      "### 確認した範囲",
      result.checkedScope,
    ].join("\n");
  }

  return [
    "## 調査結果",
    "",
    "### 原因と推測される箇所",
    `- ファイルパス: \`${result.filePath}\``,
    `- 行/関数: ${result.location}`,
    "",
    "### 根拠",
    result.evidence,
  ].join("\n");
}

/**
 * バグ報告 issue に対する原因調査ジョブ。
 * issue本文取得→read-onlyでリポジトリclone→Claude CLIで調査→コメントupsert→finallyでworkspace cleanup。
 * branch作成・commit・pushは行わない (対象リポジトリへの変更なし)。
 *
 * この関数は自身では reject しない (呼び出し側は route から fire-and-forget される想定)。
 * すべての失敗経路は jobStore.finish("failed", ...) に集約する。
 */
export async function runInvestigateJob(
  job: Job,
  client: GithubClient,
  ref: IssueRef,
  deps: InvestigateDeps = defaultInvestigateDeps,
): Promise<void> {
  jobStore.update(job.id, { status: "running" });
  let ws: GitWorkspace | undefined;

  try {
    jobStore.setPhase(job.id, "Issue の内容を取得中");
    const issue = await deps.getIssue(client, ref);

    jobStore.setPhase(job.id, "リポジトリを clone 中 (read-only)");
    ws = await deps.prepareGitWorkspace(ref.owner, ref.repo);

    jobStore.setPhase(job.id, "claude cli で調査中");
    const { systemPrompt, userPrompt } = buildInvestigatePrompt(issue.body);
    const result = await deps.runClaude({
      prompt: userPrompt,
      cwd: ws.cloneDir,
      systemPrompt,
      jsonSchema: INVESTIGATE_JSON_SCHEMA,
      tools: INVESTIGATE_TOOLS,
      model: config.claudeModel,
      timeoutMs: config.investigateTimeoutMs,
      maxBudgetUsd: config.investigateMaxBudgetUsd,
      onStderr: (line) => jobStore.appendLog(job.id, `[claude] ${line.trim()}`),
    });
    jobStore.addCost(job.id, result.costUsd);

    if (!result.ok) {
      throw new Error(`claude cli 失敗 (${result.failure.kind}): ${result.failure.detail}`);
    }

    jobStore.setPhase(job.id, "コメントに反映中");
    const body = renderInvestigationBody(result.structured);
    const existing = await deps.listIssueComments(client, ref);
    await deps.upsertGeneratedComments(client, ref, "investigation", body, existing);

    jobStore.finish(job.id, "succeeded", { phase: "完了" });
  } catch (e) {
    jobStore.finish(job.id, "failed", {
      phase: "失敗",
      error: String((e as Error)?.message ?? e),
    });
  } finally {
    if (ws) await deps.cleanupWorkspace(ws);
  }
}
