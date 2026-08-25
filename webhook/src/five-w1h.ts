/**
 * commit メッセージが 5W1H (Who/What/When/Where/Why/How) の要素を含んでいるかを判定する。
 *
 * `commitPlan.ts` が生成する commit メッセージは `Who: ...` のようなラベル付き行を
 * 本文に必ず含める前提で組み立てられる (`buildCommitMessage`)。ここではその前提を
 * 検証する側として、任意の commit メッセージ文字列からラベル行を抽出し、
 * 各要素が (ラベルだけでなく) 空でない内容を伴って存在するかを判定する。
 */

export type FiveW1HCheck = {
  hasWho: boolean;
  hasWhat: boolean;
  hasWhen: boolean;
  hasWhere: boolean;
  hasWhy: boolean;
  hasHow: boolean;
  satisfies: boolean;
};

const LABEL_PATTERNS: { key: keyof Omit<FiveW1HCheck, "satisfies">; re: RegExp }[] = [
  { key: "hasWho", re: /^Who:\s*(.+)$/im },
  { key: "hasWhat", re: /^What:\s*(.+)$/im },
  { key: "hasWhen", re: /^When:\s*(.+)$/im },
  { key: "hasWhere", re: /^Where:\s*(.+)$/im },
  { key: "hasWhy", re: /^Why:\s*(.+)$/im },
  { key: "hasHow", re: /^How:\s*(.+)$/im },
];

/** 対象のラベル行が存在し、かつラベルの後に空でない内容が続いているかを判定する。 */
function hasNonEmptyLabel(message: string, re: RegExp): boolean {
  const match = re.exec(message);
  if (!match) return false;
  return (match[1] ?? "").trim().length > 0;
}

export function checkFiveW1H(message: string): FiveW1HCheck {
  const result = {} as FiveW1HCheck;
  for (const { key, re } of LABEL_PATTERNS) {
    result[key] = hasNonEmptyLabel(message, re);
  }
  result.satisfies =
    result.hasWho &&
    result.hasWhat &&
    result.hasWhen &&
    result.hasWhere &&
    result.hasWhy &&
    result.hasHow;
  return result;
}
