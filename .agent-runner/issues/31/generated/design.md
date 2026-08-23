# PR Page Conflict Resolution Panel Design

**Date:** 2026-08-24
**Status:** Draft

## Goal
#28 で実装した「コンフリクト解決」機能を issue ページだけでなく PR ページからも直接使えるようにし、GitHub がネイティブにコンフリクトを通知する場所 (PR ページ) でそのままAI解決を起動できるようにする。

## Success Criteria
- コンフリクト中 (`mergeable: false`) の agent-runner 由来PRを開くと、「コンフリクト解決」ボタンのみのパネルが表示される
- コンフリクトの無いPR、または agent-runner 由来でないPRを開いたときはパネルが表示されない
- 既存の issue ページでの動作 (パネル一式の表示、#9 の soft-navigation 対応) に影響がない

## Global Constraints
- `userscript/vite.config.ts` の `@match` に `https://github.com/*/*/pull/*` を追加する (既存の issue 用 match は維持する)
- webhook 側の既存ジョブ (`convert`/`create-pr`/`resolve-conflicts`) のロジックは変更しない。PR番号→issue番号の逆引き用エンドポイントを追加するのみ
- PR ページ用パネルは「コンフリクト解決」ボタンのみとし、issue ページ用のフォーマット作成/変換/PR作成ボタン一式は表示しない

## Architecture
検討した2案:
1. **webhookに逆引きエンドポイントを追加 (採用)**: `GET /api/prs/:number/issue` を新設し、PR本文の `Closes #<N>` またはブランチ名から issue 番号を特定する。userscript は取得した issue 番号を使い、既存の `getPrStatus()` (#28) と同じ仕組みで mergeable 状態を確認する
2. **userscript側でGitHub REST APIを直接叩く**: userscript が保持するトークンは `AGENT_RUNNER_TOKEN` (webhook用) のみで GitHub PAT は持たないため、GitHub APIを直接叩くには別途トークン管理が必要になり複雑化する

案1 (webhook経由) を採用する。既存の認証・トークン管理の仕組みをそのまま流用できる。

## Components
### location.ts: currentPr()
- Responsibility: 現在のURLがPRページかどうかを判定し、owner/repo/prNumberを返す
- Interface: `currentPr(): { owner: string; repo: string; prNumber: number } | null`
- Depends on: なし (`location.pathname` の解析のみ)

### webhook/src/routes/prStatus.ts: GET /api/prs/:number/issue
- Responsibility: PR番号から対応するissue番号とmergeable状態を返す
- Interface: `GET /api/prs/:number/issue?owner=...&repo=...` → `{ issueNumber: number | null, mergeable?: boolean }`
- Depends on: `github.ts` (findIssueForPr, getPullRequestMergeable)

### ui/panel.ts: mountPrPanel()
- Responsibility: PRページ用の軽量パネル (コンフリクト解決ボタンのみ) を条件付きでマウントする
- Interface: `mountPrPanel(ref: { owner: string; repo: string; prNumber: number }): Promise<void>`
- Depends on: `gm-client.ts` (getIssueForPr, postResolveConflicts)

## Data Flow
Maintainer がPRページを開く → `main.ts` の `sync()` が `currentIssue()` は `null` と判定 → `currentPr()` で PRページと判定 → `mountPrPanel()` を呼ぶ → `getIssueForPr()` で `GET /api/prs/:number/issue` を呼ぶ → `issueNumber !== null && mergeable === false` ならボタンを表示 → ボタン押下で既存の `postResolveConflicts()` (#28) を呼ぶ

## Error Handling
- `GET /api/prs/:number/issue` が issue を特定できない場合: `{ issueNumber: null }` を返し (エラーではなく正常応答)、userscript側はパネルを表示しない
- webhook への通信が失敗した場合: パネルを表示せず、コンソールにログを残すのみとする (issueページ側の既存パターンに倣う)

## Testing Strategy
TDD (Red-Green-Refactor) を前提とする。各コンポーネントにつき1振る舞い1テストとする。
- `currentPr()`: PRページURL/issueページURL/その他ページURLの3パターンをそれぞれ1テストで検証する
- `findIssueForPr()`: `Closes #<N>` あり/ブランチ名のみ/どちらも無し、の3パターンをそれぞれ1テストで検証する
- `mountPrPanel()`: 表示条件を満たす/満たさない、の2パターンをそれぞれ1テストで検証する (DOM操作をモックまたはjsdomで確認)
- E2E: 実際のコンフリクト中PRとコンフリクトの無いPRの両方で表示有無を手動確認する

## Out of Scope (YAGNI)
- PRページからのフォーマット作成・変換・PR作成の実行は対象外 (issueページに限定したまま)
- コンフリクト以外のPR操作 (レビュー依頼、マージ実行など) の追加は対象外

## Open Questions
- issue番号の特定に失敗するケース (`Closes` の記法揺れ、ブランチ名の命名規則からの逸脱など) をどこまで許容するかは未確定。今回は `null` として扱いパネルを表示しない方針とする