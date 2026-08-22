/**
 * GitHubのissueページDOM (サイドバーの Labels セクション) から、付与されているラベル名の一覧を読み取る。
 *
 * GitHub側のDOM構造は変更されうるため、「Labels」という見出しを持つサイドバー項目を
 * 総当たりで探し、その中の `/labels/` へのリンクのテキストをラベル名として収集する。
 * 該当箇所が見つからない場合は空配列を返す (呼び出し側の `issueKind` は空配列を
 * task として扱うため、後方互換のデフォルトに自然にフォールバックする)。
 */
export function readIssueLabels(): string[] {
  const container = findLabelsSidebarItem();
  if (!container) return [];

  const labels: string[] = [];
  for (const a of container.querySelectorAll<HTMLAnchorElement>("a[href*='/labels/']")) {
    const name = a.textContent?.trim();
    if (name) labels.push(name);
  }
  return labels;
}

function findLabelsSidebarItem(): Element | null {
  const headings = document.querySelectorAll<HTMLElement>(
    ".discussion-sidebar-item .discussion-sidebar-heading, [data-testid='sidebar-section-heading']",
  );
  for (const heading of headings) {
    if (heading.textContent?.trim().startsWith("Labels")) {
      return heading.closest(".discussion-sidebar-item") ?? heading.parentElement;
    }
  }
  return null;
}
