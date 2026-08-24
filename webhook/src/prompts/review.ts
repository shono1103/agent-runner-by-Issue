/**
 * コミット単位のレビュー / ブランチ diff 全体のレビューを claude に依頼するためのプロンプト。
 * どちらも構造化出力 (`concerns: string[]`) のみを返させる。懸念が無ければ空配列でよい
 * (`RaiseConcern` に対応する事象が無ければ Concern を作らない、というのが仕様上の解釈)。
 */

export type ReviewPrompt = {
  systemPrompt: string;
  userPrompt: string;
};

export const REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    concerns: {
      type: "array",
      items: { type: "string" },
      description: "見つかった懸念事項の一覧。無ければ空配列。",
    },
  },
  required: ["concerns"],
  additionalProperties: false,
} as const;

export type ReviewStructuredOutput = {
  concerns: string[];
};

export function buildCommitReviewPrompt(commitMessage: string, diff: string): ReviewPrompt {
  const systemPrompt = [
    "あなたは1つのcommitをレビューするエージェントです。",
    "ファイルの編集・実行は行わず、指定された JSON スキーマの構造化出力だけを返してください。",
    "バグ・安全性・可読性・意図と実装の乖離など、レビュー観点で気になる懸念点があれば" +
      "`concerns` に列挙してください。懸念が無ければ空配列を返してください。",
  ].join("\n");

  const userPrompt = [
    "# commit メッセージ",
    "```",
    commitMessage,
    "```",
    "",
    "# 差分 (git show)",
    "```diff",
    diff,
    "```",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function buildBranchDiffReviewPrompt(diff: string): ReviewPrompt {
  const systemPrompt = [
    "あなたはブランチ全体のdiffをレビューするエージェントです。",
    "ファイルの編集・実行は行わず、指定された JSON スキーマの構造化出力だけを返してください。",
    "個々のcommit単位では見えにくい、ブランチ全体を通した設計上の懸念・一貫性の欠如・" +
      "考慮漏れがあれば `concerns` に列挙してください。懸念が無ければ空配列を返してください。",
  ].join("\n");

  const userPrompt = [
    "# ブランチ全体のdiff (base からの累積差分)",
    "```diff",
    diff,
    "```",
  ].join("\n");

  return { systemPrompt, userPrompt };
}
