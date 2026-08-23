import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSourceMarker, parseMarker, SOURCE_KINDS } from "./markers.ts";

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
