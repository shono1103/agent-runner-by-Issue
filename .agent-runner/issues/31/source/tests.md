## テスト定義

### location.ts: currentPr()

- PRページのURL (`/owner/repo/pull/123`) から `{ owner, repo, prNumber: 123 }` を
  正しく抽出できること
- issueページや他のページでは `null` を返すこと

### github.ts: findIssueForPr()

- PR本文に `Closes #<N>` が含まれる場合、その issue 番号を返すこと
- PR本文に無いが head ブランチ名が `agent-runner/issue-<N>-` の場合、その issue 番号を
  返すこと
- どちらの手がかりも無い場合は `null` を返すこと

### routes/prStatus.ts: GET /api/prs/:number/issue

- 対応する issue が見つかり `mergeable: false` の場合、`{ issueNumber, mergeable: false }`
  を返すこと
- 対応する issue が見つからない場合、`{ issueNumber: null }` を返すこと (404ではなく
  200で判定可能な形にする。userscript側が「表示しない」判断をしやすくするため)

### ui/panel.ts: mountPrPanel()

- `getIssueForPr()` が `issueNumber !== null && mergeable === false` を返した場合のみ
  「コンフリクト解決」ボタンを含むパネルがマウントされること
- それ以外 (issueNumber が null、または mergeable が true) の場合は何もマウントされない
  こと (DOMに要素が追加されないこと)

### 手動確認 (E2E)

1. コンフリクト中のPR (`agent-runner/issue-<N>-*` ブランチ) を開くと、
   「コンフリクト解決」ボタンのみのパネルが表示されること
2. ボタンを押すと #28 の `resolve-conflicts` ジョブが実行され、完了後PRが
   `mergeable: true` になること
3. コンフリクトの無いPRや、agent-runner由来でないPRを開いても、パネルが表示されないこと
4. issueページでは、これまで通りフォーマット作成・変換・PR作成一式のパネルが表示され、
   PRページ用のパネルと混同しないこと