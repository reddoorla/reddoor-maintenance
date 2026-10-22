import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/** How often an open, visible cockpit asks whether anything changed. */
export const CHECK_EVERY_MS = 60_000;

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
  let res: Response;
  try {
    res = await deps.fetch("/api/cockpit/version", {
      headers: { accept: "application/json" },
      cache: "no-store",
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

  const check = async () => {
    if (done || checking || !env.isVisible()) return;
    checking = true;
    try {
      const result = await checkFreshness(getSnapshot(), deps);
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
  return { stop };
}
