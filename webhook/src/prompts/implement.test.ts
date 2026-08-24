import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImplementPrompt } from "./implement.ts";

const ref = { owner: "o", repo: "r", issueNumber: 42 };

test("buildImplementPrompt: 仕様の参照先が issue ごとのディレクトリになっている", () => {
  const { userPrompt } = buildImplementPrompt(ref, "タイトル");
  assert.match(userPrompt, /\.agent-runner\/issues\/42\/source\/requirements\.md/);
  assert.match(userPrompt, /\.agent-runner\/issues\/42\/generated\/spec\.allium/);
});

test("buildImplementPrompt: 旧レイアウト (.agent-runner/source) を参照しない", () => {
  const { userPrompt } = buildImplementPrompt(ref, "タイトル");
  assert.doesNotMatch(userPrompt, /`\.agent-runner\/source\//);
  assert.doesNotMatch(userPrompt, /`\.agent-runner\/generated\//);
});

test("buildImplementPrompt: 他 issue のディレクトリを触らないよう指示する", () => {
  const { userPrompt } = buildImplementPrompt(ref, "タイトル");
  assert.match(userPrompt, /他の Issue のディレクトリは読む必要も変更する必要もありません/);
});

test("buildImplementPrompt: 仕様ディレクトリの削除・移動を禁じる", () => {
  const { userPrompt } = buildImplementPrompt(ref, "タイトル");
  assert.match(userPrompt, /削除・移動しないでください/);
});

test("buildImplementPrompt: デフォルトワークフロー (ラフ実装優先・コミット分割・レビュー・5W1H) への言及を含む", () => {
  const { userPrompt } = buildImplementPrompt(ref, "タイトル");
  assert.match(userPrompt, /デフォルトワークフロー/);
  assert.match(userPrompt, /ラフな実装/);
  assert.match(userPrompt, /複数コミットに分割/);
  assert.match(userPrompt, /レビューする/);
  assert.match(userPrompt, /5W1H/);
});
