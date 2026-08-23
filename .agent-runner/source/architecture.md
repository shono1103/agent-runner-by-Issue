## システムアーキテクチャ定義

### 全体像

既存の issue ページ用パネル (`mount(issue, kind)`) とは別に、PR ページ用の軽量パネル
(「コンフリクト解決」ボタンのみ) を追加する。判定・マウントの分岐は `main.ts` の
`sync()` に追加し、既存の issue 判定ロジック (`currentIssue()`) はそのまま流用する。

### 追加・変更するファイル

- `userscript/vite.config.ts`
  - `userscript.match` に `https://github.com/*/*/pull/*` を追加
- `userscript/src/location.ts`
  - `currentPr(): { owner: string; repo: string; prNumber: number } | null` を追加。
    URL パス `/<owner>/<repo>/pull/<N>` を判定する (`currentIssue()` と対になる実装)
- `webhook/src/github.ts`
  - `findIssueForPr(client, owner, repo, prNumber): Promise<number | null>` を追加。
    PR本文の `Closes #<N>` を正規表現でパースするか、無ければ head ブランチ名
    `agent-runner/issue-<N>-` から issue 番号を抽出する
- `webhook/src/routes/prStatus.ts`
  - `GET /api/prs/:number/issue` を追加。`findIssueForPr()` で issue 番号を特定し、
    見つかれば `getPullRequestMergeable()` (#28 で追加済み) と合わせて
    `{ issueNumber: number, mergeable: boolean } | { issueNumber: null }` を返す
- `userscript/src/gm-client.ts`
  - `getIssueForPr(ref: { owner: string; repo: string; prNumber: number })` を追加
- `userscript/src/ui/panel.ts`
  - PRページ用の軽量パネル生成関数 (例: `mountPrPanel(ref)`) を追加。
    `getIssueForPr()` の結果が `issueNumber !== null && mergeable === false` の場合のみ
    「コンフリクト解決」ボタン (#28 で実装済みの `postResolveConflicts` をそのまま呼ぶ)
    を表示するパネルをマウントする。それ以外は何もマウントしない
- `userscript/src/main.ts`
  - `sync()` の分岐に、`currentIssue()` が `null` のとき `currentPr()` を判定し、
    非 `null` なら `mountPrPanel()` を呼ぶ処理を追加する。既存の issue 判定・マウント
    ロジックより後に評価し、互いに排他的に動作させる

### 影響範囲

- issue ページ側の既存動作 (#9 の soft-navigation 対応含む) には変更を加えない
  (`currentIssue()` の判定を先に行い、該当すれば従来通りの分岐を通すため)
- webhook 側は新規エンドポイント追加のみで、既存の `convert`/`create-pr`/
  `resolve-conflicts` ジョブのロジックには影響しない