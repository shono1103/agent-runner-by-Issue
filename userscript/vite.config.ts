import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

export default defineConfig({
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: "agent-runner",
        namespace: "https://github.com/shono1103/agent-runner-by-Issue",
        version: "0.1.0",
        description: "GitHub Issue から claude cli を起動し、要件を Allium/LikeC4/Superpowers に変換して PR を作る",
        match: ["https://github.com/*"],
        grant: ["GM_xmlhttpRequest", "GM_getValue", "GM_setValue", "GM_addStyle"],
        connect: ["127.0.0.1", "localhost"],
        "run-at": "document-idle",
        noframes: true,
      },
      build: {
        fileName: "agent-runner.user.js",
        autoGrant: true,
      },
    }),
  ],
  build: {
    minify: false,
    sourcemap: false,
  },
});
