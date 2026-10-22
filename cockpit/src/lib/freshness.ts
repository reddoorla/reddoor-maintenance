import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/** What the root layout's load `depends()` on; invalidating it reads the snapshot again. */
export const SNAPSHOT_DEPENDENCY = "cockpit:snapshot";

/** How often an open, visible cockpit asks whether anything changed. */
export const CHECK_EVERY_MS = 60_000;

export type FreshnessDeps = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Read the snapshot again (SvelteKit's `invalidate(SNAPSHOT_DEPENDENCY)`).
   *  `own`: the page's own post asked for it, so the page takes the new data in
   *  place, keeping what the post's control shows; otherwise a change found
   *  elsewhere, which remounts the page (`+layout.svelte`). */
  refresh: (own: boolean) => Promise<void>;
  /** The session ended: the next navigation is a full load, which the auth gate
   *  sends to sign-in. Never a load at once, which would take whatever the
   *  operator has typed with it. */
  signedOut: () => void;
};

export type FreshnessResult = "unchanged" | "refreshed" | "signed-out" | "unknown";

/**
 * Whether the snapshot in hand is still the store's: one small read of the store's
 * change counter (`/api/cockpit/version`, migration 0048), and a full read of the
 * snapshot only when it moved. A snapshot with a gap, or with no version, is read
 * again whatever the counter says, since the counter cannot vouch for a read that
 * failed. A session that ended gets a full page load, which signs it out, instead
 * of a page that goes on showing what it last read.
 */
export async function checkFreshness(
  snapshot: Pick<CockpitSnapshot, "version" | "gaps"> | null,
  deps: FreshnessDeps,
): Promise<FreshnessResult> {
  // A snapshot the counter cannot vouch for is read again whatever the counter
  // says; the counter is still asked first, because its answer is also the
  // session check, and a read for a session that ended would follow the auth
  // gate's redirect to sign-in at once (review round 5).
  const unvouched = snapshot === null || snapshot.version === null || snapshot.gaps.length > 0;
  const orUnknown = async (): Promise<FreshnessResult> => {
    if (!unvouched) return "unknown";
    await deps.refresh(false);
    return "refreshed";
  };
  let res: Response;
  try {
    res = await deps.fetch("/api/cockpit/version", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return orUnknown();
  }
  if (res.status === 401 || res.status === 403) {
    deps.signedOut();
    return "signed-out";
  }
  if (!res.ok) return orUnknown();
  let body: { version?: unknown };
  try {
    body = (await res.json()) as { version?: unknown };
  } catch {
    return orUnknown();
  }
  if (typeof body.version !== "number") return orUnknown();
  if (!unvouched && body.version === snapshot.version) return "unchanged";
  await deps.refresh(false);
  return "refreshed";
}

/** What the controller needs from the page it runs on; the layout passes the
 *  browser's own, a test passes its fakes. */
export type FreshnessEnv = {
  isVisible: () => boolean;
  /** Whether the operator is typing or choosing in a field right now: a refresh
   *  remounts the page, which would take that field's unsaved text with it. */
  isEditing: () => boolean;
  /** Add a listener (`visibilitychange` on the document, `focus` on the window,
   *  `focusout` on the document) and return its removal. */
  listen: (event: "visibilitychange" | "focus" | "focusout", handler: () => void) => () => void;
};

export type FreshnessController = {
  /** Read the snapshot again now, or as soon as the operator leaves the field;
   *  `own` as `FreshnessDeps.refresh`. */
  requestRefresh: (own: boolean) => void;
  /** Ask whether anything changed (focus, the tab coming back, the interval). */
  check: () => Promise<void>;
  /** The session ended (a post was answered 401/403): no more checks. */
  signOut: () => void;
  stop: () => void;
};

/**
 * The open cockpit's freshness, one per page load (`+layout.svelte`):
 * - about every `CHECK_EVERY_MS` while the tab is visible, on coming back to the
 *   tab and on window focus, one `checkFreshness` at a time;
 * - after a change the page posted, a refresh (`requestRefresh`);
 * - once a check finds the session ended, no more checks;
 * - never while the operator is in a field: a check or refresh then waits for
 *   them to leave it (`focusout`), and runs once they have.
 */
export function startFreshness(
  getSnapshot: () => Pick<CockpitSnapshot, "version" | "gaps"> | null,
  deps: FreshnessDeps,
  env: FreshnessEnv,
): FreshnessController {
  let checking = false;
  let checkWaiting = false;
  // A refresh waiting for the operator, and whether one the page's own post
  // asked for is among them (then it runs as its own: in place).
  let refreshWaiting: { own: boolean } | null = null;
  let signedOut = false;

  const refresh = async (own: boolean) => {
    refreshWaiting = null;
    await deps.refresh(own);
  };
  const check = async () => {
    if (signedOut || checking || !env.isVisible()) return;
    if (env.isEditing()) {
      checkWaiting = true;
      return;
    }
    checkWaiting = false;
    checking = true;
    try {
      // The answer can take a while; the operator may be in a field by then,
      // and the refresh waits for them like any other.
      const result = await checkFreshness(getSnapshot(), {
        ...deps,
        refresh: async () => requestRefresh(false),
      });
      if (result === "signed-out") signedOut = true;
    } finally {
      checking = false;
    }
  };
  const requestRefresh = (own: boolean) => {
    if (env.isEditing()) refreshWaiting = { own: own || (refreshWaiting?.own ?? false) };
    else void refresh(own);
  };
  const leftField = () => {
    // `focusout` fires before focus lands on the next element; look after it.
    setTimeout(() => {
      if (env.isEditing()) return;
      if (refreshWaiting) void refresh(refreshWaiting.own);
      else if (checkWaiting) void check();
    }, 0);
  };

  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  const removers = [
    env.listen("visibilitychange", () => {
      if (env.isVisible()) void check();
    }),
    env.listen("focus", () => void check()),
    env.listen("focusout", leftField),
  ];
  return {
    requestRefresh,
    check,
    signOut: () => {
      signedOut = true;
    },
    stop: () => {
      clearInterval(timer);
      for (const remove of removers) remove();
    },
  };
}

/** The running page's controller, which `postAction` asks for a refresh. With
 *  none (a test, or before the layout mounts) a refresh runs at once. */
let active: FreshnessController | null = null;
export function setActiveFreshness(c: FreshnessController | null): void {
  active = c;
}
/** A post was answered 401/403: the running page checks no more (a check's read
 *  would follow the redirect to sign-in). */
export function reportSignedOut(): void {
  active?.signOut();
}
export function requestSnapshotRefresh(refreshNow: () => Promise<void>): void {
  if (active) active.requestRefresh(true);
  else void refreshNow();
}

/** Whether the focused element takes typing or a choice the operator has not
 *  finished with. */
export function isEditingField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "submit", "reset", "checkbox", "radio", "file", "image"].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}
