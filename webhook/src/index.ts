import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { config } from "./config.ts";

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(
      `agent-runner webhook listening on http://${info.address}:${info.port} ` +
        `(DRY_RUN=${config.dryRun ? "true" : "false"})`,
    );
    if (config.dryRun) {
      console.log("DRY_RUN=true: PR 作成ジョブは push / PR 作成を行いません。");
    }
  },
);

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
