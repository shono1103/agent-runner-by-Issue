## システムアーキテクチャ定義

### 全体像

既存の `convert` ジョブ (`webhook/src/jobs/convert.ts`) は「source3コメントを読む → claude cliで変換 → `upsertGeneratedComments` で生成コメントに反映」という一直線の処理を行う。`draft` ジョブはその入力側を担う対のジョブであり、「issueのタイトル・本文を読む → claude cliで3種のsource文書を生成 → sourceコメントとして投稿」を行う。`webhook/src/github.ts` の `ensureScaffoldComments` (空プレースホルダーを、まだ存在しないkindだけ作る仕組み) と同じ「既存を上書きしない」判断基準をそのまま流用し、プレースホルダーの代わりに実際に生成した本文を差し込む形にする。

### 追加・変更するファイル

- `webhook/src/types/api.ts`
  - `JobKind` に `"draft"` を追加する (`"convert" | "create-pr" | "draft"`)
  - `DraftRequest = IssueRef` を追加する (入力はissue参照のみ。title/bodyはジョブ内部で `getIssue()` により取得する)
- `webhook/src/prompts/draft.ts` (新規)
  - `buildDraftPrompt(input: { title: string; body: string })`: issueのタイトル・本文を渡し、要件定義/システムアーキテクチャ定義/テスト定義の3つの本文 (`markers.ts` の `buildScaffoldBody` が持つ見出し `## 要件定義` 等の構造はそのままに、プレースホルダー部分を実文書に差し替えたもの) を、1回のclaude cli呼び出しでまとめて構造化出力させる (`prompts/convert.ts` の `buildConvertPrompt` と対になる構成)。systemPromptには「3文書間で用語・粒度に矛盾がないよう配慮する」旨を含める (`convert.ts` の `CROSS_FORMAT_NOTE` と同様の考え方)
  - `DRAFT_JSON_SCHEMA`: `{ requirements: string, architecture: string, tests: string }` の3フィールドを持つ (`markers.ts` の `SOURCE_KINDS` に対応させる)
- `webhook/src/jobs/draft.ts` (新規)
  - `runDraftJob(job, client, ref)`
  - `getIssue(client, ref)` でissueのtitle/bodyを取得する
  - `listIssueComments(client, ref)` で既存コメントを取得し、`SOURCE_KINDS` それぞれについて既にsourceコメント (投稿者は問わない) が存在するかを `parseMarker` で判定する
  - 3種すべて既に存在する場合はclaude cliを呼ばず即座に完了する (無駄なコスト消費を避ける)
  - 1種以上が未投稿の場合のみ `buildDraftPrompt` を呼び、未投稿のkindについて `buildSourceMarker(kind)` + 生成文書からコメント本文を組み立て、`createIssueComment` で新規投稿する。既に存在するkindはスキップする (`ensureScaffoldComments` と同じ判断基準を流用することで、要件定義の「増殖しない」「人間の編集を尊重する」を両立する)
- `webhook/src/routes/jobs.ts`
  - `POST /draft` を追加する。`IssueRefSchema` をそのまま流用し、`jobLocks.acquire(ref, job.id, false)` でissue単位のみロックする (`convert` と同じ。リポジトリ単位ロックは取らない)
- `userscript/src/gm-client.ts`
  - `postDraft(req: DraftRequest): Promise<JobLaunchResult>` を追加する (`postConvert` と同様に `postJobStart("/api/jobs/draft", req)` を呼ぶだけ)
- `userscript/src/ui/panel.ts`
  - `convertRow` (既存の「変換」セクション。`alliumBtn` `likec4Btn` `superpowersBtn` `allBtn` が並ぶ行) に `draftBtn = mkButton("定義書作成", "action")` を追加し、`allBtn` の隣に配置する。個別フォーマット用ボタンに対応する `draft` 版 (「要件定義だけ作成」等) は追加しない
  - `draftBtn` のクリックハンドラは `withJob("定義書作成", () => postDraft(issue))` とする (他ボタンと同じ `withJob` ラッパーに乗せ、ポーリング・エラー表示・busy制御を再利用する)

### 既存コンポーネントとの接続

`draft` → (source3コメント) → `convert` → (Allium/LikeC4/Superpowers) という一直線のパイプラインになる。`draft` ジョブが投稿するコメント本文は `markers.ts` の `buildSourceMarker` によるマーカー形式に完全準拠させるため、`convert` ジョブ側 (`extractSections`, `requireSections`) は無変更で動作する。

### Open Questions

- ラベル (`type:bug` 等) による `buildDraftPrompt` の出し分けを行う場合、`prompts/draft.ts` にラベル一覧を渡す引数を追加する必要があるが、要件定義側のOpen Questionが未確定のため、本アーキテクチャ定義では引数を追加しない最小構成としている