import { Hono } from "hono";
import { config } from "./config.ts";
import { healthRoute } from "./routes/health.ts";
import { jobsRoute } from "./routes/jobs.ts";
import { scaffoldRoute } from "./routes/scaffold.ts";
import type { ApiErrorResponse } from "./types/api.ts";

export const app = new Hono();

const ALLOWED_ORIGIN = "https://github.com";

// GitHub の Issue ページ (userscript) からのみ叩かせる。Private Network Access 対策も含む。
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  c.header("Access-Control-Allow-Headers", "X-Agent-Runner-Token, Content-Type");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Private-Network", "true");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
  await next();
});

// 認証はあくまで事故防止 (トークンは userscript のソースにも平文で入る)。
// 本質的な安全境界は 127.0.0.1 bind の方。/api/health は疎通確認のため除外する。
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") {
    await next();
    return;
  }
  const token = c.req.header("X-Agent-Runner-Token");
  if (token !== config.agentRunnerToken) {
    return c.json<ApiErrorResponse>(
      { error: "unauthorized", message: "X-Agent-Runner-Token が不正、または未指定です" },
      401,
    );
  }
  await next();
});

app.route("/api/health", healthRoute);
app.route("/api/issues/scaffold", scaffoldRoute);
app.route("/api/jobs", jobsRoute);

app.notFound((c) =>
  c.json<ApiErrorResponse>({ error: "not_found", message: "そのエンドポイントは存在しません" }, 404),
);

app.onError((err, c) => {
  console.error(err);
  return c.json<ApiErrorResponse>(
    { error: "internal_error", message: String((err as Error)?.message ?? err) },
    500,
  );
});
