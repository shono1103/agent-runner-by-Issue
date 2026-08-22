## テスト定義

### 静的検証

- `.github/ISSUE_TEMPLATE/*.yml` がGitHubのIssue Formsスキーマとして妥当であること (3種類がissue作成画面の選択肢に表示されることを手動確認する)
- 各テンプレートの `labels:` に `type:bug` / `type:feature` / `type:task` がそれぞれ1つだけ設定されていること

### userscript: `issueKind` 関数の単体テスト

入力: labels配列 (文字列の配列)

- `["type:bug"]` → `"bug"`
- `["type:feature"]` → `"feature"`
- `["type:task"]` → `"task"`
- `[]` (ラベルなし、テンプレート導入前の既存issue) → `"task"` (後方互換のデフォルト)
- `["type:bug", "type:feature"]` (両方付与された異常系) → `"bug"` (アーキテクチャ定義で定めた優先順位)
- 未知のラベルのみ (`["enhancement"]`) → `"task"`

### 手動確認 (E2E)

1. GitHubのissue作成画面で3種類のテンプレートが選択肢に表示される
2. バグ報告テンプレートから作成したissueに `type:bug` ラベルが付与されている
3. 機能要望テンプレートから作成したissueに `type:feature` ラベルが付与されている
4. タスクテンプレートから作成したissueに `type:task` ラベルが付与されている
5. 上記3つのissueをそれぞれuserscriptで開き、パネルが種類に応じた表示になっている (タスクは既存ボタン一式、バグ報告・機能要望はプレースホルダー)
6. ラベルを持たない既存issue (テンプレート導入前に作成したもの) を開いても、従来通り「タスク」として扱われ、既存ボタンが表示される