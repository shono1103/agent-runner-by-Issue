import { randomUUID } from "node:crypto";
import type { JobKind, JobStatus } from "../types/api.ts";

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
  createdAt: number;
  finishedAt?: number;
};

const GC_INTERVAL_MS = 5 * 60_000;
const RETENTION_MS = 60 * 60_000; // 完了後1時間で消す

class JobStore {
  private jobs = new Map<string, Job>();

  constructor() {
    const timer = setInterval(() => this.gc(), GC_INTERVAL_MS);
    timer.unref();
  }

  create(kind: JobKind): Job {
    const job: Job = {
      id: randomUUID(),
      kind,
      status: "queued",
      phase: "queued",
      costUsd: 0,
      logs: [],
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
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
