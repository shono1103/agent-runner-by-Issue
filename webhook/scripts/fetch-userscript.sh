#!/usr/bin/env bash
# クライアントPCから実行する。リモートホスト上で userscript をビルドし、
# 成果物 (dist/agent-runner.user.js) を取得する。
#
# 使い方:
#   webhook/scripts/fetch-userscript.sh [remote-host] [remote-path]
#
# 接続先は install-remote.sh と同じ既定値・同じ REMOTE_HOST / REMOTE_PATH 環境変数を使う。
#
# 取得した内容は:
#   - ローカルの userscript/dist/agent-runner.user.js に保存する
#     (Tampermonkey の devローダー方式 `@require file://...` がそのまま拾える)
#   - pbcopy があればクリップボードにもコピーする (スタンドアロン登録用)
#   - 標準出力にも流す (ログは標準エラーに出すので `> file` や他コマンドへのパイプも自由)
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

REMOTE_HOST="${1:-${REMOTE_HOST:-shonoshono-home}}"
REMOTE_PATH="${2:-${REMOTE_PATH:-opt/agent-runner-by-Issue}}"
LOCAL_DIST="userscript/dist/agent-runner.user.js"

echo "== 接続先: $REMOTE_HOST:$REMOTE_PATH ==" >&2

CONTROL_PATH="/tmp/agent-runner-ssh-$$.sock"
SSH_MUX_OPTS=(-o "ControlMaster=auto" -o "ControlPath=$CONTROL_PATH" -o "ControlPersist=10m")
cleanup() {
  ssh -o "ControlPath=$CONTROL_PATH" -O exit "$REMOTE_HOST" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# nvm 環境では node/pnpm への PATH は対話シェルの ~/.bashrc 経由でしか通らない
# (詳細は install-remote.sh のコメント参照)。ビルドコマンドの前に明示的に読み込む。
NVM_INIT='export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '

echo "== リモートで userscript をビルド =="  >&2
ssh -t "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "${NVM_INIT}cd '$REMOTE_PATH' && pnpm --filter userscript build" >&2

echo "== 成果物を取得 ==" >&2
mkdir -p "$(dirname "$LOCAL_DIST")"
ssh "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "cat '$REMOTE_PATH/userscript/dist/agent-runner.user.js'" > "$LOCAL_DIST"

if [[ ! -s "$LOCAL_DIST" ]]; then
  echo "[NG] $LOCAL_DIST が空です。リモートのビルドが失敗していないか確認してください。" >&2
  exit 1
fi
echo "[OK] $LOCAL_DIST に保存しました" >&2

if command -v pbcopy >/dev/null 2>&1; then
  pbcopy < "$LOCAL_DIST"
  echo "[OK] クリップボードにもコピーしました" >&2
else
  echo "[INFO] pbcopy が見つからないのでクリップボードへのコピーはスキップしました" >&2
fi

cat "$LOCAL_DIST"
