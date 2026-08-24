import { Octokit } from "@octokit/rest";
import type { IssueRef } from "./types/api.ts";
import {
  buildGeneratedMarker,
  buildSourceMarker,
  parseMarker,
  stripMarkerLine,
  type GeneratedKind,
  type SourceKind,
} from "./markers.ts";

/** GitHub のコメント本文の上限。超えたら分割コメントにする。 */
export const GITHUB_COMMENT_MAX_LENGTH = 65_536;

export type IssueComment = {
  id: number;
  body: string;
  login: string | null;
  authorAssociation: string;
};

export type GithubClient = {
  octokit: Octokit;
  selfLogin: string;
};

export async function createGithubClient(token: string): Promise<GithubClient> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.users.getAuthenticated();
  return { octokit, selfLogin: data.login };
}

export async function listIssueComments(
  client: GithubClient,
  ref: IssueRef,
): Promise<IssueComment[]> {
  const comments = await client.octokit.paginate(
    client.octokit.rest.issues.listComments,
    { owner: ref.owner, repo: ref.repo, issue_number: ref.issueNumber, per_page: 100 },
  );
  return comments.map((c) => ({
    id: c.id,
    body: c.body ?? "",
    login: c.user?.login ?? null,
    authorAssociation: c.author_association,
  }));
}

/**
 * プロンプトインジェクション対策: Issue にコメントできる全員を信頼しない。
 * リポジトリの持ち主/メンバー/コラボレーターかつ許可リストに載っている人のコメントのみ、
 * claude cli への入力として使ってよいものとみなす。
 */
export function filterTrustedComments(
  comments: IssueComment[],
  allowedAuthors: string[],
): IssueComment[] {
  const allowed = new Set(allowedAuthors);
  const trustedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
  return comments.filter(
    (c) =>
      c.login !== null &&
      allowed.has(c.login) &&
      trustedAssociations.has(c.authorAssociation),
  );
}

export async function createIssueComment(
  client: GithubClient,
  ref: IssueRef,
  body: string,
): Promise<IssueComment> {
  const { data } = await client.octokit.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    body,
  });
  return {
    id: data.id,
    body: data.body ?? "",
    login: data.user?.login ?? null,
    authorAssociation: data.author_association,
  };
}

export async function updateIssueComment(
  client: GithubClient,
  ref: IssueRef,
  commentId: number,
  body: string,
): Promise<void> {
  await client.octokit.rest.issues.updateComment({
    owner: ref.owner,
    repo: ref.repo,
    comment_id: commentId,
    body,
  });
}

/** scaffold: 3つの入力コメントを、既に存在しないものだけ新規作成する。 */
export async function ensureScaffoldComments(
  client: GithubClient,
  ref: IssueRef,
  bodies: Record<SourceKind, string>,
  existing: IssueComment[],
): Promise<{ created: SourceKind[]; skipped: SourceKind[] }> {
  const created: SourceKind[] = [];
  const skipped: SourceKind[] = [];

  for (const kind of Object.keys(bodies) as SourceKind[]) {
    const already = existing.some((c) => {
      const marker = parseMarker(c.body);
      return marker?.type === "source" && marker.kind === kind;
    });
    if (already) {
      skipped.push(kind);
      continue;
    }
    await createIssueComment(client, ref, bodies[kind]);
    created.push(kind);
  }

  return { created, skipped };
}

/**
 * 生成コメントを upsert する。同じ kind・同じ自分が投稿したコメントが既にあれば
 * updateComment、無ければ createComment。他人が投稿した同名マーカーは対象にしない。
 * 65,536 文字を超える本文は連番コメントに分割する。
 */
export async function upsertGeneratedComments(
  client: GithubClient,
  ref: IssueRef,
  kind: GeneratedKind,
  content: string,
  existing: IssueComment[],
): Promise<void> {
  const parts = splitForComment(content, GITHUB_COMMENT_MAX_LENGTH - 200);
  const total = parts.length;

  type OwnedGenerated = { comment: IssueComment; part: number };
  const ownedExisting: OwnedGenerated[] = [];
  for (const c of existing) {
    if (c.login !== client.selfLogin) continue;
    const marker = parseMarker(c.body);
    if (marker?.type === "generated" && marker.kind === kind) {
      ownedExisting.push({ comment: c, part: marker.part });
    }
  }
  ownedExisting.sort((a, b) => a.part - b.part);

  for (let i = 0; i < parts.length; i++) {
    const part = i + 1;
    const body = `${buildGeneratedMarker(kind, part, total)}\n\n${parts[i]}`;
    const target = ownedExisting[i];
    if (target) {
      await updateIssueComment(client, ref, target.comment.id, body);
    } else {
      await createIssueComment(client, ref, body);
    }
  }

  // 前回より分割数が減った場合、余ったコメントは「もう使われていません」に更新する。
  for (let i = parts.length; i < ownedExisting.length; i++) {
    const stale = ownedExisting[i];
    if (!stale) continue;
    await updateIssueComment(
      client,
      ref,
      stale.comment.id,
      `<!-- ${buildGeneratedMarker(kind, 1, 1)} stale -->\n\n_(この分割コメントは再生成により不要になりました)_`,
    );
  }
}

function splitForComment(content: string, maxLen: number): string[] {
  if (content.length <= maxLen) return [content];
  const parts: string[] = [];
  let rest = content;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/**
 * PR への指摘コメントを投稿する。GitHub API 上、PR は issue の一種であり
 * `issues.createComment` (issue_number = PR番号) で投稿できる
 * (レビューコメントAPIのようなインライン位置指定は行わない、PR全体への通常コメント)。
 */
export async function createPrComment(
  client: GithubClient,
  ref: IssueRef,
  prNumber: number,
  body: string,
): Promise<void> {
  await client.octokit.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: prNumber,
    body,
  });
}

export type CreatePullRequestInput = {
  ref: IssueRef;
  branch: string;
  base: string;
  title: string;
  body: string;
};

export async function createPullRequest(
  client: GithubClient,
  input: CreatePullRequestInput,
): Promise<{ url: string; number: number }> {
  const { data } = await client.octokit.rest.pulls.create({
    owner: input.ref.owner,
    repo: input.ref.repo,
    head: input.branch,
    base: input.base,
    title: input.title,
    body: input.body,
  });
  return { url: data.html_url, number: data.number };
}

export async function getIssue(
  client: GithubClient,
  ref: IssueRef,
): Promise<{ title: string; body: string; labels: string[] }> {
  const { data } = await client.octokit.rest.issues.get({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
  });
  return {
    title: data.title,
    body: data.body ?? "",
    labels: (data.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
  };
}

export async function getDefaultBranch(
  client: GithubClient,
  ref: IssueRef,
): Promise<string> {
  const { data } = await client.octokit.rest.repos.get({
    owner: ref.owner,
    repo: ref.repo,
  });
  return data.default_branch;
}

export type OpenPrRef = {
  number: number;
  branch: string;
};

/**
 * 対象issueに対応するOPENなPRを検索する。
 * head ブランチ名が `agent-runner/issue-<N>-` で始まる、または本文に `Closes #<N>` を
 * 含むものを対象とする。複数該当した場合は PR番号が最も大きい (最新の) ものを採用する。
 */
export async function findOpenPrForIssue(
  client: GithubClient,
  ref: IssueRef,
): Promise<OpenPrRef | null> {
  const prs = await client.octokit.paginate(client.octokit.rest.pulls.list, {
    owner: ref.owner,
    repo: ref.repo,
    state: "open",
    per_page: 100,
  });

  const branchPrefix = `agent-runner/issue-${ref.issueNumber}-`;
  const closesRe = new RegExp(`\\bCloses\\s+#${ref.issueNumber}\\b`, "i");

  const matches = prs.filter((pr) => {
    const head = pr.head?.ref ?? "";
    if (head.startsWith(branchPrefix)) return true;
    return closesRe.test(pr.body ?? "");
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.number - a.number);
  const latest = matches[0]!;
  return { number: latest.number, branch: latest.head.ref };
}

/**
 * PR番号から対応するissue番号を逆引きする。PR本文の `Closes #<N>` を優先して探し、
 * 無ければ head ブランチ名 `agent-runner/issue-<N>-` から抽出する。
 * どちらの手がかりも無い場合は null を返す (agent-runner 由来のPRではない可能性が高いため)。
 */
export async function findIssueForPr(
  client: GithubClient,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<number | null> {
  const { data } = await client.octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const closesRe = /\bCloses\s+#(\d+)\b/i;
  const bodyMatch = closesRe.exec(data.body ?? "");
  if (bodyMatch?.[1]) return Number(bodyMatch[1]);

  const branchRe = /^agent-runner\/issue-(\d+)-/;
  const branchMatch = branchRe.exec(data.head?.ref ?? "");
  if (branchMatch?.[1]) return Number(branchMatch[1]);

  return null;
}

/** 単一PRの `mergeable` 状態を取得する。GitHub が計算中の場合は null になりうる。 */
export async function getPullRequestMergeable(
  client: GithubClient,
  ref: IssueRef,
  prNumber: number,
): Promise<boolean | null> {
  const { data } = await client.octokit.rest.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: prNumber,
  });
  return data.mergeable ?? null;
}

export type GeneratedArtifact = {
  /** コードフェンスの中身だけを取り出したもの (実装ジョブで .allium 等として書き出す用)。 */
  code: string;
  /** upsert したコメント本文をそのまま連結したもの (フェンスや補足込み)。 */
  raw: string;
};

/**
 * 生成コメント (自分が投稿したもの) を集めて1つのアーティファクトに復元する。
 * 65,536 文字超過で分割されている場合は part 順に連結してから読む。
 */
export function collectGeneratedArtifact(
  client: GithubClient,
  comments: IssueComment[],
  kind: GeneratedKind,
): GeneratedArtifact | null {
  const owned = comments
    .filter((c) => c.login === client.selfLogin)
    .map((c) => ({ comment: c, marker: parseMarker(c.body) }))
    .filter((x) => x.marker?.type === "generated" && x.marker.kind === kind);

  if (owned.length === 0) return null;

  owned.sort((a, b) => {
    const pa = a.marker!.type === "generated" ? a.marker!.part : 0;
    const pb = b.marker!.type === "generated" ? b.marker!.part : 0;
    return pa - pb;
  });

  const raw = owned.map((x) => stripMarkerLine(x.comment.body)).join("\n");
  const code = extractFencedCode(raw);
  return { code, raw };
}

function extractFencedCode(markdown: string): string {
  const match = /```[^\n]*\n([\s\S]*?)```/.exec(markdown);
  if (!match) return markdown.trim();
  return (match[1] ?? "").trim();
}

export { buildSourceMarker };
