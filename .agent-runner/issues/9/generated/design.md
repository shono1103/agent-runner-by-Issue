# Issue詳細ページへの到達経路によらないagent-runnerパネル表示 Design

**Date:** 2026-08-23
**Status:** Draft

## Goal
GitHub Issue詳細ページへの到達経路 (直接アクセス・フルリロードに加え、他のGitHubページからのTurbo/React soft-navigation経由) によらず、agent-runnerのuserscriptパネルが表示・動作するようにする。

## Success Criteria
- issue詳細ページ以外のGitHubページ (PR一覧・Codeタブ・通知一覧など、旧`@match`にマッチしないURL) からTurbo soft-navigation経由でissue詳細ページへ遷移したとき、agent-runnerパネルが表示・動作する
- 同じissueのURLを直接アドレスバーに入力する経路、ブラウザをリロードする経路のいずれでも、引き続きagent-runnerパネルが正しく表示・動作する (既存動作のリグレッションが無い)
- issue詳細ページ以外のGitHubページでは、agent-runnerパネルが表示されない (誤表示が発生しない)
- 既存のissue種別によるパネル表示切り替え (task = フルボタン、bug/feature = プレースホルダー) が引き続き正しく動作する
- `pnpm run typecheck` が通り、既存の単体テスト (`issue-kind.test.ts` など) が壊れていない

## Global Constraints
- 変更はuserscriptの`@match`設定とマウント判定ロジックに閉じ、webhookのAPI・ジョブロジックには変更を加えない
- `main.ts`の既存soft-navigation対応 (`setInterval(sync, 300)`によるポーリング、`MutationObserver`、`turbo:load`等のイベントリスナによる`sync()`呼び出し) は変更せず流用する
- `location.ts`の`currentIssue()` (URLパスからのissue判定ロジック) は変更しない
- 既存の`issue-kind.ts`によるissue種別判定、およびそれに基づくパネル表示切り替えのロジックは変更しない

## Architecture
検討した案:
1. `userscript/vite.config.ts`の`match`を`https://github.com/*/*/issues/*`から`https://github.com/*` (GitHubドメイン全体) に広げ、`main.ts`の既存soft-navigation対応 (`sync()`のポーリング・`MutationObserver`・イベントリスナ) をそのまま流用する。
2. Tampermonkey/Violentmonkeyの`@match`はそのままに、GitHub全体で動作する別のブートストラップ用userscript (常時注入用の最小スクリプト) を追加し、そこから本体を動的ロードする。
3. userscript側の対応をやめ、webhook側でissueページへのフルロードを検知してリダイレクトさせる。

選定: 案1。`main.ts`は既にsoft-navigation自体への追従 (ポーリング・MutationObserver・イベントリスナ) を実装済みであり、欠けているのは「そもそも未注入のケースに対する初回注入の機会を広げること」だけである。`@match`を広げるだけでこの前提 (GitHub内のどこか1ページでもフルページロードが起きればuserscriptが起動している状態) を満たせるため、変更範囲が最小になる。案2は二重のスクリプト管理コストが発生し、案3はWeb標準のnavigationをwebhook側から制御することになり実現性・保守性が低いため、いずれも却下した。

## Components

### vite.config.ts (変更)
- Responsibility: userscriptのビルド設定。Tampermonkey/Violentmonkeyへのメタデータとして埋め込まれる`@match`パターンを定義する
- Interface: `userscript.match: string[]` を `["https://github.com/*/*/issues/*"]` から `["https://github.com/*"]` に変更する
- Depends on: なし

### main.ts (変更なし、前提として流用)
- Responsibility: userscript注入後のマウント/アンマウント制御。`sync()`を300msポーリング・`MutationObserver`・`turbo:load`等のイベントリスナから呼び出し、`currentIssue()`の判定結果に基づきagent-runnerパネルをmount/unmountする
- Interface: `sync(): void` (`currentIssue()`の結果が非nullならmount、nullならunmount)
- Depends on: `location.ts`

### location.ts (変更なし)
- Responsibility: 現在のURLがissue詳細ページかどうかを判定する
- Interface: `currentIssue(): IssueRef | null`
- Depends on: なし

## Data Flow
GitHub利用者がissue詳細ページ以外のGitHubページ (旧`@match`にマッチしないURL) を直接アクセス/フルリロードで開く
-> ブラウザが新しい`@match: https://github.com/*`にマッチし、Tampermonkey/Violentmonkeyがuserscriptを注入する (`main.ts`が初期化され、ポーリング・`MutationObserver`・イベントリスナが起動する)
-> 利用者がそのページ内のリンクからissue詳細ページへ遷移する (Turbo/React soft-navigation、`history.pushState`ベースで実ブラウザナビゲーションを伴わない)
-> 既に起動済みの`main.ts`が、ポーリング (300ms間隔)・`MutationObserver` (DOM変更検知)・`turbo:load`等のイベントリスナのいずれかで遷移を検知し`sync()`を呼ぶ
-> `sync()`が`location.ts`の`currentIssue()`を呼び出し、現在のURLがissue詳細ページかどうかを判定する
-> `currentIssue()`が非nullを返せばagent-runnerパネルをmountし、nullを返せばunmountする (既存ロジックのまま)

## Error Handling
- `@match`を`https://github.com/*`に広げたことでissue詳細ページ以外でもuserscriptが起動するが、`sync()`は`currentIssue()`が非nullを返す場合のみmountするため、issue詳細ページ以外でパネルが誤って表示されることはない
- ポーリング・`MutationObserver`・イベントリスナはいずれも`main.ts`の既存実装のままであり、本変更で新たなエラーモードは追加しない
- soft-navigation検知に何らかの理由で失敗した場合 (イベントが発火しない場合) は、既存の300msポーリングがフォールバックとして機能し、最大300ms以内にパネル状態が正しい状態に更新される

## Testing Strategy
TDDのRed-Green-Refactorに従う。

### 静的検証
- `pnpm run typecheck` が通ることを確認する
- 既存の単体テスト (`userscript/src/issue-kind.test.ts` など) が壊れていないことを確認する

### 手動確認 (E2E)
1. issue詳細ページ以外のGitHubページ (旧`@match`にマッチしないURL。例: 対象リポジトリのPull Requests一覧) を開き、そのページ内のリンクからissue詳細ページへ遷移する (Turbo soft-navigation経由の遷移であることを確認する) テストケースを実行し、遷移後のissue詳細ページでagent-runnerパネルが表示・動作することを検証する
2. 同じissueのURLを直接アドレスバーに入力する経路、ブラウザをリロードする経路の両方で、引き続き正常に表示されることを検証する回帰テストケースを実行する
3. issue詳細ページ以外のページ (Pull Requests一覧・Codeタブなど) でパネルが表示されない (誤表示が発生しない) ことを検証するテストケースを実行する
4. 既存のissue種別によるパネル表示切り替え (task = フルボタン、bug/feature = プレースホルダー) が引き続き正しく動作することを検証する回帰テストケースを実行する

## Out of Scope (YAGNI)
- webhookのAPI・ジョブロジックの変更
- `location.ts`の`currentIssue()`判定ロジック自体の変更
- `issue-kind.ts`によるissue種別判定ロジックの変更
- `@match`拡大に伴うパフォーマンス計測の自動化 (体感確認のみとし、自動計測基盤は追加しない)

## Open Questions
(なし)