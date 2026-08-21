import { GM_getValue, GM_setValue } from "$";

const KEY_BASE_URL = "agent-runner:baseUrl";
const KEY_TOKEN = "agent-runner:token";

export const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

export type Settings = {
  baseUrl: string;
  token: string;
};

export function loadSettings(): Settings {
  return {
    baseUrl: GM_getValue<string>(KEY_BASE_URL, DEFAULT_BASE_URL),
    token: GM_getValue<string>(KEY_TOKEN, ""),
  };
}

export function saveSettings(settings: Settings): void {
  GM_setValue(KEY_BASE_URL, settings.baseUrl);
  GM_setValue(KEY_TOKEN, settings.token);
}

export function isConfigured(settings: Settings): boolean {
  return settings.baseUrl.trim().length > 0 && settings.token.trim().length > 0;
}
