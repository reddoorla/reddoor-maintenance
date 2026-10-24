import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, createRawSnippet } from "svelte";

vi.mock("$app/navigation", () => ({ afterNavigate: () => undefined }));

const installed: unknown[] = [];
vi.mock("../../src/lib/post.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/post.js")>();
  return {
    ...real,
    setOwnWrite: (wrap: unknown) => {
      installed.push(wrap);
      real.setOwnWrite(wrap as Parameters<typeof real.setOwnWrite>[0]);
    },
  };
});

afterEach(() => {
  installed.length = 0;
  vi.unstubAllGlobals();
});

/**
 * #1700: the fix is live only if the layout hands its freshness controller's
 * `aroundOwnWrite` to `post.ts` when it mounts, and takes it back when it goes.
 */
describe("the layout wires its own posts to the freshness check", () => {
  it("installs the controller's hook on mount and removes it on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, version: 1 }))),
    );
    const { default: Layout } = await import("../../src/routes/+layout.svelte");
    const target = document.createElement("div");
    const app = mount(Layout, {
      target,
      props: {
        data: { email: null, path: "/", snapshot: { version: 1 } as never },
        children: createRawSnippet(() => ({ render: () => "<span></span>" })),
      },
    });
    flushSync();
    expect(installed).toHaveLength(1);
    expect(typeof installed[0]).toBe("function");
    await unmount(app);
    expect(installed).toEqual([installed[0], null]);
  });
});
