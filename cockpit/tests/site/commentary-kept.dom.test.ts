import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import CommentaryEditor from "../../src/lib/site/CommentaryEditor.svelte";
import { reactive } from "../_helpers/reactive.svelte.js";

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
});
