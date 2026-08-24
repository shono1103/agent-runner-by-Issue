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
* 環境変数は `webhook/src/env-file.ts` が `.env` を読んで **`process.env` を上書きする**。
  node の `--env-file` は既存の `process.env` を上書きしないため、systemd の
  `Environment=` やシェルの `export` に残った古い値が勝ってしまうのを防ぐためのもの。
  `--env-file` を復活させないこと。読むファイルは `AGENT_RUNNER_ENV_FILE` で切り替える
  (テストは `.env.test` を指している)。
* `.env` を書き換えたら webhook を**再起動**する。プロセスは起動時の値を握ったままで、
  `/api/health` の `dryRun` にも古い値が出続ける。
* claude / git を `spawn()` で起動するとき、コマンド名の解決に使われるのは
  **子プロセスに渡す env の `PATH`** で、親プロセスの `PATH` ではない。systemd 常駐では
  unit の `Environment=PATH=` が全て (`~/.profile` も `~/.bashrc` も読まれない) なので、
  `webhook/scripts/install-service.sh` の `path_append` に積み忘れると
  「対話シェルからは動くのにサービスからだけ ENOENT」になる。claude は
  `~/.local/bin` に入るため、`/usr/bin` 等の既定 PATH には無い。
* `spawn` の `ENOENT` は「コマンドが PATH に無い」場合と「`cwd` が存在しない」場合の
  どちらでも出る。`message` も `code` も `path` も同じで区別できないため、
  `run-claude.ts` の `describeSpawnError()` のように
  `findExecutable()` で実際に解決できるかを見てから原因を決めること。
* systemd unit を書き換えたら `daemon-reload` だけでは反映されない。既存プロセスは
  起動時の環境変数を握ったままなので **`restart` が要る**。`enable --now` は
  「停止中なら起動」するだけで、動作中のサービスには何もしない。
  `install-service.sh` は `enable` + `restart` に分けてある。
* `routes/jobs.ts` の POST ルートは順序が意味を持つ。**GitHub クライアントの生成 →
  ロックの確認 → ジョブ生成 → `acquire` → `.finally(release)`** の順を崩さないこと。
  `createGithubClient()` はトークン検証で `GET /user` を叩くので throw しうる。
  ロック取得と `.finally` の登録の間に throw しうる処理を挟むと、ロックが解放されず
  そのボタンが webhook 再起動まで永久に 409 になる。
* リモートへの反映は用途でスクリプトを使い分ける。`install-remote.sh` は**初回のみ**
  (`setup-env.sh` を対話起動して `.env` を作る)。2回目以降の更新は
  `update-remote.sh` を使う (`.env` に触れず、同期 → `pnpm install` → サービス再起動 →
  `/api/health` 確認まで通す)。**コードを同期しただけでは反映されない**。
* PR 作成ジョブが書き出す仕様の置き場所は `.agent-runner/issues/<issue番号>/` で、
  パスの定義は `webhook/src/spec-dir.ts` の `specDirFor()` の1箇所だけ。
  `.agent-runner/source` / `.agent-runner/generated` 固定に戻さないこと
  (別 issue のPR同士が必ず衝突し、先にマージされた仕様が次の create-pr で消えるため)。
  `webhook/src/prompts/implement.ts` の参照先も `specDirFor()` から組み立てる。
* userscript から webhook を叩くのは `GM_xmlhttpRequest` のみ。GitHub の CSP
  (`connect-src` に localhost が無い) により素の `fetch` は使えない。

## よく使う操作

| やること | 使うもの |
| --- | --- |
| webhook を起動する | `pnpm --filter webhook dev` |
| userscript をビルドし続ける | `pnpm --filter userscript dev` (= `vite build --watch`) |
| 型チェック | `pnpm run typecheck` |
| 生成物を検証する | `likec4 validate --json --no-layout <dir>` / `allium check <file>` |
| リモートを最新コードに更新する | `webhook/scripts/update-remote.sh` (クライアントPCから) |

## 言語

ドキュメント・コメント・コミットメッセージは日本語で書く。
