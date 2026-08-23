/**
 * issue ごとの仕様ディレクトリ (リポジトリルートからの相対パス)。
 *
 * 以前は `.agent-runner/source` / `.agent-runner/generated` 固定で、create-pr ジョブが
 * 実行のたびに同じ6ファイルを丸ごと上書きしていた。そのため
 *
 * - 別々の issue のPRが必ず同じファイルで衝突する (実装が無関係でもコンフリクトする)
 * - 先にマージされた issue の仕様が、後の create-pr で消える
 *
 * という2つの問題があった。issue 番号で分けることで衝突が構造的に発生しなくなり、
 * 過去の issue の仕様もリポジトリに残る。
 */
export function specDirFor(issueNumber: number): string {
  return `.agent-runner/issues/${issueNumber}`;
}
