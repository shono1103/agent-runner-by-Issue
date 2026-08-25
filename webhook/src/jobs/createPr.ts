import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { specDirFor } from "../spec-dir.ts";
import { runClaude as runClaudeDefault } from "../claude/run-claude.ts";
import {
  changedFiles as changedFilesDefault,
  cleanupWorkspace as cleanupWorkspaceDefault,
  commitEach as commitEachDefault,
  createBranch as createBranchDefault,
  diffSince as diffSinceDefault,
  prepareGitWorkspace as prepareGitWorkspaceDefault,
  push as pushDefault,
  revParseHead as revParseHeadDefault,
  showCommitDiff as showCommitDiffDefault,
  stageAllAndDiff as stageAllAndDiffDefault,
  type GitWorkspace,
} from "../git.ts";
import {
  collectGeneratedArtifact,
  createPrComment as createPrCommentDefault,
  createPullRequest as createPullRequestDefault,
  filterTrustedComments,
  getDefaultBranch as getDefaultBranchDefault,
  getIssue as getIssueDefault,
  listIssueComments as listIssueCommentsDefault,
  type GithubClient,
} from "../github.ts";
import { buildImplementPrompt } from "../prompts/implement.ts";
import {
  buildCommitMessage,
  buildCommitPlanPrompt,
  COMMIT_PLAN_JSON_SCHEMA,
  type CommitPlan,
} from "../prompts/commitPlan.ts";
import {
  buildBranchDiffReviewPrompt,
  buildCommitReviewPrompt,
  REVIEW_JSON_SCHEMA,
  type ReviewStructuredOutput,
} from "../prompts/review.ts";
import { checkFiveW1H } from "../five-w1h.ts";
import { extractSections, requireSections } from "../sections.ts";
import { assertSafeDiff as assertSafeDiffDefault } from "../safety.ts";
import type { IssueRef } from "../types/api.ts";
import { jobStore, type Job } from "./store.ts";

const IMPLEMENT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite"];
const IMPLEMENT_DISALLOWED_TOOLS = [
  "WebFetch",
  "WebSearch",
  "Bash(git push:*)",
  "Bash(git remote:*)",
  "Bash(gh:*)",
  "Bash(curl:*)",
  "Bash(wget:*)",
];

export type Concern = { scope: "commit" | "branch_diff"; text: string };

/**
 * GitHub API・claude cli・git 操作を差し替え可能にするための依存注入。
 * 本番では下の `defaultDeps` (実際の実装) がそのまま使われる。
 */
export type CreatePrDeps = {
  getIssue: typeof getIssueDefault;
  listIssueComments: typeof listIssueCommentsDefault;
  prepareGitWorkspace: typeof prepareGitWorkspaceDefault;
  createBranch: typeof createBranchDefault;
  revParseHead: typeof revParseHeadDefault;
  runClaude: typeof runClaudeDefault;
  assertSafeDiff: typeof assertSafeDiffDefault;
  changedFiles: typeof changedFilesDefault;
  stageAllAndDiff: typeof stageAllAndDiffDefault;
  commitEach: typeof commitEachDefault;
  showCommitDiff: typeof showCommitDiffDefault;
  diffSince: typeof diffSinceDefault;
  push: typeof pushDefault;
  getDefaultBranch: typeof getDefaultBranchDefault;
  createPullRequest: typeof createPullRequestDefault;
  createPrComment: typeof createPrCommentDefault;
  cleanupWorkspace: typeof cleanupWorkspaceDefault;
};

const defaultDeps: CreatePrDeps = {
  getIssue: getIssueDefault,
  listIssueComments: listIssueCommentsDefault,
  prepareGitWorkspace: prepareGitWorkspaceDefault,
  createBranch: createBranchDefault,
  revParseHead: revParseHeadDefault,
  runClaude: runClaudeDefault,
  assertSafeDiff: assertSafeDiffDefault,
  changedFiles: changedFilesDefault,
  stageAllAndDiff: stageAllAndDiffDefault,
  commitEach: commitEachDefault,
  showCommitDiff: showCommitDiffDefault,
  diffSince: diffSinceDefault,
  push: pushDefault,
  getDefaultBranch: getDefaultBranchDefault,
  createPullRequest: createPullRequestDefault,
  createPrComment: createPrCommentDefault,
  cleanupWorkspace: cleanupWorkspaceDefault,
};

/**
 * この関数は自身では reject しない (呼び出し側は route から fire-and-forget される想定)。
 * すべての失敗経路は jobStore.finish("failed", ...) に集約する。
 */
export async function runCreatePrJob(
  job: Job,
  client: GithubClient,
  ref: IssueRef,
  overrides: Partial<CreatePrDeps> = {},
): Promise<void> {
  const deps: CreatePrDeps = { ...defaultDeps, ...overrides };
  jobStore.update(job.id, { status: "running" });
  let ws: GitWorkspace | undefined;

  try {
    jobStore.setPhase(job.id, "Issue の内容を収集中");
    const [issue, allComments] = await Promise.all([
      deps.getIssue(client, ref),
      deps.listIssueComments(client, ref),
    ]);
    const trusted = filterTrustedComments(allComments, config.allowedAuthors);
    const sections = extractSections(trusted);

    const required = requireSections(sections, ["requirements", "architecture", "tests"]);
    if (!required.ok) {
      jobStore.finish(job.id, "failed", {
        phase: "失敗",
        error:
          `要件定義/システムアーキテクチャ定義/テスト定義がすべて記入されている必要があります ` +
          `(未記入: ${required.missing.join(", ")})`,
      });
      return;
    }

    const design = collectGeneratedArtifact(client, trusted, "superpowers");
    const architecture = collectGeneratedArtifact(client, trusted, "likec4");
    const allium = collectGeneratedArtifact(client, trusted, "allium");

    jobStore.setPhase(job.id, "リポジトリを clone 中");
    ws = await deps.prepareGitWorkspace(ref.owner, ref.repo);

    const branch = `agent-runner/issue-${ref.issueNumber}-${job.id.slice(0, 8)}`;
    await deps.createBranch(ws, branch);
    // ラフ実装より前の HEAD。ブランチdiff全体のレビュー ("ReviewBranchDiff") の基点になる。
    const baseSha = await deps.revParseHead(ws);

    jobStore.setPhase(job.id, "仕様ファイルを書き出し中");
    const specDir = join(ws.cloneDir, specDirFor(ref.issueNumber));
    await mkdir(join(specDir, "source"), { recursive: true });
    await mkdir(join(specDir, "generated"), { recursive: true });
    await writeFile(join(specDir, "source", "requirements.md"), required.values.requirements, "utf8");
    await writeFile(join(specDir, "source", "architecture.md"), required.values.architecture, "utf8");
    await writeFile(join(specDir, "source", "tests.md"), required.values.tests, "utf8");
    if (design) await writeFile(join(specDir, "generated", "design.md"), design.code, "utf8");
    if (architecture)
      await writeFile(join(specDir, "generated", "architecture.c4"), architecture.code, "utf8");
    if (allium) await writeFile(join(specDir, "generated", "spec.allium"), allium.code, "utf8");

    // --- 1. 要件定義+テストがひとまず通るラフな実装 (StartRoughImplementation) ---
    jobStore.setPhase(job.id, "claude cli で実装中 (数分〜数十分かかります)");
    const { systemPrompt, userPrompt } = buildImplementPrompt(ref, issue.title);
    const result = await deps.runClaude({
      prompt: userPrompt,
      cwd: ws.cloneDir,
      systemPrompt,
      tools: IMPLEMENT_TOOLS,
      disallowedTools: IMPLEMENT_DISALLOWED_TOOLS,
      permissionMode: "acceptEdits",
      model: config.claudeModel,
      timeoutMs: config.prTimeoutMs,
      maxBudgetUsd: config.prMaxBudgetUsd,
      onStderr: (line) => jobStore.appendLog(job.id, `[claude] ${line.trim()}`),
    });
    jobStore.addCost(job.id, result.costUsd);

    if (!result.ok) {
      throw new Error(`claude cli 失敗 (${result.failure.kind}): ${result.failure.detail}`);
    }

    jobStore.setPhase(job.id, "差分を検証中");
    const safety = await deps.assertSafeDiff(ws);
    if (!safety.ok) {
      throw new Error(`${safety.reason}: ${safety.files.join(", ")}`);
    }

    const files = await deps.changedFiles(ws);
    if (files.length === 0) {
      throw new Error("claude cli は変更を生成しませんでした");
    }

    jobStore.appendLog(
      job.id,
      "[workflow] ラフ実装完了: 要件定義+テストがひとまず通る状態を作成しました",
    );

    // --- 2. 最小限のコミットに分割する (SplitIntoMinimalCommits) ---
    jobStore.setPhase(job.id, "差分を意味のある単位のコミットに分割中");
    const diff = await deps.stageAllAndDiff(ws);
    const commitPlanPrompt = buildCommitPlanPrompt(files, diff);
    const planResult = await deps.runClaude<CommitPlan>({
      prompt: commitPlanPrompt.userPrompt,
      cwd: ws.cloneDir,
      systemPrompt: commitPlanPrompt.systemPrompt,
      jsonSchema: COMMIT_PLAN_JSON_SCHEMA,
      tools: [],
      model: config.claudeModel,
      timeoutMs: config.prTimeoutMs,
      maxBudgetUsd: config.prMaxBudgetUsd,
      onStderr: (line) => jobStore.appendLog(job.id, `[claude] commit-plan: ${line.trim()}`),
    });
    jobStore.addCost(job.id, planResult.costUsd);

    if (!planResult.ok) {
      throw new Error(
        `コミット分割の計画に失敗しました (${planResult.failure.kind}): ${planResult.failure.detail}`,
      );
    }

    const plan = planResult.structured.commits;
    if (plan.length === 0) {
      throw new Error("コミット分割の計画が空でした");
    }

    const plannedFiles = new Set(plan.flatMap((c) => c.files));
    const missingFromPlan = files.filter((f) => !plannedFiles.has(f));
    if (missingFromPlan.length > 0) {
      throw new Error(
        `コミット分割の計画に含まれていない変更ファイルがあります: ${missingFromPlan.join(", ")}`,
      );
    }

    const plannedCommits = plan.map((entry) => {
      const message = buildCommitMessage(entry);
      const check = checkFiveW1H(message);
      if (!check.satisfies) {
        throw new Error(`commitメッセージが5W1Hを満たしていません: ${message.split("\n")[0]}`);
      }
      return { message, files: entry.files };
    });

    jobStore.setPhase(job.id, `commit 中 (${plannedCommits.length}件)`);
    const created = await deps.commitEach(ws, plannedCommits);
    if (created.length === 0) {
      throw new Error("分割されたコミットがありませんでした");
    }
    jobStore.appendLog(job.id, `[workflow] コミット分割完了: ${created.length}件`);
    created.forEach((c, i) => {
      jobStore.appendLog(job.id, `[workflow] commit ${i + 1}/${created.length}: ${c.message.split("\n")[0]}`);
    });

    // --- 3. CI通過確認 (CheckCi) ---
    // 外部CI (GitHub Actions等) の起動・待機は本ワークフローのスコープ外 (Out of Scope)。
    // ここでは「確認を試みた」ことをログに残すのみとし、結果未確定を理由にジョブを
    // failed にはしない (design.md Error Handling)。
    jobStore.setPhase(job.id, "CI通過確認を試行中");
    jobStore.appendLog(
      job.id,
      "[workflow] CI確認: 外部CI連携は未実装のため、確認を試みたのみです (結果は未確定)",
    );

    // --- 4. コミットごとのレビュー (ReviewCommit) ---
    jobStore.setPhase(job.id, "コミットごとにレビュー中");
    const concerns: Concern[] = [];
    for (const [i, commit] of created.entries()) {
      const commitDiff = await deps.showCommitDiff(ws, commit.sha);
      const reviewPrompt = buildCommitReviewPrompt(commit.message, commitDiff);
      const reviewResult = await deps.runClaude<ReviewStructuredOutput>({
        prompt: reviewPrompt.userPrompt,
        cwd: ws.cloneDir,
        systemPrompt: reviewPrompt.systemPrompt,
        jsonSchema: REVIEW_JSON_SCHEMA,
        tools: [],
        model: config.claudeModel,
        timeoutMs: config.prTimeoutMs,
        maxBudgetUsd: config.prMaxBudgetUsd,
        onStderr: (line) => jobStore.appendLog(job.id, `[claude] commit-review ${i + 1}: ${line.trim()}`),
      });
      jobStore.addCost(job.id, reviewResult.costUsd);
      if (!reviewResult.ok) {
        throw new Error(
          `commitレビューに失敗しました (${reviewResult.failure.kind}): ${reviewResult.failure.detail}`,
        );
      }
      for (const text of reviewResult.structured.concerns) {
        concerns.push({ scope: "commit", text: `[commit ${i + 1}] ${text}` });
      }
      jobStore.appendLog(
        job.id,
        `[workflow] commitレビュー ${i + 1}/${created.length}完了: 懸念${reviewResult.structured.concerns.length}件`,
      );
    }

    // --- 5. ブランチdiff全体のレビュー (ReviewBranchDiff) ---
    jobStore.setPhase(job.id, "ブランチdiff全体をレビュー中");
    const branchDiff = await deps.diffSince(ws, baseSha);
    const branchReviewPrompt = buildBranchDiffReviewPrompt(branchDiff);
    const branchReviewResult = await deps.runClaude<ReviewStructuredOutput>({
      prompt: branchReviewPrompt.userPrompt,
      cwd: ws.cloneDir,
      systemPrompt: branchReviewPrompt.systemPrompt,
      jsonSchema: REVIEW_JSON_SCHEMA,
      tools: [],
      model: config.claudeModel,
      timeoutMs: config.prTimeoutMs,
      maxBudgetUsd: config.prMaxBudgetUsd,
      onStderr: (line) => jobStore.appendLog(job.id, `[claude] branch-diff-review: ${line.trim()}`),
    });
    jobStore.addCost(job.id, branchReviewResult.costUsd);
    if (!branchReviewResult.ok) {
      throw new Error(
        `ブランチdiffレビューに失敗しました (${branchReviewResult.failure.kind}): ` +
          branchReviewResult.failure.detail,
      );
    }
    for (const text of branchReviewResult.structured.concerns) {
      concerns.push({ scope: "branch_diff", text });
    }
    jobStore.appendLog(
      job.id,
      `[workflow] ブランチdiffレビュー完了: 懸念${branchReviewResult.structured.concerns.length}件`,
    );

    if (config.dryRun) {
      jobStore.finish(job.id, "succeeded", {
        phase: "完了 (DRY_RUN)",
        result: {
          dryRun: true,
          branch,
          cloneDir: ws.cloneDir,
          commitCount: created.length,
          concernCount: concerns.length,
        },
        artifactDir: ws.runtimeDir,
      });
      return; // DRY_RUN 時は runtimeDir を消さない (finally も見送る)
    }

    jobStore.setPhase(job.id, "push 中");
    await deps.push(ws, branch);

    jobStore.setPhase(job.id, "PR を作成中");
    const base = await deps.getDefaultBranch(client, ref);
    const pr = await deps.createPullRequest(client, {
      ref,
      branch,
      base,
      title: `${issue.title} (#${ref.issueNumber})`,
      body: [
        `Closes #${ref.issueNumber}`,
        "",
        "agent-runner-by-Issue が Issue 上の仕様 (要件定義 / アーキテクチャ定義 / テスト定義) から自動生成しました。",
        design ? "- Superpowers design doc あり" : "- Superpowers design doc なし",
        architecture ? "- LikeC4 アーキテクチャ図あり" : "- LikeC4 アーキテクチャ図なし",
        allium ? "- Allium 形式仕様あり" : "- Allium 形式仕様なし",
        `- コミット数: ${created.length}`,
      ].join("\n"),
    });

    // --- 6. 懸念をPRの指摘コメントに残す (RaiseConcern / PostConcernAsPrComment) ---
    // 懸念が0件の場合は投稿しない ("懸念がある場合のみ残す" の解釈、tests.md)。
    if (concerns.length > 0) {
      jobStore.setPhase(job.id, "レビューの懸念をPRコメントとして投稿中");
      const body = [
        "## レビューで見つかった懸念",
        "",
        ...concerns.map((c) => `- (${c.scope === "commit" ? "commit" : "branch diff"}) ${c.text}`),
      ].join("\n");
      try {
        await deps.createPrComment(client, ref, pr.number, body);
        jobStore.appendLog(job.id, `[workflow] 懸念${concerns.length}件をPRコメントとして投稿しました`);
      } catch (e) {
        // PR自体は既に作成済みのため、コメント投稿失敗でジョブは失敗させない (design.md Error Handling)。
        jobStore.appendLog(
          job.id,
          `[workflow] 懸念のPRコメント投稿に失敗しました: ${String((e as Error)?.message ?? e)}`,
        );
      }
    }

    jobStore.finish(job.id, "succeeded", {
      phase: "完了",
      result: {
        prUrl: pr.url,
        commitCount: created.length,
        concernCount: concerns.length,
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
