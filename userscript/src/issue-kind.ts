export type IssueKind = "bug" | "feature" | "task";

/**
 * issueに付与されたラベルから種類を判定する。
 *
 * 優先順位: type:bug > type:feature > type:task
 * 該当ラベルが無い場合 (テンプレート導入前の既存issue、未知ラベルのみの場合を含む) は
 * task をデフォルトとする (後方互換)。
 */
export function issueKind(labels: readonly string[]): IssueKind {
  if (labels.includes("type:bug")) return "bug";
  if (labels.includes("type:feature")) return "feature";
  return "task";
}
