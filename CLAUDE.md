# CLAUDE.md

GitHub Issue を起点に claude cli を実行する PoC。構成・セットアップ・全体の流れは
[README.md](README.md) を参照。

## 構成

pnpm workspaces のモノレポ。`webhook/` (Node/Hono、claude cli と GitHub API を叩く) と
`userscript/` (Vite + vite-plugin-monkey、GitHub Issue ページに UI を注入する) の2つ。

`webhook/src/types/api.ts` が両者の型の境界。`userscript` からは
`@agent-runner/webhook/api-types` として `import type` する (実行時コードは含まれない)。

## 実装上の注意点 (壊しやすい箇所)

* `webhook/src/**/*.ts` の相対 import は **`.ts` 拡張子を明示する**こと。
  `webhook` は Node の `--experimental-transform-types` で直接実行するため、
  ESM の仕様上、拡張子省略や `.js` 指定では解決できない。
* `allium check` は警告のみでも構文エラーでも `exit=1` を返す。**終了コードで判定しない**。
  必ず `webhook/src/claude/verify/allium.ts` のように stdout の JSON
  (`diagnostics[].severity`) で判定する。`likec4 validate` は逆に終了コードが信頼できる。
* claude cli の呼び出し (`webhook/src/claude/run-claude.ts`) も**終了コードでは判定しない**。
  `--max-budget-usd` 超過は `exit=0` なのに `is_error:true` になる。stdout の JSON を
  パースしてから `is_error` → `structured_output` の順に見る。
* PR 作成ジョブ (`webhook/src/jobs/createPr.ts`) は `permissionMode: "acceptEdits"` 固定。
  `bypassPermissions` は使わない (隔離 clone の cwd 境界を自ら外すことになるため)。
* userscript から webhook を叩くのは `GM_xmlhttpRequest` のみ。GitHub の CSP
  (`connect-src` に localhost が無い) により素の `fetch` は使えない。

## よく使う操作

| やること | 使うもの |
| --- | --- |
| webhook を起動する | `pnpm --filter webhook dev` |
| userscript をビルドし続ける | `pnpm --filter userscript dev` (= `vite build --watch`) |
| 型チェック | `pnpm run typecheck` |
| 生成物を検証する | `likec4 validate --json --no-layout <dir>` / `allium check <file>` |

## 言語

ドキュメント・コメント・コミットメッセージは日本語で書く。
