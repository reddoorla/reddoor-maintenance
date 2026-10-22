import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import SubmissionRowInner from "../../src/lib/submission/SubmissionRowInner.svelte";
import type { SubmissionRowView } from "../../src/lib/submission/view.js";
import { reactive } from "../_helpers/reactive.svelte.js";

/**
 * A row's buttons are keyed by what they do, not by position. A status button
 * keeps its own label ("✓" once it has posted) and its disabled state, so when a
 * row's buttons change under it (a fresh snapshot after a status change), a
 * button keyed by position would hand its "✓" and its disabled state to
 * whichever button slid into its slot. The page also remounts on each fresh
 * snapshot; this pins the row on its own.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const row = (buttons: SubmissionRowView["buttons"]): SubmissionRowView => ({
  id: "sub-1",
  url: "/api/submissions/sub-1/status",
  formType: "contact",
  who: "Ana",
  email: "ana@example.com",
  status: "new",
  when: "today",
  provenance: null,
  bounce: null,
  fanout: null,
  details: [],
  buttons,
});

describe("SubmissionRowInner's buttons", () => {
  it("a posted button's ✓ goes with it, not to the button that takes its place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const props = reactive({
      row: row([
        { status: "read", label: "Mark read" },
        { status: "spam", label: "Spam" },
      ] as SubmissionRowView["buttons"]),
    });
    const target = document.createElement("div");
    const app = mount(SubmissionRowInner, { target, props });
    flushSync();
    const first = target.querySelector<HTMLButtonElement>("button[data-status='read']")!;
    first.click();
    await vi.waitFor(() => expect(first.textContent).toBe("✓"));

    // The snapshot after the post: "Mark read" is gone, "Spam" is first.
    props.row = row([{ status: "spam", label: "Spam" }] as SubmissionRowView["buttons"]);
    flushSync();
    const spam = target.querySelector<HTMLButtonElement>("button[data-status='spam']")!;
    expect(spam.textContent).toBe("Spam");
    expect(spam.disabled).toBe(false);
    unmount(app);
  });
});
