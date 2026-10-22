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
