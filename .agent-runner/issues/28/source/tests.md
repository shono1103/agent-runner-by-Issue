## テスト定義

### markers.ts / types/api.ts

- `JobKind` に `"resolve-conflicts"` が追加され、既存の `JobKind` 判定ロジックを壊さないこと

### github.ts: findOpenPrForIssue()

- 対象issueに対応するOPENなPR (head ブランチが `agent-runner/issue-<N>-` で始まる、
  または本文に `Closes #<N>` を含む) が存在する場合、その番号とブランチ名を返すこと
- 対応するPRが存在しない場合は `null` を返すこと
- 複数該当した場合 (通常発生しないはずだが) は最新のものを採用すること

### git.ts: mergeMain()

- コンフリクトが無い場合、`conflicted: false` を返し、作業ツリーに変更を残さないこと
- コンフリクトがある場合、`conflicted: true` と、コンフリクトしたファイルパスの一覧を
  正しく返すこと

### jobs/resolveConflicts.ts (結合テスト、GitHub API・claude cliはモック)

- 対象issueにPRが存在しない場合、ジョブが `failed` になり、理由が明示されること
- コンフリクトが無い場合、pushを行わずに `succeeded` で終了すること (「解決不要」の旨を結果に含む)
- コンフリクトがあり全て解決できた場合、解決後の内容でcommit・pushされ、
  ジョブが `succeeded` になること
- 一部のファイルが `unresolvable: true` を返した場合、pushを行わずに `failed` になり、
  解決できなかったファイル一覧が結果に含まれること
- `assertSafeDiff` が拒否する変更 (`.github/workflows/` 等) が解決結果に含まれる場合、
  push せず `failed` になること

### 手動確認 (E2E)

1. 実際に dirty 状態のPR (例: 本セッションで確認した #20 や #27) を対象に
   `resolve-conflicts` を実行し、実行後に GitHub 上で `mergeable: true` になることを確認する
2. 既に `mergeable: true` なPRに対して実行すると、何も変更されず成功で終わることを確認する
3. userscript パネルで、対象issueのPRがコンフリクト中のときだけ「コンフリクト解決」ボタンが
   表示されることを確認する