import { GM_xmlhttpRequest } from "$";
import type {
  ApiErrorResponse,
  ConvertRequest,
  CreatePrRequest,
  HealthResponse,
  JobConflictResponse,
  JobStartResponse,
  JobStatusResponse,
  PrIssueStatusResponse,
  PrStatusResponse,
  ResolveConflictsRequest,
  ScaffoldRequest,
  ScaffoldResponse,
} from "@agent-runner/webhook/api-types";
import { loadSettings } from "./settings.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}`);
  }
}

export type GmJsonOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * GM_xmlhttpRequest の Promise ラッパー。
 *
 * 落とし穴: onload は 4xx/5xx でも呼ばれるので status を自分で見る必要がある。
 * timeout を指定しないと ontimeout は永久に発火しない。onerror の情報はほぼ空
 * (status は 0 になりがち) なので、原因を推測できる文言に変換して投げる。
 */
export function gmJson<T>(opts: GmJsonOptions): Promise<T> {
  const settings = loadSettings();

  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const headers: Record<string, string> = { "X-Agent-Runner-Token": settings.token };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const handle = GM_xmlhttpRequest({
      method: opts.method,
      url: `${settings.baseUrl}${opts.path}`,
      headers,
      data: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      timeout: opts.timeoutMs ?? 15_000,
      onload: (res) =>
        finish(() => {
          if (res.status < 200 || res.status >= 300) {
            reject(new HttpError(res.status, (res.responseText ?? "").slice(0, 500)));
            return;
          }
          try {
            resolve(JSON.parse(res.responseText) as T);
          } catch {
            reject(
              new HttpError(res.status, `invalid JSON: ${res.responseText.slice(0, 200)}`),
            );
          }
        }),
      onerror: () =>
        finish(() =>
          reject(
            new Error(
              `webhook サーバー (${settings.baseUrl}) に接続できません。起動しているか、設定の URL が正しいか確認してください。`,
            ),
          ),
        ),
      ontimeout: () => finish(() => reject(new Error("リクエストがタイムアウトしました"))),
      onabort: () => finish(() => reject(new DOMException("aborted", "AbortError"))),
    });

    opts.signal?.addEventListener(
      "abort",
      () => {
        try {
          handle.abort();
        } catch {
          // すでに終わっている
        }
      },
      { once: true },
    );
  });
}

function isErrorResponse(x: unknown): x is ApiErrorResponse {
  return typeof x === "object" && x !== null && "error" in x && "message" in x;
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return gmJson<HealthResponse>({ method: "GET", path: "/api/health", timeoutMs: 5000, signal });
}

export async function postScaffold(req: ScaffoldRequest): Promise<ScaffoldResponse> {
  return gmJson<ScaffoldResponse>({
    method: "POST",
    path: "/api/issues/scaffold",
    body: req,
    timeoutMs: 20_000,
  });
}

export type JobLaunchResult =
  | { started: true; jobId: string }
  | { started: false; jobId: string; message: string };

export async function postConvert(req: ConvertRequest): Promise<JobLaunchResult> {
  return postJobStart("/api/jobs/convert", req);
}

export async function postCreatePr(req: CreatePrRequest): Promise<JobLaunchResult> {
  return postJobStart("/api/jobs/create-pr", req);
}

export async function postResolveConflicts(req: ResolveConflictsRequest): Promise<JobLaunchResult> {
  return postJobStart("/api/jobs/resolve-conflicts", req);
}

/**
 * 対象issueに紐づくOPENなPRの mergeable 状態を取得する。
 * 「コンフリクト解決」ボタンの表示可否判定に使う。取得できなくてもパネル自体は使えるよう、
 * 呼び出し側で失敗を許容すること。
 */
export async function getPrStatus(ref: {
  owner: string;
  repo: string;
  issueNumber: number;
}): Promise<PrStatusResponse> {
  const params = new URLSearchParams({
    owner: ref.owner,
    repo: ref.repo,
    issueNumber: String(ref.issueNumber),
  });
  return gmJson<PrStatusResponse>({
    method: "GET",
    path: `/api/issues/pr-status?${params.toString()}`,
    timeoutMs: 10_000,
  });
}

/**
 * PRページ用: PR番号から対応するissue番号とmergeable状態を取得する。
 * PRページの「コンフリクト解決」ボタンの表示可否判定に使う。
 */
export async function getIssueForPr(ref: {
  owner: string;
  repo: string;
  prNumber: number;
}): Promise<PrIssueStatusResponse> {
  const params = new URLSearchParams({ owner: ref.owner, repo: ref.repo });
  return gmJson<PrIssueStatusResponse>({
    method: "GET",
    path: `/api/prs/${ref.prNumber}/issue?${params.toString()}`,
    timeoutMs: 10_000,
  });
}

async function postJobStart(path: string, body: unknown): Promise<JobLaunchResult> {
  try {
    const res = await gmJson<JobStartResponse>({ method: "POST", path, body, timeoutMs: 20_000 });
    return { started: true, jobId: res.jobId };
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      try {
        const conflict = JSON.parse(e.body) as JobConflictResponse;
        return { started: false, jobId: conflict.jobId, message: conflict.message };
      } catch {
        // JSON でなければ下の rethrow に委ねる
      }
    }
    if (e instanceof HttpError && isErrorResponse(safeParse(e.body))) {
      const parsed = safeParse(e.body) as ApiErrorResponse;
      throw new Error(parsed.message);
    }
    throw e;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type PollOptions = {
  intervalMs?: number;
  maxIntervalMs?: number;
  totalTimeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (status: JobStatusResponse) => void;
};

/**
 * ジョブの完了までポーリングする。500ms → 1.5倍ずつ → 上限3秒のバックオフ。
 * 404 (サーバー再起動などでジョブが消えた) は即座に例外として投げ、呼び出し側で止める。
 */
export async function pollJob(jobId: string, opts: PollOptions = {}): Promise<JobStatusResponse> {
  const interval0 = opts.intervalMs ?? 500;
  const maxInterval = opts.maxIntervalMs ?? 3000;
  const totalTimeout = opts.totalTimeoutMs ?? 30 * 60_000;
  const deadline = Date.now() + totalTimeout;

  let interval = interval0;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (Date.now() > deadline) throw new Error("ポーリングがタイムアウトしました");

    let status: JobStatusResponse;
    try {
      status = await gmJson<JobStatusResponse>({
        method: "GET",
        path: `/api/jobs/${jobId}`,
        timeoutMs: 10_000,
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        throw new Error(
          "ジョブが見つかりません (webhook サーバーが再起動された可能性があります)。もう一度実行してください。",
        );
      }
      throw e;
    }

    opts.onUpdate?.(status);

    if (status.status === "succeeded" || status.status === "failed") {
      return status;
    }

    await sleep(interval, opts.signal);
    interval = Math.min(interval * 1.5, maxInterval);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
