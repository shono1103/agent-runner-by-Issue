import { execFileSync } from "node:child_process";
import { z } from "zod";

const boolFromString = z
  .string()
  .default("true")
  .transform((v) => v.trim().toLowerCase() === "true");

const GITHUB_TOKEN_SOURCES = ["gh", "pat"] as const;
type GithubTokenSource = (typeof GITHUB_TOKEN_SOURCES)[number];

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),

  AGENT_RUNNER_TOKEN: z.string().min(8, "AGENT_RUNNER_TOKEN is too short"),
  // "pat": GITHUB_TOKEN をそのまま使う。"gh": `gh auth token` の出力を使う
  // (ログイン済み gh CLI を再利用し、生の PAT を .env に置かない選択肢)。
  GITHUB_TOKEN_SOURCE: z.enum(GITHUB_TOKEN_SOURCES).default("pat"),
  GITHUB_TOKEN: z.string().optional(),

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
  CONVERT_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  PR_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
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
  convertTimeoutMs: number;
  prTimeoutMs: number;
};

/**
 * GITHUB_TOKEN_SOURCE=pat なら GITHUB_TOKEN をそのまま返す。
 * GITHUB_TOKEN_SOURCE=gh なら `gh auth token` を実行してその出力を使う
 * (runGhAuthToken はテスト用の差し替え口)。
 */
export function resolveGithubToken(
  source: GithubTokenSource,
  patFromEnv: string | undefined,
  runGhAuthToken: () => string = () =>
    execFileSync("gh", ["auth", "token"], { encoding: "utf8" }),
): string {
  if (source === "pat") {
    const token = patFromEnv?.trim();
    if (!token) {
      throw new Error("GITHUB_TOKEN_SOURCE=pat の場合は GITHUB_TOKEN が必須です。");
    }
    return token;
  }
  let output: string;
  try {
    output = runGhAuthToken();
  } catch (e) {
    throw new Error(
      "`gh auth token` の実行に失敗しました。`gh auth login` 済みか確認してください: " +
        String((e as Error)?.message ?? e),
    );
  }
  const token = output.trim();
  if (!token) {
    throw new Error("`gh auth token` の出力が空でした。");
  }
  return token;
}

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
    githubToken: resolveGithubToken(e.GITHUB_TOKEN_SOURCE, e.GITHUB_TOKEN),
    allowedAuthors: e.ALLOWED_AUTHORS,
    botName: e.BOT_NAME,
    botEmail: e.BOT_EMAIL,
    dryRun: e.AGENT_RUNNER_DRY_RUN,
    claudeModel: e.CLAUDE_MODEL,
    convertMaxBudgetUsd: e.CONVERT_MAX_BUDGET_USD,
    prMaxBudgetUsd: e.PR_MAX_BUDGET_USD,
    convertTimeoutMs: e.CONVERT_TIMEOUT_MS,
    prTimeoutMs: e.PR_TIMEOUT_MS,
  };
}

export const config = loadConfig(process.env);
