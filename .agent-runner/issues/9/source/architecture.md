## システムアーキテクチャ定義

### 配置

- `userscript/vite.config.ts` — userscriptの `@match` 設定
- `userscript/src/main.ts` — マウント/アンマウント、`sync()`、ポーリング/`MutationObserver`/イベントリスナ
- `userscript/src/location.ts` — 現在のURLがissue詳細ページかどうかの判定 (`currentIssue()`)

### 原因

`vite.config.ts` の `match: ["https://github.com/*/*/issues/*"]` により、Tampermonkey/Violentmonkeyがuserscriptを注入するのは「ブラウザが実際にこのパターンに一致するURLへフルページロードした」時に限られる。GitHubのIssuesはhard navigationに加えTurbo/React soft-navigationを併用しており、`/issues/*` にマッチしないページからissue詳細ページへの遷移は多くの場合 `history.pushState` ベースのsoft navigationで行われ、実際のブラウザナビゲーションイベントを伴わない。`main.ts` の `setInterval(sync, 300)` / `MutationObserver` / `turbo:load` 等のリスナはsoft-navigation自体には対応済みだが、これらは「userscriptが既にそのページ上で実行中である」ことが前提の対策であり、そもそも未注入のケースには効かない。

### 変更方針

- `vite.config.ts` の `userscript.match` を `https://github.com/*` (GitHubドメイン全体) まで広げ、GitHub内のどこか1ページでもフルページロードが発生すればuserscriptが起動している状態を作る
- `main.ts` の `sync()` (currentIssue() の判定結果に基づく mount/unmount) はそのまま流用する。既にissue以外のページでは `unmount()` してパネルを消す設計になっているため、対象を広げてもissue以外のページでの誤表示は発生しない
- `location.ts` の `currentIssue()` は変更不要 (URLパスからのissue判定ロジックはページの種類に依存しないため)

### 影響範囲

- issue以外の全GitHubページでもuserscriptが起動し、300msポーリングと `MutationObserver` が常時稼働するようになる。パネル自体はissue詳細ページ以外では表示されないため機能面の影響はない。CPU使用量のわずかな増加は許容する
- webhook側のAPI・ジョブロジックへの変更はない (userscript側の注入範囲のみの変更のため)