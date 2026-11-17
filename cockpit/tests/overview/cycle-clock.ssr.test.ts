import { describe, it, expect, vi, afterEach } from "vitest";
import { startCycleClock } from "../../src/lib/overview/cycle-clock.js";
import type { CycleView } from "../../src/lib/overview/cycle.js";

/**
 * P1-87 PR 5a: the page's clock for the nightly bar (plan, "The clock"). It is named
 * `.ssr.test.ts` because that is the cockpit project that runs plain `.ts` here
 * (vitest.config.ts: `cockpit/tests/**` takes only `*.ssr` and `*.dom` files).
 */

const MIN = 60_000;
const START = Date.parse("2026-10-27T07:00:00.000Z");
const IN_WINDOW = { fromIso: "2026-10-27T07:00:00.000Z", untilIso: "2026-10-27T11:07:00.000Z" };
const OUTSIDE = { fromIso: "2026-10-28T06:07:00.000Z", untilIso: "2026-10-28T11:07:00.000Z" };

afterEach(() => {
  vi.useRealTimers();
});

/** A timer function that, like the browser's, refuses to be called as a method. */
function unboundOnly<F extends (...args: never[]) => unknown>(f: F): F {
  return function (this: unknown, ...args: never[]) {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return (f as (...a: never[]) => unknown)(...args);
  } as unknown as F;
}

/** A clock on fake timers, with the page's dependencies as fakes. */
function rig(opts: { refresh?: CycleView["refresh"]; visible?: boolean; invalidate?: () => Promise<void> } = {}) {
  vi.useFakeTimers({ now: START });
  let refresh = opts.refresh ?? IN_WINDOW;
  let visible = opts.visible ?? true;
  const reads: number[] = [];
  const ticks: number[] = [];
  const invalidate = vi.fn(opts.invalidate ?? (async () => undefined));
  const clock = startCycleClock({
    getView: () => ({ refresh }) as unknown as CycleView,
    nowMs: () => Date.now(),
    isVisible: () => visible,
    invalidate: () => {
      reads.push(Date.now());
      return invalidate();
    },
    onTick: (t) => ticks.push(t),
    // The browser's timers refuse a call on any object but the window ("Illegal
    // invocation"), so these fakes refuse one too: the clock must call them bare.
    setInterval: unboundOnly(globalThis.setInterval),
    clearInterval: unboundOnly(globalThis.clearInterval),
  });
  return {
    clock,
    reads,
    ticks,
    invalidate,
    setRefresh: (r: CycleView["refresh"]) => (refresh = r),
    setVisible: (v: boolean) => (visible = v),
  };
}

describe("the nightly bar's clock", () => {
  it("re-reads the snapshot once every 2 minutes while the run may still be writing", async () => {
    const r = rig();
    await vi.advanceTimersByTimeAsync(4 * MIN);
    // Ticks at 1, 2, 3 and 4 minutes: reads at 1 and 3. Advanced async, as a real
    // timer lets each read's promise settle between ticks.
    expect(r.reads).toEqual([START + 1 * MIN, START + 3 * MIN]);
    r.clock.stop();
  });

  it("does not re-read while the tab is hidden", async () => {
    const r = rig({ visible: false });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(r.reads).toEqual([]);
    expect(r.ticks).toHaveLength(10);
    r.clock.stop();
  });

  it("does not re-read outside the window the view names", async () => {
    const r = rig({ refresh: OUTSIDE });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(r.reads).toEqual([]);
    r.clock.stop();
  });

  it("does not double a re-read that is still in flight", async () => {
    const r = rig({ invalidate: () => new Promise<void>(() => undefined) });
    await vi.advanceTimersByTimeAsync(3 * MIN + 30_000);
    // The first read never settles, so the one at 3 minutes is not started.
    expect(r.reads).toEqual([START + 1 * MIN]);
    r.clock.stop();
  });

  it("hands each tick's time to the page, so the marker moves once a minute", async () => {
    const r = rig();
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(r.ticks).toEqual([START + 1 * MIN, START + 2 * MIN, START + 3 * MIN]);
    r.clock.stop();
  });

  it("reads the view afresh on every tick, so a re-read's new window applies", async () => {
    const r = rig();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(r.reads).toHaveLength(1);
    r.setRefresh(OUTSIDE);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(r.reads).toHaveLength(1);
    r.clock.stop();
  });

  it("calls the timers bare, as the browser requires, and says so when called as a method", async () => {
    const r = rig();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(r.ticks).toHaveLength(1);
    r.clock.stop();
    // Control: the same fake, called as a method, is refused.
    const asMethod = { t: unboundOnly(globalThis.setInterval) };
    expect(() => asMethod.t(() => undefined, 1000)).toThrow("Illegal invocation");
  });

  it("stop clears the timer: no tick, no read, after it", async () => {
    const r = rig();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    r.clock.stop();
    const before = { ticks: r.ticks.length, reads: r.reads.length };
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(r.ticks).toHaveLength(before.ticks);
    expect(r.reads).toHaveLength(before.reads);
  });
});
