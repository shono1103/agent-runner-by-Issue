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
