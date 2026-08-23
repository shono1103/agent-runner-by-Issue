## 要件定義

### 背景

GitHubのissue詳細ページを開いても agent-runner のuserscriptパネルが表示されない/動作しないことがある。原因調査の結果、`https://github.com/*/*/issues/*` にマッチしない他のGitHubページ (PR一覧・Codeタブ・通知一覧など) から、GitHubのTurbo/React soft-navigation (`history.pushState` によるページ内遷移で、実際のブラウザナビゲーションを伴わないもの) 経由でissue詳細ページへ到達した場合、userscript自体が一度も注入されないことが判明した (詳細はissue本文の「原因調査」を参照)。issueのURLを直接開く/フルリロードする経路では問題なく動作する。

### 要件

1. issue詳細ページに到達する経路によらず (直接アクセス・フルリロードに加え、他のGitHubページからのTurbo soft-navigation経由も含む)、agent-runnerパネルが表示・動作すること
2. 既存の soft-navigation 対応 (`main.ts` のポーリング・`MutationObserver`・`turbo:load` 等のイベントリスナによる `sync()` 呼び出し) の動作を壊さないこと
3. 変更は userscript のマッチ範囲・マウント判定ロジックに閉じ、webhookのAPI・ジョブロジックには変更を加えないこと
4. issue詳細ページ以外では、これまで通りパネルが表示されないこと (誤表示が発生しないこと)

### 非機能要件

- `@match` の対象を広げることで issue 以外の GitHub ページでも userscript が常時起動するようになるが、既存の 300ms ポーリングと `MutationObserver` のコストの範囲であり、体感できるパフォーマンス低下がないこと
- 既存の issue 種別判定 (`issue-kind.ts`) やパネル表示切り替え (task / bug / feature) には影響しないこと