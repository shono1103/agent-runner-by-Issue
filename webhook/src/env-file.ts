import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/**
 * .env を「ファイルの値が常に勝つ」形で process.env へ反映する。
 *
 * node の `--env-file` は **既に process.env にあるキーを上書きしない**。
 * そのため systemd の `Environment=` / `systemctl --user import-environment`、
 * シェルの `export`、Claude Code セッションからの継承などで古い値が残っていると、
 * `.env` を書き換えて再起動しても前回の値のまま起動してしまう
 * (AGENT_RUNNER_DRY_RUN が典型例。意図せず true のまま = PR が作られない、
 *  あるいは意図せず false のまま = 実際に push してしまう)。
 *
 * 設定の出どころを `.env` 一本に固定するため、`--env-file` は使わず
 * ここで明示的に上書きする。上書きしたキー名は呼び出し側に返して警告に使う。
 */

/** webhook パッケージのルート (src/ の1つ上)。cwd に依存させないため import.meta から求める。 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type EnvFileLoadResult = {
  /** 解決後の絶対パス (ファイルが無かった場合も、探しに行ったパスを返す)。 */
  path: string;
  /** ファイルが存在し読み込めたか。 */
  loaded: boolean;
  /** ファイルの値で上書きしたキー名。値は秘密を含みうるので返さない。 */
  overridden: string[];
};

/**
 * .env のテキストをパースして env へ反映し、上書きが発生したキー名を返す。
 * (fs に触らない純粋部分。テストからはこちらを使う)
 */
export function applyEnvFile(content: string, env: NodeJS.ProcessEnv): string[] {
  const overridden: string[] = [];
  for (const [key, value] of Object.entries(parseEnv(content))) {
    if (typeof value !== "string") continue;
    const existing = env[key];
    if (existing !== undefined && existing !== value) overridden.push(key);
    env[key] = value;
  }
  return overridden;
}

/**
 * env ファイルを読み込んで env へ反映する。
 * 読むファイルは `AGENT_RUNNER_ENV_FILE` (相対パスはパッケージルート基準)、既定は `.env`。
 * 明示指定されたファイルが無ければ例外、既定の `.env` が無いだけなら警告用に loaded:false を返す
 * (systemd の `Environment=` だけで運用する構成を許すため)。
 */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): EnvFileLoadResult {
  const specified = env.AGENT_RUNNER_ENV_FILE?.trim();
  const target = specified || ".env";
  const path = isAbsolute(target) ? target : resolve(PACKAGE_ROOT, target);

  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if (specified) {
      throw new Error(`AGENT_RUNNER_ENV_FILE に指定された ${path} が見つかりません。`);
    }
    return { path, loaded: false, overridden: [] };
  }

  return { path, loaded: true, overridden: applyEnvFile(content, env) };
}
