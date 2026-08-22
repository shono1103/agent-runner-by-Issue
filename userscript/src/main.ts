import { issueKind } from "./issue-kind.ts";
import { readIssueLabels } from "./labels.ts";
import { currentIssue, isSubIssueOverlayOpen, issueKey, type IssueLocation } from "./location.ts";
import { buildPanel, type PanelHandle } from "./ui/panel.ts";

const PANEL_ID = "agent-runner-root";

let mountedFor: string | null = null;
let currentHandle: PanelHandle | null = null;

function unmount(): void {
  currentHandle?.destroy();
  currentHandle = null;
  document.getElementById(PANEL_ID)?.remove();
  mountedFor = null;
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
    return;
  }
  const issue = currentIssue();
  if (!issue) {
    if (mountedFor !== null) unmount();
    return;
  }
  const key = issueKey(issue);
  if (mountedFor === key && document.getElementById(PANEL_ID)) return;
  unmount();
  mount(issue);
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
