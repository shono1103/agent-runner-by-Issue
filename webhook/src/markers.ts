/**
 * Issue コメントの先頭行に埋め込む不可視マーカー。
 * 見出し文字列 ("## 要件定義" 等) に依存すると人間の書き換えで壊れるため、
 * コメントの用途を判別する手段としてこのマーカーだけを信頼する。
 *
 * 入力側:  <!-- agent-runner:source:requirements ... -->
 * 生成側:  <!-- agent-runner:generated:allium:1/3 ... -->
 *          (N/M は 65,536 文字上限を超えた場合の分割連番。単一なら 1/1)
 */

export const SOURCE_KINDS = ["requirements", "architecture", "tests"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const GENERATED_KINDS = ["allium", "likec4", "superpowers", "investigation"] as const;
export type GeneratedKind = (typeof GENERATED_KINDS)[number];

const PREFIX = "agent-runner";
const KEEP_NOTE = "この行は消さないでください";

export type ParsedSourceMarker = {
  type: "source";
  kind: SourceKind;
};

export type ParsedGeneratedMarker = {
  type: "generated";
  kind: GeneratedKind;
  part: number;
  total: number;
};

export type ParsedMarker = ParsedSourceMarker | ParsedGeneratedMarker;

export function buildSourceMarker(kind: SourceKind): string {
  return `<!-- ${PREFIX}:source:${kind} ${KEEP_NOTE} -->`;
}

export function buildGeneratedMarker(
  kind: GeneratedKind,
  part: number,
  total: number,
): string {
  return `<!-- ${PREFIX}:generated:${kind}:${part}/${total} ${KEEP_NOTE} -->`;
}

const SOURCE_RE = new RegExp(
  `^<!--\\s*${PREFIX}:source:(${SOURCE_KINDS.join("|")})\\b`,
);
const GENERATED_RE = new RegExp(
  `^<!--\\s*${PREFIX}:generated:(${GENERATED_KINDS.join("|")}):(\\d+)/(\\d+)\\b`,
);

/** コメント本文の先頭行を見て、agent-runner のマーカーかどうかを判定する。 */
export function parseMarker(body: string): ParsedMarker | null {
  const firstLine = body.trimStart().split("\n", 1)[0]?.trim() ?? "";

  const sourceMatch = SOURCE_RE.exec(firstLine);
  if (sourceMatch) {
    return { type: "source", kind: sourceMatch[1] as SourceKind };
  }

  const generatedMatch = GENERATED_RE.exec(firstLine);
  if (generatedMatch) {
    return {
      type: "generated",
      kind: generatedMatch[1] as GeneratedKind,
      part: Number(generatedMatch[2]),
      total: Number(generatedMatch[3]),
    };
  }

  return null;
}

/** マーカー行を除いた本文を返す (要件本文の読み取り用)。 */
export function stripMarkerLine(body: string): string {
  const lines = body.split("\n");
  if (lines.length === 0) return body;
  const first = lines[0]?.trimStart() ?? "";
  if (first.startsWith(`<!-- ${PREFIX}:`) || first.startsWith(`<!--${PREFIX}:`)) {
    return lines.slice(1).join("\n").trimStart();
  }
  return body;
}

const SCAFFOLD_HEADINGS: Record<SourceKind, string> = {
  requirements: "## 要件定義",
  architecture: "## システムアーキテクチャ定義",
  tests: "## テスト定義",
};

const SCAFFOLD_PLACEHOLDERS: Record<SourceKind, string> = {
  requirements: "<!-- ここに要件を記入してください -->",
  architecture: "<!-- ここにシステムアーキテクチャを記入してください -->",
  tests: "<!-- ここにテスト方針を記入してください -->",
};

export function buildScaffoldBody(kind: SourceKind): string {
  return [
    buildSourceMarker(kind),
    SCAFFOLD_HEADINGS[kind],
    "",
    SCAFFOLD_PLACEHOLDERS[kind],
    "",
  ].join("\n");
}
