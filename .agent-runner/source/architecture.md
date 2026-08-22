## システムアーキテクチャ定義

### 配置

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/task.yml`
- `.github/ISSUE_TEMPLATE/config.yml` (`blank_issues_enabled: false` にしてテンプレート経由の作成を必須にする)

GitHubのIssue Forms (`.yml` 形式) を採用する。Markdownテンプレートではなく Issue Forms を選ぶ理由は、`labels:` フィールドでissue作成時に固定ラベルを自動付与でき、これを種類判別の目印として使えるため。

### 種類判別の目印

各テンプレートに以下の固定ラベルを自動付与する。

- バグ報告用テンプレート → ラベル `type:bug`
- 機能要望用テンプレート → ラベル `type:feature`
- タスク用テンプレート → ラベル `type:task`

ラベルを目印に選ぶ理由:

- issue本文やコメントの書き換えでは失われない (issue自体の属性である)
- GitHub UI・API (`labels` フィールド) の両方から取得でき、userscript・webhook のどちらからも参照しやすい
- `webhook/src/markers.ts` が担う「コメント種別のマーカー」とは別レイヤーの関心事であり、既存の仕組みと衝突しない

### userscript側の変更

- 種類判別ロジックを新設する (`userscript/src/issue-kind.ts` 等)
  - `issueKind(labels: string[]): "bug" | "feature" | "task"` — labels配列から `type:bug` / `type:feature` を検出し、どちらも無ければ `"task"` を返す (既存issueとの後方互換のデフォルト)
  - 両方のラベルが同時に付与されている異常系では、`type:bug` を優先する (バグ報告の調査結果反映を優先させたいため) と定め、実装をこれに合わせる
- labelsはGitHubのissueページDOM (サイドバーの Labels セクション) から取得する。`userscript/src/main.ts` の `mount()` 内で1度だけ読み取り、`issueKind` の結果を `ui/panel.ts` の `buildPanel()` に渡す
- パネル (`userscript/src/ui/panel.ts`) は種類に応じて表示するボタンを切り替える
  - `task` → 既存の「フォーマット作成 / Allium生成 / LikeC4生成 / Superpowers生成 / すべて生成 / PRを作成」
  - `bug` → #3 で実装する調査ボタン (本issueのスコープ外。今回はボタン非表示のプレースホルダーのみ用意する)
  - `feature` → #4 で実装する質問ボタン (本issueのスコープ外。今回はボタン非表示のプレースホルダーのみ用意する)

### webhook側の変更

- 本issueのスコープではwebhookのAPI・ジョブロジックへの変更はない (テンプレート追加とラベル付与はGitHub側の設定のみで完結するため)
- #3・#4 の実装時、webhookのエンドポイントが対象issueの `labels` をGitHub APIから読み取り種類に応じた処理を分岐する際にも、同じラベル名 (`type:bug` / `type:feature` / `type:task`) を参照する前提とする