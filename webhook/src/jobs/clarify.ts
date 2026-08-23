import { tmpdir } from "node:os";
import { config } from "../config.ts";
import { runClaude as runClaudeDefault } from "../claude/run-claude.ts";
import type { ClaudeErr, ClaudeOk, RunClaudeOptions } from "../claude/run-claude.ts";
import {
  collectGeneratedArtifact,
  getIssue,
  listIssueComments,
  upsertGeneratedComments,
  type GithubClient,
} from "../github.ts";
import { buildClarifyPrompt, type ClarifyStructuredOutput } from "../prompts/clarify.ts";
import type { IssueRef } from "../types/api.ts";
import { jobStore, type Job } from "./store.ts";

const FEATURE_LABEL = "type:feature";

export type ClarifyRunClaudeFn = (
  opts: RunClaudeOptions,
) => Promise<ClaudeOk<ClarifyStructuredOutput> | ClaudeErr>;

export type ClarifyJobDeps = {
  runClaude?: ClarifyRunClaudeFn;
};

/**
 * `type:feature` ラベルのissueに対し、質問リストの生成・質問コメントのupsertを行う。
 * 対象リポジトリのコードは読まない (git clone を行わない)。
 */
export async function runClarifyJob(
  job: Job,
  client: GithubClient,
  ref: IssueRef,
  deps: ClarifyJobDeps = {},
): Promise<void> {
  const runClaudeFn: ClarifyRunClaudeFn =
    deps.runClaude ?? ((opts) => runClaudeDefault<ClarifyStructuredOutput>(opts));

  jobStore.update(job.id, { status: "running" });
  try {
    jobStore.setPhase(job.id, "Issue を取得中");
    const issue = await getIssue(client, ref);
    if (!issue.labels.includes(FEATURE_LABEL)) {
      jobStore.finish(job.id, "failed", {
        phase: "失敗",
        error: `このジョブは ${FEATURE_LABEL} ラベルの付いた Issue にのみ実行できます`,
      });
      return;
    }

    jobStore.setPhase(job.id, "前回の質問コメントを取得中");
    const comments = await listIssueComments(client, ref);
    const previous = collectGeneratedArtifact(client, comments, "clarify");
    const previousQa = previous ? previous.code : null;

    jobStore.setPhase(job.id, "質問を生成中");
    const { systemPrompt, userPrompt, schema } = buildClarifyPrompt(issue.body, previousQa);
    const result = await runClaudeFn({
      prompt: userPrompt,
      cwd: tmpdir(),
      systemPrompt,
      jsonSchema: schema,
      tools: [],
      model: config.claudeModel,
      timeoutMs: config.clarifyTimeoutMs,
      maxBudgetUsd: config.clarifyMaxBudgetUsd,
    });

    jobStore.addCost(job.id, result.costUsd);

    if (!result.ok) {
      jobStore.finish(job.id, "failed", {
        phase: "失敗",
        error: `claude cli 失敗 (${result.failure.kind}): ${result.failure.detail}`,
      });
      return;
    }

    jobStore.setPhase(job.id, "コメントに反映中");
    const body = buildClarifyCommentBody(result.structured);
    await upsertGeneratedComments(client, ref, "clarify", body, comments);

    const unresolvedCount = result.structured.questions.filter((q) => !q.resolved).length;
    jobStore.finish(job.id, "succeeded", {
      phase: "完了",
      result: {
        questionCount: result.structured.questions.length,
        unresolvedCount,
        allResolved: result.structured.allResolved,
      },
    });
  } catch (e) {
    jobStore.finish(job.id, "failed", {
      phase: "失敗",
      error: String((e as Error)?.message ?? e),
    });
  }
}

function buildClarifyCommentBody(output: ClarifyStructuredOutput): string {
  const lines: string[] = [];
  if (output.allResolved) {
    lines.push("✅ 全ての質問が解消されました");
    lines.push("");
  }
  lines.push("## 機能要望への質問");
  lines.push("");
  for (const q of output.questions) {
    lines.push(`- [${q.resolved ? "x" : " "}] ${q.text}`);
  }
  lines.push("");
  lines.push(
    "（この行より上のチェック状態は自動更新されます。回答はこのコメントを直接編集して書き込んでください）",
  );
  return lines.join("\n");
}
