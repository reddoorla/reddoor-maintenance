import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import CommentaryEditor from "../../src/lib/site/CommentaryEditor.svelte";
import { reactive } from "../_helpers/reactive.svelte.js";
import { beginRestore, captureView, finishRestore } from "../../src/lib/view-keep.js";

/**
 * Review round 2 of the freshness PR: a refresh in place (the store's counter
 * unchanged, as after a failed save) hands the editor a new `c`. Bound to the
 * live prop, the textarea took the stored text back over the operator's
 * unsaved paragraph. It shows what it mounted with; a change in the store
 * remounts the page instead.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CommentaryEditor across a refresh in place", () => {
  it("keeps a paragraph whose save failed, with its ✗", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    const props = reactive({
      c: { id: "rep1", url: "/api/reports/rep1/commentary", text: "Stored." },
    });
    const target = document.createElement("div");
    document.body.append(target);
    const app = mount(CommentaryEditor, { target, props });
    flushSync();
    const t = target.querySelector("textarea")!;
    t.value = "A whole new paragraph.";
    t.dispatchEvent(new FocusEvent("blur"));
    await vi.waitFor(() =>
      expect(target.querySelector(".commentary-saved")!.textContent).toContain("✗"),
    );

    props.c = { id: "rep1", url: "/api/reports/rep1/commentary", text: "Stored, as read again." };
    flushSync();
    expect(t.value).toBe("A whole new paragraph.");
    expect(target.querySelector(".commentary-saved")!.textContent).toContain("✗");
    unmount(app);
    target.remove();
  });

  it("keeps a paragraph whose save failed, with its ✗, through a remount for a change in the store", async () => {
    // Review round 3: the counter moved (any write) and the remount brought the
    // stored text back.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    const c = { id: "rep2", url: "/api/reports/rep2/commentary", text: "Stored." };
    const target = document.createElement("div");
    document.body.append(target);
    let app = mount(CommentaryEditor, { target, props: { c } });
    flushSync();
    const t = target.querySelector("textarea")!;
    t.value = "Unsaved paragraph.";
    t.dispatchEvent(new FocusEvent("blur"));
    await vi.waitFor(() =>
      expect(target.querySelector(".commentary-saved")!.textContent).toContain("✗"),
    );

    // What the layout does around a remount on the same page.
    const kept = captureView("/s/acme", target, 0);
    unmount(app);
    beginRestore(kept, "/s/acme");
    app = mount(CommentaryEditor, {
      target,
      props: { c: { ...c, text: "Stored, changed elsewhere." } },
    });
    flushSync();
    finishRestore(target, () => undefined);
    expect(target.querySelector("textarea")!.value).toBe("Unsaved paragraph.");
    expect(target.querySelector(".commentary-saved")!.textContent).toContain("✗");
    unmount(app);
    target.remove();
  });

  it("takes a fresher stored text in place while it holds nothing of the operator's", () => {
    // Review round 5: the read after the page's own post is taken in place and
    // can carry another writer's text.
    const props = reactive({
      c: { id: "rep3", url: "/api/reports/rep3/commentary", text: "Old." },
    });
    const target = document.createElement("div");
    document.body.append(target);
    const app = mount(CommentaryEditor, { target, props });
    flushSync();
    props.c = { id: "rep3", url: "/api/reports/rep3/commentary", text: "Written elsewhere." };
    flushSync();
    expect(target.querySelector("textarea")!.value).toBe("Written elsewhere.");
    unmount(app);
    target.remove();
  });
});
