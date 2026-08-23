## システムアーキテクチャ定義

### 全体像

既存の `convert` ジョブは「source系コメント (人間が書く)」と「generated系コメント (claudeが書く)」を別コメントに分けている。本ジョブは対象がissue本文1つであり、かつ「claudeが書いた質問コメントに人間が直接回答を書き込む」運用のため、**質問コメント自身が次回実行時の入力を兼ねる** (source/generatedの分離をしない) 点が既存パターンとの違いになる。この点は実装時に見落とさないよう明記しておく。

### 追加・変更するファイル

- `webhook/src/types/api.ts`
  - `JobKind` に `"clarify"` を追加
  - `ClarifyRequest = IssueRef` を追加
- `webhook/src/markers.ts`
  - `GENERATED_KINDS` に `"clarify"` を追加 (`agent-runner:generated:clarify:1/1` マーカー)
- `webhook/src/prompts/clarify.ts` (新規)
  - `buildClarifyPrompt(issueBody: string, previousQa: string | null)` — issue本文と、前回の質問コメント本文 (人間が編集した回答を含む、無ければ null) を入力に、質問リストと解消状況を構造化出力させる
  - JSON Schema: `{ questions: [{ text: string, resolved: boolean }], allResolved: boolean }` を想定
- `webhook/src/jobs/clarify.ts` (新規)
  - `runClarifyJob(job, client, ref)`
  - `getIssue()` でissue本文を取得
  - `listIssueComments()` → `collectGeneratedArtifact(client, comments, "clarify")` で前回の質問コメント本文を取得 (`code` フィールドがマーカー行を除いた本文そのものになる。`clarify` はコードフェンスを使わないため `extractFencedCode` は非マッチとなりraw全体を返す、という既存挙動をそのまま利用する)
  - `runClaude()` (`tools: []`。コードは読まないためRead系ツールも不要) で質問リストと `allResolved` を取得
  - 質問リストからMarkdown本文を組み立てる (`- [x] 解消済みの質問` / `- [ ] 未解決の質問` のチェックリスト形式。`allResolved === true` なら先頭に「✅ 全ての質問が解消されました」を追記)
  - `upsertGeneratedComments(client, ref, "clarify", body, existing)` で同じコメントを更新 (新規コメントは追加しない)
- `webhook/src/routes/jobs.ts`
  - `POST /clarify` を追加。`jobLocks.acquire(ref, job.id, false)` (issue単位のみ)
- `userscript/src/gm-client.ts`
  - `clarify(ref)` を追加
- `userscript/src/ui/panel.ts`
  - issueKind (#2で追加) が `"feature"` のときのみ「質問を実行」ボタンを表示する

### 質問コメントのフォーマット (案)

```
<!-- agent-runner:generated:clarify:1/1 この行は消さないでください -->
## 機能要望への質問

- [ ] 質問A
- [x] 質問B (回答済みと判断された質問)

（この行より上のチェック状態は自動更新されます。回答はこのコメントを直接編集して書き込んでください）
```

人間は `- [ ] 質問A` の下または右側に直接回答を書き込む形で編集する。次回実行時はこの編集後の本文全体をclaudeへの入力とし、`resolved` 判定と追加質問の要否を再計算する。