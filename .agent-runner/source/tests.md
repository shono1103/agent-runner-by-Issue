## テスト定義

### location.ts: `isSubIssueOverlayOpen()`

- 重なり表示に対応するDOM要素が存在するとき `true` を返すこと
- 通常のissue単体表示 (該当要素が存在しない) のとき `false` を返すこと
- 誤検知の確認: ラベル編集や担当者選択など、Sub-issue以外のdialog/popoverが開いている状態では `false` を返すこと (Sub-issue表示に特有のセレクタで判定できていることの確認)

### main.ts: `sync()` の分岐

- `isSubIssueOverlayOpen()` が `true` のとき、`mount()` が呼ばれず、既にマウント済みであれば `unmount()` が呼ばれること (パネルがDOMから消えること)
- `isSubIssueOverlayOpen()` が `false` のとき、既存通りの挙動 (issueに応じたマウント/切り替え) になること
- 重なり表示 → 解消の遷移で、パネルが再度表示されること

### 手動確認 (E2E)

1. 通常のissueページではパネルが表示される
2. 親issueのSub-issues一覧から子issueをクリックし、重なった表示になったらパネルが消えること
3. 重なり表示を閉じて通常のissue単体表示に戻ると、パネルが再度表示されること
4. ラベル編集などSub-issue以外のdialog/popoverを開いてもパネルが消えないこと (誤検知しないこと)