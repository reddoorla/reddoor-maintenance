import { describe, it, expect } from "vitest";
import {
  beginRestore,
  captureView,
  finishRestore,
  keepValue,
  keptValue,
} from "../../src/lib/view-keep.js";

/**
 * The operator's place on a page across a remount for a fresh snapshot: open
 * <details> by what names them, a component's registered state, and the scroll. A
 * navigation to another page keeps none of it.
 */

function page(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

/** Two leads (named by their row's buttons), a lane (named by its class), and
 *  a <details> nothing names. */
const LEADS =
  `<li><details></details><div><button data-id="a"></button></div></li>` +
  `<li><details></details><div><button data-id="b"></button></div></li>` +
  `<details class="inbox"></details><div><details></details></div>`;
const at = (root: HTMLElement, i: number) => root.querySelectorAll("details")[i]!;

describe("view-keep", () => {
  it("a remount of the same page reopens what was open, closes what was closed, and scrolls back", () => {
    const before = page(LEADS);
    at(before, 1).open = true;
    at(before, 2).open = true;
    const unregister = keepValue("fleet:filter", () => "stale");
    const kept = captureView("/submissions", before, 640);
    unregister();

    beginRestore(kept, "/submissions");
    expect(keptValue("fleet:filter", "all")).toBe("stale");
    const after = page(LEADS);
    at(after, 0).open = true;
    at(after, 3).open = true;
    let scrolled: number | null = null;
    finishRestore(after, (y) => (scrolled = y));
    const open = [...after.querySelectorAll<HTMLDetailsElement>("details")].map((d) => d.open);
    // Lead a was closed before and closes again; lead b and the lane reopen;
    // the one nothing names is left as it is.
    expect(open).toEqual([false, true, true, true]);
    expect(scrolled).toBe(640);
    // Done: the next mount starts afresh.
    expect(keptValue("fleet:filter", "all")).toBe("all");
  });

  it("a navigation to another page keeps nothing", () => {
    const before = page(LEADS);
    at(before, 0).open = true;
    const unregister = keepValue("fleet:filter", () => "stale");
    const kept = captureView("/submissions", before, 640);
    unregister();

    beginRestore(kept, "/fleet");
    expect(keptValue("fleet:filter", "all")).toBe("all");
    const after = page(LEADS);
    let scrolled: number | null = null;
    finishRestore(after, (y) => (scrolled = y));
    expect(at(after, 0).open).toBe(false);
    expect(scrolled).toBeNull();
  });

  it("an unregistered value is not captured, and a newer registration is not removed by an older one", () => {
    const first = keepValue("x", () => 1);
    const second = keepValue("x", () => 2);
    first();
    expect(captureView("/p", page(""), 0).values.get("x")).toBe(2);
    second();
    expect(captureView("/p", page(""), 0).values.has("x")).toBe(false);
  });
});
