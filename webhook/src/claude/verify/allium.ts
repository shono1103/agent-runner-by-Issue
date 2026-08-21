import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliJson } from "./run-cli.ts";

export type AlliumDiagnostic = {
  code: string | null;
  severity: "error" | "warning" | "info";
  message: string;
  location: { file: string; line: number; col: number };
};

export type AlliumCheckResult = {
  ok: boolean;
  diagnostics: AlliumDiagnostic[];
  raw: string;
};

async function withAlliumFile<T>(
  source: string,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "agent-runner-allium-"));
  try {
    const file = join(dir, "spec.allium");
    await writeFile(file, source, "utf8");
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * `allium check` は警告のみの正常な spec でも exit=1 を返し、構文エラーでも exit=1
 * になる。終了コードでは合否を判定できないため、stdout の JSON を必ずパースし、
 * diagnostics[].severity === "error" の有無で判定する。
 */
export async function checkAllium(source: string): Promise<AlliumCheckResult> {
  return withAlliumFile(source, async (file) => {
    const result = await runCliJson("allium", ["check", file]);
    let parsed: { diagnostics?: AlliumDiagnostic[] } | null = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return {
        ok: false,
        diagnostics: [],
        raw: result.stderr || result.stdout || "allium check produced no output",
      };
    }
    const diagnostics = parsed?.diagnostics ?? [];
    const ok = !diagnostics.some((d) => d.severity === "error");
    return { ok, diagnostics, raw: result.stdout };
  });
}

export type AlliumObligation = {
  id: string;
  category: string;
  description: string;
  detail: unknown;
};

export type AlliumPlanResult =
  | { ok: true; obligations: AlliumObligation[] }
  | { ok: false; diagnostics: AlliumDiagnostic[]; raw: string };

/** `allium plan` は仕様からテスト義務を構造化データ (obligations[]) として導出する。 */
export async function planAllium(source: string): Promise<AlliumPlanResult> {
  return withAlliumFile(source, async (file) => {
    const result = await runCliJson("allium", ["plan", file]);
    let parsed: { obligations?: AlliumObligation[]; diagnostics?: AlliumDiagnostic[] } | null =
      null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return {
        ok: false,
        diagnostics: [],
        raw: result.stderr || result.stdout || "allium plan produced no output",
      };
    }
    const diagnostics = parsed?.diagnostics ?? [];
    if (diagnostics.some((d) => d.severity === "error")) {
      return { ok: false, diagnostics, raw: result.stdout };
    }
    return { ok: true, obligations: parsed?.obligations ?? [] };
  });
}
