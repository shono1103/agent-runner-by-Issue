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

# node/pnpm の bin ディレクトリを PATH に積む。nvm 経由だと corepack 由来の pnpm も
# 同じディレクトリにあることが多いが、別経路でインストールされている場合に備えて両方積む。
NODE_DIR="$(dirname "$NODE_BIN")"
PNPM_DIR="$(dirname "$PNPM_BIN")"
SERVICE_PATH="$NODE_DIR:$PNPM_DIR:/usr/local/bin:/usr/bin:/bin"

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
systemctl --user enable --now "${SERVICE_NAME}.service"
echo "[OK] ${SERVICE_NAME}.service を有効化・起動しました"

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
