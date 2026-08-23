# Clarify Job Design

**Date:** 2026-08-23
**Status:** Draft

## Goal
`type:feature` ラベルの付いたissueに対して、issue本文だけでは読み取れない不明点を claude cli に洗い出させて質問コメントとして投稿し、人間がそのコメントを直接編集して回答することで、再実行のたびに解消状況を再判定するループを実装する。

## Success Criteria
- `type:feature` ラベルの付いたissueに対してジョブを初回実行すると、不明点の一覧が1件の新規コメントとして投稿される
- 投稿された質問コメントを人間が直接編集して回答を書き込んだ後に再実行すると、回答から解消したと判断できる質問には解消済みである旨が付き、未解決の質問は残る
- 未解決点が残る場合、解消済みの質問は消えずに残ったまま、追加の質問がコメントに反映される
- 同一issueに対して何回再実行しても、質問コメントは1件のまま増えず、既存のコメントが更新される
- 全ての質問が解消された場合、コメント本文を見ただけで「解消済み」と分かる表示になる
- `type:feature` ラベルの付いたissueをuserscriptで開いたときのみ「質問を実行」ボタンが表示され、それ以外のissueでは表示されない
- 既存の「タスク」用ジョブ (要件定義等の変換、PR作成) の挙動・APIが変更されていない
- ジョブの実行はissue本文とコメントのみを入力とし、対象リポジトリのコードを読み取らない (cloneを行わない)

## Global Constraints
- 質問は常に1つのコメントにまとめて投稿すること (複数コメントに分割しない)
- 人間の回答は質問コメント自体の直接編集 (edit) によってのみ行われること。新規コメントでの回答は入力として扱わない
- 再実行時にコメントを新規作成しないこと (既存の質問コメントの更新のみ)
- 本ジョブは対象リポジトリのコードを読み取らないこと (git clone を行わない)
- 既存の「タスク」用ジョブ (変換、PR作成) のAPI・挙動を変更しないこと
- 生成コメントのマーカー形式は `agent-runner:generated:clarify:1/1` の1系列のみを使うこと (#3 の `investigation` と同様、単一パートに固定する)

## Architecture
検討した案:
1. 質問コメント自身を次回実行時の入力として扱い、既存の `source`/`generated` コメント分離パターンを使わずに、単一の生成コメントを issue 本文と突き合わせて毎回まるごと再判定する。
2. 既存の `convert` ジョブと同じ「source コメントで人間が入力し、generated コメントで結果を出す」分離パターンをそのまま踏襲し、回答用の別コメントを人間に新規作成させる。
3. issue 本文自体を人間が都度編集して回答してもらう (コメントを使わない)。

選定: 案1。要件で「同じコメントを人間が直接編集して回答する」運用が明示されており、質問と回答が同一コメント内で完結する方が人間にとって参照しやすく、回答用コメントを探す手間がない。案2は「新規コメントで回答するのではない」という要件と矛盾するため却下。案3はissue本文が要件定義などの他用途と混在し得るため、質問専用の領域を持てず却下。

案1を採用する結果、既存の `collectGeneratedArtifact` の「マーカー行を除いた本文を返す」機構を、今回は生成物ではなく次回実行時の入力としても再利用する点が、他ジョブ (convert 等) との構造上の違いになる。

## Components

### prompts/clarify.ts (新規)
- Responsibility: issue本文と、前回の質問コメント本文 (人間の回答を含む、無ければ無し) から、質問リストと全体の解消状況をclaude cliに構造化出力させるpromptを構築する
- Interface: `buildClarifyPrompt(issueBody: string, previousQa: string | null): { systemPrompt: string; userPrompt: string; schema: JsonSchema }`
  - `schema` は以下のフィールドを持つ:
    - `questions`: 質問の配列。各要素は `text` (質問文) と `resolved` (回答から解消したと判断できるか) を持つ
    - `allResolved`: 全ての質問が解消されたかどうか
- Depends on: なし

### jobs/clarify.ts (新規)
- Responsibility: `type:feature` ラベルのissueに対し、issue単位ロック取得 → issue本文と前回の質問コメント取得 → claude cliによる質問リスト/解消判定の生成 → 質問コメントの新規投稿または更新、を一連のジョブとして実行する
- Interface: `runClarifyJob(job: Job, client: GithubClient, ref: IssueRef): Promise<void>`
- Depends on: `prompts/clarify.ts`, `markers.ts`, `runClaude`, `listIssueComments`, `upsertGeneratedComments`, issue単位ロック機構 (既存)

### markers.ts (拡張)
- Responsibility: 生成物マーカー文字列の構築とパース。`"clarify"` kindを既存のkind群に追加する
- Interface:
  - `buildGeneratedMarker(kind: "clarify" | ExistingKind, part: number, total: number): string`
  - `parseMarker(comment: string): { type: "generated"; kind: string; part: number; total: number } | null`
- Depends on: なし

### userscript (拡張)
- Responsibility: issueページで `type:feature` ラベルが付いている場合にのみ「質問を実行」ボタンを表示し、クリック時に `jobs/clarify.ts` の起動をトリガーする
- Interface: 既存のボタン表示ロジックに `type:feature` ラベル判定を追加し、`clarify(ref)` を呼ぶ
- Depends on: `jobs/clarify.ts` のトリガーAPI (`POST /clarify`)

## Data Flow
issue (本文、ラベル: `type:feature`) + (存在すれば) 前回の質問コメント本文 (人間が編集した回答を含む)
-> userscriptが `type:feature` ラベルを検知し「質問を実行」ボタンを表示
-> ボタン押下でジョブ起動、issue単位ロック取得
-> `getIssue()` でissue本文を取得、`listIssueComments()` から既存の `clarify` マーカー付きコメント本文 (無ければ null) を取得
-> `prompts/clarify.ts` がissue本文と前回の質問コメント本文からsystemPrompt/userPrompt/schemaを構築
-> `runClaude` (`tools: []`) が質問リスト (`text`, `resolved` の配列) と `allResolved` を構造化出力として返す
-> `jobs/clarify.ts` が質問リストからMarkdown本文 (`- [x]`/`- [ ]` のチェックリスト、`allResolved` なら解消済みの旨を先頭に追記) を組み立てる
-> `markers.ts` の `buildGeneratedMarker("clarify", 1, 1)` を用いてマーカー付きコメント本文を構築
-> `upsertGeneratedComments(kind: "clarify")` がissueへの新規投稿、または既存の `clarify` マーカー付きコメントの更新を行う
-> issue単位ロック解放

## Error Handling
- `runClaude` が失敗を返した場合: ジョブステータスを `failed` にする。既存の質問コメントは更新しない (人間が書き込んだ回答を失わないため)
- 前回の質問コメントが存在しない場合: これは失敗ではなく初回実行として扱い、issue本文のみを入力に質問リストを生成する
- 前回の質問コメントが存在するが空 (人間がまだ何も回答していない) 場合: 未回答として扱い、既存の質問をそのまま維持しつつ `allResolved: false` で再投稿する
- 同一issueに対して既に他ジョブ (clarify自身の別実行、または convert 等) が実行中の場合: issue単位ロックにより後続のジョブ実行の開始をブロックする
- `type:feature` ラベルが外れた状態でジョブが呼び出された場合 (userscript側のボタン非表示を回避してAPIが直接叩かれた場合を含む): ジョブを実行せず `failed` として扱う

## Testing Strategy
TDDのRed-Green-Refactorに従い、各コンポーネントの観測可能な振る舞いを1テスト1振る舞いで検証する。

### markers.ts
- `buildGeneratedMarker("clarify", 1, 1)` を呼んだとき、戻り値が `<!-- agent-runner:generated:clarify:1/1 ... -->` であることを検証する単体テスト
- 上記マーカー文字列を `parseMarker()` に渡したとき、戻り値が `{ type: "generated", kind: "clarify", part: 1, total: 1 }` であることを検証する単体テスト

### prompts/clarify.ts
- 前回の質問コメントが無い (`previousQa: null`) 場合、`userPrompt` がissue本文のみを入力に質問リストを生成する内容になり、前回の質問コメントに関する文言を含まないことを検証する単体テスト
- 前回の質問コメントがある場合、その内容 (人間の回答を含む編集後本文) が `userPrompt` に含まれることを検証する単体テスト
- 生成された `schema` が `questions` (配列、各要素は `text` と `resolved`) と `allResolved` のフィールドを持つことを検証する単体テスト

### jobs/clarify.ts (結合テスト、GitHub API・claude cliはモック)
- 初回実行: 質問コメントが存在しない状態で実行すると、新規コメントが1件作成されることを検証する結合テスト
- 再実行 (未解消あり): 既存の質問コメントがある状態で実行すると、新規コメントが増えず既存コメントが更新されることを検証する結合テスト
- 再実行 (未解消あり): 未解決の質問はチェックなし、解消済みの質問はチェック付きで本文に反映されることを検証する結合テスト
- 再実行 (全解消): `allResolved: true` が返ったとき、コメント本文に解消済みである旨が明示されることを検証する結合テスト
- 失敗系: `runClaude` が失敗を返したとき、ジョブが `failed` になることを検証する結合テスト
- 失敗系: `runClaude` が失敗を返したとき、既存の質問コメントが更新されないことを検証する結合テスト

### 手動確認 (E2E)
1. `type:feature` ラベルの付いたissueをuserscriptで開くと「質問を実行」ボタンが表示されることを確認する
2. 初回実行で、不明点が質問コメントとして投稿されることを確認する
3. 質問コメントを直接編集して回答を書き込み、再度実行すると、回答済みの項目にチェックが付き、未解決の項目のみ残る (または新たな質問が追加される) ことを確認する
4. 全ての質問に回答し再実行すると、コメントに解消済みである旨が表示されることを確認する
5. `type:feature` 以外のissueでは「質問を実行」ボタンが表示されないことを確認する

## Out of Scope (YAGNI)
- 回答用の新規コメント作成 (要件で明示的に否定されている運用)
- `type:feature` 以外のラベルに対する質問生成機能
- 質問への回答を検証・承認するワークフロー (自動承認や差し戻しなど)
- 質問生成ジョブによる対象リポジトリのコード読み取り・clone

## Open Questions
(なし)