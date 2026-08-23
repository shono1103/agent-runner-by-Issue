import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.ts";
import { createGithubClient, findOpenPrForIssue, getPullRequestMergeable } from "../github.ts";
import type { ApiErrorResponse, PrStatusResponse } from "../types/api.ts";

const QuerySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.coerce.number().int().positive(),
});

export const prStatusRoute = new Hono();

/**
 * 対象issueに対応するOPENなPRの mergeable 状態を返す。
 * userscript のパネルが「コンフリクト解決」ボタンの表示可否を判定するために使う。
 */
prStatusRoute.get("/", async (c) => {
  const parsed = QuerySchema.safeParse({
    owner: c.req.query("owner"),
    repo: c.req.query("repo"),
    issueNumber: c.req.query("issueNumber"),
  });
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref = parsed.data;

  const client = await createGithubClient(config.githubToken);
  const pr = await findOpenPrForIssue(client, ref);
  if (!pr) {
    return c.json<PrStatusResponse>({ pr: null });
  }

  const mergeable = await getPullRequestMergeable(client, ref, pr.number);
  return c.json<PrStatusResponse>({ pr: { number: pr.number, branch: pr.branch, mergeable } });
});
