import assert from "node:assert/strict";
import { test } from "node:test";
import { JobLocks } from "./locks.ts";
import type { IssueRef } from "./types/api.ts";

const ISSUE_1: IssueRef = { owner: "o", repo: "r", issueNumber: 1 };
const ISSUE_2: IssueRef = { owner: "o", repo: "r", issueNumber: 2 };
const OTHER_REPO: IssueRef = { owner: "o", repo: "other", issueNumber: 1 };

test("acquire したら holderOf が jobId を返し、release で消える", () => {
  const locks = new JobLocks();
  assert.equal(locks.holderOf(ISSUE_1, false), null);

  assert.equal(locks.acquire(ISSUE_1, "job-a", false), true);
  assert.equal(locks.holderOf(ISSUE_1, false), "job-a");

  locks.release(ISSUE_1, false);
  assert.equal(locks.holderOf(ISSUE_1, false), null);
});

test("同じ Issue の2つ目は取れない", () => {
  const locks = new JobLocks();
  locks.acquire(ISSUE_1, "job-a", false);
  assert.equal(locks.acquire(ISSUE_1, "job-b", false), false);
  assert.equal(locks.holderOf(ISSUE_1, false), "job-a");
});

test("repo ロックは同じリポジトリの別 Issue を弾く (push が競合するため)", () => {
  const locks = new JobLocks();
  locks.acquire(ISSUE_1, "job-a", true);
  assert.equal(locks.acquire(ISSUE_2, "job-b", true), false);
  assert.equal(locks.acquire(OTHER_REPO, "job-c", true), true);
});

test("issue ロックだけなら同じリポジトリの別 Issue は取れる", () => {
  const locks = new JobLocks();
  locks.acquire(ISSUE_1, "job-a", false);
  assert.equal(locks.acquire(ISSUE_2, "job-b", false), true);
});

/**
 * routes/jobs.ts は「ジョブを作る前に holderOf で弾く」形にしている (#48)。
 * これが acquire の失敗判定と同値でないと、409 を返すべき場面で通してしまう。
 */
test("holderOf が null であることと acquire が成功することは同値", () => {
  const cases: Array<{ setup: (l: JobLocks) => void; ref: IssueRef; repoLock: boolean }> = [
    { setup: () => {}, ref: ISSUE_1, repoLock: false },
    { setup: () => {}, ref: ISSUE_1, repoLock: true },
    { setup: (l) => l.acquire(ISSUE_1, "held", false), ref: ISSUE_1, repoLock: false },
    { setup: (l) => l.acquire(ISSUE_1, "held", false), ref: ISSUE_1, repoLock: true },
    { setup: (l) => l.acquire(ISSUE_1, "held", true), ref: ISSUE_2, repoLock: true },
    { setup: (l) => l.acquire(ISSUE_1, "held", true), ref: ISSUE_2, repoLock: false },
    { setup: (l) => l.acquire(ISSUE_1, "held", true), ref: OTHER_REPO, repoLock: true },
  ];

  for (const [i, { setup, ref, repoLock }] of cases.entries()) {
    const locks = new JobLocks();
    setup(locks);
    const free = locks.holderOf(ref, repoLock) === null;
    const acquired = locks.acquire(ref, "new-job", repoLock);
    assert.equal(free, acquired, `ケース ${i}: holderOf=${!free} なのに acquire=${acquired}`);
  }
});
