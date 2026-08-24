/**
 * 「要件定義+テストがひとまず通るラフな実装」の差分 (working tree diff) を、
 * 意味のある単位ごとの複数コミットへ分割する計画を claude に立てさせるためのプロンプト。
 *
 * このプロンプト自身は commit を実行しない (Write/Edit/Bash を渡さず、構造化出力のみを
 * 返させる)。実際の `git add`/`git commit` は呼び出し側 (`jobs/createPr.ts`) が
 * `git.ts` の `commitEach` を通じて行う。これは、コミットの分割・確定という
 * 「リポジトリへの書き込みを確定させる操作」を claude cli 自身ではなく別プロセス側の
 * 責務のまま維持するという設計上の制約 (design.md Global Constraints) による。
 */

export type CommitPlanEntry = {
  files: string[];
  who: string;
  what: string;
  when: string;
  where: string;
  why: string;
  how: string;
};

export type CommitPlan = {
  commits: CommitPlanEntry[];
};

export function buildCommitPlanPrompt(files: string[], diff: string): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "あなたは git の差分を、意味のある単位の複数コミットへ分割する計画を立てるエージェントです。",
    "ファイルの編集・実行は行わず、指定された JSON スキーマの構造化出力だけを返してください。",
    "1つのコミットに無関係な変更をまとめないでください。可能な限り、レビューしやすい" +
      "最小限の粒度に分割してください (変更が単一の目的しか持たない場合は1コミットで構いません)。",
    "each commit エントリの who/what/when/where/why/how には、それぞれ空でない具体的な文章を" +
      "1つずつ入れてください (5W1H として commit メッセージにそのまま使われます)。",
  ].join("\n");

  const userPrompt = [
    "# 分割対象の変更ファイル一覧",
    ...files.map((f) => `- ${f}`),
    "",
    "# 差分 (git diff --cached)",
    "```diff",
    diff,
    "```",
    "",
    "上記の変更を、意味のある単位ごとの複数コミットに分割する計画を立ててください。",
    "各コミットの `files` には、変更ファイル一覧に含まれるパスのみを、重複や漏れなく" +
      "過不足なく (全ファイルの合計がちょうど変更ファイル一覧と一致するように) 割り当ててください。",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export const COMMIT_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    commits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" } },
          who: { type: "string" },
          what: { type: "string" },
          when: { type: "string" },
          where: { type: "string" },
          why: { type: "string" },
          how: { type: "string" },
        },
        required: ["files", "who", "what", "when", "where", "why", "how"],
        additionalProperties: false,
      },
    },
  },
  required: ["commits"],
  additionalProperties: false,
} as const;

/** 1行目に要約 (what)、本文に 5W1H のラベル付き行を含む commit メッセージを組み立てる。 */
export function buildCommitMessage(entry: CommitPlanEntry): string {
  const firstLine = entry.what.split("\n")[0] ?? entry.what;
  const subject = firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;

  return [
    subject,
    "",
    `Who: ${entry.who}`,
    `What: ${entry.what}`,
    `When: ${entry.when}`,
    `Where: ${entry.where}`,
    `Why: ${entry.why}`,
    `How: ${entry.how}`,
  ].join("\n");
}
