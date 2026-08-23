import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGeneratedMarker, parseMarker } from "./markers.ts";

test("buildGeneratedMarker: clarify kind のマーカー文字列を生成できる", () => {
  const marker = buildGeneratedMarker("clarify", 1, 1);
  assert.equal(marker, "<!-- agent-runner:generated:clarify:1/1 この行は消さないでください -->");
});

test("parseMarker: clarify kind のマーカー文字列を正しくパースできる", () => {
  const marker = buildGeneratedMarker("clarify", 1, 1);
  const parsed = parseMarker(marker);
  assert.deepEqual(parsed, { type: "generated", kind: "clarify", part: 1, total: 1 });
});
