import { describe, it, expect } from "vitest";
import {
  createMinIntervalThrottle,
  applyThrottle,
} from "../../../src/reports/airtable/throttle.js";

/** Drain all pending microtasks by crossing a real macrotask boundary. Robust
 *  against however many internal `.then` hops the throttle chain takes. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A controllable fake clock: `now()` returns a number we advance manually, and
 * `delay(ms)` resolves only once the clock has advanced by at least `ms`. This
 * lets us assert spacing deterministically without real timers.
 */
function fakeClock(start = 0) {
  let t = start;
  const waiters: { due: number; resolve: () => void }[] = [];
  return {
    now: () => t,
    delay: (ms: number) =>
      new Promise<void>((resolve) => {
        if (ms <= 0) resolve();
        else waiters.push({ due: t + ms, resolve });
      }),
    advance(ms: number) {
      t += ms;
      for (const w of [...waiters]) {
        if (w.due <= t) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve();
        }
      }
    },
  };
}

describe("createMinIntervalThrottle", () => {
  it("runs the first call immediately and forwards all arguments", async () => {
    const clock = fakeClock();
    const calls: unknown[][] = [];
    const wrap = createMinIntervalThrottle({
      minIntervalMs: 200,
      now: clock.now,
      delay: clock.delay,
    });
    const fn = wrap((...args: unknown[]) => calls.push(args));

    fn("a", 1, { x: true });
    await flush();

    expect(calls).toEqual([["a", 1, { x: true }]]);
  });

  it("spaces consecutive call starts by at least minIntervalMs", async () => {
    const clock = fakeClock();
    const startedAt: number[] = [];
    const wrap = createMinIntervalThrottle({
      minIntervalMs: 200,
      now: clock.now,
      delay: clock.delay,
    });
    const fn = wrap(() => startedAt.push(clock.now()));

    fn();
    fn();
    fn();
    // First fires immediately; the rest are queued behind the interval.
    await flush();
    expect(startedAt).toEqual([0]);

    clock.advance(200);
    await flush();
    expect(startedAt).toEqual([0, 200]);

    clock.advance(200);
    await flush();
    expect(startedAt).toEqual([0, 200, 400]);
  });

  it("does not stall the queue when a wrapped call throws", async () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const wrap = createMinIntervalThrottle({
      minIntervalMs: 100,
      now: clock.now,
      delay: clock.delay,
    });
    const fn = wrap((n: number) => {
      if (n === 1) throw new Error("boom"); // runAction is callback-style, but be defensive
      seen.push(n);
    });

    fn(1); // throws inside the chain
    fn(2); // must still run
    await flush();
    clock.advance(100);
    await flush();

    expect(seen).toEqual([2]);
  });

  it("preserves call order and invokes the underlying fn exactly once per call", async () => {
    const clock = fakeClock();
    const seen: number[] = [];
    const wrap = createMinIntervalThrottle({
      minIntervalMs: 100,
      now: clock.now,
      delay: clock.delay,
    });
    const fn = wrap((n: number) => seen.push(n));

    fn(1);
    fn(2);
    fn(3);
    await flush();
    clock.advance(100);
    await flush();
    clock.advance(100);
    await flush();

    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("applyThrottle", () => {
  it("replaces base._base.runAction and base.runAction with throttled versions", async () => {
    const clock = fakeClock();
    const innerCalls: unknown[][] = [];
    const original = (...args: unknown[]) => innerCalls.push(args);
    // Shape mirrors the airtable SDK's baseFn: a callable with `_base.runAction`
    // (the real funnel) plus a bound `runAction` copy on the function itself.
    const fakeBase = Object.assign(() => ({}), {
      _base: { runAction: original },
      runAction: original,
    });

    const returned = applyThrottle(fakeBase, {
      minIntervalMs: 200,
      now: clock.now,
      delay: clock.delay,
    });

    expect(returned).toBe(fakeBase);
    expect(fakeBase._base.runAction).not.toBe(original);
    expect(fakeBase.runAction).not.toBe(original);

    fakeBase._base.runAction("get", "/Websites", {}, null, () => {});
    await flush();
    expect(innerCalls).toEqual([["get", "/Websites", {}, null, expect.any(Function)]]);
  });

  it("is a no-op when _base is absent (defensive)", () => {
    const clock = fakeClock();
    const fakeBase = Object.assign(
      () => ({}),
      {} as {
        _base?: { runAction?: (...args: unknown[]) => unknown };
        runAction?: (...args: unknown[]) => unknown;
      },
    );
    expect(() =>
      applyThrottle(fakeBase, { minIntervalMs: 200, now: clock.now, delay: clock.delay }),
    ).not.toThrow();
  });
});
