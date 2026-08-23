import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { specDirFor } from "../spec-dir.ts";
import { runClaude } from "../claude/run-claude.ts";
import {
  changedFiles,
  cleanupWorkspace,
  commitAll,
  createBranch,
  diffStatSinceParent,
  prepareGitWorkspace,
  push,
  type GitWorkspace,
} from "../git.ts";
import {
  collectGeneratedArtifact,
  createPullRequest,
  filterTrustedComments,
  getDefaultBranch,
  getIssue,
  listIssueComments,
  type GithubClient,
} from "../github.ts";
import { buildImplementPrompt } from "../prompts/implement.ts";
import { extractSections, requireSections } from "../sections.ts";
import { assertSafeDiff } from "../safety.ts";
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

/**
 * この関数は自身では reject しない (呼び出し側は route から fire-and-forget される想定)。
 * すべての失敗経路は jobStore.finish("failed", ...) に集約する。
 */
export async function runCreatePrJob(job: Job, client: GithubClient, ref: IssueRef): Promise<void> {
  jobStore.update(job.id, { status: "running" });
  let ws: GitWorkspace | undefined;

  try {
    jobStore.setPhase(job.id, "Issue の内容を収集中");
    const [issue, allComments] = await Promise.all([
      getIssue(client, ref),
      listIssueComments(client, ref),
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
    ws = await prepareGitWorkspace(ref.owner, ref.repo);

    const branch = `agent-runner/issue-${ref.issueNumber}-${job.id.slice(0, 8)}`;
    await createBranch(ws, branch);

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

    jobStore.setPhase(job.id, "claude cli で実装中 (数分〜数十分かかります)");
    const { systemPrompt, userPrompt } = buildImplementPrompt(ref, issue.title);
    const result = await runClaude({
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
    const safety = await assertSafeDiff(ws);
    if (!safety.ok) {
      throw new Error(`${safety.reason}: ${safety.files.join(", ")}`);
    }

    const files = await changedFiles(ws);
    if (files.length === 0) {
      throw new Error("claude cli は変更を生成しませんでした");
    }

    jobStore.setPhase(job.id, "commit 中");
    await commitAll(
      ws,
      `feat: implement #${ref.issueNumber}\n\nCloses #${ref.issueNumber}\n\nCo-Authored-By: claude <noreply@anthropic.com>`,
    );

    if (config.dryRun) {
      const stat = await diffStatSinceParent(ws);
      jobStore.finish(job.id, "succeeded", {
        phase: "完了 (DRY_RUN)",
        result: { dryRun: true, branch, cloneDir: ws.cloneDir, diffStat: stat },
        artifactDir: ws.runtimeDir,
      });
      return; // DRY_RUN 時は runtimeDir を消さない (finally も見送る)
    }

    jobStore.setPhase(job.id, "push 中");
    await push(ws, branch);

    jobStore.setPhase(job.id, "PR を作成中");
    const base = await getDefaultBranch(client, ref);
    const pr = await createPullRequest(client, {
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
      ].join("\n"),
    });

    jobStore.finish(job.id, "succeeded", { phase: "完了", result: { prUrl: pr.url } });
    await cleanupWorkspace(ws);
  } catch (e) {
    jobStore.finish(job.id, "failed", {
      phase: "失敗",
      error: String((e as Error)?.message ?? e),
    });
    if (ws) await cleanupWorkspace(ws);
  }
}
