export type ResolveConflictPrompt = {
  systemPrompt: string;
  userPrompt: string;
};

/**
 * コンフリクトマーカー (`<<<<<<<`/`=======`/`>>>>>>>`) を含む1ファイルの内容から、
 * 「main の変更意図」と「PR ブランチの変更意図」の両方を汲んだ統合済みの内容を
 * 生成させるプロンプトを組み立てる。構造化出力のみを返させ、Write/Edit/Bash は渡さない
 * 前提 (ファイルへの書き込みは呼び出し側のジョブが行う)。
 */
export function buildResolveConflictPrompt(
  filePath: string,
  conflictedContent: string,
): ResolveConflictPrompt {
  const systemPrompt = [
    "あなたは git のマージコンフリクトを解決するエージェントです。",
    "渡されたファイルには `<<<<<<<`/`=======`/`>>>>>>>` のコンフリクトマーカーが含まれています。",
    "`<<<<<<< HEAD` から `=======` までが PR ブランチ側の変更、",
    "`=======` から `>>>>>>>` までが main 側の変更です。",
    "両方の変更意図を汲み取り、両方が活きる形で統合的に解決してください。",
    "単純に `--ours`/`--theirs` のようにどちらか一方だけを採用する解決はしないでください。",
    "意味的に両立不可能で安全に統合できないと判断した場合は、無理に確定させず " +
      "`unresolvable` を true にしてください。",
    "ファイルの編集・実行は行わず、会話や補足説明も書かず、指定された JSON スキーマの" +
      "構造化出力だけを返してください。",
  ].join("\n");

  const userPrompt = [
    `# コンフリクトファイル: ${filePath}`,
    "",
    "以下はこのファイルの現在の内容です (コンフリクトマーカーを含みます)。",
    "",
    "```",
    conflictedContent,
    "```",
    "",
    "解決できた場合は、コンフリクトマーカーを一切含まない、統合済みのファイル内容全体を",
    "`resolvedContent` に入れ、`unresolvable` を `false` にして返してください " +
      "(ファイルの一部ではなく全体を返すことに注意してください)。",
    "解決できない場合は `unresolvable` を `true` にし、理由を `reason` に書いてください",
    "(この場合 `resolvedContent` は空文字で構いません)。",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export const RESOLVE_CONFLICT_JSON_SCHEMA = {
  type: "object",
  properties: {
    resolvedContent: {
      type: "string",
      description:
        "コンフリクトマーカーを除去した、統合済みのファイル内容全体。" +
        "unresolvable=true の場合は空文字で可",
    },
    unresolvable: {
      type: "boolean",
      description: "意味的に両立不可能で自動解決できない場合は true",
    },
    reason: {
      type: "string",
      description: "unresolvable=true の場合の理由。解決できた場合は空文字で可",
    },
  },
  required: ["resolvedContent", "unresolvable", "reason"],
  additionalProperties: false,
} as const;

export type ResolveConflictStructuredOutput = {
  resolvedContent: string;
  unresolvable: boolean;
  reason: string;
};
