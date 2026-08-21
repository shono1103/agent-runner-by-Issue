import type { IssueComment } from "./github.ts";
import { parseMarker, stripMarkerLine, type SourceKind } from "./markers.ts";

export type Sections = Partial<Record<SourceKind, string>>;

/**
 * 信頼済みコメント (filterTrustedComments 済み) から3つのソースセクションを取り出す。
 * 同じ kind のコメントが複数あった場合は最後のもの (コメントIDが最大) を採用する。
 */
export function extractSections(comments: IssueComment[]): Sections {
  const sections: Sections = {};
  for (const comment of comments) {
    const marker = parseMarker(comment.body);
    if (marker?.type !== "source") continue;
    sections[marker.kind] = stripMarkerLine(comment.body).trim();
  }
  return sections;
}

export function requireSections(
  sections: Sections,
  kinds: SourceKind[],
): { ok: true; values: Record<SourceKind, string> } | { ok: false; missing: SourceKind[] } {
  const missing = kinds.filter((k) => !sections[k] || sections[k]!.trim().length === 0);
  if (missing.length > 0) return { ok: false, missing };
  const values = {} as Record<SourceKind, string>;
  for (const k of kinds) values[k] = sections[k]!;
  return { ok: true, values };
}
