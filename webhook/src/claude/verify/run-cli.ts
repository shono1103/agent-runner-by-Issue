import { spawn } from "node:child_process";
import { once } from "node:events";

export type CliRunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

/**
 * likec4 / allium などの検証 CLI を実行する共通ヘルパー。
 * 呼び出し側はここでは合否判定をしない (2つの CLI で判定方法が非対称なため)。
 */
export async function runCliJson(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c: string) => (stdout += c));
  child.stderr.on("data", (c: string) => (stderr += c));

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, timeoutMs);

  try {
    const [exitCode] = (await once(child, "close")) as [number | null];
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}
