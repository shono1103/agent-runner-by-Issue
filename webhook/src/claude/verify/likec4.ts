import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliJson } from "./run-cli.ts";

export type LikeC4Error = {
  message: string;
  file: string;
  line: number;
};

export type LikeC4ValidateResult =
  | { ok: true }
  | { ok: false; errors: LikeC4Error[]; raw: string };

/**
 * `likec4 validate --json --no-layout <dir>` は終了コードが信頼できる
 * (正常 exit=0 / エラー exit=1) うえ、JSON に valid: true|false を返す。
 * ただし引数はファイルではなくディレクトリを渡す必要があるため、
 * 生成した .c4 ファイルを専用の一時ディレクトリに書き出してから検証する。
 */
export async function validateLikeC4(source: string): Promise<LikeC4ValidateResult> {
  const dir = await mkdtemp(join(tmpdir(), "agent-runner-likec4-"));
  try {
    await writeFile(join(dir, "model.c4"), source, "utf8");
    const result = await runCliJson("likec4", ["validate", "--json", "--no-layout", dir]);

    let parsed: { valid?: boolean; errors?: LikeC4Error[] } | null = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      // likec4 コマンド自体が見つからない等。stderr を raw として返す。
      return {
        ok: false,
        errors: [],
        raw: result.stderr || result.stdout || "likec4 validate produced no output",
      };
    }

    if (parsed?.valid === true) return { ok: true };
    return {
      ok: false,
      errors: parsed?.errors ?? [],
      raw: result.stdout,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
