import { Hono } from "hono";
import { config } from "../config.ts";
import type { HealthResponse } from "../types/api.ts";

export const healthRoute = new Hono();

healthRoute.get("/", (c) => {
  const body: HealthResponse = { ok: true, version: "0.1.0", dryRun: config.dryRun };
  return c.json(body);
});
