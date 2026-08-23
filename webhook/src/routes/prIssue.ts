import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.ts";
import { createGithubClient, findIssueForPr, getPullRequestMergeable } from "../github.ts";
import type { ApiErrorResponse, PrIssueStatusResponse } from "../types/api.ts";

const QuerySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export const prIssueRoute = new Hono();

/**
 * PR番号から対応するissue番号とmergeable状態を返す。
 * userscript のPRページ用パネルが「コンフリクト解決」ボタンの表示可否を判定するために使う。
 * 対応するissueが見つからない場合は 404 ではなく 200 で `{ issueNumber: null }` を返す
 * (userscript側が「パネルを表示しない」判断をしやすくするため)。
 */
prIssueRoute.get("/:number/issue", async (c) => {
  const numberParsed = z.coerce.number().int().positive().safeParse(c.req.param("number"));
  const queryParsed = QuerySchema.safeParse({
    owner: c.req.query("owner"),
    repo: c.req.query("repo"),
  });
  if (!numberParsed.success || !queryParsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: "owner・repo・PR番号の指定が不正です" },
      400,
    );
  }
  const prNumber = numberParsed.data;
  const { owner, repo } = queryParsed.data;

  const client = await createGithubClient(config.githubToken);
  const issueNumber = await findIssueForPr(client, owner, repo, prNumber);
  if (issueNumber === null) {
    return c.json<PrIssueStatusResponse>({ issueNumber: null });
  }

  const mergeable = await getPullRequestMergeable(client, { owner, repo, issueNumber }, prNumber);
  return c.json<PrIssueStatusResponse>({ issueNumber, mergeable });
});
