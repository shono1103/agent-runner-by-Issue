import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { findExecutable } from "./which.ts";

function makeBin(dir: string, name: string, mode: number): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\nexit 0\n");
  chmodSync(p, mode);
  return p;
}

test("PATH 上の実行可能ファイルを見つける", () => {
  const root = mkdtempSync(join(tmpdir(), "which-"));
  const bin = makeBin(join(root, "bin"), "fakecmd", 0o755);
  assert.equal(findExecutable("fakecmd", { PATH: join(root, "bin") }), bin);
});

test("PATH に無ければ null", () => {
  const root = mkdtempSync(join(tmpdir(), "which-"));
  makeBin(join(root, "bin"), "fakecmd", 0o755);
  assert.equal(findExecutable("othercmd", { PATH: join(root, "bin") }), null);
});

test("実行ビットが立っていなければ見つけない", () => {
  const root = mkdtempSync(join(tmpdir(), "which-"));
  makeBin(join(root, "bin"), "fakecmd", 0o644);
  assert.equal(findExecutable("fakecmd", { PATH: join(root, "bin") }), null);
});

test("PATH の空要素を飛ばして後続のディレクトリを探す", () => {
  const root = mkdtempSync(join(tmpdir(), "which-"));
  const bin = makeBin(join(root, "bin"), "fakecmd", 0o755);
  const path = ["", join(root, "empty"), join(root, "bin")].join(delimiter);
  assert.equal(findExecutable("fakecmd", { PATH: path }), bin);
});

test("先に見つかったディレクトリを優先する", () => {
  const root = mkdtempSync(join(tmpdir(), "which-"));
  const first = makeBin(join(root, "a"), "fakecmd", 0o755);
  makeBin(join(root, "b"), "fakecmd", 0o755);
  const path = [join(root, "a"), join(root, "b")].join(delimiter);
  assert.equal(findExecutable("fakecmd", { PATH: path }), first);
});

test("PATH 自体が無ければ null (systemd で Environment=PATH を書き忘れた場合)", () => {
  assert.equal(findExecutable("fakecmd", {}), null);
});

test("同名のディレクトリは実行可能ファイルとみなさない", () => {
  const root = mkdtempSync(join(tmpdir(), "which-"));
  mkdirSync(join(root, "bin", "fakecmd"), { recursive: true });
  assert.equal(findExecutable("fakecmd", { PATH: join(root, "bin") }), null);
});
