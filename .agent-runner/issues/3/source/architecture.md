## システムアーキテクチャ定義

### 全体像

`webhook/src/jobs/createPr.ts` の「リポジトリをcloneしてclaude cliに渡す」流れと、`webhook/src/jobs/convert.ts` の「生成結果をコメントとしてupsertする」流れを組み合わせる。ただし本ジョブはコードを変更しないため、branch作成・commit・pushは行わない。

### 追加・変更するファイル

- `webhook/src/types/api.ts`
  - `JobKind` に `"investigate"` を追加
  - `InvestigateRequest = IssueRef` を追加
- `webhook/src/markers.ts`
  - `GENERATED_KINDS` に `"investigation"` を追加 (`agent-runner:generated:investigation:1/1` マーカーで既存の `upsertGeneratedComments` / `collectGeneratedArtifact` の仕組みにそのまま乗せる)
- `webhook/src/prompts/investigate.ts` (新規)
  - `buildInvestigatePrompt(issueBody: string)` — バグ報告issue本文を渡し、原因箇所・根拠・確認範囲を構造化出力させるsystemPrompt/userPromptとJSON Schemaを組み立てる (`prompts/convert.ts` と同様の構成)
- `webhook/src/jobs/investigate.ts` (新規)
  - `runInvestigateJob(job, client, ref)`
  - `getIssue()` でissue本文を取得
  - `prepareGitWorkspace(ref.owner, ref.repo)` (`git.ts`) でread-only clone。branch作成・commit・pushは呼ばない
  - `runClaude()` を `tools: ["Read", "Grep", "Glob"]` のみ (Write/Edit/Bashを渡さない。調査専用で変更を許さないため `createPr.ts` の `IMPLEMENT_TOOLS` より狭い許可リストにする)、`permissionMode` は指定しない (書き込み系ツールが無いため確認不要)
  - 結果を `upsertGeneratedComments(client, ref, "investigation", body, existing)` でコメントに反映
  - `finally` で必ず `cleanupWorkspace(ws)` を呼ぶ (DRY_RUN分岐は無い。読み取り専用でありコードを残す意味が無いため)
- `webhook/src/routes/jobs.ts`
  - `POST /investigate` を追加。`IssueRefSchema` をそのまま流用し、`jobLocks.acquire(ref, job.id, false)` (issue単位のみ、`convert` と同じ)
- `userscript/src/gm-client.ts`
  - `investigate(ref)` を追加 (`POST /investigate` を叩く)
- `userscript/src/ui/panel.ts`
  - issueKind (#2で追加) が `"bug"` のときのみ「調査を実行」ボタンを表示し、`investigate()` を呼ぶ

### プロンプト設計の方針

`convert.ts` 系と同様、claude cliには `tools: []` ではなく `["Read","Grep","Glob"]` を渡し、実際に対象リポジトリのコードを読ませたうえで根拠付きの回答をさせる。`createPr.ts` のように `disallowedTools` で `Bash(git push:*)` 等を明示的に塞ぐ必要はない (`Bash` 自体を許可リストに含めないため)。