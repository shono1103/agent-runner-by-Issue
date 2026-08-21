import type { IssueRef } from "../types/api.ts";

export type ImplementPrompt = {
  systemPrompt: string;
  userPrompt: string;
};

/**
 * PR 作成ジョブで claude に実装させるプロンプト。
 * 仕様そのものは埋め込まず、clone 内の .agent-runner/ を読ませる (親プロセスが書き出す)。
 */
export function buildImplementPrompt(ref: IssueRef, issueTitle: string): ImplementPrompt {
  const systemPrompt = [
    "あなたはこのリポジトリの clone 上で、GitHub Issue の内容を実装するエージェントです。",
    "作業ディレクトリ (カレントディレクトリ) の外は読み書きできません。それ以外の場所にアクセスしようとしないでください。",
    "git の push・remote の変更・GitHub CLI (gh) の操作は行わないでください (それらは別プロセスが行います)。",
    ".github/workflows/ 配下のファイルは変更しないでください。",
    "外部ネットワークへのアクセス (WebFetch/WebSearch 相当) は行わないでください。",
  ].join("\n");

  const userPrompt = [
    `# Issue #${ref.issueNumber}: ${issueTitle}`,
    "",
    "このリポジトリの `.agent-runner/` ディレクトリに、GitHub Issue 上でやり取りされた仕様が",
    "置かれています。`source/` が人間が書いた原文、`generated/` が claude cli による",
    "変換結果です (変換を経ていない項目は無いことがあります)。",
    "",
    "- `.agent-runner/source/requirements.md` — 要件定義 (原文)",
    "- `.agent-runner/source/architecture.md` — システムアーキテクチャ定義 (原文)",
    "- `.agent-runner/source/tests.md` — テスト定義 (原文)",
    "- `.agent-runner/generated/design.md` — 要件定義+テスト定義を Superpowers design doc 形式に変換したもの (あれば)",
    "- `.agent-runner/generated/architecture.c4` — システムアーキテクチャ定義を LikeC4 に変換したもの (あれば)",
    "- `.agent-runner/generated/spec.allium` — 要件定義+テスト定義の振る舞いの形式仕様 (あれば)。",
    "  各 `rule` の `ensures` が実装すべき挙動、`transitions` が状態遷移を表す",
    "",
    "まずこれらすべてを読んでください。`generated/` にあるものは `source/` より構造化されているので優先して読み、",
    "`source/` は文脈確認や `generated/` に無い項目の補完に使ってください。",
    "",
    "その上で、Superpowers の TDD 規律に従って実装してください:",
    "各振る舞いについて、まず失敗するテストを書き、失敗を確認してから最小実装を行い、",
    "テストが通ることを確認する、を繰り返してください。`spec.allium` に `rule` があれば、",
    "その成功ケースと各 `requires` の失敗ケースの両方をテストしてください。",
    "",
    "実装が終わったら、変更はワーキングツリーに残したまま終了してください",
    "(commit は行わないでください。別プロセスが差分を検査してから commit します)。",
    "`.agent-runner/` ディレクトリ自体は削除・移動しないでください。",
  ].join("\n");

  return { systemPrompt, userPrompt };
}
