import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";
import { runClaude } from "../claude/run-claude.ts";
import type { GithubClient } from "../github.ts";
import { createIssueComment, getIssue, listIssueComments } from "../github.ts";
import { buildSourceMarker, parseMarker, SOURCE_KINDS, type SourceKind } from "../markers.ts";
import {
  buildDraftPrompt,
  DRAFT_JSON_SCHEMA,
  type DraftStructuredOutput,
} from "../prompts/draft.ts";
import type { IssueRef } from "../types/api.ts";
import { jobStore, type Job } from "./store.ts";

/**
 * 依存関数を差し替え可能にして (デフォルトは実実装)、結合テストで
 * GitHub API / claude cli をモックしやすくする。
 */
export type DraftJobDeps = {
  getIssue: typeof getIssue;
  listIssueComments: typeof listIssueComments;
  createIssueComment: typeof createIssueComment;
  runClaude: typeof runClaude;
};

const defaultDeps: DraftJobDeps = {
  getIssue,
  listIssueComments,
  createIssueComment,
  runClaude,
};

function isDraftStructuredOutput(value: unknown): value is DraftStructuredOutput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.requirements === "string" &&
    typeof v.architecture === "string" &&
    typeof v.tests === "string"
  );
}

export async function runDraftJob(
  job: Job,
  client: GithubClient,
  ref: IssueRef,
  deps: DraftJobDeps = defaultDeps,
): Promise<void> {
  jobStore.update(job.id, { status: "running" });
  try {
    jobStore.setPhase(job.id, "Issue とコメントを取得中");
    const [issue, comments] = await Promise.all([
      deps.getIssue(client, ref),
      deps.listIssueComments(client, ref),
    ]);

    const existingKinds = new Set<SourceKind>();
    for (const comment of comments) {
      const marker = parseMarker(comment.body);
      if (marker?.type === "source") existingKinds.add(marker.kind);
    }

    const missing = SOURCE_KINDS.filter((kind) => !existingKinds.has(kind));
    if (missing.length === 0) {
      jobStore.finish(job.id, "succeeded", {
        phase: "完了 (source コメントが既にすべて揃っています)",
      });
      return;
    }

    const workDir = await mkdtemp(join(tmpdir(), "agent-runner-draft-"));
    try {
      jobStore.setPhase(job.id, "定義書を生成中");
      const { systemPrompt, userPrompt } = buildDraftPrompt({
        title: issue.title,
        body: issue.body,
      });

      const result = await deps.runClaude<DraftStructuredOutput>({
        prompt: userPrompt,
        cwd: workDir,
        systemPrompt,
        jsonSchema: DRAFT_JSON_SCHEMA,
        tools: [],
        model: config.claudeModel,
        timeoutMs: config.convertTimeoutMs,
        maxBudgetUsd: config.convertMaxBudgetUsd,
      });

      jobStore.addCost(job.id, result.costUsd);

      if (!result.ok) {
        jobStore.finish(job.id, "failed", {
          phase: "失敗",
          error: `claude cli 失敗 (${result.failure.kind}) ${result.failure.detail}`,
        });
        return;
      }

      if (!isDraftStructuredOutput(result.structured)) {
        jobStore.finish(job.id, "failed", {
          phase: "失敗",
          error: "claude cli の構造化出力が期待するスキーマ (requirements/architecture/tests) と一致しません",
        });
        return;
      }

      const structured = result.structured;
      const bodies: Record<SourceKind, string> = {
        requirements: `${buildSourceMarker("requirements")}\n\n${structured.requirements.trim()}\n`,
        architecture: `${buildSourceMarker("architecture")}\n\n${structured.architecture.trim()}\n`,
        tests: `${buildSourceMarker("tests")}\n\n${structured.tests.trim()}\n`,
      };

      jobStore.setPhase(job.id, "コメントを投稿中");
      const created: SourceKind[] = [];
      for (const kind of missing) {
        await deps.createIssueComment(client, ref, bodies[kind]);
        created.push(kind);
      }

      jobStore.finish(job.id, "succeeded", { phase: "完了", result: { created } });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  } catch (e) {
    jobStore.finish(job.id, "failed", {
      phase: "失敗",
      error: String((e as Error)?.message ?? e),
    });
  }
}
