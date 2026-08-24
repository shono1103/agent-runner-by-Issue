import { spawn } from "node:child_process";
import { once } from "node:events";
import { scrubEnv } from "../env.ts";
import { findExecutable } from "../which.ts";

const KILL_GRACE_MS = 5_000;

/**
 * spawn 失敗の理由を、そのまま画面に出して意味が分かる文言にする。
 *
 * 素の "spawn claude ENOENT" だけだと何を直せばいいのか分からない。ただし ENOENT は
 * 「claude が PATH に無い」ときにも「cwd が存在しない」ときにも同じ形で出る
 * (どちらも message は "spawn claude ENOENT"、code も path も同じ) ので、
 * メッセージだけでは区別できない。実際に claude を解決できるかを見てから原因を決める。
 *
 * spawn がコマンド名を解決するのに使うのは子プロセスに渡す env の PATH なので、
 * systemd で常駐させると unit の Environment=PATH が全てになる
 * (対話シェルからは動くのにサービスからだけ失敗する、という出方をする)。
 */
function describeSpawnError(e: NodeJS.ErrnoException, cwd: string): string {
  const raw = String(e?.message ?? e);
  if (e?.code !== "ENOENT") return raw;

  const bin = findExecutable("claude");
  if (bin === null) {
    return (
      `${raw}: claude コマンドが PATH 上に見つかりません。systemd で常駐させている場合は、` +
      "unit の Environment=PATH に claude のディレクトリが含まれていない可能性があります " +
      "(webhook/scripts/install-service.sh を再実行してください)。" +
      ` PATH=${process.env.PATH ?? "(未設定)"}`
    );
  }
  return `${raw}: claude は ${bin} にあります。cwd が存在しない可能性があります (cwd=${cwd})。`;
}

export type ClaudeFailure =
  | { kind: "spawn"; detail: string }
  | { kind: "timeout"; detail: string }
  | { kind: "protocol"; detail: string; stdout: string }
  | { kind: "agent"; detail: string; subtype?: string; terminalReason?: string };

export type ClaudeOk<T> = {
  ok: true;
  structured: T;
  text: string;
  costUsd: number;
  raw: unknown;
};

export type ClaudeErr = {
  ok: false;
  failure: ClaudeFailure;
  costUsd: number;
  raw?: unknown;
};

export type RunClaudeOptions = {
  prompt: string;
  cwd: string;
  systemPrompt: string;
  jsonSchema?: object;
  /** 許可するツール名。省略時は [] = ツール無効 (変換ジョブ向け)。 */
  tools?: string[];
  disallowedTools?: string[];
  permissionMode?: "acceptEdits";
  model?: string;
  timeoutMs: number;
  maxBudgetUsd?: number;
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
};

type ClaudeCliResult = {
  is_error?: boolean;
  subtype?: string;
  terminal_reason?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  stop_reason?: string;
};

/**
 * claude cli を -p (print) モードで実行する。
 *
 * 判定は「exit code」ではなく「stdout の JSON」で行う。実測で、不正なモデル名は
 * exit=1 だが stdout は valid JSON、--max-budget-usd 超過は exit=0 なのに
 * is_error:true になることを確認済み。exit code を成功判定に使わないこと。
 */
export async function runClaude<T = unknown>(
  opts: RunClaudeOptions,
): Promise<ClaudeOk<T> | ClaudeErr> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    opts.model ?? "sonnet",
    "--setting-sources",
    "",
    "--system-prompt",
    opts.systemPrompt,
    "--no-session-persistence",
    // commander の可変長引数なので必ずカンマ結合で1要素にする。
    "--tools",
    (opts.tools ?? []).join(","),
  ];
  if (opts.disallowedTools && opts.disallowedTools.length > 0) {
    args.push("--disallowed-tools", opts.disallowedTools.join(","));
  }
  if (opts.permissionMode) {
    args.push("--permission-mode", opts.permissionMode);
  }
  if (opts.jsonSchema) {
    args.push("--json-schema", JSON.stringify(opts.jsonSchema));
  }
  if (opts.maxBudgetUsd != null) {
    args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  }

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // プロセスグループを作る (孫プロセスまで殺すため)
    env: scrubEnv(process.env),
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    opts.onStderr?.(chunk);
  });

  // EPIPE 対策: claude が先に落ちた場合に unhandled error でサーバーごと落ちないようにする。
  child.stdin.on("error", () => {});
  child.stdin.end(opts.prompt, "utf8");

  let timedOut = false;
  const killTree = (signal: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // すでに終了している
      }
    }
  };

  const softTimer = setTimeout(() => {
    timedOut = true;
    killTree("SIGTERM");
    setTimeout(() => killTree("SIGKILL"), KILL_GRACE_MS).unref();
  }, opts.timeoutMs);

  const onAbort = () => {
    timedOut = true;
    killTree("SIGTERM");
    setTimeout(() => killTree("SIGKILL"), KILL_GRACE_MS).unref();
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  try {
    const result = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
    [exitCode, exitSignal] = result;
  } catch (e) {
    clearTimeout(softTimer);
    return {
      ok: false,
      costUsd: 0,
      failure: { kind: "spawn", detail: describeSpawnError(e as NodeJS.ErrnoException, opts.cwd) },
    };
  } finally {
    clearTimeout(softTimer);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  if (timedOut) {
    return {
      ok: false,
      costUsd: 0,
      failure: {
        kind: "timeout",
        detail: `timed out after ${opts.timeoutMs}ms (exit=${exitCode} signal=${exitSignal})`,
      },
    };
  }

  let raw: ClaudeCliResult;
  try {
    raw = JSON.parse(stdout.trim()) as ClaudeCliResult;
  } catch {
    return {
      ok: false,
      costUsd: 0,
      failure: {
        kind: "protocol",
        detail: `non-JSON stdout (exit=${exitCode}) stderr=${stderr.slice(0, 500)}`,
        stdout: stdout.slice(0, 2000),
      },
    };
  }

  const costUsd = Number(raw.total_cost_usd ?? 0);

  if (raw.is_error === true) {
    return {
      ok: false,
      costUsd,
      raw,
      failure: {
        kind: "agent",
        subtype: raw.subtype,
        terminalReason: raw.terminal_reason,
        detail: String(raw.result ?? raw.subtype ?? stderr.slice(0, 500)),
      },
    };
  }

  if (opts.jsonSchema && raw.structured_output == null) {
    return {
      ok: false,
      costUsd,
      raw,
      failure: {
        kind: "protocol",
        detail: `structured_output missing (stop_reason=${raw.stop_reason})`,
        stdout: String(raw.result ?? "").slice(0, 2000),
      },
    };
  }

  return {
    ok: true,
    structured: raw.structured_output as T,
    text: String(raw.result ?? ""),
    costUsd,
    raw,
  };
}
