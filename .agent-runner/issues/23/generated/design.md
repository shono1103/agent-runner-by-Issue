# Draft Job Design

**Date:** 2026-08-23
**Status:** Draft

## Goal
issueのタイトル・本文のみを入力として、claude cliに「要件定義/システムアーキテクチャ定義/テスト定義」の3つのsourceコメントを自動でドラフトさせ、issueに投稿する新しいジョブ種別 `draft` を実装する。既存の `convert` ジョブ (source3コメント → Allium/LikeC4/Superpowers) とは入力の向きが逆 (issue本文 → source) であり、両者を連結することで「issueを書くだけでEaCまで一気通貫で生成できる」フローを実現する。

## Success Criteria
- sourceコメントが1件も無いissueに対して `draft` ジョブを実行すると、要件定義/システムアーキテクチャ定義/テスト定義の3コメントが新規投稿される
- 各コメント本文の先頭行が対応する `buildSourceMarker(kind)` の形式と一致する
- 同一issueに対して `draft` ジョブを再実行しても、コメントが増殖しない
- 一部のkindについて既にsourceコメント (人間の編集によるものか過去の生成によるものかを問わない) が存在する状態で再実行すると、そのkindは上書きされず、不足しているkindのみが新規投稿される
- 3種すべてのsourceコメントが既に存在する場合、`draft` ジョブはclaude cliを呼び出さずに完了する
- `draft` ジョブが生成したsourceコメント3件をそのまま `convert` ジョブの入力として渡すと、既存の `extractSections` / `requireSections` の判定を通過し、Allium/LikeC4/Superpowersへの変換が正常に実行できる
- `draft` ジョブは対象リポジトリのコードを一切読み取らない (issueのtitle/bodyのみを入力とする)
- userscript側では、既存の「すべて生成」ボタンの隣に「定義書作成」ボタンが1つ追加され、個別フォーマット選択に相当するdraft版ボタンは存在しない

## Global Constraints
- 生成マーカーの形式は `buildSourceMarker(kind)` が `<!-- agent-runner:source:<kind> この行は消さないでください -->` を生成する既存形式にそのまま従うこと (`kind` は `requirements` / `architecture` / `tests`)
- `draft` ジョブは既存 `convert` ジョブと同水準のissue単位ロックを使用すること
- `draft` ジョブはリポジトリ単位ロックを使用しないこと (git cloneもpushも行わないため)
- `draft` ジョブは対象リポジトリのclone・コード読み取りを一切行わないこと
- 既に存在するsourceコメントは、投稿者が人間かbotかを問わず上書きしないこと
- 既存の「タスク」用ジョブ (`convert`, `create-pr`) のAPI・挙動を変更しないこと

## Architecture
検討した案:
1. 既存 `ensureScaffoldComments` (空プレースホルダーを、まだ存在しないkindだけ作る仕組み) と同じ「既存を上書きしない」判断基準を流用し、プレースホルダーの代わりに実際にclaude cliが生成した本文を差し込む新規ジョブ `draft` を追加する。issue単位ロック・`markers.ts`・`getIssue()` 等の既存機構をそのまま再利用する。
2. `draft` ジョブの出力を一旦「レビュー待ち」コメントとして投稿し、人間が承認ボタンを押してから正式なsourceコメントに変換する2段階フローにする。
3. issue本文の変更を検知するたびに自動的に `draft` ジョブを起動する (人間のボタン操作を介さない完全自動化)。

選定: 案1。issue #23 の要望は「自分でドキュメント構築まではしない。しかし生成後に読んで問題の有無を考えることはある」であり、生成後の確認・修正は「通常のコメント編集」という既存手段で十分に賄える。案2は「承認ステップを必須にしない」という要件 (issue #23 の明言) に反するため却下。案3はボタン操作を起点とする既存の全ジョブ (`convert`, `create-pr`) の設計方針と一貫しないうえ、意図しないタイミングでの自動生成がコストを消費するため却下。

## Components

### types/api.ts (拡張)
- Responsibility: `JobKind` に `"draft"` を追加し、`DraftRequest` 型を定義する
- Interface:
  - `JobKind = "convert" | "create-pr" | "draft"`
  - `DraftRequest = IssueRef`
- Depends on: なし

### prompts/draft.ts (新規)
- Responsibility: issueのtitle/bodyから、要件定義/システムアーキテクチャ定義/テスト定義の3文書を1回のclaude cli呼び出しでまとめて構造化出力させるsystemPrompt・userPrompt・JSON Schemaを構築する
- Interface:
  - `buildDraftPrompt(input: { title: string; body: string }): { systemPrompt: string; userPrompt: string }`
  - `DRAFT_JSON_SCHEMA`: `{ requirements: string, architecture: string, tests: string }` の3フィールドを持つJSON Schema
- Depends on: なし

### jobs/draft.ts (新規)
- Responsibility: issue単位ロック取得後、既存sourceコメントのkindを確認し、不足しているkindのみをclaude cliに生成させてissueへ新規投稿する。3種すべて揃っている場合はclaude cliを呼ばない
- Interface: `runDraftJob(job: Job, client: GithubClient, ref: IssueRef): Promise<void>`
- Depends on: `getIssue`, `listIssueComments`, `createIssueComment` (`github.ts`), `parseMarker`, `buildSourceMarker` (`markers.ts`), `buildDraftPrompt` (`prompts/draft.ts`), `runClaude`

### routes/jobs.ts (拡張)
- Responsibility: `POST /draft` エンドポイントを追加する
- Interface: `IssueRefSchema` を流用したリクエストバリデーション、`jobLocks.acquire(ref, job.id, false)` によるissue単位ロック
- Depends on: `jobs/draft.ts`, `jobLocks`

### userscript/gm-client.ts (拡張)
- Responsibility: `POST /draft` を呼び出す
- Interface: `postDraft(req: DraftRequest): Promise<JobLaunchResult>`
- Depends on: `postJobStart` (既存)

### userscript/ui/panel.ts (拡張)
- Responsibility: 既存の「変換」セクション (`convertRow`) に「定義書作成」ボタンを1つ追加する。個別フォーマット選択に相当するdraft版ボタンは追加しない
- Interface: `draftBtn = mkButton("定義書作成", "action")` を `allBtn` の隣に配置し、クリックで `withJob("定義書作成", () => postDraft(issue))` を呼ぶ
- Depends on: `gm-client.ts` の `postDraft`

## Data Flow
issue (タイトル・本文)
-> ユーザーが「定義書作成」ボタンを押す
-> `postDraft(issue)` が `POST /draft` を呼ぶ
-> `jobsRoute` が issue単位ロックを取得しジョブを起動する
-> `runDraftJob` が `getIssue()` でtitle/bodyを取得し、`listIssueComments()` + `parseMarker()` で既存sourceコメントのkindを確認する
-> 3種すべて存在する場合はここで完了する (claude cliは呼ばない)
-> 1種以上が不足している場合、`buildDraftPrompt` がtitle/bodyからsystemPrompt/userPrompt/schemaを構築する
-> `runClaude` がissueのtitle/bodyのみ (コードは読ませない) を入力に、3文書を構造化出力として生成する
-> 不足していたkindについてのみ、`buildSourceMarker(kind)` + 生成文書からコメント本文を組み立て、`createIssueComment` で新規投稿する (既存kindはスキップ)
-> issue単位ロック解放
-> (後続で人間が「すべて生成」ボタンを押すと) 投稿されたsource3コメントが `convert` ジョブの入力として使われる

## Error Handling
- `runClaude` が失敗を返した場合: ジョブステータスを `failed` にする。コメントは1件も投稿しない
- claude cliの構造化出力が期待するJSON Schemaに一致しない場合: 検証失敗としてジョブを `failed` にする。部分的な投稿 (3件のうち1件だけ投稿する等) は行わない
- 3種すべてのsourceコメントが既に存在する場合: エラーではなく正常系として扱い、claude cliを呼ばずにジョブを `succeeded` として完了する
- issue単位ロックが既に取得されている場合: `convert` ジョブと同様に409を返し、新しいジョブを起動しない
- `createIssueComment` がGitHub API呼び出しで失敗した場合: 既に投稿済みのコメントはそのまま残し、ジョブを `failed` にする (再実行時は「既に存在するkindはスキップする」ロジックにより、投稿済み分の重複投稿は起きない)

## Testing Strategy
TDDのRed-Green-Refactorに従い、各コンポーネントの観測可能な振る舞いを1テスト1振る舞いで検証する。

### markers.ts (既存動作の確認)
- `draft` ジョブが投稿するコメント本文の先頭行が `buildSourceMarker(kind)` (kindは `requirements` / `architecture` / `tests`) と一致することを検証する単体テスト
- 上記マーカー文字列を `parseMarker()` に渡したとき、戻り値が `{ type: "source", kind }` であることを検証する単体テスト

### prompts/draft.ts
- issueのtitle/bodyを渡して `buildDraftPrompt` を呼んだとき、`userPrompt` にtitle/bodyの内容が含まれることを検証する単体テスト
- `DRAFT_JSON_SCHEMA` が `requirements` / `architecture` / `tests` の3フィールドを持つことを検証する単体テスト
- `systemPrompt` に「3文書間の用語・粒度の整合性に配慮する」旨の指示が含まれることを検証する単体テスト

### jobs/draft.ts (結合テスト、GitHub API・claude cliはモック)
- 正常系 (既存sourceコメントなし): `runClaude` が3フィールドを含む構造化出力を返したとき、`requirements` / `architecture` / `tests` の3件が新規コメントとして投稿されることを検証する結合テスト
- 冪等性: 3種のうち一部 (例: `requirements`) が既に存在する状態で再実行すると、`requirements` は新規投稿されず既存のまま残り、残りの未投稿分のみが新規投稿されることを検証する結合テスト
- 全件存在時のスキップ: 3種すべてが既に存在する場合、`runClaude` が呼ばれず、コメントも一切投稿されないことを検証する結合テスト
- 入力範囲: `runDraftJob` の呼び出しにおいて、対象リポジトリのコードを読み取るAPI呼び出し (clone等) が一切行われないことを検証する結合テスト
- 接続テスト: `draft` ジョブが生成したsourceコメント3件をそのまま `extractSections` / `requireSections` に渡すと、必要セクションがすべて揃っていると判定されることを検証する結合テスト
- 失敗系: `runClaude` が失敗を返したとき、ジョブが `failed` になり、コメントが1件も投稿されないことを検証する結合テスト

### 手動確認 (E2E)
1. sourceコメントが1件も無いissueで「定義書作成」ボタンを押すと、要件定義/システムアーキテクチャ定義/テスト定義の3コメントが新規投稿されることを確認する
2. 同じissueで「定義書作成」を再度押しても、コメントが4件目以降増えないことを確認する
3. 生成されたsourceコメントをWeb UI上で人間が直接編集した後に「定義書作成」を再度押しても、編集内容が上書きされないことを確認する
4. 生成直後に「すべて生成」ボタン (`convert` ジョブ) を押すと、Allium/LikeC4/Superpowersが正常に生成されることを確認する
5. userscriptのパネルに、個別フォーマット選択に相当するdraft版ボタンが存在せず、「定義書作成」ボタンが1つだけ「すべて生成」ボタンの隣に表示されることを確認する

## Out of Scope (YAGNI)
- issueに付与されたラベル (`type:bug` / `type:feature` 等) による出力内容の出し分け (Open Questionsに記載、本実装のスコープには含めない)
- 生成後の人間による確認・承認を必須にするレビューフロー
- issue本文の変更を検知した自動再生成 (ボタン操作を起点としない完全自動化)
- 対象リポジトリのコードを読ませたうえでのドラフト生成 (issueのtitle/bodyのみを入力とする)

## Open Questions
- `draft` ジョブの入力に、issueに付与されたラベル (`type:bug` / `type:feature` / `type:task` 等) による出力内容の出し分けを行うかどうか。たとえばバグ報告issueであれば要件定義で「再現手順」を重視し、機能要望issueであれば「実現したいこと」を重視する、といった調整が考えられるが、本issueの対応範囲に含めるかは未確定