/**
 * Airtable enforces ~5 requests/second per base. Even fully *sequential* paging
 * (each `eachPage` fetch awaits the previous) bursts past that when responses are
 * fast — a single cockpit load scanning Reports + Submissions can fire a dozen
 * page-GETs in under a second and trip 429s.
 *
 * Rather than rate-limit each call site, we throttle at the ONE chokepoint every
 * Airtable HTTP call funnels through: `base._base.runAction` (used by query
 * paging, create, update, and destroy alike). The throttle serializes call
 * *starts* so consecutive requests begin at least `minIntervalMs` apart, keeping
 * the whole process under the per-base limit.
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
export function applyThrottle<T extends ThrottleableBase>(
  base: T,
  opts: ThrottleOptions & { retryDelaysMs?: readonly number[] },
): T {
  const real = base._base?.runAction;
  if (typeof real !== "function") return base;
  const bound = real.bind(base._base);
  const guarded = (...args: unknown[]): void => {
    try {
      bound(...args);
    } catch (err) {
      const cb = args[4];
      if (typeof cb === "function") (cb as RunActionCallback)(err);
    }
  };
  const throttled = createMinIntervalThrottle(opts)(guarded);
  const delays = opts.retryDelaysMs ?? RATE_LIMIT_RETRY_DELAYS_MS;
  const runAction = (...args: unknown[]): void => {
    const cb = args[4];
    if (typeof cb !== "function") {
      throttled(...args);
      return;
    }
    const attempt = (retry: number): void => {
      const next = [...args];
      next[4] = (err: unknown, resp?: unknown, body?: unknown) => {
        const outcome = classifyAirtableFailure(err, body);
        if (outcome === "pass") return (cb as RunActionCallback)(err, resp, body);
        if (outcome === "quota") return (cb as RunActionCallback)(quotaExhausted());
        if (outcome === "timeout") return (cb as RunActionCallback)(requestTimedOut());
        const wait = delays[retry];
        if (wait === undefined) return (cb as RunActionCallback)(rateLimited(delays.length));
        void opts.delay(wait).then(() => attempt(retry + 1));
      };
      throttled(...next);
    };
    attempt(0);
  };
  base._base!.runAction = runAction;
  base.runAction = runAction;
  return base;
}

type RunActionCallback = (err: unknown, resp?: unknown, body?: unknown) => void;

export const RATE_LIMIT_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000, 30_000];

export const AIRTABLE_QUOTA_ERROR = "PUBLIC_API_BILLING_LIMIT_EXCEEDED";

export type AirtableFailure = Error & { code: string; error: string; statusCode?: number };

function classifyAirtableFailure(
  err: unknown,
  body: unknown,
): "pass" | "quota" | "rate" | "timeout" {
  if (err === null || err === undefined) return "pass";
  if ((err as { name?: unknown }).name === "AbortError") return "timeout";
  if ((err as { statusCode?: unknown }).statusCode !== 429) return "pass";
  const errors = (body as { errors?: unknown } | null | undefined)?.errors;
  const quota =
    Array.isArray(errors) &&
    errors.some((e) => (e as { error?: unknown } | null)?.error === AIRTABLE_QUOTA_ERROR);
  return quota ? "quota" : "rate";
}

function failure(code: string, message: string, statusCode?: number): AirtableFailure {
  return Object.assign(new Error(message), {
    code,
    error: code,
    ...(statusCode === undefined ? {} : { statusCode }),
  });
}

function quotaExhausted(): AirtableFailure {
  return failure(
    "AIRTABLE_QUOTA_EXHAUSTED",
    `Airtable monthly API call quota exhausted (429 ${AIRTABLE_QUOTA_ERROR}); every call is refused until the quota resets`,
    429,
  );
}

function rateLimited(retries: number): AirtableFailure {
  return failure(
    "AIRTABLE_RATE_LIMITED",
    `Airtable rate limit (429) persisted through ${retries} retries`,
    429,
  );
}

function requestTimedOut(): AirtableFailure {
  return failure("AIRTABLE_TIMEOUT", "Airtable request timed out before a response arrived");
}
