#!/usr/bin/env bash
# webhook/.env を対話的に作成するセットアップスクリプト。
# Ubuntu Server の初期状態 (git/pnpm/gh 未導入) でも動くことを前提にする。
# 不足しているコマンドは自動インストールせず、実行すべきコマンドを提示して終了する
# (sudo を伴う操作をスクリプトが勝手に行わないため)。
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

cd "$(dirname "$0")/.."  # webhook/ を基準にする
ENV_FILE=".env"

missing=0

check_cmd() {
  local cmd="$1" hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[NG] '$cmd' が見つかりません。次のコマンドを実行してから、このスクリプトを再実行してください:" >&2
    echo "     $hint" >&2
    missing=1
  else
    echo "[OK] $cmd"
  fi
}

echo "== 前提コマンドの確認 =="
check_cmd node "nvm でインストール (https://github.com/nvm-sh/nvm): nvm install --lts"
check_cmd git "sudo apt-get update && sudo apt-get install -y git"
check_cmd pnpm "corepack enable && corepack prepare pnpm@latest --activate"
check_cmd openssl "sudo apt-get update && sudo apt-get install -y openssl"

if [[ "$missing" -eq 1 ]]; then
  echo
  echo "不足しているコマンドをインストールしてから、このスクリプトを再実行してください。" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  read -r -p "$ENV_FILE は既に存在します。上書きしますか? [y/N]: " overwrite
  case "$overwrite" in
    [Yy]*) ;;
    *) echo "中断しました。"; exit 1 ;;
  esac
fi

echo
echo "== agent-runner webhook: .env セットアップ =="

# --- GitHub トークンの取得方式 --------------------------------------------
echo
echo "GitHub トークンの取得方式を選んでください:"
echo "  1) gh コマンド (gh auth token) を使う (推奨: gh にログイン済みの場合、生の PAT を .env に置かずに済む)"
echo "  2) Personal Access Token を直接入力する"
read -r -p "選択 [1/2]: " token_choice

GITHUB_TOKEN=""
case "$token_choice" in
  1)
    if ! command -v gh >/dev/null 2>&1; then
      cat >&2 <<'EOF'

[NG] gh コマンドが見つかりません。次のコマンドでインストールしてから、このスクリプトを再実行してください:

    (type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
      && sudo mkdir -p -m 755 /etc/apt/keyrings \
      && wget -nv -O- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
      && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
      && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
      && sudo apt update \
      && sudo apt install gh -y

インストール後、`gh auth login` でログインしてから再実行してください。
EOF
      exit 1
    fi
    if ! gh auth token >/dev/null 2>&1; then
      echo "[NG] gh が未ログインです。次のコマンドを実行してから再実行してください: gh auth login" >&2
      exit 1
    fi
    GITHUB_TOKEN_SOURCE="gh"
    ;;
  2)
    GITHUB_TOKEN_SOURCE="pat"
    read -r -s -p "GitHub Personal Access Token を入力 (repo スコープ, 非表示): " GITHUB_TOKEN
    echo
    if [[ -z "$GITHUB_TOKEN" ]]; then
      echo "トークンが空です。" >&2
      exit 1
    fi
    ;;
  *)
    echo "不正な選択です。" >&2
    exit 1
    ;;
esac

# --- AGENT_RUNNER_TOKEN (userscript との共有シークレット) ------------------
echo
read -r -p "AGENT_RUNNER_TOKEN (userscript との共有シークレット) を自動生成しますか? [Y/n]: " gen_choice
case "$gen_choice" in
  [Nn]*)
    read -r -s -p "AGENT_RUNNER_TOKEN を入力 (非表示): " AGENT_RUNNER_TOKEN
    echo
    ;;
  *)
    AGENT_RUNNER_TOKEN="$(openssl rand -hex 32)"
    echo "生成しました (先頭8文字: ${AGENT_RUNNER_TOKEN:0:8}...)"
    ;;
esac
if [[ -z "$AGENT_RUNNER_TOKEN" ]]; then
  echo "AGENT_RUNNER_TOKEN が空です。" >&2
  exit 1
fi

# --- ALLOWED_AUTHORS --------------------------------------------------------
default_author=""
if command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then
  default_author="$(gh api user --jq .login 2>/dev/null || true)"
fi
read -r -p "ALLOWED_AUTHORS (カンマ区切りの GitHub ユーザー名, 既定: ${default_author:-なし}): " allowed_authors
allowed_authors="${allowed_authors:-$default_author}"
if [[ -z "$allowed_authors" ]]; then
  echo "ALLOWED_AUTHORS は必須です (プロンプトインジェクション対策)。" >&2
  exit 1
fi

# --- HOST (tailscale 経由で公開する場合の bind アドレス) --------------------
default_host="127.0.0.1"
if command -v tailscale >/dev/null 2>&1; then
  ts_ip="$(tailscale ip -4 2>/dev/null || true)"
  [[ -n "$ts_ip" ]] && default_host="$ts_ip"
else
  cat >&2 <<'EOF'

[INFO] tailscale コマンドが見つかりません。tailnet 経由で公開する場合は次のコマンドで導入してください:

    curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up

導入後、`tailscale ip -4` の値を HOST に設定してください (このスクリプトを再実行すれば自動検出します)。
未導入のまま続ける場合、既定 (127.0.0.1) のまま進みます。
EOF
fi
read -r -p "HOST (bind するアドレス, 既定: $default_host): " host
host="${host:-$default_host}"

read -r -p "PORT (既定: 8787): " port
port="${port:-8787}"

# --- AGENT_RUNNER_DRY_RUN ----------------------------------------------------
echo
echo "AGENT_RUNNER_DRY_RUN=true の間は PR 作成ジョブが git push / PR 作成を行わず、"
echo "ブランチと差分だけをリモートの一時ディレクトリに残します。動作確認が済むまでは"
echo "true のままにすることを推奨します。"
read -r -p "AGENT_RUNNER_DRY_RUN を true にしますか? [Y/n]: " dry_run_choice
case "$dry_run_choice" in
  [Nn]*) dry_run="false" ;;
  *) dry_run="true" ;;
esac

# --- 書き込み ----------------------------------------------------------------
{
  echo "PORT=$port"
  echo "HOST=$host"
  echo ""
  echo "AGENT_RUNNER_TOKEN=$AGENT_RUNNER_TOKEN"
  echo "GITHUB_TOKEN_SOURCE=$GITHUB_TOKEN_SOURCE"
  [[ -n "$GITHUB_TOKEN" ]] && echo "GITHUB_TOKEN=$GITHUB_TOKEN"
  echo ""
  echo "ALLOWED_AUTHORS=$allowed_authors"
  echo ""
  echo "BOT_NAME=agent-runner-bot"
  echo "BOT_EMAIL=agent-runner-bot@users.noreply.github.com"
  echo ""
  echo "AGENT_RUNNER_DRY_RUN=$dry_run"
  echo ""
  echo "CLAUDE_MODEL=sonnet"
  echo "CONVERT_MAX_BUDGET_USD=0.5"
  echo "PR_MAX_BUDGET_USD=5"
  echo "CONVERT_TIMEOUT_MS=300000"
  echo "PR_TIMEOUT_MS=1800000"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo
echo "$ENV_FILE を作成しました (chmod 600)。"
if [[ "$dry_run" == "true" ]]; then
  echo "AGENT_RUNNER_DRY_RUN=true です。動作確認できたら .env を編集し false に変更してください。"
else
  echo "AGENT_RUNNER_DRY_RUN=false です。PR 作成ジョブが実際に git push / PR 作成を行います。"
fi
echo
echo "依存関係のインストールと起動:"
echo "    pnpm install"
echo "    pnpm --filter webhook dev"
echo
if ! command -v claude >/dev/null 2>&1; then
  echo "[INFO] claude コマンドが見つかりません。PR 作成ジョブが claude cli を呼び出すため、別途インストール・ログインが必要です:" >&2
  echo "    https://code.claude.com/docs/en/setup" >&2
fi
