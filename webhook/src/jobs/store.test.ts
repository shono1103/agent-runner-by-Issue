import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobKind } from "../types/api.ts";
import { jobStore } from "./store.ts";

test("jobStore.create: resolve-conflicts を含む全ての JobKind でジョブを作成できる", () => {
  const kinds: JobKind[] = ["convert", "create-pr", "resolve-conflicts"];

  for (const kind of kinds) {
    const job = jobStore.create(kind);
    assert.equal(job.kind, kind);
    assert.equal(job.status, "queued");
    const fetched = jobStore.get(job.id);
    assert.equal(fetched?.kind, kind);
  }
});
