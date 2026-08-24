import type { IssueRef } from "../types/api.ts";
import { specDirFor } from "../spec-dir.ts";

export type ImplementPrompt = {
  systemPrompt: string;
  userPrompt: string;
};

/**
 * PR 作成ジョブで claude に実装させるプロンプト。
 * 仕様そのものは埋め込まず、clone 内の issue ごとの仕様ディレクトリを読ませる
 * (親プロセスが書き出す)。
 */
export function buildImplementPrompt(ref: IssueRef, issueTitle: string): ImplementPrompt {
  const systemPrompt = [
    "あなたはこのリポジトリの clone 上で、GitHub Issue の内容を実装するエージェントです。",
    "作業ディレクトリ (カレントディレクトリ) の外は読み書きできません。それ以外の場所にアクセスしようとしないでください。",
    "git の push・remote の変更・GitHub CLI (gh) の操作は行わないでください (それらは別プロセスが行います)。",
    ".github/workflows/ 配下のファイルは変更しないでください。",
    "外部ネットワークへのアクセス (WebFetch/WebSearch 相当) は行わないでください。",
  ].join("\n");

  const specDir = specDirFor(ref.issueNumber);

  const userPrompt = [
    `# Issue #${ref.issueNumber}: ${issueTitle}`,
    "",
    `このリポジトリの \`${specDir}/\` ディレクトリに、この Issue 上でやり取りされた仕様が`,
    "置かれています。`source/` が人間が書いた原文、`generated/` が claude cli による",
    "変換結果です (変換を経ていない項目は無いことがあります)。",
    "",
    `- \`${specDir}/source/requirements.md\` — 要件定義 (原文)`,
    `- \`${specDir}/source/architecture.md\` — システムアーキテクチャ定義 (原文)`,
    `- \`${specDir}/source/tests.md\` — テスト定義 (原文)`,
    `- \`${specDir}/generated/design.md\` — 要件定義+テスト定義を Superpowers design doc 形式に変換したもの (あれば)`,
    `- \`${specDir}/generated/architecture.c4\` — システムアーキテクチャ定義を LikeC4 に変換したもの (あれば)`,
    `- \`${specDir}/generated/spec.allium\` — 要件定義+テスト定義の振る舞いの形式仕様 (あれば)。`,
    "  各 `rule` の `ensures` が実装すべき挙動、`transitions` が状態遷移を表す",
    "",
    "まずこれらすべてを読んでください。`generated/` にあるものは `source/` より構造化されているので優先して読み、",
    "`source/` は文脈確認や `generated/` に無い項目の補完に使ってください。",
    "",
    "`.agent-runner/issues/` の下には他の Issue の仕様も置かれていますが、実装対象は",
    `この Issue (#${ref.issueNumber}) のものだけです。他の Issue のディレクトリは読む必要も変更する必要もありません。`,
    "",
    "その上で、Superpowers の TDD 規律に従って実装してください:",
    "各振る舞いについて、まず失敗するテストを書き、失敗を確認してから最小実装を行い、",
    "テストが通ることを確認する、を繰り返してください。`spec.allium` に `rule` があれば、",
    "その成功ケースと各 `requires` の失敗ケースの両方をテストしてください。",
    "",
    "このPR作成ジョブは、以下の「デフォルトワークフロー」に従って進みます:",
    "1. (ここ) まず要件定義+テストがひとまず通るラフな実装を行う",
    "2. 差分を意味のある単位の複数コミットに分割する (別プロセスが行います)",
    "3. CI通過を確認する (別プロセスが行います)",
    "4. コミットごとにレビューする (別プロセスが行います)",
    "5. ブランチdiff全体をレビューする (別プロセスが行います)",
    "6. レビューで見つかった懸念をPRの指摘コメントに残す (別プロセスが行います)",
    "各コミットメッセージには Who/What/When/Where/Why/How の5W1Hの要素が含まれるよう、",
    "別プロセスが構成します。あなたが担当するのは上記のうち 1. だけです。",
    "",
    "実装が終わったら、変更はワーキングツリーに残したまま終了してください",
    "(commit は行わないでください。別プロセスが差分を検査してから commit します)。",
    `\`${specDir}/\` をはじめ \`.agent-runner/\` 配下は削除・移動しないでください。`,
  ].join("\n");

  return { systemPrompt, userPrompt };
}
