import assert from "node:assert/strict";
import { test } from "node:test";

// isSubIssueOverlayOpen() は document.querySelector のみに依存する。
// jsdom 等を導入せず、テストに必要な最小限の要素マッチングだけを行う
// 簡易フェイクDOMを globalThis.document に差し込んで検証する。

type FakeElement = { tag: string; attrs: Record<string, string> };

function matchesSelector(selector: string, el: FakeElement): boolean {
  const trimmed = selector.trim();
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(trimmed);
  const tag = tagMatch ? tagMatch[0] : null;
  if (tag && el.tag !== tag) return false;

  const attrRe = /\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g;
  let m: RegExpExecArray | null;
  let matchedAny = false;
  while ((m = attrRe.exec(trimmed))) {
    matchedAny = true;
    const name = m[1] as string;
    const value = m[2];
    if (!(name in el.attrs)) return false;
    if (value !== undefined && el.attrs[name] !== value) return false;
  }
  // タグ名も属性条件も無い空文字列はマッチさせない (誤用防止)。
  if (!tag && !matchedAny) return false;
  return true;
}

function createFakeDocument(elements: FakeElement[]) {
  return {
    querySelector(selectorList: string): FakeElement | null {
      const selectors = selectorList.split(",").map((s) => s.trim());
      for (const el of elements) {
        for (const sel of selectors) {
          if (matchesSelector(sel, el)) return el;
        }
      }
      return null;
    },
  };
}

async function withFakeDocument<T>(
  elements: FakeElement[],
  fn: () => Promise<T> | T,
): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  const hadOwn = Object.hasOwn(g, "document");
  const original = g.document;
  g.document = createFakeDocument(elements);
  try {
    return await fn();
  } finally {
    if (hadOwn) g.document = original;
    else delete g.document;
  }
}

test("isSubIssueOverlayOpen: Sub-issueの重なり表示 (issue-viewer-overlay) があるとき true", async () => {
  await withFakeDocument(
    [{ tag: "div", attrs: { role: "dialog", "data-testid": "issue-viewer-overlay" } }],
    async () => {
      const { isSubIssueOverlayOpen } = await import("./location.ts");
      assert.equal(isSubIssueOverlayOpen(), true);
    },
  );
});

test("isSubIssueOverlayOpen: Sub-issueの重なり表示 (sub-issues-issue-viewer) があるとき true", async () => {
  await withFakeDocument(
    [{ tag: "div", attrs: { role: "dialog", "data-testid": "sub-issues-issue-viewer" } }],
    async () => {
      const { isSubIssueOverlayOpen } = await import("./location.ts");
      assert.equal(isSubIssueOverlayOpen(), true);
    },
  );
});

test("isSubIssueOverlayOpen: 通常のissue単体表示 (該当要素なし) のとき false", async () => {
  await withFakeDocument([], async () => {
    const { isSubIssueOverlayOpen } = await import("./location.ts");
    assert.equal(isSubIssueOverlayOpen(), false);
  });
});

test("isSubIssueOverlayOpen: ラベル編集dialog (role=dialogのみでSub-issue特有のdata-testidが無い) では false", async () => {
  await withFakeDocument(
    [{ tag: "div", attrs: { role: "dialog", "data-testid": "label-picker" } }],
    async () => {
      const { isSubIssueOverlayOpen } = await import("./location.ts");
      assert.equal(isSubIssueOverlayOpen(), false);
    },
  );
});

test("isSubIssueOverlayOpen: 担当者選択popover (role=dialogのみでSub-issue特有のdata-testidが無い) では false", async () => {
  await withFakeDocument(
    [{ tag: "div", attrs: { role: "dialog", "data-testid": "assignee-picker" } }],
    async () => {
      const { isSubIssueOverlayOpen } = await import("./location.ts");
      assert.equal(isSubIssueOverlayOpen(), false);
    },
  );
});

test("isSubIssueOverlayOpen: Sub-issue用のdata-testidを持つがrole=dialogでない要素では false", async () => {
  await withFakeDocument(
    [{ tag: "div", attrs: { "data-testid": "issue-viewer-overlay" } }],
    async () => {
      const { isSubIssueOverlayOpen } = await import("./location.ts");
      assert.equal(isSubIssueOverlayOpen(), false);
    },
  );
});
