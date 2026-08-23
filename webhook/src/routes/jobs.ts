import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.ts";
import { createGithubClient } from "../github.ts";
import { runConvertJob } from "../jobs/convert.ts";
import { runCreatePrJob } from "../jobs/createPr.ts";
import { runDraftJob } from "../jobs/draft.ts";
import { jobStore } from "../jobs/store.ts";
import { jobLocks } from "../locks.ts";
import type {
  ApiErrorResponse,
  ConvertTarget,
  IssueRef,
  JobConflictResponse,
  JobStartResponse,
  JobStatusResponse,
} from "../types/api.ts";

const IssueRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.number().int().positive(),
});

const ConvertSchema = IssueRefSchema.extend({
  targets: z.array(z.enum(["allium", "likec4", "superpowers"])).min(1),
});

export const jobsRoute = new Hono();

jobsRoute.post("/convert", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = ConvertSchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref: IssueRef = parsed.data;
  const targets = parsed.data.targets as ConvertTarget[];

  const job = jobStore.create("convert");
  const acquired = jobLocks.acquire(ref, job.id, false);
  if (!acquired) {
    const holder = jobLocks.holderOf(ref, false);
    return c.json<JobConflictResponse>(
      {
        error: "locked",
        jobId: holder ?? job.id,
        message: "この Issue に対するジョブが既に実行中です",
      },
      409,
    );
  }

  const client = await createGithubClient(config.githubToken);
  runConvertJob(job, client, ref, targets).finally(() => jobLocks.release(ref, false));

  return c.json<JobStartResponse>({ jobId: job.id }, 202);
});

jobsRoute.post("/draft", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = IssueRefSchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref: IssueRef = parsed.data;

  const job = jobStore.create("draft");
  const acquired = jobLocks.acquire(ref, job.id, false);
  if (!acquired) {
    const holder = jobLocks.holderOf(ref, false);
    return c.json<JobConflictResponse>(
      {
        error: "locked",
        jobId: holder ?? job.id,
        message: "この Issue に対するジョブが既に実行中です",
      },
      409,
    );
  }

  const client = await createGithubClient(config.githubToken);
  runDraftJob(job, client, ref).finally(() => jobLocks.release(ref, false));

  return c.json<JobStartResponse>({ jobId: job.id }, 202);
});

jobsRoute.post("/create-pr", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = IssueRefSchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref: IssueRef = parsed.data;

  const job = jobStore.create("create-pr");
  const acquired = jobLocks.acquire(ref, job.id, true);
  if (!acquired) {
    const holder = jobLocks.holderOf(ref, true);
    return c.json<JobConflictResponse>(
      {
        error: "locked",
        jobId: holder ?? job.id,
        message: "この Issue またはリポジトリに対するジョブが既に実行中です",
      },
      409,
    );
  }

  const client = await createGithubClient(config.githubToken);
  runCreatePrJob(job, client, ref).finally(() => jobLocks.release(ref, true));

  return c.json<JobStartResponse>({ jobId: job.id }, 202);
});

jobsRoute.get("/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = jobStore.get(jobId);
  if (!job) {
    return c.json<ApiErrorResponse>(
      { error: "not_found", message: "ジョブが見つかりません (完了後1時間で破棄されます)" },
      404,
    );
  }
  const body: JobStatusResponse = {
    id: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    costUsd: job.costUsd,
    logs: job.logs,
    result: job.result,
    error: job.error,
  };
  return c.json(body);
});
