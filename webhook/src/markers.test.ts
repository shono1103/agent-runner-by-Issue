import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGeneratedMarker,
  buildSourceMarker,
  parseMarker,
  SOURCE_KINDS,
} from "./markers.ts";

test("buildGeneratedMarker: investigation kind の 1/1 マーカーを生成する", () => {
  const marker = buildGeneratedMarker("investigation", 1, 1);
  assert.match(marker, /^<!-- agent-runner:generated:investigation:1\/1 .*-->$/);
});

test("parseMarker: investigation マーカーを generated/investigation/1/1 としてパースできる", () => {
  const marker = buildGeneratedMarker("investigation", 1, 1);
  const parsed = parseMarker(`${marker}\n\n本文`);
  assert.deepEqual(parsed, { type: "generated", kind: "investigation", part: 1, total: 1 });
});

test("buildGeneratedMarker: clarify kind のマーカー文字列を生成できる", () => {
  const marker = buildGeneratedMarker("clarify", 1, 1);
  assert.equal(marker, "<!-- agent-runner:generated:clarify:1/1 この行は消さないでください -->");
});

test("parseMarker: clarify kind のマーカー文字列を正しくパースできる", () => {
  const marker = buildGeneratedMarker("clarify", 1, 1);
  const parsed = parseMarker(marker);
  assert.deepEqual(parsed, { type: "generated", kind: "clarify", part: 1, total: 1 });
});

test("buildSourceMarker: draft ジョブが投稿するコメント本文の先頭行として想定される形式を生成する", () => {
  for (const kind of SOURCE_KINDS) {
    const marker = buildSourceMarker(kind);
    assert.equal(marker, `<!-- agent-runner:source:${kind} この行は消さないでください -->`);
  }
});

test("parseMarker: buildSourceMarker(kind) の出力を渡すと { type: 'source', kind } を返す", () => {
  for (const kind of SOURCE_KINDS) {
    const body = `${buildSourceMarker(kind)}\n\n## 本文\n\nダミー`;
    assert.deepEqual(parseMarker(body), { type: "source", kind });
  }
});
