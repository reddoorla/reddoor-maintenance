import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/** What the root layout's load `depends()` on; invalidating it reads the snapshot again. */
export const SNAPSHOT_DEPENDENCY = "cockpit:snapshot";

/** How often an open, visible cockpit asks whether anything changed. */
export const CHECK_EVERY_MS = 60_000;

export type FreshnessDeps = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Read the snapshot again (SvelteKit's `invalidate(SNAPSHOT_DEPENDENCY)`). */
  refresh: () => Promise<void>;
  /** A full page load: the auth gate then sends a signed-out browser to sign-in. */
  reload: () => void;
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
  if (snapshot === null || snapshot.version === null || snapshot.gaps.length > 0) {
    await deps.refresh();
    return "refreshed";
  }
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
    deps.reload();
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
  if (body.version === snapshot.version) return "unchanged";
  await deps.refresh();
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
  /** Read the snapshot again now, or as soon as the operator leaves the field. */
  requestRefresh: () => void;
  /** Ask whether anything changed (focus, the tab coming back, the interval). */
  check: () => Promise<void>;
  stop: () => void;
};

/**
 * The open cockpit's freshness, one per page load (`+layout.svelte`):
 * - about every `CHECK_EVERY_MS` while the tab is visible, on coming back to the
 *   tab and on window focus, one `checkFreshness` at a time;
 * - after a change the page posted, a refresh (`requestRefresh`);
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
  let refreshWaiting = false;

  const refresh = async () => {
    refreshWaiting = false;
    await deps.refresh();
  };
  const check = async () => {
    if (checking || !env.isVisible()) return;
    if (env.isEditing()) {
      checkWaiting = true;
      return;
    }
    checkWaiting = false;
    checking = true;
    try {
      // The answer can take a while; the operator may be in a field by then,
      // and the refresh waits for them like any other.
      await checkFreshness(getSnapshot(), { ...deps, refresh: async () => requestRefresh() });
    } finally {
      checking = false;
    }
  };
  const requestRefresh = () => {
    if (env.isEditing()) refreshWaiting = true;
    else void refresh();
  };
  const leftField = () => {
    // `focusout` fires before focus lands on the next element; look after it.
    setTimeout(() => {
      if (env.isEditing()) return;
      if (refreshWaiting) void refresh();
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
export function requestSnapshotRefresh(refreshNow: () => Promise<void>): void {
  if (active) active.requestRefresh();
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
