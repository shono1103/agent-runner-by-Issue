import type { PrLocation } from "../location.ts";
import { PANEL_CSS } from "./styles.ts";

/**
 * PRページ用: PR番号に対応するissue番号とmergeable状態。
 * webhook (`GET /api/prs/:number/issue`) の応答をそのまま表す。
 */
export type PrIssueStatus =
  | { issueNumber: number; mergeable: boolean | null }
  | { issueNumber: null };

export const PR_PANEL_ID = "agent-runner-pr-root";

/**
 * PRページに「コンフリクト解決」パネルを表示すべきかどうかを判定する。
 * (spec.allium の `Pr.should_show_panel = has_linked_issue and not mergeable` に対応する)
 */
export function shouldShowPrPanel(status: PrIssueStatus): boolean {
  return status.issueNumber !== null && status.mergeable === false;
}

export type ResolveConflictsResult = { ok: boolean; message: string };

/**
 * mountPrPanel() が必要とする外部依存。gm-client.ts (`GM_xmlhttpRequest` を使う実装) を
 * このファイルから直接importしないための注入口。main.ts が本番実装を組み立てて渡す。
 */
export type MountPrPanelDeps = {
  /** 対応するissue番号とmergeable状態を取得する (webhook: GET /api/prs/:number/issue)。 */
  getIssueForPr(ref: PrLocation): Promise<PrIssueStatus>;
  /** #28 の「コンフリクト解決」ジョブを起動し、完了まで待つ。進捗は onUpdate に随時通知する。 */
  resolveConflicts(
    issueNumber: number,
    onUpdate: (statusText: string) => void,
  ): Promise<ResolveConflictsResult>;
};

/**
 * PRページ用の軽量パネル (「コンフリクト解決」ボタンのみ) を条件付きでマウントする。
 * `getIssueForPr()` の結果が `shouldShowPrPanel()` を満たす場合のみ DOM に要素を追加する。
 * それ以外 (issueNumber が null、または mergeable が true/null) の場合はパネル自体を
 * 作らない (issueページ用パネルと異なり、非表示状態のDOMを残さない)。
 * webhook への通信が失敗した場合もパネルを表示せず、何もしない
 * (issueページ側の既存パターンに倣う)。
 */
export async function mountPrPanel(pr: PrLocation, deps: MountPrPanelDeps): Promise<void> {
  let status: PrIssueStatus;
  try {
    status = await deps.getIssueForPr(pr);
  } catch {
    return;
  }
  if (!shouldShowPrPanel(status) || status.issueNumber === null) return;
  const issueNumber = status.issueNumber;

  const host = document.createElement("div");
  host.id = PR_PANEL_ID;
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = PANEL_CSS;

  const panel = document.createElement("div");
  panel.className = "panel";

  const header = document.createElement("div");
  header.className = "header";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = `agent-runner · #${issueNumber} (PR #${pr.prNumber})`;
  header.append(title);

  const body = document.createElement("div");
  body.className = "body";

  const statusEl = document.createElement("div");
  statusEl.className = "status";
  statusEl.textContent = "待機中";

  const row = document.createElement("div");
  row.className = "row";
  const conflictBtn = document.createElement("button");
  conflictBtn.type = "button";
  conflictBtn.className = "action danger";
  conflictBtn.textContent = "コンフリクト解決";
  row.append(conflictBtn);

  body.append(row, statusEl);
  panel.append(header, body);
  shadow.append(style, panel);

  conflictBtn.addEventListener("click", () => {
    const ok = window.confirm(
      `Issue #${issueNumber} のPRに main を取り込みマージし、コンフリクトを解決します。よろしいですか?`,
    );
    if (!ok) return;
    conflictBtn.disabled = true;
    statusEl.textContent = "コンフリクト解決: 開始しています...";
    deps
      .resolveConflicts(issueNumber, (text) => {
        statusEl.textContent = text;
      })
      .then((result) => {
        statusEl.textContent = result.message;
        if (result.ok) setTimeout(() => location.reload(), 1200);
      })
      .catch((e: unknown) => {
        statusEl.textContent = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        conflictBtn.disabled = false;
      });
  });

  document.body.append(host);
}
