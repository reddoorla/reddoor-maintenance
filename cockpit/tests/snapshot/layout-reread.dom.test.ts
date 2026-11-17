import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, createRawSnippet } from "svelte";

vi.mock("$app/navigation", () => ({ afterNavigate: () => undefined }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const version = (v: number) => new Response(JSON.stringify({ ok: true, version: v }));

/**
 * P1-87 PR 5a, decision 5: the bar re-reads the snapshot while a run is writing, so
 * the layout's "Newer data is available" notice, raised by an earlier check, is
 * cleared once the snapshot it was about has been re-read. The freshness controller
 * restarts on the new version, and the next check judges against it.
 */
describe("the layout clears the newer-data notice after a re-read (P1-87 PR 5a)", () => {
  it("a new snapshot version clears the notice, and a later unchanged check raises none", async () => {
    // The store is at version 2 from the first check on: a snapshot at 1 is older.
    const fetch = vi.fn(async () => version(2));
    vi.stubGlobal("fetch", fetch);
    const { default: Layout } = await import("../../src/routes/+layout.svelte");
    const { holder } = await import("./reread-props.svelte.js");
    holder.data = { email: null, path: "/", snapshot: { version: 1 } };
    const target = document.createElement("div");
    document.body.append(target);
    const app = mount(Layout, {
      target,
      props: {
        get data() {
          return holder.data as never;
        },
        children: createRawSnippet(() => ({ render: () => "<span></span>" })),
      },
    });
    flushSync();

    // A focus runs a check: the counter (2) has moved past the snapshot (1).
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(target.querySelector(".cockpit-newer")).not.toBeNull());

    // The bar's re-read brings a snapshot at version 2.
    holder.data = { email: null, path: "/", snapshot: { version: 2 } };
    flushSync();
    expect(target.querySelector(".cockpit-newer")).toBeNull();

    // The restarted check judges against 2, which the counter still says: no notice.
    const asked = fetch.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(asked));
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(target.querySelector(".cockpit-newer")).toBeNull();

    await unmount(app);
    target.remove();
  });
});

describe("the layout keeps the newer-data notice on a same-version change (P1-87 PR 5a, review round 1, Group E)", () => {
  it("a data change with the same version (only the path) leaves the notice showing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => version(2)),
    );
    const { default: Layout } = await import("../../src/routes/+layout.svelte");
    const { holder } = await import("./reread-props.svelte.js");
    holder.data = { email: null, path: "/", snapshot: { version: 1 } };
    const target = document.createElement("div");
    document.body.append(target);
    const app = mount(Layout, {
      target,
      props: {
        get data() {
          return holder.data as never;
        },
        children: createRawSnippet(() => ({ render: () => "<span></span>" })),
      },
    });
    flushSync();

    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(target.querySelector(".cockpit-newer")).not.toBeNull());

    // Another page of the same snapshot: the version is still 1, which is the one the
    // notice is about, so the notice stays.
    holder.data = { email: null, path: "/s/acme", snapshot: { version: 1 } };
    flushSync();
    expect(target.querySelector(".cockpit-newer")).not.toBeNull();

    await unmount(app);
    target.remove();
  });
});
