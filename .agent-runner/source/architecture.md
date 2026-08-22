## システムアーキテクチャ定義

### 方針

既存の `userscript/src/main.ts` の `sync()` は300msポーリング + `MutationObserver` + turbo系イベントで「今マウントすべきか/どのissueを対象にすべきか」を判定している。この仕組みに「重なり表示中かどうか」の判定を1つ追加するだけで対応する。新しい監視機構は追加しない。

### 追加・変更するファイル

- `userscript/src/location.ts`
  - `isSubIssueOverlayOpen(): boolean` を追加する
  - 判定方法は実装着手時にGitHubの実際のDOMを調査して確定する。有力な候補は、GitHubの他のオーバーレイ機能 (差分プレビュー等) と同様に `role="dialog"` またはSub-issue専用の `data-*` 属性を持つ要素の有無を見る方法。調査結果に応じてこの関数の中身だけを差し替えられるよう、判定ロジックはこの関数1箇所に閉じ込める
  - 誤検知防止のため、GitHubの他の機能 (ラベル編集ドロップダウン等の別のdialog/popover) と混同しない、Sub-issue表示に特有のセレクタを使うこと
- `userscript/src/main.ts`
  - `sync()` の冒頭、`currentIssue()` の判定より前に `isSubIssueOverlayOpen()` をチェックする
  - `true` の場合は即座に `unmount()` を呼んで `return` する (通常のissue判定・マウント処理は行わない)
  - `false` の場合は既存の `sync()` のロジックをそのまま実行する

### 影響範囲

- `unmount()` / `mount()` など既存の関数はそのまま流用し、新規に追加するのは検知関数と `sync()` 冒頭の分岐のみ
- ジョブ実行中 (webhookへのポーリング等) の挙動には手を入れない。重なり表示中にパネルが消えても、既存の非同期処理自体は要件上とくに中断しない