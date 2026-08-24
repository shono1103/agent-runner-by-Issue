import { randomUUID } from "node:crypto";
import type { IssueRef, JobKind, JobStatus } from "../types/api.ts";

export type Job = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  phase: string;
  costUsd: number;
  logs: string[];
  result?: unknown;
  error?: string;
  /** DRY_RUN の PR ジョブでのみ設定する。設定されている間は GC 対象から外す。 */
  artifactDir?: string;
  /** ログにどの Issue のジョブかを出すためだけに持つ。API 応答には含めない。 */
  ref?: IssueRef;
  createdAt: number;
  finishedAt?: number;
};

/**
 * ジョブの開始・終了をどこに書くか。既定は console (= systemd なら journalctl)。
 * テストから差し替えられるように外に出してある。
 */
export type JobSink = {
  info: (line: string) => void;
  error: (line: string) => void;
};

const consoleSink: JobSink = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

/** 失敗時に添えるジョブ内ログの行数。診断の実体はここにある。 */
const FAILURE_LOG_TAIL = 5;

function describeRef(ref: IssueRef | undefined): string {
  return ref ? `${ref.owner}/${ref.repo}#${ref.issueNumber}` : "(ref なし)";
}

const GC_INTERVAL_MS = 5 * 60_000;
const RETENTION_MS = 60 * 60_000; // 完了後1時間で消す

export class JobStore {
  private jobs = new Map<string, Job>();

  constructor(private readonly sink: JobSink = consoleSink) {
    const timer = setInterval(() => this.gc(), GC_INTERVAL_MS);
    timer.unref();
  }

  create(kind: JobKind, ref?: IssueRef): Job {
    const job: Job = {
      id: randomUUID(),
      kind,
      status: "queued",
      phase: "queued",
      costUsd: 0,
      logs: [],
      ref,
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    // 開始も残す。これが無いと、ハングして finish に到達しないジョブが
    // ログ上に一切現れない (失敗と区別がつかない)。
    this.sink.info(`[job] ${kind} ${describeRef(ref)} started id=${job.id}`);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
  }

  setPhase(id: string, phase: string): void {
    this.update(id, { phase });
  }

  appendLog(id: string, line: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.logs.push(line);
  }

  addCost(id: string, deltaUsd: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.costUsd += deltaUsd;
  }

  finish(id: string, status: "succeeded" | "failed", patch: Partial<Job> = {}): void {
    this.update(id, { status, finishedAt: Date.now(), ...patch });

    const job = this.jobs.get(id);
    if (!job) return;
    const elapsedSec = ((job.finishedAt ?? Date.now()) - job.createdAt) / 1000;
    const head =
      `[job] ${job.kind} ${describeRef(job.ref)} ${status} id=${job.id} ` +
      `(phase=${job.phase}, ${elapsedSec.toFixed(1)}s, $${job.costUsd.toFixed(4)})`;

    if (status === "succeeded") {
      this.sink.info(head);
      return;
    }
    this.sink.error(`${head}: ${job.error ?? "(エラー内容なし)"}`);
    for (const line of job.logs.slice(-FAILURE_LOG_TAIL)) {
      this.sink.error(`       | ${line}`);
    }
  }

  private gc(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [id, job] of this.jobs) {
      if (job.artifactDir) continue; // DRY_RUN の成果物は手動確認されるまで残す
      const isDone = job.status === "succeeded" || job.status === "failed";
      if (isDone && job.finishedAt !== undefined && job.finishedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}

export const jobStore = new JobStore();
