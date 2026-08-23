import { z } from "zod";

const boolFromString = z
  .string()
  .default("true")
  .transform((v) => v.trim().toLowerCase() === "true");

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),

  AGENT_RUNNER_TOKEN: z.string().min(8, "AGENT_RUNNER_TOKEN is too short"),
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),

  ALLOWED_AUTHORS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),

  BOT_NAME: z.string().default("agent-runner-bot"),
  BOT_EMAIL: z.string().default("agent-runner-bot@users.noreply.github.com"),

  AGENT_RUNNER_DRY_RUN: boolFromString,

  CLAUDE_MODEL: z.string().default("sonnet"),
  CONVERT_MAX_BUDGET_USD: z.coerce.number().positive().default(0.5),
  PR_MAX_BUDGET_USD: z.coerce.number().positive().default(5),
  CLARIFY_MAX_BUDGET_USD: z.coerce.number().positive().default(0.3),
  CONVERT_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  PR_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  CLARIFY_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
});

export type Config = {
  port: number;
  host: string;
  agentRunnerToken: string;
  githubToken: string;
  allowedAuthors: string[];
  botName: string;
  botEmail: string;
  dryRun: boolean;
  claudeModel: string;
  convertMaxBudgetUsd: number;
  prMaxBudgetUsd: number;
  clarifyMaxBudgetUsd: number;
  convertTimeoutMs: number;
  prTimeoutMs: number;
  clarifyTimeoutMs: number;
};

function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`環境変数の検証に失敗しました:\n${issues}`);
  }
  const e = parsed.data;
  if (e.ALLOWED_AUTHORS.length === 0) {
    throw new Error(
      "ALLOWED_AUTHORS が空です。プロンプトインジェクション対策のため、" +
        "少なくとも1人の GitHub ユーザー名を指定してください。",
    );
  }
  return {
    port: e.PORT,
    host: e.HOST,
    agentRunnerToken: e.AGENT_RUNNER_TOKEN,
    githubToken: e.GITHUB_TOKEN,
    allowedAuthors: e.ALLOWED_AUTHORS,
    botName: e.BOT_NAME,
    botEmail: e.BOT_EMAIL,
    dryRun: e.AGENT_RUNNER_DRY_RUN,
    claudeModel: e.CLAUDE_MODEL,
    convertMaxBudgetUsd: e.CONVERT_MAX_BUDGET_USD,
    prMaxBudgetUsd: e.PR_MAX_BUDGET_USD,
    clarifyMaxBudgetUsd: e.CLARIFY_MAX_BUDGET_USD,
    convertTimeoutMs: e.CONVERT_TIMEOUT_MS,
    prTimeoutMs: e.PR_TIMEOUT_MS,
    clarifyTimeoutMs: e.CLARIFY_TIMEOUT_MS,
  };
}

export const config = loadConfig(process.env);
