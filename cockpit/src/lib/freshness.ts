import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/** How often an open, visible cockpit asks whether anything changed. */
export const CHECK_EVERY_MS = 60_000;

/** How long one check may take before it counts as "unknown". */
export const CHECK_TIMEOUT_MS = 10_000;

/** How long the read just before one of the page's own posts may hold that post
 *  up (#1700). Past it the post goes ahead and is not taken as the page's own. */
export const OWN_WRITE_READ_MS = 2_000;

export type FreshnessDeps = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** The session ended: the next navigation is a full load, which the auth gate
   *  sends to sign-in. Never a load at once, which would take whatever the
   *  operator has typed with it. */
  signedOut: () => void;
};

export type FreshnessResult = "unchanged" | "newer" | "signed-out" | "unknown";

/**
 * Whether the store has changed since the snapshot in hand was read: one small
 * read of the store's change counter (`/api/cockpit/version`, migration 0048).
 * It reads nothing else and changes nothing on the page; the layout shows a
 * notice and the operator reloads when they choose (the operator's decision,
 * workspace decisions/2026-10-22-1541-cockpit-freshness-round-6.md). A snapshot
 * with no counter cannot be compared (its read failed; the next navigation is a
 * full load already), but the counter is still asked, because its answer is
 * also the session check.
 */
export async function checkFreshness(
  snapshot: Pick<CockpitSnapshot, "version"> | null,
  deps: FreshnessDeps,
): Promise<FreshnessResult> {
  // A request that never settles (a connection dropped mid-request) would hold
  // the one-at-a-time slot in `startFreshness` until a full load (#1701). A
  // plain timer rather than `AbortSignal.timeout`, whose clock a test cannot move.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CHECK_TIMEOUT_MS);
  try {
    return await readVersion(snapshot, deps, abort.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function readVersion(
  snapshot: Pick<CockpitSnapshot, "version"> | null,
  deps: FreshnessDeps,
  signal: AbortSignal,
): Promise<FreshnessResult> {
  let res: Response;
  try {
    res = await deps.fetch("/api/cockpit/version", {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch {
    return "unknown";
  }
  if (res.status === 401 || res.status === 403) {
    deps.signedOut();
    return "signed-out";
  }
  if (!res.ok) return "unknown";
  let body: { version?: unknown };
  try {
    body = (await res.json()) as { version?: unknown };
  } catch {
    return "unknown";
  }
  if (typeof body.version !== "number") return "unknown";
  if (snapshot === null || snapshot.version === null) return "unknown";
  return body.version === snapshot.version ? "unchanged" : "newer";
}

/** The counter's value, or null when it cannot be read in `timeoutMs` (any
 *  failure, a non-number, an ended session: the post itself reports that). */
async function readCounter(deps: FreshnessDeps, timeoutMs: number): Promise<number | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await deps.fetch("/api/cockpit/version", {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "number" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** What the controller needs from the page it runs on; the layout passes the
 *  browser's own, a test passes its fakes. */
export type FreshnessEnv = {
  isVisible: () => boolean;
  /** Add a listener (`visibilitychange` on the document, `focus` on the window)
   *  and return its removal. */
  listen: (event: "visibilitychange" | "focus", handler: () => void) => () => void;
};

export type FreshnessController = {
  /** Remove the interval and the listeners. */
  stop: () => void;
  /** Run one of the page's own posts so that its change does not raise the
   *  notice (#1700); `post.ts` sends every post through it. */
  aroundOwnWrite: <T>(write: () => Promise<T>) => Promise<T>;
};

/**
 * The open cockpit's freshness check, one per page load (`+layout.svelte`):
 * about every `CHECK_EVERY_MS` while the tab is visible, on coming back to the
 * tab and on window focus, one check at a time. Once the store is newer it calls
 * `onNewer`, and every later check does nothing (the notice stays until the
 * operator reloads); the same once the session has ended. `stop` removes the
 * interval and the listeners.
 */
export function startFreshness(
  getSnapshot: () => Pick<CockpitSnapshot, "version"> | null,
  deps: FreshnessDeps,
  env: FreshnessEnv,
  onNewer: () => void,
): FreshnessController {
  let checking = false;
  let done = false;
  // The page's own posts (#1700). `ownWrites` counts those in flight, during
  // which no check runs: the store has moved and the page has not seen why yet.
  // `own` is the counter after the last of them, for the snapshot it was taken
  // against, and is what a check compares with in place of the snapshot's.
  let ownWrites = 0;
  let own: { snapshot: number; version: number } | null = null;

  /** The counter value that means "nothing but this page has changed the store". */
  const expected = (): Pick<CockpitSnapshot, "version"> | null => {
    const s = getSnapshot();
    if (s === null || s.version === null) return s;
    return own !== null && own.snapshot === s.version ? { version: own.version } : s;
  };

  const check = async () => {
    if (done || checking || ownWrites > 0 || !env.isVisible()) return;
    checking = true;
    try {
      const result = await checkFreshness(expected(), deps);
      if (result === "newer") {
        done = true;
        onNewer();
      } else if (result === "signed-out") {
        done = true;
      }
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  const removers = [
    env.listen("visibilitychange", () => {
      if (env.isVisible()) void check();
    }),
    env.listen("focus", () => void check()),
  ];
  const stop = () => {
    clearInterval(timer);
    for (const remove of removers) remove();
  };

  // Read the counter just before the post and just after it. Only when the
  // before-value is still the one expected (nobody else has written since this
  // page last knew the store) is the after-value taken as the page's own; a
  // write by anyone else before the post, or one the read could not rule out,
  // still raises the notice. A write that lands during the post's own round trip
  // is the one this cannot tell from the page's.
  const aroundOwnWrite = async <T>(write: () => Promise<T>): Promise<T> => {
    ownWrites++;
    const base = expected();
    const before =
      base === null || base.version === null ? null : await readCounter(deps, OWN_WRITE_READ_MS);
    const settle = async () => {
      try {
        if (before === null || base === null || before !== base.version) return;
        const after = await readCounter(deps, CHECK_TIMEOUT_MS);
        const s = getSnapshot();
        if (after !== null && s !== null && s.version !== null) {
          own = { snapshot: s.version, version: after };
        }
      } finally {
        ownWrites--;
      }
    };
    try {
      return await write();
    } finally {
      // Not awaited: the page shows the post's answer at once.
      void settle();
    }
  };
  return { stop, aroundOwnWrite };
}
