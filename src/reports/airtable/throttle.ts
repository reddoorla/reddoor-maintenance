/**
 * Airtable enforces ~5 requests/second per base. Even fully *sequential* paging
 * (each `eachPage` fetch awaits the previous) bursts past that when responses are
 * fast — a single cockpit load scanning Reports + Submissions can fire a dozen
 * page-GETs in under a second and trip 429s. The SDK retries 429s with backoff,
 * but under sustained over-limit volume that retry budget runs out and the error
 * surfaces.
 *
 * Rather than rate-limit each call site, we throttle at the ONE chokepoint every
 * Airtable HTTP call funnels through: `base._base.runAction` (used by query
 * paging, create, update, and destroy alike). The throttle serializes call
 * *starts* so consecutive requests begin at least `minIntervalMs` apart, keeping
 * the whole process under the per-base limit. The SDK's built-in 429 retry stays
 * as a backstop for cross-process contention we can't see from here.
 */

export type ThrottleClock = {
  /** Current time in ms (e.g. `Date.now`). */
  now: () => number;
  /** Resolves after at least `ms` have elapsed (e.g. setTimeout-backed). */
  delay: (ms: number) => Promise<void>;
};

export type ThrottleOptions = ThrottleClock & {
  /** Minimum ms between successive call starts (220 ⇒ ≤ ~4.5 req/s). */
  minIntervalMs: number;
};

/**
 * Build a wrapper that spaces the *starts* of calls to any callback-style
 * function by `minIntervalMs`. Calls preserve order. The wrapper does NOT await
 * the wrapped function's completion (Airtable's `runAction` is fire-and-forget
 * with a callback), so spacing is measured start-to-start, which is exactly what
 * the per-second request limit counts.
 */
export function createMinIntervalThrottle(opts: ThrottleOptions) {
  const { minIntervalMs, now, delay } = opts;
  // A single promise chain serializes the gate; `last` is the start time of the
  // most recent dispatch. Both are captured per-wrapper so distinct wrapped fns
  // throttle independently (we only ever wrap one base, but this keeps it pure).
  return function wrap<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => void {
    let chain: Promise<void> = Promise.resolve();
    let last = Number.NEGATIVE_INFINITY;
    return (...args: A): void => {
      // The trailing `.catch` is load-bearing: if any step rejected, the next
      // `chain.then(...)` would never run its onFulfilled handler and the queue
      // would stall — silently hanging EVERY subsequent Airtable call in the
      // process. Swallowing keeps the chain perpetually fulfilled.
      chain = chain
        .then(async () => {
          const wait = minIntervalMs - (now() - last);
          if (wait > 0) await delay(wait);
          last = now();
          fn(...args);
        })
        .catch(() => {});
    };
  };
}

type ThrottleableBase = {
  _base?: { runAction?: (...args: unknown[]) => unknown };
  runAction?: (...args: unknown[]) => unknown;
};

/**
 * Replace `base._base.runAction` (the real funnel every table operation calls)
 * and `base.runAction` (its bound public copy) with throttled versions. Returns
 * the same base for chaining. No-op when `_base.runAction` is absent so an
 * unexpected SDK shape degrades gracefully rather than throwing at startup.
 */
export function applyThrottle<T extends ThrottleableBase>(base: T, opts: ThrottleOptions): T {
  const real = base._base?.runAction;
  if (typeof real !== "function") return base;
  const wrap = createMinIntervalThrottle(opts);
  const throttled = wrap(real.bind(base._base));
  base._base!.runAction = throttled;
  base.runAction = throttled;
  return base;
}
