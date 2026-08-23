#!/usr/bin/env bash
# クライアントPCから実行する。リポジトリをリモートホストへ同期し、
# リモート上で webhook/scripts/setup-env.sh を対話実行させるオーケストレータ。
#
# 使い方:
#   webhook/scripts/install-remote.sh [remote-host] [remote-path]
#
# 例:
#   webhook/scripts/install-remote.sh                              # ~/.ssh/config の shonoshono-home へ
#   webhook/scripts/install-remote.sh shonoshono-home               # 同上を明示指定
#   webhook/scripts/install-remote.sh shonoshono-home /opt/agent-runner
#
# 接続先は REMOTE_HOST / REMOTE_PATH 環境変数でも指定できる (引数が優先)。
#
# secrets は一切扱わない。実際のトークン入力は setup-env.sh 側の read/read -s に任せ、
# ここでは「コードを届ける」「リモートで対話スクリプトを起動する」ことだけをやる。
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

REMOTE_HOST="${1:-${REMOTE_HOST:-shonoshono-home}}"
# 相対パス (リモートの $HOME 基準) にしておく。"~/..." をデフォルトにすると
# シングルクォート越しの呼び出しでチルダ展開されず文字通りの "~" ディレクトリが
# できてしまうため、あえて使わない (実際には ~/opt/agent-runner-by-Issue に置かれる)。
REMOTE_PATH="${2:-${REMOTE_PATH:-opt/agent-runner-by-Issue}}"

echo "== 接続先 =="
echo "  REMOTE_HOST: $REMOTE_HOST"
echo "  REMOTE_PATH: $REMOTE_PATH"
echo

if ! command -v rsync >/dev/null 2>&1; then
  echo "[NG] ローカルに rsync が見つかりません。インストールしてから再実行してください。" >&2
  exit 1
fi

# このスクリプト内の ssh / rsync 呼び出しを1本のマスター接続に相乗りさせる。
# これが無いと、パスワード認証の場合に呼び出しの数だけ (疎通確認・rsync確認・rsync本体・
# setup-env.sh・pnpm install・install-service.sh と最大6回) パスワードを聞かれてしまう。
CONTROL_PATH="/tmp/agent-runner-ssh-$$.sock"
SSH_MUX_OPTS=(-o "ControlMaster=auto" -o "ControlPath=$CONTROL_PATH" -o "ControlPersist=10m")
cleanup() {
  ssh -o "ControlPath=$CONTROL_PATH" -O exit "$REMOTE_HOST" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# nvm 環境では node/pnpm への PATH は ~/.bashrc 経由で通るが、`ssh host "command"` は
# -t を付けても非対話シェル扱いになり ~/.bashrc が読まれない。setup-env.sh /
# install-service.sh は自前で nvm.sh を読み込むが、ここから直接叩く `pnpm install` は
# そうではないため、同じ対策をコマンド文字列の先頭に差し込む。
NVM_INIT='export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '

echo "== SSH 疎通確認 (最初の1回だけ認証を求められます) =="
if ! ssh "${SSH_MUX_OPTS[@]}" -o ConnectTimeout=5 "$REMOTE_HOST" true; then
  echo "[NG] '$REMOTE_HOST' に接続できません。~/.ssh/config の設定を確認してください。" >&2
  exit 1
fi
echo "[OK] $REMOTE_HOST に接続できます"

echo
echo "== リモートの rsync 確認 =="
if ! ssh "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" 'command -v rsync >/dev/null 2>&1'; then
  echo "[NG] '$REMOTE_HOST' 側に rsync が見つかりません。次を実行してから再実行してください:" >&2
  echo "     ssh $REMOTE_HOST 'sudo apt-get update && sudo apt-get install -y rsync'" >&2
  exit 1
fi
echo "[OK] リモートに rsync があります"

echo
echo "== コードを $REMOTE_HOST:$REMOTE_PATH へ同期 =="
ssh "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "mkdir -p '$REMOTE_PATH'"
# --info=stats1 は rsync 3.1+ 専用。macOS 標準の openrsync (2.6.9 互換) には無いので使わない。
rsync -az --exclude-from=.gitignore --exclude='.git' --exclude='webhook/.env' \
  -e "ssh ${SSH_MUX_OPTS[*]}" \
  ./ "$REMOTE_HOST:$REMOTE_PATH/"
echo "[OK] 同期完了 (.env は除外済み。既存のリモート .env は上書きされません)"

echo
echo "== リモートで setup-env.sh を対話実行 =="
echo "   (トークン等の入力プロンプトがこの端末にそのまま出ます)"
echo
ssh -t "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_PATH/webhook' && ./scripts/setup-env.sh"

echo
read -r -p "続けて 'pnpm install' をリモートで実行しますか? [Y/n]: " do_install
case "$do_install" in
  [Nn]*)
    echo
    echo "完了 (依存インストール・常駐化は未実施)。あとで '$REMOTE_HOST' に SSH ログインして:"
    echo "    cd '$REMOTE_PATH'"
    echo "    pnpm install"
    echo "    webhook/scripts/install-service.sh"
    exit 0
    ;;
esac

echo "== pnpm install (リモート) =="
ssh -t "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "${NVM_INIT}cd '$REMOTE_PATH' && pnpm install"

echo
read -r -p "webhook を systemd --user サービスとして常駐化しますか? [Y/n]: " do_service
case "$do_service" in
  [Nn]*)
    echo
    echo "完了。'$REMOTE_HOST' に SSH ログインして webhook を起動 (このセッションを閉じると止まります):"
    echo "    cd '$REMOTE_PATH'"
    echo "    pnpm --filter webhook dev"
    echo "常駐化したくなったら (同じログインシェルで):"
    echo "    webhook/scripts/install-service.sh"
    exit 0
    ;;
esac

echo "== systemd --user サービスとして常駐化 (リモート) =="
ssh -t "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "cd '$REMOTE_PATH' && webhook/scripts/install-service.sh"
