import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { snapshot, night } from "./fixtures.js";
import { markIntroPlayed } from "../../src/lib/overview/motion.js";

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn(async (_key: string) => undefined) }));
vi.mock("$app/navigation", () => ({ invalidate, afterNavigate: () => undefined }));

/**
 * P1-87 PR 5a, review round 1 (correctness major 1, minor 4): the page mounts on the
 * server's clock, moves the nightly bar's marker and until-words with it, re-reads the
 * snapshot while the run may still be writing, and stops when it unmounts.
 */

const MIN = 60_000;

function setVisible(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

/** The page's own marker, as a percentage of the bar, from its inline style. */
const markerLeft = (target: HTMLElement): number => {
  const el = target.querySelector<HTMLElement>(".ov-cycle-marker");
  expect(el).not.toBeNull();
  return Number.parseFloat(el!.style.left);
};

/**
 * The browser's timers refuse a call on any object but the window ("Illegal invocation").
 * The fake timers installed by the test do not, so the window's timers are wrapped to
 * refuse a method call the same way: a `this` that is neither undefined nor the window
 * throws. Installed after the fake timers, so the page's own wiring meets it.
 */
function refuseMethodCalls() {
  for (const name of ["setInterval", "clearInterval"] as const) {
    const real = window[name] as (...args: unknown[]) => unknown;
    vi.spyOn(window, name).mockImplementation(function (this: unknown, ...args: unknown[]) {
      if (this !== undefined && this !== window) throw new TypeError("Illegal invocation");
      return real.apply(window, args);
    } as never);
  }
}

describe("the nightly bar's page clock (P1-87 PR 5a)", () => {
  let target: HTMLDivElement;
  let app: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    setVisible("visible");
    invalidate.mockClear();
    target = document.createElement("div");
    document.body.append(target);
  });

  afterEach(async () => {
    if (app) await unmount(app);
    app = null;
    target.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Mount the real page for `view`, with the fake clock at `fakeNow`. */
  async function mountPage(view: ReturnType<typeof overviewFromSnapshot>) {
    refuseMethodCalls();
    const { default: Page } = await import("../../src/routes/+page.svelte");
    app = mount(Page, { target, props: { data: { view } as never } });
    flushSync();
    return app;
  }

  it("a recorded view: the marker moves with the clock, and the until-words change at the hour", async () => {
    // After the run's window (11:07Z), so the marker is past 0 and moves.
    vi.useFakeTimers({ now: Date.parse("2026-10-27T12:00:00.000Z") });
    const view = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26")], sites: [] }),
      new Date("2026-10-27T12:00:00.000Z"),
    );
    await mountPage(view);
    const before = markerLeft(target);
    expect(target.textContent).toContain("in 18 hours");
    await vi.advanceTimersByTimeAsync(60_000);
    flushSync();
    expect(markerLeft(target)).toBeGreaterThan(before);
    // At 13:00Z the start is 17 hours and 7 minutes away: "in 17 hours".
    await vi.advanceTimersByTimeAsync(59 * MIN);
    flushSync();
    expect(target.textContent).toContain("in 17 hours");
    expect(target.textContent).not.toContain("in 18 hours");
  });

  it("a running view: after 2 minutes the page re-reads the snapshot", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-27T07:30:00.000Z") });
    const view = overviewFromSnapshot(
      snapshot({ nights: [], sites: [] }),
      new Date("2026-10-27T07:30:00.000Z"),
    );
    await mountPage(view);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(invalidate).toHaveBeenCalledWith("cockpit:snapshot");
  });

  it("after unmount, advancing 10 minutes calls nothing more", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-27T07:30:00.000Z") });
    const view = overviewFromSnapshot(
      snapshot({ nights: [], sites: [] }),
      new Date("2026-10-27T07:30:00.000Z"),
    );
    const mounted = await mountPage(view);
    await unmount(mounted);
    app = null;
    const calls = invalidate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(invalidate.mock.calls.length).toBe(calls);
  });

  it("a view made 10 minutes after the page's own clock: the marker is where the view's instant is, not the page's", async () => {
    // The server's instant is 12:10Z; the page's own clock says 12:00Z. Both are after the
    // run's window, so the marker is not held at 0 and the two readings differ.
    vi.useFakeTimers({ now: Date.parse("2026-10-27T12:00:00.000Z") });
    const view = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26")], sites: [] }),
      new Date("2026-10-27T12:10:00.000Z"),
    );
    await mountPage(view);
    expect(view.cycle.marker).not.toBeNull();
    expect(markerLeft(target)).toBeCloseTo(view.cycle.marker! * 100, 6);
  });

  /**
   * P1-87 PR 5a, review round 2 (tests e1b, e10): the clock is called bare, a hidden tab
   * re-reads nothing, and a recorded view before its stale time re-reads nothing.
   */
  it("a running view makes no re-read over 5 minutes while the tab is hidden, and reads at once when it is shown", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-27T07:30:00.000Z") });
    setVisible("hidden");
    const view = overviewFromSnapshot(
      snapshot({ nights: [], sites: [] }),
      new Date("2026-10-27T07:30:00.000Z"),
    );
    // This test is about the clock, not the intro: a first load's intro holds a re-read until its
    // end (#2164), so the intro is marked played, as it is for every test after the first. Without
    // this the test passed only after another test had played it.
    markIntroPlayed();
    await mountPage(view);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(invalidate).not.toHaveBeenCalled();
    // Control: the same page, shown, re-reads at once on the visibility change.
    setVisible("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(invalidate).toHaveBeenCalledWith("cockpit:snapshot");
  });

  it("a recorded view before its stale time makes no re-read over 5 minutes", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-27T12:00:00.000Z") });
    const view = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26")], sites: [] }),
      new Date("2026-10-27T12:00:00.000Z"),
    );
    expect(view.cycle.mode).toBe("recorded");
    expect(view.cycle.staleAfterIso).toBe("2026-10-28T06:07:00.000Z");
    await mountPage(view);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
