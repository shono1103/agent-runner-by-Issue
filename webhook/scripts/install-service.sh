#!/usr/bin/env bash
# webhook を systemd --user サービスとして常駐させる (SSHセッションを閉じても動き続ける)。
# リモートホスト上で実行する想定 (install-remote.sh から ssh -t 経由で呼ばれる、
# もしくは shonoshono-home に直接 SSH してから単体でも実行できる)。
#
# sudo は一切使わない (systemd --user はユーザー権限で完結する)。
# ただし「ログアウトしてもサービスを動かし続ける」には linger が必要で、
# それを許可する権限が無い場合は sudo コマンドを提示するだけに留める。
set -euo pipefail

# nvm は node/pnpm を PATH に通す設定を ~/.bashrc に書くが、それは対話シェルでしか
# 読み込まれない。`ssh host "command"` (このスクリプトが呼ばれる経路) は -t を付けても
# 非対話シェル扱いになり ~/.bashrc が読まれないため、ここで明示的に nvm.sh を読み込む。
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # nvm.sh 内部の分岐が非ゼロ終了したり未定義変数を参照することがあるため、
  # 読み込み中だけ set -e / -u を外す。
  set +eu
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  set -eu
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE_NAME="agent-runner-webhook"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/${SERVICE_NAME}.service"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[NG] systemctl が見つかりません。systemd が無い環境では、この方式は使えません" \
    "(tmux/screen 常駐などを検討してください)。" >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$NODE_BIN" || -z "$PNPM_BIN" ]]; then
  echo "[NG] node / pnpm が見つかりません。先に webhook/scripts/setup-env.sh を実行し、" \
    "依存関係 (pnpm install) を済ませてから再実行してください。" >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/webhook/.env" ]]; then
  echo "[NG] $REPO_ROOT/webhook/.env が見つかりません。先に webhook/scripts/setup-env.sh を" \
    "実行してください。" >&2
  exit 1
fi

# サービスに渡す PATH を組み立てる。
#
# ここが systemd プロセスの PATH の全てになる (~/.profile も ~/.bashrc も読まれない)。
# しかも webhook は claude を `spawn("claude", ...)` と名前で起動し、その解決には
# 子プロセスに渡す env の PATH が使われる。つまり claude のディレクトリをここに
# 積み忘れると、対話シェルからは動くのに、常駐サービスからだけ
# 「claude cli 失敗 (spawn): spawn claude ENOENT」で落ちる。
# claude の公式インストーラは ~/.local/bin に置くが、そこは systemd の既定 PATH には
# 無いため、node/pnpm と同じように command -v で拾って明示的に積む。
NODE_DIR="$(dirname "$NODE_BIN")"
PNPM_DIR="$(dirname "$PNPM_BIN")"
CLAUDE_BIN="$(command -v claude || true)"

SERVICE_PATH=""
path_append() {
  local dir="$1"
  [[ -n "$dir" && -d "$dir" ]] || return 0
  case ":$SERVICE_PATH:" in
    *":$dir:"*) return 0 ;; # 既に入っている
  esac
  if [[ -z "$SERVICE_PATH" ]]; then SERVICE_PATH="$dir"; else SERVICE_PATH="$SERVICE_PATH:$dir"; fi
}

path_append "$NODE_DIR"
# nvm 経由だと corepack 由来の pnpm も node と同じディレクトリにあるが、
# 別経路でインストールされている場合に備えて両方積む (重複は path_append が弾く)。
path_append "$PNPM_DIR"
if [[ -n "$CLAUDE_BIN" ]]; then
  path_append "$(dirname "$CLAUDE_BIN")"
fi
# claude を後から入れ直した場合や、allium/likec4 など他のユーザーローカルな CLI のために
# ~/.local/bin も積んでおく。
path_append "$HOME/.local/bin"
path_append /usr/local/bin
path_append /usr/bin
path_append /bin

if [[ -z "$CLAUDE_BIN" ]]; then
  echo "[INFO] claude が見つかりません。このままだと全てのジョブが spawn ENOENT で失敗します。" >&2
  echo "       claude をインストール・ログインしてから、このスクリプトを再実行してください" >&2
  echo "       (PATH は再実行時に取り直されます)。" >&2
else
  echo "[OK] claude: $CLAUDE_BIN"
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=agent-runner webhook
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
Environment=PATH=$SERVICE_PATH
ExecStart=$PNPM_BIN --filter webhook start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

echo "[OK] $UNIT_FILE を作成しました"

systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}.service" >/dev/null

# enable --now ではなく restart を使う。--now は「停止中なら起動する」だけで、
# 既に動いていると何もしない。unit を書き換えたのにプロセスは古い環境変数を
# 握ったまま、という状態になる (#50)。PATH を直すために再実行する、という
# 使い方が主なので、ここが反映されないと再実行の意味が無い。
# restart は停止中なら起動、動作中なら再起動するので、初回・再実行のどちらでもよい。
was_active=0
systemctl --user is-active --quiet "${SERVICE_NAME}.service" && was_active=1

systemctl --user restart "${SERVICE_NAME}.service"
if [[ "$was_active" -eq 1 ]]; then
  echo "[OK] ${SERVICE_NAME}.service を再起動しました (新しい unit を反映)"
else
  echo "[OK] ${SERVICE_NAME}.service を有効化・起動しました"
fi

echo
if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q "Linger=yes"; then
  echo "[OK] linger は既に有効です (ログアウト後もサービスは動き続けます)"
else
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "[OK] linger を有効化しました (ログアウト後もサービスは動き続けます)"
  else
    echo "[INFO] linger を自分の権限では有効化できませんでした。次のコマンドを実行してください:" >&2
    echo "     sudo loginctl enable-linger $USER" >&2
    echo "     (実行しない場合、このSSHセッション/ユーザーの全セッションが切れるとサービスも停止します)" >&2
  fi
fi

echo
echo "状態確認:  systemctl --user status ${SERVICE_NAME}.service --no-pager"
echo "ログ確認:  journalctl --user -u ${SERVICE_NAME}.service -f"
echo "停止:      systemctl --user stop ${SERVICE_NAME}.service"
echo
echo "[注意] webhook/.env の AGENT_RUNNER_DRY_RUN=true のままだと PR は作成されません。"
echo "       動作確認できたら .env を編集し、サービスを再起動してください:"
echo "       systemctl --user restart ${SERVICE_NAME}.service"
