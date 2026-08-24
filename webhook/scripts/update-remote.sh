#!/usr/bin/env bash
# クライアントPCから実行する。リモートホストで稼働中の webhook を、
# 手元のコードで更新して再起動し、実際に新しいプロセスが応答することまで確認する。
#
# install-remote.sh との違い:
#   install-remote.sh … 初回インストール用。setup-env.sh を対話起動し .env を作る。
#                        サービスの再起動はしない。
#   update-remote.sh  … 2回目以降の更新用。.env には一切触れず、同期 → 依存更新 →
#                        再起動 → /api/health での確認までを非対話で通す。
#
# 使い方:
#   webhook/scripts/update-remote.sh [options] [remote-host] [remote-path]
#
# 例:
#   webhook/scripts/update-remote.sh                  # ~/.ssh/config の shonoshono-home へ
#   webhook/scripts/update-remote.sh -y               # 確認プロンプトを出さない
#   webhook/scripts/update-remote.sh shonoshono-home /opt/agent-runner
#
# 接続先は REMOTE_HOST / REMOTE_PATH 環境変数でも指定できる (引数が優先)。
#
# secrets は一切扱わない。リモートの webhook/.env は rsync の除外対象で、
# 読み取るのも HOST / PORT / AGENT_RUNNER_DRY_RUN だけ (値の表示は DRY_RUN のみ)。
set -euo pipefail

SERVICE_NAME="agent-runner-webhook"

usage() {
  cat <<'USAGE'
使い方: webhook/scripts/update-remote.sh [options] [remote-host] [remote-path]

options:
  -y, --yes       確認プロンプトを出さずに実行する
      --skip-check  ローカルの型チェック (pnpm run typecheck) を省略する
      --no-delete   ローカルに無いファイルをリモートから削除しない
  -h, --help      このヘルプを表示する

既定の接続先: shonoshono-home:opt/agent-runner-by-Issue
(REMOTE_HOST / REMOTE_PATH 環境変数でも指定できる。引数が優先)
USAGE
}

ASSUME_YES=0
SKIP_CHECK=0
DO_DELETE=1
POS1=""
POS2=""
npos=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y | --yes) ASSUME_YES=1 ;;
    --skip-check) SKIP_CHECK=1 ;;
    --no-delete) DO_DELETE=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "[NG] 不明なオプション: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      # 配列を使わないのは、クライアントが macOS 標準の bash 3.2 でも動くようにするため
      # (空配列への ${arr[@]} 展開が set -u でエラーになる)。位置引数は最大2個。
      npos=$((npos + 1))
      case "$npos" in
        1) POS1="$1" ;;
        2) POS2="$1" ;;
        *)
          echo "[NG] 引数が多すぎます: $1" >&2
          usage >&2
          exit 2
          ;;
      esac
      ;;
  esac
  shift
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

REMOTE_HOST="${POS1:-${REMOTE_HOST:-shonoshono-home}}"
# 相対パス (リモートの $HOME 基準)。理由は install-remote.sh のコメント参照。
REMOTE_PATH="${POS2:-${REMOTE_PATH:-opt/agent-runner-by-Issue}}"

echo "== 配布するコード =="
echo "  接続先: $REMOTE_HOST:$REMOTE_PATH"
echo "  コミット: $(git log -1 --format='%h %s')"
dirty_count="$(git status --porcelain | wc -l | tr -d ' ')"
if [[ "$dirty_count" != "0" ]]; then
  echo "  [注意] 未コミットの変更が $dirty_count 件あります。rsync は作業ツリーをそのまま送るため、"
  echo "         GitHub に存在しない状態がリモートで動くことになります。"
fi
echo

if ! command -v rsync >/dev/null 2>&1; then
  echo "[NG] ローカルに rsync が見つかりません。インストールしてから再実行してください。" >&2
  exit 1
fi

# --- ローカルでの事前チェック ------------------------------------------------
# 壊れたコードをリモートに配ってからサービスを再起動すると、再起動した瞬間に落ちる。
# 配る前に手元で気付けるようにする。
if [[ "$SKIP_CHECK" -eq 0 ]]; then
  echo "== ローカルで型チェック =="
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[NG] pnpm が見つかりません。型チェックを飛ばすなら --skip-check を付けてください。" >&2
    exit 1
  fi
  if ! pnpm run typecheck; then
    echo >&2
    echo "[NG] 型チェックに失敗しました。壊れたコードを配らないため、ここで中断します。" >&2
    echo "     承知のうえで配る場合は --skip-check を付けて再実行してください。" >&2
    exit 1
  fi
  echo "[OK] 型チェックを通過しました"
  echo
fi

# このスクリプト内の ssh / rsync 呼び出しを1本のマスター接続に相乗りさせる
# (パスワード認証でも認証は1回で済む)。詳細は install-remote.sh のコメント参照。
CONTROL_PATH="/tmp/agent-runner-ssh-$$.sock"
SSH_MUX_OPTS=(-o "ControlMaster=auto" -o "ControlPath=$CONTROL_PATH" -o "ControlPersist=10m")
cleanup() {
  ssh -o "ControlPath=$CONTROL_PATH" -O exit "$REMOTE_HOST" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# `ssh host "command"` は -t を付けても非対話シェル扱いで ~/.bashrc が読まれず、
# nvm 経由の node/pnpm に PATH が通らない。詳細は install-remote.sh のコメント参照。
NVM_INIT='export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; '

echo "== SSH 疎通確認 (最初の1回だけ認証を求められます) =="
if ! ssh "${SSH_MUX_OPTS[@]}" -o ConnectTimeout=5 "$REMOTE_HOST" true; then
  echo "[NG] '$REMOTE_HOST' に接続できません。~/.ssh/config の設定を確認してください。" >&2
  exit 1
fi
echo "[OK] $REMOTE_HOST に接続できます"

echo
echo "== 更新対象の確認 =="
# これは「更新」スクリプトなので、まだ入っていないホストには何もしない。
# .env を作りに行く (= setup-env.sh を動かす) のは install-remote.sh の役目。
if ! ssh "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "test -f '$REMOTE_PATH/webhook/.env'"; then
  echo "[NG] $REMOTE_HOST:$REMOTE_PATH/webhook/.env が見つかりません。" >&2
  echo "     このホストはまだセットアップされていないようです。初回は install-remote.sh を使ってください:" >&2
  echo "     ./webhook/scripts/install-remote.sh $REMOTE_HOST $REMOTE_PATH" >&2
  exit 1
fi
echo "[OK] $REMOTE_PATH/webhook/.env があります (このスクリプトは .env を変更しません)"

# --- 同期 --------------------------------------------------------------------
# --info=stats1 は rsync 3.1+ 専用。macOS 標準の openrsync には無いので使わない
# (install-remote.sh と同じ理由)。
RSYNC_OPTS=(-az --exclude-from=.gitignore --exclude='.git' --exclude='webhook/.env')
if [[ "$DO_DELETE" -eq 1 ]]; then
  # ローカルで削除したファイルがリモートに残り続けると、リポジトリの実体が
  # 手元と食い違ったまま気付けなくなる。除外パターンに一致するファイル
  # (node_modules/ dist/ .env など) は rsync が削除対象から自動的に守る。
  RSYNC_OPTS+=(--delete)
fi

echo
echo "== 変更内容の確認 (dry-run) =="
DRY_OUT="$(rsync "${RSYNC_OPTS[@]}" --dry-run -v -e "ssh ${SSH_MUX_OPTS[*]}" \
  ./ "$REMOTE_HOST:$REMOTE_PATH/" | grep -v -E '^(sending|sent|total size|building file list|$)' || true)"
if [[ -z "$DRY_OUT" ]]; then
  echo "  (差分なし。リモートは既に手元と同じ内容です)"
else
  echo "$DRY_OUT"
fi
if [[ "$DO_DELETE" -eq 1 ]]; then
  echo
  echo "  [注意] --delete が有効です。ローカルに無いファイルはリモートから削除されます"
  echo "         (残したい場合は --no-delete)。上の一覧に削除分が出ない rsync 実装もあります。"
fi

if [[ "$ASSUME_YES" -eq 0 ]]; then
  echo
  read -r -p "この内容で $REMOTE_HOST を更新して webhook を再起動しますか? [y/N]: " answer
  case "$answer" in
    [Yy]*) ;;
    *)
      echo "中止しました。"
      exit 0
      ;;
  esac
fi

echo
echo "== コードを $REMOTE_HOST:$REMOTE_PATH へ同期 =="
rsync "${RSYNC_OPTS[@]}" -e "ssh ${SSH_MUX_OPTS[*]}" ./ "$REMOTE_HOST:$REMOTE_PATH/"
echo "[OK] 同期完了 (.env は除外済み。既存のリモート .env は上書きされません)"

echo
echo "== 依存関係を更新 (リモート) =="
# --frozen-lockfile: pnpm-lock.yaml と package.json が食い違っていたら、
# リモートで勝手に解決させず失敗させる (配る前に手元で直すべき状態なので)。
if ! ssh "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "${NVM_INIT}cd '$REMOTE_PATH' && pnpm install --frozen-lockfile"; then
  echo "[NG] リモートでの pnpm install に失敗しました。" >&2
  echo "     pnpm-lock.yaml が package.json と食い違っている可能性があります" >&2
  echo "     (手元で pnpm install してコミットしてから再実行してください)。" >&2
  exit 1
fi
echo "[OK] 依存関係を更新しました"

# --- 再起動 ------------------------------------------------------------------
# #35 の教訓: プロセスは起動時の値・起動時のコードを握ったままなので、
# 同期しただけでは古い webhook が動き続ける。MainPID が変わったことまで確認する。
echo
echo "== webhook を再起動 (リモート) =="
restart_script() {
  cat <<'EOS'
set -eu
SERVICE_NAME="agent-runner-webhook"
main_pid() {
  systemctl --user show -p MainPID "${SERVICE_NAME}.service" 2>/dev/null | sed 's/^MainPID=//'
}
if ! command -v systemctl >/dev/null 2>&1; then
  echo "[INFO] systemctl がありません。常駐サービスとしては動いていないようです。"
  echo "       webhook を手で起動している場合は、自分で起動し直してください。"
  exit 3
fi
if ! systemctl --user list-unit-files "${SERVICE_NAME}.service" 2>/dev/null | grep -q "${SERVICE_NAME}.service"; then
  echo "[INFO] ${SERVICE_NAME}.service が登録されていません。常駐化するには:"
  echo "       webhook/scripts/install-service.sh"
  exit 3
fi
before="$(main_pid)"
systemctl --user restart "${SERVICE_NAME}.service"
after="$(main_pid)"
if [ -n "${after:-}" ] && [ "${after}" != "0" ] && [ "${before:-}" = "${after}" ]; then
  echo "[NG] MainPID が ${after} のまま変わっていません。プロセスが入れ替わっていません。" >&2
  exit 1
fi
echo "[OK] ${SERVICE_NAME}.service を再起動しました (PID ${before:-?} -> ${after:-?})"
EOS
}
restart_rc=0
ssh "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "$(restart_script)" || restart_rc=$?
if [[ "$restart_rc" -eq 1 ]]; then
  echo "[NG] 再起動に失敗しました。リモートのログを確認してください:" >&2
  echo "     ssh $REMOTE_HOST 'journalctl --user -u ${SERVICE_NAME}.service -n 50 --no-pager'" >&2
  exit 1
fi
if [[ "$restart_rc" -eq 3 ]]; then
  echo
  echo "コードの同期までは完了しています (再起動は行われていません)。"
  exit 0
fi

# --- 反映確認 ----------------------------------------------------------------
# systemctl status は「プロセスが生きている」としか言わない。
# 実際に HTTP が返ること、しかも .env の DRY_RUN と一致することまで見る。
echo
echo "== 反映確認 (/api/health) =="
health_script() {
  cat <<'EOS'
set -eu
env_get() { sed -n "s/^$1=//p" .env | tail -n 1; }
HOST="$(env_get HOST)"; HOST="${HOST:-127.0.0.1}"
PORT="$(env_get PORT)"; PORT="${PORT:-8787}"
WANT="$(env_get AGENT_RUNNER_DRY_RUN)"; WANT="${WANT:-true}"
URL="http://${HOST}:${PORT}/api/health"

fetch_health() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$URL" 2>/dev/null || true
  else
    node -e 'fetch(process.argv[1]).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>{})' "$URL" 2>/dev/null || true
  fi
}

body=""
i=0
while [ "$i" -lt 15 ]; do
  body="$(fetch_health)"
  [ -n "$body" ] && break
  i=$((i + 1))
  sleep 1
done

if [ -z "$body" ]; then
  echo "[NG] $URL が応答しません (15秒待機)。" >&2
  exit 1
fi
echo "[OK] $URL -> $body"

case "$body" in
  *'"dryRun":true'*) got="true" ;;
  *'"dryRun":false'*) got="false" ;;
  *) got="" ;;
esac
if [ -z "$got" ]; then
  echo "[NG] 応答から dryRun を読み取れませんでした。" >&2
  exit 1
fi
if [ "$got" != "$WANT" ]; then
  echo "[NG] .env は AGENT_RUNNER_DRY_RUN=$WANT なのに、応答は dryRun=$got です。" >&2
  echo "     古いプロセスが残っているか、systemd の Environment= に古い値が残っています。" >&2
  exit 1
fi
echo "[OK] .env の AGENT_RUNNER_DRY_RUN=$WANT が反映されています"
if [ "$got" = "true" ]; then
  echo "[注意] DRY_RUN=true のままです。PR 作成ジョブは git push / PR 作成を行いません。"
fi
EOS
}
if ! ssh "${SSH_MUX_OPTS[@]}" "$REMOTE_HOST" "${NVM_INIT}cd '$REMOTE_PATH/webhook' || exit 1
$(health_script)"; then
  echo "[NG] 更新後の疎通確認に失敗しました。ログを確認してください:" >&2
  echo "     ssh $REMOTE_HOST 'journalctl --user -u ${SERVICE_NAME}.service -n 50 --no-pager'" >&2
  exit 1
fi

echo
echo "更新完了。"
echo "  ログ: ssh $REMOTE_HOST 'journalctl --user -u ${SERVICE_NAME}.service -n 30 --no-pager'"
echo "  userscript も更新するなら: ./webhook/scripts/fetch-userscript.sh $REMOTE_HOST $REMOTE_PATH"
