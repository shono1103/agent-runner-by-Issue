import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrIssueStatus } from "./pr-panel.ts";

// mountPrPanel() は本物の document を直接操作するため、location.test.ts の
// withFakeDocument と同様、テストに必要な最小限の要素だけを実装した簡易フェイクDOMを
// globalThis.document に差し込んで検証する (jsdom 等は導入しない)。

type FakeElement = {
  tag: string;
  id: string;
  className: string;
  textContent: string;
  style: { cssText: string; [key: string]: string };
  disabled?: boolean;
  type?: string;
  children: FakeElement[];
  append(...nodes: FakeElement[]): void;
  addEventListener(eventType: string, cb: () => void): void;
  attachShadow(init: { mode: "open" }): { append(...nodes: FakeElement[]): void };
};

function createFakeElement(tag: string): FakeElement {
  const children: FakeElement[] = [];
  const el: FakeElement = {
    tag,
    id: "",
    className: "",
    textContent: "",
    style: { cssText: "" },
    children,
    append(...nodes) {
      children.push(...nodes);
    },
    addEventListener() {
      // クリックはテストしないため、登録するだけで何もしない。
    },
    attachShadow() {
      const shadowChildren: FakeElement[] = [];
      return {
        append: (...nodes: FakeElement[]) => shadowChildren.push(...nodes),
      };
    },
  };
  return el;
}

async function withFakeGlobalDocument<T>(
  fn: (bodyAppended: FakeElement[]) => Promise<T> | T,
): Promise<T> {
  const bodyAppended: FakeElement[] = [];
  const fakeDocument = {
    createElement: (tag: string) => createFakeElement(tag),
    body: {
      append: (...nodes: FakeElement[]) => bodyAppended.push(...nodes),
    },
  };

  const g = globalThis as Record<string, unknown>;
  const hadOwn = Object.hasOwn(g, "document");
  const original = g.document;
  g.document = fakeDocument;
  try {
    return await fn(bodyAppended);
  } finally {
    if (hadOwn) g.document = original;
    else delete g.document;
  }
}

function resolveConflictsShouldNotBeCalled() {
  return async () => {
    throw new Error("resolveConflicts は呼ばれてはいけません");
  };
}

test("shouldShowPrPanel: issueNumberがあり mergeable:false のとき true", async () => {
  const { shouldShowPrPanel } = await import("./pr-panel.ts");
  const status: PrIssueStatus = { issueNumber: 5, mergeable: false };
  assert.equal(shouldShowPrPanel(status), true);
});

test("shouldShowPrPanel: issueNumberがnullのとき false", async () => {
  const { shouldShowPrPanel } = await import("./pr-panel.ts");
  const status: PrIssueStatus = { issueNumber: null };
  assert.equal(shouldShowPrPanel(status), false);
});

test("shouldShowPrPanel: issueNumberがあり mergeable:true のとき false", async () => {
  const { shouldShowPrPanel } = await import("./pr-panel.ts");
  const status: PrIssueStatus = { issueNumber: 5, mergeable: true };
  assert.equal(shouldShowPrPanel(status), false);
});

test("shouldShowPrPanel: issueNumberがあり mergeableがnull (計算中) のとき false", async () => {
  const { shouldShowPrPanel } = await import("./pr-panel.ts");
  const status: PrIssueStatus = { issueNumber: 5, mergeable: null };
  assert.equal(shouldShowPrPanel(status), false);
});

test("mountPrPanel: issueNumber!==null かつ mergeable===false のとき、コンフリクト解決ボタンを含むパネルがマウントされる", async () => {
  await withFakeGlobalDocument(async (bodyAppended) => {
    const { mountPrPanel, PR_PANEL_ID } = await import("./pr-panel.ts");

    await mountPrPanel(
      { owner: "o", repo: "r", prNumber: 10 },
      {
        getIssueForPr: async () => ({ issueNumber: 5, mergeable: false }),
        resolveConflicts: resolveConflictsShouldNotBeCalled(),
      },
    );

    assert.equal(bodyAppended.length, 1);
    assert.equal(bodyAppended[0]?.id, PR_PANEL_ID);
  });
});

test("mountPrPanel: issueNumberがnullのとき、何もマウントされない", async () => {
  await withFakeGlobalDocument(async (bodyAppended) => {
    const { mountPrPanel } = await import("./pr-panel.ts");

    await mountPrPanel(
      { owner: "o", repo: "r", prNumber: 10 },
      {
        getIssueForPr: async () => ({ issueNumber: null }),
        resolveConflicts: resolveConflictsShouldNotBeCalled(),
      },
    );

    assert.equal(bodyAppended.length, 0);
  });
});

test("mountPrPanel: mergeableがtrueのとき、何もマウントされない", async () => {
  await withFakeGlobalDocument(async (bodyAppended) => {
    const { mountPrPanel } = await import("./pr-panel.ts");

    await mountPrPanel(
      { owner: "o", repo: "r", prNumber: 10 },
      {
        getIssueForPr: async () => ({ issueNumber: 5, mergeable: true }),
        resolveConflicts: resolveConflictsShouldNotBeCalled(),
      },
    );

    assert.equal(bodyAppended.length, 0);
  });
});

test("mountPrPanel: getIssueForPrが失敗したとき、何もマウントされない", async () => {
  await withFakeGlobalDocument(async (bodyAppended) => {
    const { mountPrPanel } = await import("./pr-panel.ts");

    await mountPrPanel(
      { owner: "o", repo: "r", prNumber: 10 },
      {
        getIssueForPr: async () => {
          throw new Error("webhookに接続できません");
        },
        resolveConflicts: resolveConflictsShouldNotBeCalled(),
      },
    );

    assert.equal(bodyAppended.length, 0);
  });
});
