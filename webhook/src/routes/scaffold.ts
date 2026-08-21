import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.ts";
import { createGithubClient, ensureScaffoldComments, listIssueComments } from "../github.ts";
import { buildScaffoldBody, type SourceKind } from "../markers.ts";
import type { ApiErrorResponse, ScaffoldResponse } from "../types/api.ts";

const BodySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.number().int().positive(),
});

export const scaffoldRoute = new Hono();

scaffoldRoute.post("/", async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json<ApiErrorResponse>(
      { error: "invalid_request", message: parsed.error.message },
      400,
    );
  }
  const ref = parsed.data;

  const client = await createGithubClient(config.githubToken);
  const existing = await listIssueComments(client, ref);

  const bodies: Record<SourceKind, string> = {
    requirements: buildScaffoldBody("requirements"),
    architecture: buildScaffoldBody("architecture"),
    tests: buildScaffoldBody("tests"),
  };

  const { created, skipped } = await ensureScaffoldComments(client, ref, bodies, existing);
  const body: ScaffoldResponse = { created, skipped };
  return c.json(body);
});
