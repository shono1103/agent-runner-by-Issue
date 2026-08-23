import { getIssueForPr, pollJob, postResolveConflicts } from "./gm-client.ts";
import { issueKind } from "./issue-kind.ts";
import { readIssueLabels } from "./labels.ts";
import {
  currentIssue,
  currentPr,
  isSubIssueOverlayOpen,
  issueKey,
  prKey,
  type IssueLocation,
  type PrLocation,
} from "./location.ts";
import { buildPanel, type PanelHandle } from "./ui/panel.ts";
import { mountPrPanel, PR_PANEL_ID, type MountPrPanelDeps } from "./ui/pr-panel.ts";

const PANEL_ID = "agent-runner-root";

let mountedFor: string | null = null;
let currentHandle: PanelHandle | null = null;
let prMountedFor: string | null = null;

function unmount(): void {
  currentHandle?.destroy();
  currentHandle = null;
  document.getElementById(PANEL_ID)?.remove();
  mountedFor = null;
}

function unmountPr(): void {
  document.getElementById(PR_PANEL_ID)?.remove();
  prMountedFor = null;
}

/** gm-client.ts (webhook呼び出し) を ui/pr-panel.ts の注入インターフェースに合わせる。 */
function buildPrPanelDeps(pr: PrLocation): MountPrPanelDeps {
  return {
    getIssueForPr,
    async resolveConflicts(issueNumber, onUpdate) {
      const launched = await postResolveConflicts({
        owner: pr.owner,
        repo: pr.repo,
        issueNumber,
      });
      if (!launched.started) {
        onUpdate(`${launched.message} (既存ジョブに合流: jobId=${launched.jobId})`);
      } else {
        onUpdate(`コンフリクト解決: 開始 (jobId=${launched.jobId})`);
      }
      const result = await pollJob(launched.jobId, {
        totalTimeoutMs: 5 * 60_000,
        onUpdate: (s) => onUpdate(`コンフリクト解決: ${s.phase} (費用 $${s.costUsd.toFixed(3)})`),
      });
      if (result.status === "succeeded") {
        return { ok: true, message: "コンフリクト解決: 完了" };
      }
      return { ok: false, message: `コンフリクト解決: 失敗 (${result.error ?? "unknown error"})` };
    },
  };
}

/**
 * currentIssue() が null のときだけ評価する (issueページ判定より後、互いに排他的)。
 * 表示条件を満たすかどうかは webhook への問い合わせが必要なため、同じPRに対しては
 * (300msごとの再ポーリングで) 何度も問い合わせないよう prMountedFor で一度だけに絞る。
 */
function syncPr(): void {
  const pr = currentPr();
  if (!pr) {
    if (prMountedFor !== null) unmountPr();
    return;
  }
  const key = prKey(pr);
  if (prMountedFor === key) return;
  unmountPr();
  prMountedFor = key;
  void mountPrPanel(pr, buildPrPanelDeps(pr));
}

function mount(issue: IssueLocation): void {
  const host = document.createElement("div");
  host.id = PANEL_ID;
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;";
  const shadow = host.attachShadow({ mode: "open" });

  // issueページDOMからlabelsを1度だけ読み取り、issueの種類を判定する。
  const kind = issueKind(readIssueLabels());
  const handle = buildPanel(issue, kind);
  shadow.append(handle.element);
  document.body.append(host);

  currentHandle = handle;
  mountedFor = issueKey(issue);
}

/**
 * GitHub の Issues は hard navigation / Turbo / React soft-navigation を併用しており、
 * どのイベントが飛ぶかはページ側実装依存で不確実。location.href のポーリングを主軸にし、
 * MutationObserver とイベントリスナは「飛べば速いだけ」の補助として重ねる。
 */
function sync(): void {
  // Sub-issues一覧から子issueを開き、issueが重なった状態で表示されているときは、
  // パネルがどのissueを対象にしているか判断できず誤操作につながるため、
  // 通常のissue判定・マウント処理より前にパネルを非表示にして抜ける。
  if (isSubIssueOverlayOpen()) {
    if (mountedFor !== null) unmount();
    if (prMountedFor !== null) unmountPr();
    return;
  }
  const issue = currentIssue();
  if (issue) {
    // issueページ用パネルとPRページ用パネルは互いに排他的 (同時表示しない)。
    if (prMountedFor !== null) unmountPr();
    const key = issueKey(issue);
    if (mountedFor === key && document.getElementById(PANEL_ID)) return;
    unmount();
    mount(issue);
    return;
  }
  if (mountedFor !== null) unmount();
  // currentIssue() が null のときだけ、PRページかどうかを判定する。
  syncPr();
}

setInterval(sync, 300);

new MutationObserver(() => {
  if (currentIssue() && !document.getElementById(PANEL_ID)) {
    mountedFor = null;
    sync();
  }
}).observe(document.documentElement, { childList: true, subtree: true });

for (const eventName of ["turbo:load", "turbo:render", "soft-nav:success", "pjax:end"]) {
  document.addEventListener(eventName, sync);
}

sync();
