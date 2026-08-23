## 要件定義

### 背景

`create-pr` ジョブは issue ごとに独立した clone・ブランチ (`agent-runner/issue-<N>-<hash>`) で
実装を行うが、複数の issue の実装が同じ共有ファイル (例: `userscript/src/main.ts`,
`userscript/src/ui/panel.ts`, `webhook/src/types/api.ts`, `webhook/src/markers.ts`,
`webhook/src/routes/jobs.ts`, `userscript/src/gm-client.ts`) を編集することが多い。
そのため、あるPRが先に main にマージされると、まだマージされていない他のPRは
`mergeable: false` (dirty) の状態になる。実例: issue #5 のPR (#18) が main にマージされた
直後、issue #3/#4/#9/#23 のPR (#20/#25/#26/#27) がすべて dirty 化した。

### 要件

1. 対象の issue (またはPR) を指定して、そのPRブランチと現在の main とのコンフリクトを
   解消する新しいジョブ (`resolve-conflicts`) を追加すること
2. コンフリクト解消方針は「取り込みマージ」とする: PRブランチに main を **merge** する
   (rebase ではない)。コンフリクトが発生した箇所は、claude cli に
   「mainの変更意図」と「PRブランチの変更意図」の両方を汲み取らせ、両方が活きる形で
   統合的に解決させる (単純な `--ours`/`--theirs` によるどちらか一方の切り捨てはしない)
3. 解消後、対象PRが GitHub 上で `mergeable: true` になる状態までブランチを更新し、push すること
4. userscript 側に、対象issueに紐づくPRが `mergeable: false` (コンフリクト中) のときにのみ
   表示される「コンフリクト解決」ボタンを追加すること
5. 意味的に両立不可能で自動解決できないコンフリクトがあった場合は、無理に確定させず、
   ジョブを失敗として終了し、どのファイル・箇所を解決できなかったかを結果に含めること
6. 既存の `create-pr` ジョブ (実装・commit・push) の安全設計 (`assertSafeDiff` による
   `.github/workflows/` 等の変更拒否、`permissionMode: acceptEdits` 固定) をこのジョブにも
   同水準で適用すること

### 非機能要件

- 本ジョブはリポジトリへの push を伴うため、既存の `create-pr` と同じくリポジトリ単位の
  排他ロックを取得すること (同時に他の `create-pr`/`resolve-conflicts` ジョブと競合させない)
- 解決前後の差分を人間が確認できるよう、解決結果はPRへのpushという形で残し、
  ジョブ自体が直接 GitHub 上でPRをマージすることはしない (マージ判断は人間に残す)

### open question

「取り込みマージ」の厳密な定義 (単純な `git merge main` 実行後、コンフリクトマーカーを
claude cliに解決させるという解釈で進めるが、それ以上に高度な意味的統合まで求めているかは
issue本文からは断定できない) は未確定として残す。