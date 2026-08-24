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

### 仕様の置き場所 (`.agent-runner/issues/<N>/`)

PR 作成ジョブは、確定した仕様を対象 issue の番号ごとのディレクトリに書き出してから
claude cli に実装させる。パスは `webhook/src/spec-dir.ts` の `specDirFor()` が唯一の定義。

```
.agent-runner/issues/<N>/
├── source/                 # 人間が Issue コメントに書いた原文
│   ├── requirements.md
│   ├── architecture.md
│   └── tests.md
└── generated/              # claude cli による変換結果 (無いこともある)
    ├── design.md           # Superpowers design doc
    ├── architecture.c4     # LikeC4
    └── spec.allium         # Allium
```

issue ごとに分かれているため、**別々の issue のPRがこのディレクトリで衝突することはなく、
先にマージされた issue の仕様が後の PR 作成で上書きされて消えることもない**。過去の issue
の仕様はそのままリポジトリに残る (実装の根拠のアーカイブになる)。

## セットアップ

```sh
pnpm install
cp webhook/.env.example webhook/.env
# webhook/.env を編集: AGENT_RUNNER_TOKEN (適当な乱数文字列) / GITHUB_TOKEN (repo スコープの PAT) /
# ALLOWED_AUTHORS (Issue コメントを信頼する GitHub ユーザー名。プロンプトインジェクション対策)
```

### リモートホスト (tailscale 等) にインストールする場合

**クライアントPCから** `webhook/scripts/install-remote.sh [remote-host] [remote-path]` を
実行する。ローカルのリポジトリを `rsync` でリモートへ同期し (`.gitignore` 準拠で
`node_modules/`・`.env` などは除外)、続けて `ssh -t` でリモート上の
`webhook/scripts/setup-env.sh` を対話実行させる (トークン等のプロンプトはこの端末に
そのまま出る)。接続先はデフォルトで `~/.ssh/config` の `shonoshono-home`、配置先はデフォルトで
`~/opt/agent-runner-by-Issue` (相対パス指定。リモートの `$HOME` 基準)。
どちらも `REMOTE_HOST` / `REMOTE_PATH` 環境変数か引数で上書きできる。

```sh
./webhook/scripts/install-remote.sh                       # 既定 (shonoshono-home:~/opt/agent-runner-by-Issue)
./webhook/scripts/install-remote.sh shonoshono-home other/path
```

`webhook/scripts/setup-env.sh` 単体は、リモート上に既にコードがある状態で直接叩いてもよい
(`install-remote.sh` はこれを ssh 越しに呼んでいるだけ)。どちらも Ubuntu Server の初期状態
(git / pnpm / gh 未導入) を前提にしており、不足しているコマンドがあれば自動インストールは
せず、実行すべきコマンドを提示してスクリプトを終了する
(sudo を伴う操作を勝手に行わないため。提示されたコマンドを実行してから再実行する)。

GitHub トークンは次の2方式から選べる。

* `gh` コマンド経由 (`GITHUB_TOKEN_SOURCE=gh`) — 対象ホストで `gh auth login` 済みなら、
  起動時に `gh auth token` の出力を使う。生の PAT を `.env` に置かずに済む
* Personal Access Token を直接 `.env` に書く (`GITHUB_TOKEN_SOURCE=pat`、既定)

`HOST` は `tailscale` コマンドがあれば `tailscale ip -4` の値を自動検出する。webhookを
`127.0.0.1` 以外にbindする場合、これまでの「本質的な安全境界は127.0.0.1 bind」という
前提が崩れる点に注意 (詳細は「安全上の注意」を参照)。tailnet インターフェースのIPに
明示的にbindし、LANなど他のネットワークには晒さないこと。

`pnpm install` の後、`webhook/scripts/install-service.sh` で systemd `--user` サービスとして
常駐化できる (`install-remote.sh` からも続けて呼べる)。SSHセッションを閉じても動き続け、
`Restart=on-failure` で異常終了時は自動再起動する。sudoは使わないが、ログアウト後も
動かし続けるための `loginctl enable-linger` だけは権限が無いと失敗するため、その場合は
提示される `sudo loginctl enable-linger <user>` を別途実行する。

サービスの `Environment=PATH=` は `install-service.sh` が組み立てる。systemd プロセスは
`~/.profile` も `~/.bashrc` も読まないため、ここに書かれた PATH が全てになる。
webhook は claude を `spawn("claude", ...)` と名前で起動し、その解決には**子プロセスに
渡す env の PATH** が使われるので、claude のディレクトリ (公式インストーラなら
`~/.local/bin`) が積まれていないと、対話シェルからは動くのに常駐サービスからだけ
`claude cli 失敗 (spawn): spawn claude ENOENT` で落ちる。`install-service.sh` は
`command -v claude` で場所を拾って積み、見つからなければ警告する。claude を
後から入れた場合は `install-service.sh` を再実行して PATH を取り直すこと。

webhook は起動時にも claude を PATH 上で解決できるか確認し、`claude cli: <path>` か
`[NG] claude が PATH 上に見つかりません` をログに出す。

```sh
ssh -t shonoshono-home "cd '~/opt/agent-runner-by-Issue' && webhook/scripts/install-service.sh"

# 状態確認・ログ
ssh shonoshono-home 'systemctl --user status agent-runner-webhook.service --no-pager'
ssh shonoshono-home 'journalctl --user -u agent-runner-webhook.service -f'
```

ジョブの開始・終了はここに出る。失敗したときはエラー内容に加えて、ジョブが溜めた
ログの末尾5行も添える (診断の実体はそこにあるため)。

```
[job] create-pr shono1103/agent-runner-by-Issue#45 started id=88d83e9a-...
[job] create-pr shono1103/agent-runner-by-Issue#45 failed id=88d83e9a-... (phase=claude 実行中, 12.3s, $0.4210): claude cli 失敗 (spawn): ...
       | 隔離 clone を作成
       | claude 実行中
```

開始も出しているのは、ハングして終了に到達しないジョブがログ上に一切現れないのを
避けるため (失敗と区別がつかなくなる)。


### リモートを最新コードに更新する

一度インストールしたあと、コードを更新してリモートに反映するには
**クライアントPCから** `webhook/scripts/update-remote.sh` を実行する。
`install-remote.sh` は初回インストール用 (`setup-env.sh` を対話起動して `.env` を作る)
なので、更新のたびに使うには重い。`update-remote.sh` は `.env` に一切触れず、
次を非対話で通す。

1. ローカルで `pnpm run typecheck` (壊れたコードを配らないためのガード。`--skip-check` で省略)
2. `rsync` で同期 (`.gitignore` 準拠。`webhook/.env` と `.git` は除外)
3. リモートで `pnpm install --frozen-lockfile`
4. `agent-runner-webhook.service` を再起動し、**MainPID が変わったこと**を確認
5. `GET /api/health` を叩き、`.env` の `AGENT_RUNNER_DRY_RUN` と応答の `dryRun` が
   一致することを確認

```sh
./webhook/scripts/update-remote.sh                    # 既定 (shonoshono-home:~/opt/agent-runner-by-Issue)
./webhook/scripts/update-remote.sh -y                 # 確認プロンプトなし
./webhook/scripts/update-remote.sh --no-delete        # ローカルに無いファイルをリモートに残す
```

同期前に rsync の dry-run 結果を表示して確認を取る。既定では `--delete` 付き
(ローカルで削除したファイルがリモートに残り続けて実体が食い違うのを防ぐため)。
`node_modules/`・`dist/`・`.env` は除外パターン側で守られるので消えない。

接続先が未セットアップ (リモートに `webhook/.env` が無い) の場合は、`.env` を作りには
行かず `install-remote.sh` を案内して終了する。サービスが未登録なら同期だけ済ませて
`install-service.sh` を案内する。

5. の確認を入れているのは、`systemctl status` では「プロセスが生きている」ことしか
分からないため。実際に HTTP が返り、しかも `.env` と食い違っていないところまで見ないと、
古いプロセスが残っている状態 (「webhook を起動する」の下記参照) を見逃す。

### webhook を起動する

```sh
pnpm --filter webhook dev   # http://127.0.0.1:8787
```

`AGENT_RUNNER_DRY_RUN=true` が既定値。この間は PR 作成ジョブが `git push` / PR 作成を
行わず、ブランチと差分だけをローカルの一時ディレクトリに残す。本番運用に切り替えるときは
明示的に `false` にする (`true` / `false` 以外の値を書くと起動時にエラーになる)。

#### 設定の読み込み順 (`.env` が常に勝つ)

node の `--env-file` は既に `process.env` にあるキーを上書きしないため、systemd の
`Environment=` やシェルの `export` に古い値が残っていると、`.env` を書き換えても
前回の値のまま起動してしまう。これを避けるため webhook は `--env-file` を使わず、
`webhook/src/env-file.ts` が `.env` を読んで**プロセス環境変数を上書きする**。

* 読み込むファイルは `AGENT_RUNNER_ENV_FILE` で変更できる (相対パスは `webhook/` 基準、
  既定は `webhook/.env`)。`PORT=9999 pnpm --filter webhook start` のような一時的な
  上書きは効かないので、別の env ファイルを用意して `AGENT_RUNNER_ENV_FILE` で指す
* 上書きが起きたキー名は起動時に `[env] ...` として警告に出る
* 起動ログに、実際に読み込んだ env ファイルのパスと `DRY_RUN` の値が出る

```
agent-runner webhook listening on http://100.106.101.15:8787 (DRY_RUN=false, env=/home/…/webhook/.env)
```

**`.env` を書き換えたら webhook を再起動すること。** 動いているプロセスは起動時の値を
握ったままなので、userscript の「疎通確認」にも古い `DRY_RUN` が表示される。

```sh
systemctl --user restart agent-runner-webhook.service   # 常駐サービスの場合
```

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
   // @connect      100.106.101.15
   // @noframes
   // @require      file:///Users/shonoshono/repos/personal/agent-runner-by-Issue/userscript/dist/agent-runner.user.js
   // ==/UserScript==
   ```

   `@connect` は webhook の接続先ホストを列挙する allowlist。webhook をリモート
   (shonoshono-home の tailscale IP `100.106.101.15` など) で動かす場合はそのホストも
   追加する (`userscript/vite.config.ts` の `connect` と揃える)。ここは Tampermonkey に
   直接貼った内容がそのまま使われる (`vite.config.ts` を直しても反映されないので、両方
   直す必要がある)。

3. Tampermonkey の設定 (Advanced) で Externals の更新間隔を「Always」にする
   (既定はキャッシュされ、ビルドし直しても反映されない)

### userscript をリモートでビルドして取得する

`webhook` を shonoshono-home で動かす構成では、`userscript` もそちらでビルドしたい
ことがある。`webhook/scripts/fetch-userscript.sh` はリモートで `pnpm --filter userscript
build` を実行し、成果物 (`dist/agent-runner.user.js`) を取得する。

```sh
./webhook/scripts/fetch-userscript.sh                       # 既定 (shonoshono-home:~/opt/agent-runner-by-Issue)
```

取得した内容は次の3箇所に反映される。

* ローカルの `userscript/dist/agent-runner.user.js` に保存 (上の devローダーの
  `@require file://` がそのまま拾える)
* `pbcopy` があればクリップボードにもコピー (Tampermonkey ダッシュボードに直接ペーストして
  スタンドアロンなスクリプトとして登録する場合用)
* 標準出力にも同じ内容を流す (`> path/to/file.user.js` などへの自由なリダイレクトも可能)
4. 実際の GitHub Issue ページを開くと右下にパネルが表示される。⚙ から webhook URL
   (既定 `http://127.0.0.1:8787`) と `AGENT_RUNNER_TOKEN` を設定し、「疎通確認」で確認する

## 安全上の注意 (PoC としての前提)

* webhook は既定で `127.0.0.1` にのみ bind する。共有トークンは事故防止であって認証ではない
  (userscript のソースに平文で入るため)。`HOST` を tailscale 等の別インターフェースに
  変更する場合、境界は「そのネットワーク (tailnet) にいる端末だけが到達できる」ことに
  置き換わる。`0.0.0.0` ではなく tailnet インターフェースの IP を明示し、LAN 等の
  他ネットワークに晒さないこと
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
