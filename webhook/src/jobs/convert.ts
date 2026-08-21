import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";
import { runClaude } from "../claude/run-claude.ts";
import { checkAllium, planAllium, type AlliumObligation } from "../claude/verify/allium.ts";
import { validateLikeC4 } from "../claude/verify/likec4.ts";
import type { GithubClient } from "../github.ts";
import {
  filterTrustedComments,
  listIssueComments,
  upsertGeneratedComments,
} from "../github.ts";
import type { SourceKind } from "../markers.ts";
import {
  buildConvertPrompt,
  CONVERT_JSON_SCHEMA,
  type ConvertStructuredOutput,
} from "../prompts/convert.ts";
import { extractSections, requireSections } from "../sections.ts";
import type { ConvertTarget, IssueRef } from "../types/api.ts";
import { jobStore, type Job } from "./store.ts";

const MAX_RETRIES = 2;

const TARGET_REQUIRED_SECTIONS: Record<ConvertTarget, SourceKind[]> = {
  allium: ["requirements", "tests"],
  superpowers: ["requirements", "tests"],
  likec4: ["architecture"],
};

const FENCE_LANG: Record<ConvertTarget, string> = {
  allium: "allium",
  likec4: "likec4",
  superpowers: "markdown",
};

export async function runConvertJob(
  job: Job,
  client: GithubClient,
  ref: IssueRef,
  targets: ConvertTarget[],
): Promise<void> {
  jobStore.update(job.id, { status: "running" });
  try {
    jobStore.setPhase(job.id, "Issue コメントを取得中");
    const allComments = await listIssueComments(client, ref);
    const trusted = filterTrustedComments(allComments, config.allowedAuthors);
    const sections = extractSections(trusted);

    for (const target of targets) {
      jobStore.setPhase(job.id, `${target}: 入力セクションを確認中`);
      const required = TARGET_REQUIRED_SECTIONS[target];
      const requiredCheck = requireSections(sections, required);
      if (!requiredCheck.ok) {
        jobStore.appendLog(
          job.id,
          `${target}: 必要なセクションが未記入のためスキップしました (${requiredCheck.missing.join(", ")})`,
        );
        continue;
      }

      const converted = await convertOne(job, target, requiredCheck.values);
      if (converted === null) continue;

      jobStore.setPhase(job.id, `${target}: コメントに反映中`);
      const body = [
        `\`\`\`${FENCE_LANG[target]}`,
        converted.code.trim(),
        "```",
        converted.extra ?? "",
      ]
        .filter((s) => s !== "")
        .join("\n\n");

      // 他ターゲットが直前に投稿したコメントも踏まえて再取得してから upsert する。
      const latestComments = await listIssueComments(client, ref);
      await upsertGeneratedComments(client, ref, target, body, latestComments);
    }

    jobStore.finish(job.id, "succeeded", { phase: "完了" });
  } catch (e) {
    jobStore.finish(job.id, "failed", {
      phase: "失敗",
      error: String((e as Error)?.message ?? e),
    });
  }
}

type ConvertOneResult = { code: string; extra?: string };

async function convertOne(
  job: Job,
  target: ConvertTarget,
  values: Record<SourceKind, string>,
): Promise<ConvertOneResult | null> {
  const workDir = await mkdtemp(join(tmpdir(), "agent-runner-convert-"));
  try {
    let retryContext: { previousOutput: string; errors: string } | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      jobStore.setPhase(job.id, `${target}: 生成中 (試行 ${attempt + 1}/${MAX_RETRIES + 1})`);
      const { systemPrompt, userPrompt } = await buildConvertPrompt({
        target,
        requirements: values.requirements,
        tests: values.tests,
        architecture: values.architecture,
        retryContext,
      });

      const result = await runClaude<ConvertStructuredOutput>({
        prompt: userPrompt,
        cwd: workDir,
        systemPrompt,
        jsonSchema: CONVERT_JSON_SCHEMA,
        tools: [],
        model: config.claudeModel,
        timeoutMs: config.convertTimeoutMs,
        maxBudgetUsd: config.convertMaxBudgetUsd,
      });

      jobStore.addCost(job.id, result.costUsd);

      if (!result.ok) {
        jobStore.appendLog(
          job.id,
          `${target}: claude cli 失敗 (${result.failure.kind}) ${result.failure.detail}`,
        );
        return null;
      }

      jobStore.setPhase(job.id, `${target}: 検証中`);
      const verify = await verifyTarget(target, result.structured.code);
      if (verify.ok) {
        const extra =
          target === "allium" && verify.obligations && verify.obligations.length > 0
            ? renderObligationsChecklist(verify.obligations)
            : undefined;
        return { code: result.structured.code, extra };
      }

      jobStore.appendLog(job.id, `${target}: 検証エラー (試行 ${attempt + 1})\n${verify.errorText}`);
      retryContext = { previousOutput: result.structured.code, errors: verify.errorText };
    }

    jobStore.appendLog(
      job.id,
      `${target}: ${MAX_RETRIES + 1}回試行しても検証を通過できませんでした`,
    );
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

type VerifyResult = {
  ok: boolean;
  errorText: string;
  obligations?: AlliumObligation[];
};

async function verifyTarget(target: ConvertTarget, code: string): Promise<VerifyResult> {
  if (target === "likec4") {
    const result = await validateLikeC4(code);
    if (result.ok) return { ok: true, errorText: "" };
    const detail =
      result.errors.length > 0
        ? result.errors.map((e) => `- ${e.file}:${e.line} ${e.message}`).join("\n")
        : result.raw;
    return { ok: false, errorText: detail };
  }

  if (target === "allium") {
    const checked = await checkAllium(code);
    if (!checked.ok) {
      const errs = checked.diagnostics.filter((d) => d.severity === "error");
      const detail =
        errs.length > 0
          ? errs
              .map((d) => `- ${d.location.file}:${d.location.line} [${d.code ?? "?"}] ${d.message}`)
              .join("\n")
          : checked.raw;
      return { ok: false, errorText: detail };
    }
    const planned = await planAllium(code);
    if (planned.ok) return { ok: true, errorText: "", obligations: planned.obligations };
    // check は通っているので plan の失敗はリトライ対象にせず成功扱いにする。
    return { ok: true, errorText: "" };
  }

  // superpowers: 機械検証手段が無い (Spec Self-Review はプロンプト側の指示に委ねる)。
  return { ok: true, errorText: "" };
}

function renderObligationsChecklist(obligations: AlliumObligation[]): string {
  const lines = [
    "## テスト義務チェックリスト (`allium plan` から機械導出)",
    "",
    ...obligations.map((o) => `- [ ] \`${o.id}\` (${o.category}): ${o.description}`),
  ];
  return lines.join("\n");
}
