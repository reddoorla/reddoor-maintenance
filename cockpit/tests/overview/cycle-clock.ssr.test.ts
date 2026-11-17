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
const NEVER = "2100-01-01T00:00:00.000Z";
/** A refresh window that is not due in these tests, so only staleness can re-read. */
const NOT_DUE = { fromIso: "2026-10-29T06:07:00.000Z", untilIso: "2026-10-29T11:07:00.000Z" };

function rig(
  opts: {
    refresh?: CycleView["refresh"];
    staleAfterIso?: string;
    visible?: boolean;
    invalidate?: () => Promise<void>;
    /** How late each tick's reading of the clock is, by tick number (1 is the first). */
    lateMs?: (tick: number) => number;
  } = {},
) {
  vi.useFakeTimers({ now: START });
  let readings = 0;
  let refresh = opts.refresh ?? IN_WINDOW;
  let staleAfterIso = opts.staleAfterIso ?? NEVER;
  let visible = opts.visible ?? true;
  let onVisible: (() => void) | null = null;
  const reads: number[] = [];
  const ticks: number[] = [];
  const invalidate = vi.fn(opts.invalidate ?? (async () => undefined));
  const clock = startCycleClock({
    getView: () => ({ refresh, staleAfterIso }) as unknown as CycleView,
    // A browser's interval fires a few ms late, by a different amount each time, so the
    // clock's reading of "now" is the real time plus that tick's lateness.
    nowMs: () => Date.now() + (opts.lateMs ? opts.lateMs(++readings) : 0),
    isVisible: () => visible,
    listenVisible: (handler) => {
      onVisible = handler;
      return () => {
        onVisible = null;
      };
    },
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
    setStale: (iso: string) => (staleAfterIso = iso),
    /** Make the tab visible or hidden, as the browser's visibilitychange does. */
    setVisible: (v: boolean) => {
      visible = v;
      if (v) onVisible?.();
    },
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

  it("a read that hangs does not stop the next one, 2 minutes after it began", async () => {
    const r = rig({ invalidate: () => new Promise<void>(() => undefined) });
    await vi.advanceTimersByTimeAsync(3 * MIN + 30_000);
    // The first read never settles. The 2-minute gap from its start is met at the
    // 3-minute tick, and the read there is started.
    expect(r.reads).toEqual([START + 1 * MIN, START + 3 * MIN]);
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

/**
 * P1-87 PR 5a, review round 1 (correctness majors 1 and 3, minor 4): the re-read is due
 * when the view is stale as well as inside its window, a hung re-read settles, a
 * rejected one is caught, and a tab made visible is looked at at once.
 */
describe("the bar's clock re-reads a stale view, is not held by a hung read, and ticks on visibility (P1-87 PR 5a)", () => {
  const WINDOW_END = Date.parse("2026-10-27T11:07:00.000Z");
  const STALE_RUN = {
    refresh: { fromIso: "2026-10-27T07:00:00.000Z", untilIso: "2026-10-27T11:07:00.000Z" },
    staleAfterIso: "2026-10-27T11:07:00.000Z",
  };

  it("a running view whose window passed while hidden is re-read at once on becoming visible, then every 2 minutes while unchanged", async () => {
    const r = rig({ ...STALE_RUN, visible: false });
    await vi.advanceTimersByTimeAsync(WINDOW_END + 3 * 60 * MIN - START);
    expect(r.reads).toEqual([]);
    r.setVisible(true);
    // The visibility tick reads at once, not a minute later.
    expect(r.reads).toEqual([WINDOW_END + 3 * 60 * MIN]);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(r.reads).toEqual([WINDOW_END + 3 * 60 * MIN, WINDOW_END + 3 * 60 * MIN + 2 * MIN]);
    r.clock.stop();
  });

  it("a recorded view is not re-read before its staleAfter, and is re-read once the clock passes it", async () => {
    const STALE = Date.parse("2026-10-28T06:07:00.000Z");
    const r = rig({
      refresh: NOT_DUE,
      staleAfterIso: "2026-10-28T06:07:00.000Z",
    });
    await vi.advanceTimersByTimeAsync(STALE - MIN - START);
    expect(r.reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(r.reads).toEqual([STALE]);
    r.clock.stop();
  });

  it("an invalidate that never settles does not stop re-reads", async () => {
    const r = rig({
      refresh: NOT_DUE,
      staleAfterIso: "2026-10-27T00:00:00.000Z",
      invalidate: () => new Promise<void>(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(4 * MIN + 30_000);
    // The first read at 1 minute never settles. The 2-minute gap runs from its start, so
    // the next read is at the 3-minute tick. The one after would fall at the 5-minute
    // tick, past this test's 4 min 30 s.
    expect(r.reads).toEqual([START + 1 * MIN, START + 3 * MIN]);
    r.clock.stop();
  });

  it("a rejecting invalidate does not throw out of the tick, and the gap still applies", async () => {
    const r = rig({
      refresh: NOT_DUE,
      staleAfterIso: "2026-10-27T00:00:00.000Z",
      invalidate: () => Promise.reject(new Error("the read failed")),
    });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(r.reads).toEqual([START + 1 * MIN, START + 3 * MIN]);
    r.clock.stop();
  });

  it("an invalidate that throws synchronously does not throw out of the tick either", async () => {
    const r = rig({
      refresh: NOT_DUE,
      staleAfterIso: "2026-10-27T00:00:00.000Z",
      invalidate: () => {
        throw new Error("the read failed at once");
      },
    });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(r.reads).toEqual([START + 1 * MIN, START + 3 * MIN]);
    r.clock.stop();
  });

  it("hidden: a stale view is not re-read", async () => {
    const r = rig({
      refresh: NOT_DUE,
      staleAfterIso: "2026-10-27T00:00:00.000Z",
      visible: false,
    });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(r.reads).toEqual([]);
    r.clock.stop();
  });

  it("stop removes the visibility listener: a later change of visibility reads nothing", async () => {
    const r = rig({ ...STALE_RUN, visible: false });
    r.clock.stop();
    r.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.reads).toEqual([]);
  });
});

/**
 * P1-87 PR 5a, review round 2 (correctness major 1; tests e12, e17): the 2-minute gap runs
 * from the start of the last read, not from its settle, and a late answer from a read that
 * already timed out does not change the clock.
 */
describe("the bar's clock spaces re-reads from when a read began (P1-87 PR 5a, round 2)", () => {
  it("a slow read (2 s) does not push the next re-read a tick later: reads land at 1, 3 and 5 minutes", async () => {
    const r = rig({
      refresh: NOT_DUE,
      staleAfterIso: "2026-10-27T00:00:00.000Z",
      invalidate: () => new Promise<void>((res) => setTimeout(res, 2000)),
    });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(r.reads).toEqual([START + 1 * MIN, START + 3 * MIN, START + 5 * MIN]);
    r.clock.stop();
  });

  it("a read that hangs and answers at 90 s, after a tick has passed, does not change the reads", async () => {
    let calls = 0;
    const r = rig({
      refresh: NOT_DUE,
      staleAfterIso: "2026-10-27T00:00:00.000Z",
      // The first read answers at 90 s, after the 2-minute tick; later reads answer at once.
      invalidate: () => {
        calls += 1;
        return calls === 1
          ? new Promise<void>((res) => setTimeout(res, 90_000))
          : Promise.resolve();
      },
    });
    await vi.advanceTimersByTimeAsync(5 * MIN);
    // Measured from the start (1 minute), the reads are at 3 and 5 minutes. Had the late
    // answer restarted the gap (at 2 minutes 30 s), the next read would slip to 4 minutes.
    expect(r.reads).toEqual([START + 1 * MIN, START + 3 * MIN, START + 5 * MIN]);
    r.clock.stop();
  });
});

/**
 * P1-87 PR 5a, review round 3 (correctness major 1): the tick is a repeating interval, so
 * each tick lands a few ms late by a different amount. The 2-minute gap is met with a
 * half-tick of slack, so a jittered tick does not skip a re-read.
 */
describe("the bar's clock re-reads every 2 minutes whatever the tick jitter (P1-87 PR 5a, round 3)", () => {
  it("with tick 1 8 ms late and every later tick 2 ms late, reads land at 1, 3, 5, 7 and 9 minutes", async () => {
    const r = rig({ lateMs: (tick) => (tick === 1 ? 8 : 2) });
    await vi.advanceTimersByTimeAsync(9.5 * MIN);
    expect(r.reads).toEqual([1, 3, 5, 7, 9].map((m) => START + m * MIN));
    r.clock.stop();
  });
});
