# Resolve Conflicts Job Design

**Date:** 2026-08-24
**Status:** Draft

## Goal
複数issueから生成された `create-pr` のPRが同じ共有ファイルを編集し合いマージ後にコンフリクトする問題に対し、対象issueのPRブランチにmainを取り込みマージし、コンフリクトをclaude cliで解決してpushする `resolve-conflicts` ジョブと、それを起動する「コンフリクト解決」ボタンを追加する。

## Success Criteria
- 対象issueに対応するOPENなPRが `mergeable: false` の状態から、ジョブ実行後に `mergeable: true` になる
- コンフリクトが無いPRに対して実行した場合、pushを行わずジョブが成功で終わる
- 意味的に自動解決できないコンフリクトがあった場合、pushを行わずジョブが失敗し、どのファイルを解決できなかったかが結果に含まれる
- 対象issueのPRが `mergeable: false` のときにのみ、userscriptパネルに「コンフリクト解決」ボタンが表示される

## Global Constraints
- コンフリクト解決は merge 戦略で行う (rebase は使わない)
- claude cli には `Write`/`Edit`/`Bash` を渡さず、コンフリクト解決結果 (`resolvedContent`) はジョブ側のコードがファイルに書き込む
- `assertSafeDiff` による安全検査 (`.github/workflows/` 等の拒否) を既存の `create-pr` と同水準で適用する
- リポジトリ単位の排他ロックを取得し、`create-pr` ジョブと同時に走らない

## Architecture
検討した2案:
1. **merge + claude cliによるマーカー解決 (採用)**: `git merge --no-commit origin/main` でコンフリクトを発生させ、コンフリクトマーカーを含むファイルをclaude cliに渡して解決させる。既存の `createPr.ts` のパターンを流用しやすく、実装コストが低い
2. **rebase + interactive resolution**: PRブランチをmain上にrebaseする。履歴が書き換わり既存のPRの差分表示が大きく変わってしまう (レビュー済みコミットのSHAが変わる) ため、人間のレビューを妨げる

案1 (merge) を採用する。rebaseは履歴を書き換えるため、レビュー中のPRに対して行うと差分の追跡が困難になる。

## Components
### resolveConflicts.ts (webhook)
- Responsibility: 対象issueのPRを検索し、mainをmergeしてコンフリクトを解決し、pushする
- Interface: `runResolveConflictsJob(job: Job, client: GithubClient, ref: IssueRef): Promise<void>`
- Depends on: `github.ts` (findOpenPrForIssue)、`git.ts` (mergeMain, prepareGitWorkspaceFromBranch)、`prompts/resolveConflicts.ts`、`safety.ts` (assertSafeDiff)

### prompts/resolveConflicts.ts (webhook)
- Responsibility: コンフリクトマーカーを含む1ファイルの内容から、統合済みの内容を生成させるプロンプトを組み立てる
- Interface: `buildResolveConflictPrompt(filePath: string, conflictedContent: string): { systemPrompt: string, userPrompt: string }`
- Depends on: なし (純粋関数)

### ui/panel.ts のボタン追加 (userscript)
- Responsibility: 対象issueのPRが `mergeable: false` のときのみ「コンフリクト解決」ボタンを表示し、押下時に `resolveConflicts()` を呼ぶ
- Interface: 既存のボタン追加パターンに準拠
- Depends on: `gm-client.ts`

## Data Flow
Maintainer がパネルの「コンフリクト解決」ボタンを押す → `gm-client.ts` が `POST /api/jobs/resolve-conflicts` を呼ぶ → webhookが対象issueに紐づくPRを検索 → PRブランチをclone → `origin/main` をmerge → コンフリクトファイルごとにclaude cliへ解決を依頼 → 全て解決できればcommit・push → ジョブ結果 (`succeeded`/`failed`) をパネルに返す

## Error Handling
- 対象issueにOPENなPRが存在しない場合: ジョブを即座に `failed` にし、「対象PRが見つかりません」というエラーメッセージを返す
- コンフリクトが無い場合: pushを行わず `succeeded` で終了し、結果に「解決不要」と明記する
- 一部のファイルが `unresolvable: true` を返した場合: pushを行わず `failed` にし、結果にファイルパスの一覧を含める
- `assertSafeDiff` が拒否する変更が含まれる場合: pushを行わず `failed` にし、拒否されたファイル一覧を結果に含める

## Testing Strategy
TDD (Red-Green-Refactor) を前提とする。各コンポーネントにつき1振る舞い1テストとする。
- `findOpenPrForIssue()`: 該当PRがある場合/無い場合をそれぞれ1テストで検証する
- `mergeMain()`: コンフリクト無し/コンフリクト有りをそれぞれ1テストで検証する
- `runResolveConflictsJob()`: PR無し/コンフリクト無し/全解決/一部解決不能/安全検査拒否、の5パターンをそれぞれ1テストで検証する (GitHub API・claude cliはモック)
- E2E: 実際にdirty状態のPRに対して実行し `mergeable: true` になることを手動確認する

## Out of Scope (YAGNI)
- ジョブによるPRの自動マージは行わない (人間がマージ判断を行う)
- rebase戦略の実装は行わない (mergeのみ)

## Open Questions
- 「取り込みマージ」の厳密な意味的統合の度合い (単純なマーカー解決を超えた高度な統合を求めているか) は issue本文からは断定できず未確定