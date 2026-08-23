## システムアーキテクチャ定義

### 全体像

既存の `webhook/src/jobs/createPr.ts` の「リポジトリを clone → claude cli に実装させる →
commit → push」という流れを踏襲する。ただし対象は新規ブランチではなく、
**既に存在する `agent-runner/issue-<N>-<hash>` ブランチ**であり、実装ではなく
「main を merge してコンフリクトを解消する」ことが目的になる。

### 追加・変更するファイル

- `webhook/src/types/api.ts`
  - `JobKind` に `"resolve-conflicts"` を追加
  - `ResolveConflictsRequest = IssueRef` を追加 (対象PRは issue から導出する)
- `webhook/src/github.ts`
  - `findOpenPrForIssue(client, ref): Promise<{ number: number; branch: string } | null>` を追加。
    `gh pr list` 相当を GitHub API (`GET /repos/{owner}/{repo}/pulls`) で行い、
    本文に `Closes #<N>` を含む、または head ブランチ名が `agent-runner/issue-<N>-` で
    始まる OPEN な PR を検索する
- `webhook/src/git.ts`
  - `prepareGitWorkspaceFromBranch(owner, repo, branch): Promise<GitWorkspace>` を追加
    (`prepareGitWorkspace` の clone 後に対象ブランチを checkout する版)
  - `mergeMain(ws): Promise<{ conflicted: boolean; conflictFiles: string[] }>` を追加。
    `git fetch origin main && git merge --no-commit origin/main` を実行し、
    `git diff --name-only --diff-filter=U` でコンフリクトファイルを取得する
- `webhook/src/prompts/resolveConflicts.ts` (新規)
  - `buildResolveConflictPrompt(filePath, conflictedContent)` —
    `<<<<<<<`/`=======`/`>>>>>>>` を含むファイル内容を渡し、
    「mainの変更意図」「PRブランチの変更意図」の両方を汲んで統合したファイル内容を
    生成させる (構造化出力: `{ resolvedContent: string, unresolvable: boolean, reason: string }`)
- `webhook/src/jobs/resolveConflicts.ts` (新規)
  - `runResolveConflictsJob(job, client, ref)`
  - `findOpenPrForIssue()` で対象PR/ブランチを特定 (無ければ失敗で終了)
  - `prepareGitWorkspaceFromBranch()` で対象ブランチを clone
  - `mergeMain()` でコンフリクト有無を判定。コンフリクトが無ければ「解決不要」として
    成功で終了 (push しない)
  - コンフリクトがあれば、コンフリクトファイルごとに `buildResolveConflictPrompt` で
    claude cli (`runClaude()`, `tools: ["Read"]` のみ。ファイル書き込みは
    このジョブ側が `resolvedContent` を書き込む形にし、claude cli自体には
    Write/Edit/Bashを渡さない) を呼び、解決結果を得る
  - `unresolvable: true` が1件でもあれば、ジョブを失敗にし push しない。
    どのファイルが解決不能だったかを結果に含める
  - 全て解決できれば、各ファイルに `resolvedContent` を書き込み、
    `assertSafeDiff()` で安全検査 (既存の `createPr.ts` と同じ) → マージコミットとして
    commit → push する
- `webhook/src/routes/jobs.ts`
  - `POST /resolve-conflicts` を追加。`jobLocks.acquire(ref, job.id, true)`
    (`create-pr` と同じくリポジトリ単位ロックも取得。git push が競合するため)
- `userscript/src/gm-client.ts`
  - `resolveConflicts(ref)` を追加
- `userscript/src/ui/panel.ts`
  - 対象issueに紐づくPRの `mergeable` 状態を取得し (`GET /repos/.../pulls` を webhook経由で
    参照する新しい軽量エンドポイント、または既存の `create-pr` 結果に含まれる `prUrl` から
    ユーザーがGitHub上で確認する運用と割り切るかは実装時に判断)、`false` のときのみ
    「コンフリクト解決」ボタンを表示する

### 影響範囲

- 既存の `create-pr`/`convert` ジョブのロジックには変更を加えない (新規ジョブとして追加)
- 本ジョブ自体も `userscript/src/ui/panel.ts` や `webhook/src/types/api.ts` を編集するため、
  他issue (#3/#4/#9/#23) のPRとコンフリクトしうる。これは本ジョブが解決しようとしている
  問題そのものであり、実装時点では既存PRのマージ順序調整で対応する