export type IssueLocation = {
  owner: string;
  repo: string;
  issueNumber: number;
};

// /issues/new にもマッチしてしまうため、末尾の \d+ で除外する。
const ISSUE_RE = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#]|$)/;

export function currentIssue(): IssueLocation | null {
  const m = ISSUE_RE.exec(location.pathname);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  const issueNumber = m[3];
  if (!owner || !repo || !issueNumber) return null;
  return { owner, repo, issueNumber: Number(issueNumber) };
}

export function issueKey(issue: IssueLocation): string {
  return `${issue.owner}/${issue.repo}#${issue.issueNumber}`;
}

/**
 * GitHubのSub-issues一覧から子issueを開いた際、issueが重なった状態 (子issueが
 * オーバーレイ/ダイアログとして親issueページの上に重ねて表示される状態) を検知する。
 *
 * 判定方法: このオーバーレイは `role="dialog"` を持ち、かつSub-issue表示に特有の
 * `data-testid` を持つ要素として描画される。ラベル編集・担当者選択など他の
 * dialog/popoverと誤って混同しないよう、汎用的な `[role="dialog"]` だけでなく
 * Sub-issue専用のセレクタもあわせて要求する。
 *
 * GitHub側の実際のDOM構造が変わった場合は、この関数の中身 (セレクタ) だけを
 * 差し替えれば良いよう、判定ロジックはここに閉じ込める。
 */
const SUB_ISSUE_OVERLAY_SELECTOR = [
  '[role="dialog"][data-testid="issue-viewer-overlay"]',
  '[role="dialog"][data-testid="sub-issues-issue-viewer"]',
].join(", ");

export function isSubIssueOverlayOpen(): boolean {
  return document.querySelector(SUB_ISSUE_OVERLAY_SELECTOR) !== null;
}
