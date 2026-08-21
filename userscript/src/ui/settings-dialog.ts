import { getHealth, HttpError } from "../gm-client.ts";
import { DEFAULT_BASE_URL, loadSettings, saveSettings } from "../settings.ts";

export type SettingsViewHandle = {
  element: HTMLElement;
};

export function renderSettingsView(onSaved: () => void, onCancel: () => void): SettingsViewHandle {
  const current = loadSettings();

  const root = document.createElement("div");

  const baseUrlLabel = document.createElement("label");
  baseUrlLabel.textContent = "webhook URL";
  const baseUrlInput = document.createElement("input");
  baseUrlInput.type = "text";
  baseUrlInput.value = current.baseUrl || DEFAULT_BASE_URL;
  baseUrlInput.placeholder = DEFAULT_BASE_URL;
  baseUrlLabel.append(baseUrlInput);

  const tokenLabel = document.createElement("label");
  tokenLabel.textContent = "共有トークン (X-Agent-Runner-Token)";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.value = current.token;
  tokenLabel.append(tokenInput);

  const status = document.createElement("div");
  status.className = "status";

  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "action";
  checkBtn.textContent = "疎通確認";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "action primary";
  saveBtn.textContent = "保存";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "action";
  cancelBtn.textContent = "キャンセル";

  checkBtn.addEventListener("click", () => {
    void (async () => {
      status.textContent = "確認中...";
      // loadSettings() は保存済みの値を読むため、入力中の値を一時保存してから確認する。
      saveSettings({ baseUrl: baseUrlInput.value.trim(), token: tokenInput.value });
      try {
        const health = await getHealth();
        status.textContent = `接続OK (version=${health.version}, DRY_RUN=${health.dryRun})`;
      } catch (e) {
        status.textContent = describeError(e);
      }
    })();
  });

  saveBtn.addEventListener("click", () => {
    saveSettings({ baseUrl: baseUrlInput.value.trim() || DEFAULT_BASE_URL, token: tokenInput.value });
    onSaved();
  });

  cancelBtn.addEventListener("click", onCancel);

  const buttonRow = document.createElement("div");
  buttonRow.className = "row";
  buttonRow.append(checkBtn, saveBtn, cancelBtn);

  root.append(baseUrlLabel, tokenLabel, buttonRow, status);

  return { element: root };
}

function describeError(e: unknown): string {
  if (e instanceof HttpError) return `HTTP ${e.status}: ${e.body.slice(0, 200)}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
