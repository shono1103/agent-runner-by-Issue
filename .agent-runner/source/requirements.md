## 要件定義

### 背景

#28 で実装した「コンフリクト解決」ボタンは issue 詳細ページの userscript パネルにのみ
表示される (`@match: ["https://github.com/*/*/issues/*"]` のため、PR ページでは
userscript 自体が注入されない)。しかし実際にコンフリクトへ気づくのは、GitHub が
ネイティブに「This branch has conflicts that must be resolved」と表示する **PR ページ**
であることがほとんどで、そこにAIによる解決手段への導線が無いと機能の存在に気づけない/
使いにくい。

### 要件

1. userscript の `@match` に `https://github.com/*/*/pull/*` を追加し、PR ページでも
   userscript が起動するようにすること (既存の issue ページでの動作は維持すること)
2. PR ページを開いたとき、そのPRに対応する issue 番号 (PR本文の `Closes #<N>` または
   ブランチ名 `agent-runner/issue-<N>-*` から判定) を webhook 経由で特定できること
3. 対応する issue が見つかり、かつそのPRが `mergeable: false` (コンフリクト中) の場合のみ、
   PRページに「コンフリクト解決」ボタンを表示すること
4. PRページに表示するのは「コンフリクト解決」ボタンのみとし、フォーマット作成・変換・
   PR作成など issue ページ用の他のボタン一式は表示しないこと (PRページでissueに対する
   他の操作をするのは文脈的に不自然なため)
5. 対応する issue が特定できない (agent-runner 由来のPRではない、または既にmergeable な)
   場合は、パネル自体を表示しないこと
6. 既存の issue ページでの動作 (#9 で対応した soft-navigation 含む) を壊さないこと

### 非機能要件

- `@match` を広げることで PR ページでも常時 userscript が起動するようになるが、
  既存の 300ms ポーリング・`MutationObserver` のコスト範囲内であること (#9 の判断を踏襲)
- webhook 側の既存API・ジョブロジック (`resolve-conflicts` 含む) には変更を加えず、
  PR番号→issue番号の逆引き用エンドポイントを追加するのみとすること