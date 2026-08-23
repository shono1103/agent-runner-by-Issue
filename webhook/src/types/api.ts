/**
 * webhook が公開する HTTP API の型。userscript から
 * `@agent-runner/webhook/api-types` として import type する (実行時コードは含まない)。
 */

export type IssueRef = {
  owner: string;
  repo: string;
  issueNumber: number;
};

export type ScaffoldRequest = IssueRef;
export type ScaffoldResponse = {
  created: string[];
  skipped: string[];
};

export type ConvertTarget = "allium" | "likec4" | "superpowers";

export type ConvertRequest = IssueRef & {
  targets: ConvertTarget[];
};

export type CreatePrRequest = IssueRef;

export type ResolveConflictsRequest = IssueRef;

export type InvestigateRequest = IssueRef;

export type ClarifyRequest = IssueRef;

export type DraftRequest = IssueRef;

export type JobKind =
  | "convert"
  | "create-pr"
  | "resolve-conflicts"
  | "investigate"
  | "clarify"
  | "draft";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobStartResponse = {
  jobId: string;
};

export type JobConflictResponse = {
  error: "locked";
  jobId: string;
  message: string;
};

export type JobStatusResponse = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  phase: string;
  costUsd: number;
  logs: string[];
  result?: unknown;
  error?: string;
};

export type HealthResponse = {
  ok: true;
  version: string;
  dryRun: boolean;
};

/** 対象issueに紐づくOPENなPRの状態 (コンフリクト解決ボタンの表示判定に使う)。 */
export type PrStatus = {
  number: number;
  branch: string;
  /** GitHub がまだ計算中の場合は null になりうる。 */
  mergeable: boolean | null;
};

export type PrStatusResponse = {
  pr: PrStatus | null;
};

/**
 * PRページ用: PR番号に対応するissue番号とmergeable状態
 * (PRページの「コンフリクト解決」ボタン表示可否判定に使う)。
 * 対応するissueが特定できない場合は issueNumber: null のみを返す (エラーではない)。
 */
export type PrIssueStatusResponse =
  | { issueNumber: number; mergeable: boolean | null }
  | { issueNumber: null };

export type ApiErrorResponse = {
  error: string;
  message: string;
};
