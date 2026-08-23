import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { runClaude as runClaudeDefault } from "../claude/run-claude.ts";
import {
  cleanupWorkspace as cleanupWorkspaceDefault,
  commitAll as commitAllDefault,
  mergeMain as mergeMainDefault,
  prepareGitWorkspaceFromBranch as prepareGitWorkspaceFromBranchDefault,
  push as pushDefault,
  type GitWorkspace,
} from "../git.ts";
import { findOpenPrForIssue as findOpenPrForIssueDefault, type GithubClient } from "../github.ts";
import {
  buildResolveConflictPrompt,
  RESOLVE_CONFLICT_JSON_SCHEMA,
  type ResolveConflictStructuredOutput,
} from "../prompts/resolveConflicts.ts";
import { assertSafeDiff as assertSafeDiffDefault } from "../safety.ts";
import type { IssueRef } from "../types/api.ts";
import { jobStore, type Job } from "./store.ts";

/**
 * GitHub API・claude cli・git 操作を差し替え可能にするための依存注入。
 * 本番では下の `defaultDeps` (実際の実装) がそのまま使われる。
 */
export type ResolveConflictsDeps = {
  findOpenPrForIssue: typeof findOpenPrForIssueDefault;
  prepareGitWorkspaceFromBranch: typeof prepareGitWorkspaceFromBranchDefault;
  mergeMain: typeof mergeMainDefault;
  push: typeof pushDefault;
  commitAll: typeof commitAllDefault;
  cleanupWorkspace: typeof cleanupWorkspaceDefault;
  assertSafeDiff: typeof assertSafeDiffDefault;
  runClaude: typeof runClaudeDefault;
};

const defaultDeps: ResolveConflictsDeps = {
  findOpenPrForIssue: findOpenPrForIssueDefault,
  prepareGitWorkspaceFromBranch: prepareGitWorkspaceFromBranchDefault,
  mergeMain: mergeMainDefault,
  push: pushDefault,
  commitAll: commitAllDefault,
  cleanupWorkspace: cleanupWorkspaceDefault,
  assertSafeDiff: assertSafeDiffDefault,
  runClaude: runClaudeDefault,
};

/**
 * この関数は自身では reject しない (呼び出し側は route から fire-and-forget される想定)。
 * すべての失敗経路は jobStore.finish("failed", ...) に集約する。
 */
export async function runResolveConflictsJob(
  job: Job,
  client: GithubClient,
  ref: IssueRef,
  overrides: Partial<ResolveConflictsDeps> = {},
): Promise<void> {
  const deps: ResolveConflictsDeps = { ...defaultDeps, ...overrides };
  jobStore.update(job.id, { status: "running" });
  let ws: GitWorkspace | undefined;

  try {
    jobStore.setPhase(job.id, "対象PRを検索中");
    const pr = await deps.findOpenPrForIssue(client, ref);
    if (!pr) {
      jobStore.finish(job.id, "failed", {
        phase: "失敗",
        error: `Issue #${ref.issueNumber} に対応するOPENなPRが見つかりません`,
      });
      return;
    }

    jobStore.setPhase(job.id, "PRブランチを clone 中");
    ws = await deps.prepareGitWorkspaceFromBranch(ref.owner, ref.repo, pr.branch);

    jobStore.setPhase(job.id, "main を merge 中");
    const merged = await deps.mergeMain(ws);

    if (!merged.conflicted) {
      jobStore.finish(job.id, "succeeded", {
        phase: "完了",
        result: {
          resolved: false,
          pushed: false,
          message: "解決不要 (main とのコンフリクトはありませんでした)",
          prNumber: pr.number,
        },
      });
      await deps.cleanupWorkspace(ws);
      return;
    }

    jobStore.setPhase(job.id, `コンフリクトを解決中 (${merged.conflictFiles.length}件)`);
    const resolutions = new Map<string, ResolveConflictStructuredOutput>();
    const unresolvable: string[] = [];

    for (const filePath of merged.conflictFiles) {
      const conflictedContent = await readFile(join(ws.cloneDir, filePath), "utf8");
      const { systemPrompt, userPrompt } = buildResolveConflictPrompt(
        filePath,
        conflictedContent,
      );

      const result = await deps.runClaude<ResolveConflictStructuredOutput>({
        prompt: userPrompt,
        cwd: ws.cloneDir,
        systemPrompt,
        jsonSchema: RESOLVE_CONFLICT_JSON_SCHEMA,
        tools: ["Read"],
        model: config.claudeModel,
        timeoutMs: config.prTimeoutMs,
        maxBudgetUsd: config.prMaxBudgetUsd,
        onStderr: (line) => jobStore.appendLog(job.id, `[claude] ${filePath}: ${line.trim()}`),
      });
      jobStore.addCost(job.id, result.costUsd);

      if (!result.ok) {
        throw new Error(
          `claude cli 失敗 (${filePath}, ${result.failure.kind}): ${result.failure.detail}`,
        );
      }

      resolutions.set(filePath, result.structured);
      if (result.structured.unresolvable) {
        unresolvable.push(filePath);
      }
    }

    if (unresolvable.length > 0) {
      jobStore.finish(job.id, "failed", {
        phase: "失敗",
        error: "意味的に自動解決できないコンフリクトがありました",
        result: {
          resolved: false,
          pushed: false,
          unresolvableFiles: unresolvable,
          reasons: Object.fromEntries(
            unresolvable.map((f) => [f, resolutions.get(f)?.reason ?? ""]),
          ),
        },
      });
      await deps.cleanupWorkspace(ws);
      return;
    }

    jobStore.setPhase(job.id, "解決結果を書き込み中");
    for (const [filePath, resolution] of resolutions) {
      await writeFile(join(ws.cloneDir, filePath), resolution.resolvedContent, "utf8");
    }

    jobStore.setPhase(job.id, "差分を検証中");
    const safety = await deps.assertSafeDiff(ws);
    if (!safety.ok) {
      jobStore.finish(job.id, "failed", {
        phase: "失敗",
        error: `${safety.reason}: ${safety.files.join(", ")}`,
        result: { resolved: false, pushed: false, rejectedFiles: safety.files },
      });
      await deps.cleanupWorkspace(ws);
      return;
    }

    jobStore.setPhase(job.id, "commit 中");
    await deps.commitAll(
      ws,
      `merge: resolve conflicts with main for #${ref.issueNumber}\n\n` +
        "Co-Authored-By: claude <noreply@anthropic.com>",
    );

    jobStore.setPhase(job.id, "push 中");
    await deps.push(ws, pr.branch);

    jobStore.finish(job.id, "succeeded", {
      phase: "完了",
      result: {
        resolved: true,
        pushed: true,
        resolvedFiles: [...resolutions.keys()],
        prNumber: pr.number,
      },
    });
    await deps.cleanupWorkspace(ws);
  } catch (e) {
    jobStore.finish(job.id, "failed", {
      phase: "失敗",
      error: String((e as Error)?.message ?? e),
    });
    if (ws) await deps.cleanupWorkspace(ws);
  }
}
