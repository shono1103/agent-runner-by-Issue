# agent-runner-by-Issue

GitHub Issue を起点に claude cli を実行するための PoC。Issue 上で「要件定義 / システム
アーキテクチャ定義 / テスト定義」を書き、それぞれを **Allium (振る舞いの形式仕様) /
LikeC4 (アーキテクチャ図) / Superpowers (実行計画)** に機械変換して推敲し、納得がいったら
その仕様を根拠に PR を自動生成する。

pnpm workspaces によるモノレポで、以下の2つのサブプロジェクトからなる。

```
.
├── webhook/      # ローカルPCで動く HTTP サーバー。claude cli / GitHub API を叩く
└── userscript/   # Tampermonkey userscript。GitHub の Issue ページにボタンパネルを注入する
```

## 全体の流れ

1. userscript の「フォーマット作成」ボタン → webhook が Issue に3つのコメントを新規投稿
   (`## 要件定義` / `## システムアーキテクチャ定義` / `## テスト定義`)
2. 人間が各コメントを編集して中身を書く
3. userscript の「Allium 生成 / LikeC4 生成 / Superpowers 生成 / すべて生成」ボタン →
   webhook が該当コメントを読み、claude cli で変換し、**形式ごとの専用コメント**として
   投稿/更新する (再実行しても増殖しない)
4. 2〜3 を納得がいくまで繰り返す
5. 「PR を作成」ボタン → webhook が対象リポジトリを clone し、確定した仕様を渡して
   claude cli に実装させ、commit → (DRY_RUN でなければ) push・PR 作成

各形式の役割分担: **LikeC4 = 構造**、**Allium = 振る舞い (テストが機械導出できる)**、
**Superpowers = 実行計画**。Allium・Superpowers は要件定義+テスト定義を、LikeC4 は
システムアーキテクチャ定義を入力にする。

## セットアップ

```sh
pnpm install
cp webhook/.env.example webhook/.env
# webhook/.env を編集: AGENT_RUNNER_TOKEN (適当な乱数文字列) / GITHUB_TOKEN (repo スコープの PAT) /
# ALLOWED_AUTHORS (Issue コメントを信頼する GitHub ユーザー名。プロンプトインジェクション対策)
```

### webhook を起動する

```sh
pnpm --filter webhook dev   # http://127.0.0.1:8787
```

`AGENT_RUNNER_DRY_RUN=true` が既定値。この間は PR 作成ジョブが `git push` / PR 作成を
行わず、ブランチと差分だけをローカルの一時ディレクトリに残す。本番運用に切り替えるときは
明示的に `false` にする。

### userscript を Tampermonkey に読み込む

GitHub の CSP により `vite` の dev サーバーは使えないため、`vite build --watch` +
`@require file://` のローダー方式を使う。

```sh
pnpm --filter userscript dev   # dist/agent-runner.user.js を watch ビルドし続ける
```

1. Chrome の Tampermonkey 拡張機能の詳細設定で「ファイルの URL へのアクセスを許可する」を ON
2. Tampermonkey に以下の内容で新規スクリプトを1つ登録する (パスは環境に合わせて変更)

   ```js
   // ==UserScript==
   // @name         agent-runner (dev loader)
   // @match        https://github.com/*
   // @grant        GM_xmlhttpRequest
   // @grant        GM_getValue
   // @grant        GM_setValue
   // @grant        GM_addStyle
   // @connect      127.0.0.1
   // @connect      localhost
   // @noframes
   // @require      file:///Users/shonoshono/repos/personal/agent-runner-by-Issue/userscript/dist/agent-runner.user.js
   // ==/UserScript==
   ```

3. Tampermonkey の設定 (Advanced) で Externals の更新間隔を「Always」にする
   (既定はキャッシュされ、ビルドし直しても反映されない)
4. 実際の GitHub Issue ページを開くと右下にパネルが表示される。⚙ から webhook URL
   (既定 `http://127.0.0.1:8787`) と `AGENT_RUNNER_TOKEN` を設定し、「疎通確認」で確認する

## 安全上の注意 (PoC としての前提)

* webhook は `127.0.0.1` にのみ bind する。共有トークンは事故防止であって認証ではない
  (userscript のソースに平文で入るため)
* PR 作成ジョブは `acceptEdits` + ツール許可リストで動かし、`bypassPermissions` は使わない
  (隔離した clone ディレクトリという cwd 境界が実質のサンドボックスであり、
  `bypassPermissions` はその境界ごと外してしまう)
* `.github/workflows/` への変更は commit 前に無条件で拒否する (`webhook/src/safety.ts`)
* Issue コメントは `ALLOWED_AUTHORS` にある GitHub ユーザーかつ
  OWNER/MEMBER/COLLABORATOR のものだけを claude cli への入力として使う
  (プロンプトインジェクション対策)

## 開発

```sh
pnpm run typecheck   # webhook / userscript 両方
```

サブプロジェクトごとの詳細は各ディレクトリの `src/` を参照。
