import type { ConvertTarget } from "@agent-runner/webhook/api-types";
import {
  HttpError,
  getHealth,
  pollJob,
  postConvert,
  postCreatePr,
  postScaffold,
  type JobLaunchResult,
} from "../gm-client.ts";
import type { IssueLocation } from "../location.ts";
import { isConfigured, loadSettings } from "../settings.ts";
import { renderSettingsView } from "./settings-dialog.ts";
import { PANEL_CSS } from "./styles.ts";

export type PanelHandle = {
  element: DocumentFragment;
  destroy(): void;
};

const TARGET_LABELS: Record<ConvertTarget, string> = {
  allium: "Allium 生成",
  likec4: "LikeC4 生成",
  superpowers: "Superpowers 生成",
};

function mkButton(label: string, className: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  return b;
}

function describeError(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status}: ${e.body.slice(0, 200)}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function buildPanel(issue: IssueLocation): PanelHandle {
  let activeController: AbortController | null = null;

  const style = document.createElement("style");
  style.textContent = PANEL_CSS;

  const panel = document.createElement("div");
  panel.className = "panel";

  // --- header --------------------------------------------------------
  const header = document.createElement("div");
  header.className = "header";

  const dot = document.createElement("span");
  dot.className = "dot";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = `agent-runner · #${issue.issueNumber}`;
  const titleWrap = document.createElement("div");
  titleWrap.style.display = "flex";
  titleWrap.style.alignItems = "center";
  titleWrap.style.gap = "6px";
  titleWrap.append(dot, title);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "iconbtn";
  settingsBtn.type = "button";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "設定";
  const collapseBtn = document.createElement("button");
  collapseBtn.className = "iconbtn";
  collapseBtn.type = "button";
  collapseBtn.textContent = "–";
  collapseBtn.title = "折りたたむ";

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(settingsBtn, collapseBtn);

  header.append(titleWrap, actions);

  // --- body ------------------------------------------------------------
  const body = document.createElement("div");
  body.className = "body";

  const status = document.createElement("div");
  status.className = "status";
  status.textContent = "準備中...";

  const log = document.createElement("div");
  log.className = "log";

  const scaffoldRow = document.createElement("div");
  scaffoldRow.className = "row";
  const scaffoldBtn = mkButton("フォーマット作成", "action");
  scaffoldRow.append(scaffoldBtn);

  const convertLabel = document.createElement("div");
  convertLabel.className = "section-label";
  convertLabel.textContent = "変換";
  const convertRow = document.createElement("div");
  convertRow.className = "row";
  const alliumBtn = mkButton(TARGET_LABELS.allium, "action");
  const likec4Btn = mkButton(TARGET_LABELS.likec4, "action");
  const superpowersBtn = mkButton(TARGET_LABELS.superpowers, "action");
  const allBtn = mkButton("すべて生成", "action");
  convertRow.append(alliumBtn, likec4Btn, superpowersBtn, allBtn);

  const prLabel = document.createElement("div");
  prLabel.className = "section-label";
  prLabel.textContent = "実装";
  const prRow = document.createElement("div");
  prRow.className = "row";
  const prBtn = mkButton("PR を作成", "action danger");
  prRow.append(prBtn);

  body.append(scaffoldRow, convertLabel, convertRow, prLabel, prRow, status, log);
  panel.append(header, body);

  const allButtons = [scaffoldBtn, alliumBtn, likec4Btn, superpowersBtn, allBtn, prBtn];
  const setBusy = (busy: boolean) => {
    for (const b of allButtons) b.disabled = busy;
  };

  const appendLog = (line: string) => {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${line}`;
    log.textContent = log.textContent ? `${log.textContent}\n${entry}` : entry;
    log.scrollTop = log.scrollHeight;
  };

  const setStatus = (text: string) => {
    status.textContent = text;
  };

  async function withJob(kind: string, launch: () => Promise<JobLaunchResult>): Promise<void> {
    if (!isConfigured(loadSettings())) {
      setStatus("先に ⚙ から webhook URL とトークンを設定してください");
      return;
    }
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    setBusy(true);
    setStatus(`${kind}: 開始しています...`);
    try {
      const launched = await launch();
      if (!launched.started) {
        appendLog(`${kind}: ${launched.message} (既存ジョブに合流: jobId=${launched.jobId})`);
      } else {
        appendLog(`${kind}: 開始 (jobId=${launched.jobId})`);
      }

      const totalTimeoutMs = kind === "PR 作成" ? 40 * 60_000 : 5 * 60_000;
      const result = await pollJob(launched.jobId, {
        signal: controller.signal,
        totalTimeoutMs,
        onUpdate: (s) => {
          setStatus(`${kind}: ${s.phase} (費用 $${s.costUsd.toFixed(3)})`);
        },
      });

      for (const line of result.logs) appendLog(line);

      if (result.status === "succeeded") {
        setStatus(`${kind}: 完了`);
        dot.className = "dot ok";
        if (
          result.result &&
          typeof result.result === "object" &&
          "prUrl" in result.result &&
          typeof (result.result as { prUrl: unknown }).prUrl === "string"
        ) {
          appendLog(`PR: ${(result.result as { prUrl: string }).prUrl}`);
        }
        if (kind !== "PR 作成") {
          setTimeout(() => location.reload(), 1200);
        }
      } else {
        setStatus(`${kind}: 失敗 (${result.error ?? "unknown error"})`);
        dot.className = "dot error";
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus(`${kind}: 中断しました`);
        return;
      }
      setStatus(`${kind}: ${describeError(e)}`);
      dot.className = "dot error";
    } finally {
      setBusy(false);
    }
  }

  scaffoldBtn.addEventListener("click", () => {
    void (async () => {
      if (!isConfigured(loadSettings())) {
        setStatus("先に ⚙ から webhook URL とトークンを設定してください");
        return;
      }
      setBusy(true);
      setStatus("フォーマット作成中...");
      try {
        const res = await postScaffold(issue);
        setStatus(
          `作成: ${res.created.join(", ") || "なし"} / 既存: ${res.skipped.join(", ") || "なし"}`,
        );
        if (res.created.length > 0) setTimeout(() => location.reload(), 1000);
      } catch (e) {
        setStatus(describeError(e));
      } finally {
        setBusy(false);
      }
    })();
  });

  alliumBtn.addEventListener("click", () => {
    void withJob("Allium 変換", () => postConvert({ ...issue, targets: ["allium"] }));
  });
  likec4Btn.addEventListener("click", () => {
    void withJob("LikeC4 変換", () => postConvert({ ...issue, targets: ["likec4"] }));
  });
  superpowersBtn.addEventListener("click", () => {
    void withJob("Superpowers 変換", () => postConvert({ ...issue, targets: ["superpowers"] }));
  });
  allBtn.addEventListener("click", () => {
    void withJob("全形式変換", () =>
      postConvert({ ...issue, targets: ["allium", "likec4", "superpowers"] }),
    );
  });

  prBtn.addEventListener("click", () => {
    const ok = window.confirm(
      `Issue #${issue.issueNumber} の内容から PR を作成します。よろしいですか?`,
    );
    if (!ok) return;
    void withJob("PR 作成", () => postCreatePr(issue));
  });

  let collapsed = false;
  header.addEventListener("click", (e) => {
    if (e.target === settingsBtn) return;
    collapsed = !collapsed;
    body.classList.toggle("collapsed", collapsed);
    collapseBtn.textContent = collapsed ? "+" : "–";
  });

  let showingSettings = false;
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (showingSettings) return;
    showingSettings = true;
    const originalChildren = Array.from(body.children) as HTMLElement[];
    for (const c of originalChildren) c.style.display = "none";

    const view = renderSettingsView(
      () => {
        view.element.remove();
        for (const c of originalChildren) c.style.display = "";
        showingSettings = false;
        setStatus("設定を保存しました");
      },
      () => {
        view.element.remove();
        for (const c of originalChildren) c.style.display = "";
        showingSettings = false;
      },
    );
    body.append(view.element);
  });

  void (async () => {
    if (!isConfigured(loadSettings())) {
      setStatus("未設定: ⚙ から webhook URL とトークンを設定してください");
      return;
    }
    try {
      await getHealth();
      dot.className = "dot ok";
      setStatus("待機中");
    } catch {
      dot.className = "dot error";
      setStatus("webhook サーバーに接続できません");
    }
  })();

  const fragment = document.createDocumentFragment();
  fragment.append(style, panel);

  return {
    element: fragment,
    destroy() {
      activeController?.abort();
    },
  };
}
