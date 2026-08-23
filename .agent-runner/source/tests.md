## テスト定義

### 静的検証

- `pnpm run typecheck` が通ること
- 既存の単体テスト (`userscript/src/issue-kind.test.ts` など) が壊れていないこと

### 手動確認 (E2E) — 再現手順ベース

1. issue詳細ページ以外のGitHubページ (旧 `@match` にマッチしないURL。例: 対象リポジトリの Pull Requests 一覧) を開く
2. そのページ内のリンクからissue詳細ページへ遷移する (Turbo soft-navigation経由の遷移であること)
3. 遷移後のissue詳細ページで agent-runner パネルが表示・動作することを確認する (修正前は表示されなかった経路)
4. 比較として、同じissueのURLを直接アドレスバーに入力する / ブラウザをリロードする経路でも、引き続き正常に表示されることを確認する (既存動作のリグレッションが無いこと)
5. issue詳細ページ以外のページ (Pull Requests一覧・Codeタブなど) でパネルが表示されない (誤表示が発生しない) ことを確認する
6. 既存の issue 種別によるパネル表示切り替え (task = フルボタン、bug/feature = プレースホルダー) が引き続き正しく動作することを確認する