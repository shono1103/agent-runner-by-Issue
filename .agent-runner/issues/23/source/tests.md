## テスト定義

### markers.ts (既存動作の確認)

- `draft` ジョブが投稿するコメント本文の先頭行が `buildSourceMarker(kind)` (kind は `requirements` / `architecture` / `tests`) と一致し、`parseMarker()` で `{ type: "source", kind }` として正しくパースできること

### prompts/draft.ts

- issueのtitle/bodyを渡したとき、userPromptにtitle/bodyの内容が含まれること
- 構造化出力スキーマ (`DRAFT_JSON_SCHEMA`) が `requirements` / `architecture` / `tests` の3フィールドを持つこと
- systemPromptに「3文書間の用語・粒度の整合性に配慮する」旨の指示が含まれること

### jobs/draft.ts (結合テスト、GitHub API・claude cliはモック)

- 正常系 (既存sourceコメントなし): `runClaude` が3フィールドを含む構造化出力を返したとき、`requirements` / `architecture` / `tests` の3件が新規コメントとして投稿されること。各本文の先頭行が対応する `buildSourceMarker(kind)` であること
- 冪等性 (再実行してもコメントが増殖せず、既存を尊重すること): 3種のうち一部 (例: `requirements`) について既にsourceコメントが存在する状態で再実行すると、`requirements` は新規投稿されず既存のまま残り、残りの未投稿分 (`architecture` / `tests`) のみが新規投稿されること
- 全件存在時のスキップ: 3種すべてが既に存在する場合、`runClaude` が呼ばれず、コメントも一切投稿されないこと
- 「issueのタイトル・本文のみからsourceコメント3種が生成・投稿されること」: title/bodyのみを入力として渡したとき (対象リポジトリのコードは一切参照しないこと)、3件のsourceコメントが生成されること
- 既存フローとの接続: `draft` ジョブが生成したsourceコメント3件をそのまま `convert` ジョブの入力として渡すと (`extractSections` / `requireSections`)、必要セクションがすべて揃っていると判定され、Allium/LikeC4/Superpowersへの変換が正常に実行できること
- 失敗系: `runClaude` が失敗を返したとき、ジョブが `failed` になり、コメントは1件も投稿されないこと

### 手動確認 (E2E)

1. sourceコメントが1件も無いissueで「定義書作成」ボタンを押すと、要件定義/システムアーキテクチャ定義/テスト定義の3コメントが新規投稿される
2. 同じissueで「定義書作成」を再度押しても、コメントが4件目以降増えない
3. 生成されたsourceコメントの内容が、issueのタイトル・本文の内容と矛盾しない
4. 生成直後に「すべて生成」ボタン (convertジョブ) を押すと、Allium/LikeC4/Superpowersが正常に生成される (既存フローとの接続確認)
5. 生成されたsourceコメントをWeb UI上で人間が直接編集した後に「定義書作成」を再度押しても、編集内容が上書きされない

### Open Questions

- ラベルによる出力内容の出し分けを行う場合のテスト観点は、要件定義側のOpen Questionが解消してから追加する