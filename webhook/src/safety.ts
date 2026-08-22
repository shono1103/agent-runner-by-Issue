import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { changedFiles, showFileAtHead, type GitWorkspace } from "./git.ts";

/**
 * claude が実装した差分を commit する前に検査する。
 * PR 作成エージェントに与えた「実質的なサンドボックス」は clone ディレクトリという
 * cwd 境界だけなので、CI 定義や認証情報に触れる変更は無条件で拒否する。
 * 特に .github/workflows/ の書き換えは PR merge 前に任意コード実行を許しうるため危険。
 */

const DENY_PREFIXES = [".github/workflows/", ".git/"];
const DENY_EXACT_BASENAMES = [".npmrc", ".netrc"];
const ALLOWLIST_HIDDEN_PREFIXES = [".agent-runner/", ".github/ISSUE_TEMPLATE/"];
const ALLOWLIST_HIDDEN_BASENAMES = [".env.example", ".env.test"];

/** npm がパッケージ操作時に暗黙に実行するスクリプト名。新規追加であっても拒否する。 */
const LIFECYCLE_SCRIPT_NAMES = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublishOnly",
  "preversion",
  "version",
  "postversion",
  "prepack",
  "postpack",
]);

export type SafeDiffResult =
  | { ok: true }
  | { ok: false; reason: string; files: string[] };

export async function assertSafeDiff(ws: GitWorkspace): Promise<SafeDiffResult> {
  const files = await changedFiles(ws);
  const offending = new Set<string>();

  for (const f of files) {
    if (DENY_PREFIXES.some((p) => f.startsWith(p))) {
      offending.add(f);
      continue;
    }
    const basename = f.split("/").pop() ?? f;
    if (DENY_EXACT_BASENAMES.includes(basename)) {
      offending.add(f);
      continue;
    }
    const isHidden = f.startsWith(".") || f.includes("/.");
    if (
      isHidden &&
      !ALLOWLIST_HIDDEN_PREFIXES.some((p) => f.startsWith(p)) &&
      !ALLOWLIST_HIDDEN_BASENAMES.includes(basename)
    ) {
      offending.add(f);
      continue;
    }
  }

  for (const f of await scriptsFieldOffenders(ws, files)) {
    offending.add(f);
  }

  if (offending.size > 0) {
    return {
      ok: false,
      reason: "許可されていないファイルへの変更が含まれています",
      files: [...offending],
    };
  }
  return { ok: true };
}

/** package.json の "scripts" フィールドが変更されたファイルを検出する。 */
async function scriptsFieldOffenders(ws: GitWorkspace, files: string[]): Promise<string[]> {
  const offenders: string[] = [];
  for (const f of files) {
    if (!f.endsWith("package.json")) continue;

    const beforeRaw = await showFileAtHead(ws, f);
    if (beforeRaw === null) continue; // 新規ファイルは対象外 (新規パッケージ追加を妨げない)

    try {
      const before = JSON.parse(beforeRaw) as { scripts?: Record<string, string> };
      const afterRaw = await readFile(join(ws.cloneDir, f), "utf8");
      const after = JSON.parse(afterRaw) as { scripts?: Record<string, string> };
      if (hasUnsafeScriptsChange(before.scripts ?? {}, after.scripts ?? {})) {
        offenders.push(f);
      }
    } catch {
      // 壊れた JSON は別の問題として通常のレビューに委ね、ここではブロックしない。
    }
  }
  return offenders;
}

/**
 * 既存スクリプトの値の変更・削除、またはライフサイクルフックの新規追加を「不正な変更」とみなす。
 * それ以外の新規スクリプトキー追加 (例: "test") は許可する。
 */
function hasUnsafeScriptsChange(
  before: Record<string, string>,
  after: Record<string, string>,
): boolean {
  for (const [key, value] of Object.entries(before)) {
    if (after[key] !== value) return true;
  }
  for (const key of Object.keys(after)) {
    if (!(key in before) && LIFECYCLE_SCRIPT_NAMES.has(key)) return true;
  }
  return false;
}
