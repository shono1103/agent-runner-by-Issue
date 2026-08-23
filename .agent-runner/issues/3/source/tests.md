## テスト定義

### markers.ts

- `buildGeneratedMarker("investigation", 1, 1)` が `<!-- agent-runner:generated:investigation:1/1 ... -->` を生成すること
- `parseMarker()` が上記マーカーを `{ type: "generated", kind: "investigation", part: 1, total: 1 }` として正しくパースできること

### prompts/investigate.ts

- issue本文を渡したときに、systemPrompt/userPromptに本文の内容が含まれること
- JSON Schemaが「原因箇所 (ファイルパス・行または関数名)」「根拠」「特定できなかった場合の代替フィールド」を持つこと

### jobs/investigate.ts (結合テスト、GitHub API・claude cliはモック)

- 正常系: `runClaude` がファイルパスと根拠を含む構造化出力を返したとき、`upsertGeneratedComments` が `"investigation"` kindで呼ばれること
- 再実行時: 既存の調査結果コメント (自分が投稿した `investigation` マーカー付き) がある状態で再実行すると、新規コメントが増えず既存コメントが更新されること (`upsertGeneratedComments` の既存挙動に委ねる)
- 失敗系: `runClaude` が失敗を返したとき、ジョブが `failed` になり、コメントは投稿されないこと
- clone後は成功・失敗どちらの経路でも `cleanupWorkspace` が呼ばれること (一時ディレクトリが残らないこと)

### 手動確認 (E2E)

1. `type:bug` ラベルの付いたissueをuserscriptで開くと「調査を実行」ボタンが表示される
2. 実行すると、原因箇所と根拠を含むコメントが新規投稿される
3. 同じissueで再度実行すると、コメントが増えず、内容が更新される
4. `type:bug` 以外のissueでは「調査を実行」ボタンが表示されない