import type { ConvertTarget } from "@agent-runner/webhook/api-types";
import {
  HttpError,
  getHealth,
  getPrStatus,
  investigate,
  pollJob,
  postClarify,
  postConvert,
  postCreatePr,
  postResolveConflicts,
  postScaffold,
  type JobLaunchResult,
} from "../gm-client.ts";
import type { IssueKind } from "../issue-kind.ts";
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

export function buildPanel(issue: IssueLocation, kind: IssueKind): PanelHandle {
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

  // task 種別のときのみ生成される。PR が mergeable: false のときだけ表示する。
  let conflictLabel: HTMLElement | null = null;
  let conflictRow: HTMLElement | null = null;
  let conflictVisible = false;
  // 設定画面を開閉する際、conflictLabel/conflictRow は非表示状態を保ったまま復元する
  // (単純に display: "" へ戻すと、非表示にしていたはずのボタンが出てきてしまう)。
  const restoreChildDisplay = (c: HTMLElement) => {
    if ((c === conflictLabel || c === conflictRow) && !conflictVisible) {
      c.style.display = "none";
      return;
    }
    c.style.display = "";
  };

  const allButtons: HTMLButtonElement[] = [];
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

  async function withJob(
    jobLabel: string,
    launch: () => Promise<JobLaunchResult>,
  ): Promise<void> {
    if (!isConfigured(loadSettings())) {
      setStatus("先に ⚙ から webhook URL とトークンを設定してください");
      return;
    }
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    setBusy(true);
    setStatus(`${jobLabel}: 開始しています...`);
    try {
      const launched = await launch();
      if (!launched.started) {
        appendLog(`${jobLabel}: ${launched.message} (既存ジョブに合流: jobId=${launched.jobId})`);
      } else {
        appendLog(`${jobLabel}: 開始 (jobId=${launched.jobId})`);
      }

      const totalTimeoutMs =
        jobLabel === "PR 作成" ? 40 * 60_000 : jobLabel === "調査" ? 15 * 60_000 : 5 * 60_000;
      const result = await pollJob(launched.jobId, {
        signal: controller.signal,
        totalTimeoutMs,
        onUpdate: (s) => {
          setStatus(`${jobLabel}: ${s.phase} (費用 $${s.costUsd.toFixed(3)})`);
        },
      });

      for (const line of result.logs) appendLog(line);

      if (result.status === "succeeded") {
        setStatus(`${jobLabel}: 完了`);
        dot.className = "dot ok";
        if (
          result.result &&
          typeof result.result === "object" &&
          "prUrl" in result.result &&
          typeof (result.result as { prUrl: unknown }).prUrl === "string"
        ) {
          appendLog(`PR: ${(result.result as { prUrl: string }).prUrl}`);
        }
        if (jobLabel !== "PR 作成") {
          setTimeout(() => location.reload(), 1200);
        }
      } else {
        setStatus(`${jobLabel}: 失敗 (${result.error ?? "unknown error"})`);
        dot.className = "dot error";
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus(`${jobLabel}: 中断しました`);
        return;
      }
      setStatus(`${jobLabel}: ${describeError(e)}`);
      dot.className = "dot error";
    } finally {
      setBusy(false);
    }
  }

  if (kind === "task") {
    // タスク種別: 既存の「フォーマット作成 / 変換 / PR作成」一式を表示する。
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

    // 対象issueのPRが mergeable: false (コンフリクト中) のときだけ表示する。
    conflictLabel = document.createElement("div");
    conflictLabel.className = "section-label";
    conflictLabel.textContent = "コンフリクト解決";
    conflictLabel.style.display = "none";
    conflictRow = document.createElement("div");
    conflictRow.className = "row";
    conflictRow.style.display = "none";
    const conflictBtn = mkButton("コンフリクト解決", "action danger");
    conflictRow.append(conflictBtn);

    body.append(
      scaffoldRow,
      convertLabel,
      convertRow,
      prLabel,
      prRow,
      conflictLabel,
      conflictRow,
      status,
      log,
    );
    allButtons.push(scaffoldBtn, alliumBtn, likec4Btn, superpowersBtn, allBtn, prBtn, conflictBtn);

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

    conflictBtn.addEventListener("click", () => {
      const ok = window.confirm(
        `Issue #${issue.issueNumber} のPRに main を取り込みマージし、コンフリクトを解決します。よろしいですか?`,
      );
      if (!ok) return;
      void withJob("コンフリクト解決", () => postResolveConflicts(issue));
    });
  } else if (kind === "bug") {
    // bug 種別: type:bug ラベルの付いた issue に対する原因調査を実行する。
    const investigateRow = document.createElement("div");
    investigateRow.className = "row";
    const investigateBtn = mkButton("調査を実行", "action");
    investigateRow.append(investigateBtn);

    body.append(investigateRow, status, log);
    allButtons.push(investigateBtn);

    investigateBtn.addEventListener("click", () => {
      void withJob("調査", () => investigate(issue));
    });
  } else {
    // feature 種別: 機能要望issueへの質問生成・再判定ループ。
    const clarifyLabel = document.createElement("div");
    clarifyLabel.className = "section-label";
    clarifyLabel.textContent = "質問";
    const clarifyRow = document.createElement("div");
    clarifyRow.className = "row";
    const clarifyBtn = mkButton("質問を実行", "action");
    clarifyRow.append(clarifyBtn);

    body.append(clarifyLabel, clarifyRow, status, log);
    allButtons.push(clarifyBtn);

    clarifyBtn.addEventListener("click", () => {
      void withJob("質問", () => postClarify(issue));
    });
  }

  panel.append(header, body);

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
        for (const c of originalChildren) restoreChildDisplay(c);
        showingSettings = false;
        setStatus("設定を保存しました");
      },
      () => {
        view.element.remove();
        for (const c of originalChildren) restoreChildDisplay(c);
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
      return;
    }

    if (kind === "task" && conflictLabel && conflictRow) {
      try {
        const prStatus = await getPrStatus(issue);
        if (prStatus.pr && prStatus.pr.mergeable === false) {
          conflictVisible = true;
          conflictLabel.style.display = "";
          conflictRow.style.display = "";
        }
      } catch {
        // PR状態の取得に失敗してもパネル自体は使えるようにする (ボタンは非表示のまま)。
      }
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
