import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * PATH から実行可能なコマンドを探す。見つからなければ null。
 *
 * `spawn("claude", ...)` のように名前でコマンドを起動すると、解決に使われるのは
 * **子プロセスに渡す env の PATH** であって、親プロセスの PATH ではない
 * (実測で確認済み)。systemd の `Environment=PATH=` に claude のディレクトリが
 * 入っていないと、対話シェルからは動くのにサービスからだけ ENOENT になる。
 * 起動時にそれを検出するために使う。
 */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const rawPath = env.PATH;
  if (!rawPath) return null;

  for (const dir of rawPath.split(delimiter)) {
    if (!dir) continue; // PATH の空要素 ("a::b" や先頭/末尾の ":") は無視する
    const candidate = join(dir, name);
    try {
      // symlink 越しでも実体を見る (claude は ~/.local/bin から versions/ への symlink)。
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}
