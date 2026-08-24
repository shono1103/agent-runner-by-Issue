import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { config, envFile } from "./config.ts";
import { findExecutable } from "./which.ts";

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(
      `agent-runner webhook listening on http://${info.address}:${info.port} ` +
        `(DRY_RUN=${config.dryRun ? "true" : "false"}, env=${envFile.path})`,
    );
    if (config.dryRun) {
      console.log("DRY_RUN=true: PR 作成ジョブは push / PR 作成を行いません。");
    }

    // ジョブは全て claude cli を spawn する。PATH で解決できないと、ボタンを押した
    // その時まで気付けないまま ENOENT で失敗するので、起動時に確認しておく。
    const claudeBin = findExecutable("claude");
    if (claudeBin) {
      console.log(`claude cli: ${claudeBin}`);
    } else {
      console.error(
        "[NG] claude が PATH 上に見つかりません。全てのジョブが spawn ENOENT で失敗します。\n" +
          `     PATH=${process.env.PATH ?? "(未設定)"}\n` +
          "     systemd で常駐させている場合は webhook/scripts/install-service.sh を再実行してください。",
      );
    }
  },
);

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
