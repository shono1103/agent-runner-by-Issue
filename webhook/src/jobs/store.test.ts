import assert from "node:assert/strict";
import { test } from "node:test";
import type { IssueRef, JobKind } from "../types/api.ts";
import { JobStore, type JobSink } from "./store.ts";

const REF: IssueRef = { owner: "shono1103", repo: "agent-runner-by-Issue", issueNumber: 45 };

/** 出力を捨てずに拾い、テストの標準出力も汚さないための sink。 */
function capturingStore(): { store: JobStore; info: string[]; error: string[] } {
  const info: string[] = [];
  const error: string[] = [];
  const sink: JobSink = { info: (l) => info.push(l), error: (l) => error.push(l) };
  return { store: new JobStore(sink), info, error };
}

/** noUncheckedIndexedAccess のため、行の存在を確かめてから返す。 */
function line(lines: string[], i: number): string {
  const l = lines[i];
  assert.ok(l !== undefined, `${i} 行目が無い (実際: ${lines.length} 行)`);
  return l;
}

test("create: resolve-conflicts を含む全ての JobKind でジョブを作成できる", () => {
  const { store } = capturingStore();
  const kinds: JobKind[] = ["convert", "create-pr", "resolve-conflicts"];

  for (const kind of kinds) {
    const job = store.create(kind);
    assert.equal(job.kind, kind);
    assert.equal(job.status, "queued");
    const fetched = store.get(job.id);
    assert.equal(fetched?.kind, kind);
  }
});

test("create: 開始をログに出す (finish に到達しないジョブも痕跡が残るように)", () => {
  const { store, info } = capturingStore();
  const job = store.create("create-pr", REF);

  assert.equal(info.length, 1);
  assert.match(line(info, 0), /create-pr/);
  assert.match(line(info, 0), /shono1103\/agent-runner-by-Issue#45/);
  assert.match(line(info, 0), new RegExp(`id=${job.id}`));
});

test("finish(failed): エラー内容をログに出す", () => {
  const { store, error } = capturingStore();
  const job = store.create("create-pr", REF);
  store.setPhase(job.id, "claude 実行中");
  store.addCost(job.id, 1.25);
  store.finish(job.id, "failed", { error: "claude cli 失敗 (spawn): spawn claude ENOENT" });

  assert.equal(error.length, 1);
  assert.match(line(error, 0), /failed/);
  assert.match(line(error, 0), /phase=claude 実行中/);
  assert.match(line(error, 0), /\$1\.2500/);
  assert.match(line(error, 0), /spawn claude ENOENT/);
});

test("finish(failed): 診断のためにジョブ内ログの末尾を添える", () => {
  const { store, error } = capturingStore();
  const job = store.create("convert", REF);
  for (let i = 1; i <= 8; i++) store.appendLog(job.id, `行${i}`);
  store.finish(job.id, "failed", { error: "失敗" });

  // 1行目が見出し、以降が logs の末尾5行。
  assert.equal(error.length, 6);
  assert.deepEqual(
    error.slice(1),
    ["行4", "行5", "行6", "行7", "行8"].map((l) => `       | ${l}`),
  );
});

test("finish(failed): error が無くても黙らない", () => {
  const { store, error } = capturingStore();
  const job = store.create("draft", REF);
  store.finish(job.id, "failed");

  assert.equal(error.length, 1);
  assert.match(line(error, 0), /エラー内容なし/);
});

test("finish(succeeded): 1行だけ出す (ジョブ内ログは添えない)", () => {
  const { store, info, error } = capturingStore();
  const job = store.create("investigate", REF);
  store.appendLog(job.id, "何か");
  store.finish(job.id, "succeeded");

  assert.equal(error.length, 0);
  assert.equal(info.length, 2); // started + succeeded
  assert.match(line(info, 1), /succeeded/);
});

test("ref が無くてもログは出る", () => {
  const { store, info } = capturingStore();
  store.create("convert");
  assert.match(line(info, 0), /\(ref なし\)/);
});

test("ref は API 応答用の型には持ち込まず、Job にだけ保持する", () => {
  const { store } = capturingStore();
  const job = store.create("clarify", REF);
  assert.deepEqual(job.ref, REF);
});
