import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/** How often an open, visible cockpit asks whether anything changed. */
export const CHECK_EVERY_MS = 60_000;

/** How long one check may take before it counts as "unknown". */
export const CHECK_TIMEOUT_MS = 10_000;

/** The response headers a cockpit POST answers with (#1700): the change counter
 *  just before and just after its own handler ran (`route.ts`). */
export const VERSION_BEFORE_HEADER = "x-cockpit-version-before";
export const VERSION_AFTER_HEADER = "x-cockpit-version-after";

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
  aroundOwnWrite: (write: () => Promise<Response>) => Promise<Response>;
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
  // The page's own posts (#1700). Each answers with the counter just before and
  // just after its handler ran. `pairs` keeps those not yet chained onto the
  // baseline, so overlapping posts resolve in whatever order their answers come;
  // `own` is the baseline they have carried the snapshot's counter to.
  let pairs: Array<{ before: number; after: number }> = [];
  let own: { snapshot: number; version: number } | null = null;
  // Posts in flight, each holding checks off for at most CHECK_TIMEOUT_MS: the
  // store may already have moved and the page cannot yet tell whose write it was.
  let inFlight = 0;
  // Posts started so far: a check that saw one start while it was asking cannot
  // tell the page's write from anyone else's, so its answer says nothing.
  let started = 0;

  /** The counter value that means "nothing but this page has changed the store". */
  const expected = (): Pick<CockpitSnapshot, "version"> | null => {
    const s = getSnapshot();
    if (s === null || s.version === null) return s;
    let version = own !== null && own.snapshot === s.version ? own.version : s.version;
    // Every counter value reachable from the baseline through the page's own posts
    // is the page's own, whatever order the posts' reads and answers interleaved
    // in: two posts that both read 41 before either wrote answer (41,42) and
    // (41,43). The counter only rises, so the baseline becomes the highest.
    const reached = new Set([version]);
    for (let next = pairs.find((p) => reached.has(p.before)); next;) {
      const used = next;
      reached.add(used.after);
      version = Math.max(version, used.after);
      pairs = pairs.filter((p) => p !== used);
      next = pairs.find((p) => reached.has(p.before));
    }
    own = { snapshot: s.version, version };
    return { version };
  };

  const check = async () => {
    if (done || checking || inFlight > 0 || !env.isVisible()) return;
    checking = true;
    try {
      const base = expected();
      const startedBefore = started;
      const result = await checkFreshness(base, deps);
      // A post began while this check was asking (its write may be what the
      // counter shows), or a post's answer moved the baseline meanwhile: this
      // answer was judged against what the page knew before, so it says nothing.
      if (
        result === "newer" &&
        (started !== startedBefore || expected()?.version !== base?.version)
      ) {
        return;
      }
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

  const header = (res: Response, name: string): number | null => {
    const v = res.headers.get(name);
    return v !== null && /^\d+$/.test(v) ? Number(v) : null;
  };

  // The post goes out at once: nothing is read in front of it, so a click that
  // unloads the page cannot strand it. Its answer's headers say which counter
  // values were its own; an answer without them (a refusal, an error, an older
  // server) changes nothing, and the notice behaves as before.
  const aroundOwnWrite = async (write: () => Promise<Response>): Promise<Response> => {
    inFlight++;
    started++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight--;
      clearTimeout(cap);
    };
    const cap = setTimeout(release, CHECK_TIMEOUT_MS);
    try {
      const res = await write();
      const before = header(res, VERSION_BEFORE_HEADER);
      const after = header(res, VERSION_AFTER_HEADER);
      if (before !== null && after !== null) pairs.push({ before, after });
      return res;
    } finally {
      release();
    }
  };
  return { stop, aroundOwnWrite };
}
