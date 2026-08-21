import type { IssueRef } from "./types/api.ts";

type LockKey = string;

/**
 * Issue単位 + リポジトリ単位のジョブロック。
 *
 * 変換ジョブは Issue 単位のみで十分だが、PR 作成ジョブは同じリポジトリの
 * 別 Issue から同時に走ると git push が競合するため、リポジトリ単位でも排他する。
 */
export class JobLocks {
  private held = new Map<LockKey, string>();

  private issueKey(ref: IssueRef): LockKey {
    return `issue:${ref.owner}/${ref.repo}#${ref.issueNumber}`;
  }

  private repoKey(ref: IssueRef): LockKey {
    return `repo:${ref.owner}/${ref.repo}`;
  }

  private keysFor(ref: IssueRef, includeRepo: boolean): LockKey[] {
    return includeRepo ? [this.issueKey(ref), this.repoKey(ref)] : [this.issueKey(ref)];
  }

  /** ロックが取れれば true。取れなければ false (呼び出し側は holderOf で既存 jobId を返す)。 */
  acquire(ref: IssueRef, jobId: string, includeRepo: boolean): boolean {
    const keys = this.keysFor(ref, includeRepo);
    const conflict = keys.find((k) => this.held.has(k));
    if (conflict) return false;
    for (const k of keys) this.held.set(k, jobId);
    return true;
  }

  release(ref: IssueRef, includeRepo: boolean): void {
    for (const k of this.keysFor(ref, includeRepo)) this.held.delete(k);
  }

  holderOf(ref: IssueRef, includeRepo: boolean): string | null {
    for (const k of this.keysFor(ref, includeRepo)) {
      const holder = this.held.get(k);
      if (holder) return holder;
    }
    return null;
  }
}

export const jobLocks = new JobLocks();
