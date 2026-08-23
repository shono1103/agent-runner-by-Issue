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

export type DraftRequest = IssueRef;

export type JobKind = "convert" | "create-pr" | "draft";
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

export type ApiErrorResponse = {
  error: string;
  message: string;
};
