import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.ts";
import { createGithubClient } from "../github.ts";
import { runClarifyJob } from "../jobs/clarify.ts";
import { runConvertJob } from "../jobs/convert.ts";
import { runCreatePrJob } from "../jobs/createPr.ts";
import { runDraftJob } from "../jobs/draft.ts";
import { runInvestigateJob } from "../jobs/investigate.ts";
import { runResolveConflictsJob } from "../jobs/resolveConflicts.ts";
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

  // GitHub クライアントの生成はロックを取る前に済ませる。
  // createGithubClient() はトークン検証のため GET /user を叩くので throw しうる。
  // ロック取得より後に置くと、throw した瞬間にロックもジョブも放置され、
  // そのボタンが webhook 再起動まで永久に 409 になる (#48)。
  // ロック取得と .finally の登録の間に、throw しうる処理を挟まないこと。
  const client = await createGithubClient(config.githubToken);

  // ロックの確認はジョブを作る前に行う。作ってから 409 で捨てると、使われないジョブが
  // queued のまま残り (GC は完了済みしか消さない)、ログにも紛らわしい started が出る。
  // ここから acquire までの間に await が無いので、確認と取得の間に割り込みは起きない。
  const holder = jobLocks.holderOf(ref, false);
  if (holder) {
    return c.json<JobConflictResponse>(
      { error: "locked", jobId: holder, message: "この Issue に対するジョブが既に実行中です" },
      409,
    );
  }

  const job = jobStore.create("convert", ref);
  jobLocks.acquire(ref, job.id, false);

  runConvertJob(job, client, ref, targets).finally(() => jobLocks.release(ref, false));

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

  // GitHub クライアントの生成はロックを取る前に済ませる。
  // createGithubClient() はトークン検証のため GET /user を叩くので throw しうる。
  // ロック取得より後に置くと、throw した瞬間にロックもジョブも放置され、
  // そのボタンが webhook 再起動まで永久に 409 になる (#48)。
  // ロック取得と .finally の登録の間に、throw しうる処理を挟まないこと。
  const client = await createGithubClient(config.githubToken);

  // ロックの確認はジョブを作る前に行う。作ってから 409 で捨てると、使われないジョブが
  // queued のまま残り (GC は完了済みしか消さない)、ログにも紛らわしい started が出る。
  // ここから acquire までの間に await が無いので、確認と取得の間に割り込みは起きない。
  const holder = jobLocks.holderOf(ref, true);
  if (holder) {
    return c.json<JobConflictResponse>(
      { error: "locked", jobId: holder, message: "この Issue またはリポジトリに対するジョブが既に実行中です" },
      409,
    );
  }

  const job = jobStore.create("create-pr", ref);
  jobLocks.acquire(ref, job.id, true);

  runCreatePrJob(job, client, ref).finally(() => jobLocks.release(ref, true));

  return c.json<JobStartResponse>({ jobId: job.id }, 202);
});

jobsRoute.post("/resolve-conflicts", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = IssueRefSchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref: IssueRef = parsed.data;

  // GitHub クライアントの生成はロックを取る前に済ませる。
  // createGithubClient() はトークン検証のため GET /user を叩くので throw しうる。
  // ロック取得より後に置くと、throw した瞬間にロックもジョブも放置され、
  // そのボタンが webhook 再起動まで永久に 409 になる (#48)。
  // ロック取得と .finally の登録の間に、throw しうる処理を挟まないこと。
  const client = await createGithubClient(config.githubToken);

  // ロックの確認はジョブを作る前に行う。作ってから 409 で捨てると、使われないジョブが
  // queued のまま残り (GC は完了済みしか消さない)、ログにも紛らわしい started が出る。
  // ここから acquire までの間に await が無いので、確認と取得の間に割り込みは起きない。
  const holder = jobLocks.holderOf(ref, true);
  if (holder) {
    return c.json<JobConflictResponse>(
      { error: "locked", jobId: holder, message: "この Issue またはリポジトリに対するジョブが既に実行中です" },
      409,
    );
  }

  // create-pr と同じくリポジトリ単位でもロックする (git push が競合するため)。
  const job = jobStore.create("resolve-conflicts", ref);
  jobLocks.acquire(ref, job.id, true);

  runResolveConflictsJob(job, client, ref).finally(() => jobLocks.release(ref, true));

  return c.json<JobStartResponse>({ jobId: job.id }, 202);
});

jobsRoute.post("/investigate", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = IssueRefSchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref: IssueRef = parsed.data;

  // 調査は push を伴わないため、リポジトリ単位ではなく Issue 単位のロックで足りる。
  // GitHub クライアントの生成はロックを取る前に済ませる。
  // createGithubClient() はトークン検証のため GET /user を叩くので throw しうる。
  // ロック取得より後に置くと、throw した瞬間にロックもジョブも放置され、
  // そのボタンが webhook 再起動まで永久に 409 になる (#48)。
  // ロック取得と .finally の登録の間に、throw しうる処理を挟まないこと。
  const client = await createGithubClient(config.githubToken);

  // ロックの確認はジョブを作る前に行う。作ってから 409 で捨てると、使われないジョブが
  // queued のまま残り (GC は完了済みしか消さない)、ログにも紛らわしい started が出る。
  // ここから acquire までの間に await が無いので、確認と取得の間に割り込みは起きない。
  const holder = jobLocks.holderOf(ref, false);
  if (holder) {
    return c.json<JobConflictResponse>(
      { error: "locked", jobId: holder, message: "この Issue に対するジョブが既に実行中です" },
      409,
    );
  }

  const job = jobStore.create("investigate", ref);
  jobLocks.acquire(ref, job.id, false);

  runInvestigateJob(job, client, ref).finally(() => jobLocks.release(ref, false));

  return c.json<JobStartResponse>({ jobId: job.id }, 202);
});

jobsRoute.post("/clarify", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = IssueRefSchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref: IssueRef = parsed.data;

  // GitHub クライアントの生成はロックを取る前に済ませる。
  // createGithubClient() はトークン検証のため GET /user を叩くので throw しうる。
  // ロック取得より後に置くと、throw した瞬間にロックもジョブも放置され、
  // そのボタンが webhook 再起動まで永久に 409 になる (#48)。
  // ロック取得と .finally の登録の間に、throw しうる処理を挟まないこと。
  const client = await createGithubClient(config.githubToken);

  // ロックの確認はジョブを作る前に行う。作ってから 409 で捨てると、使われないジョブが
  // queued のまま残り (GC は完了済みしか消さない)、ログにも紛らわしい started が出る。
  // ここから acquire までの間に await が無いので、確認と取得の間に割り込みは起きない。
  const holder = jobLocks.holderOf(ref, false);
  if (holder) {
    return c.json<JobConflictResponse>(
      { error: "locked", jobId: holder, message: "この Issue に対するジョブが既に実行中です" },
      409,
    );
  }

  const job = jobStore.create("clarify", ref);
  jobLocks.acquire(ref, job.id, false);

  runClarifyJob(job, client, ref).finally(() => jobLocks.release(ref, false));

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

  // GitHub クライアントの生成はロックを取る前に済ませる。
  // createGithubClient() はトークン検証のため GET /user を叩くので throw しうる。
  // ロック取得より後に置くと、throw した瞬間にロックもジョブも放置され、
  // そのボタンが webhook 再起動まで永久に 409 になる (#48)。
  // ロック取得と .finally の登録の間に、throw しうる処理を挟まないこと。
  const client = await createGithubClient(config.githubToken);

  // ロックの確認はジョブを作る前に行う。作ってから 409 で捨てると、使われないジョブが
  // queued のまま残り (GC は完了済みしか消さない)、ログにも紛らわしい started が出る。
  // ここから acquire までの間に await が無いので、確認と取得の間に割り込みは起きない。
  const holder = jobLocks.holderOf(ref, false);
  if (holder) {
    return c.json<JobConflictResponse>(
      { error: "locked", jobId: holder, message: "この Issue に対するジョブが既に実行中です" },
      409,
    );
  }

  const job = jobStore.create("draft", ref);
  jobLocks.acquire(ref, job.id, false);

  runDraftJob(job, client, ref).finally(() => jobLocks.release(ref, false));

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
