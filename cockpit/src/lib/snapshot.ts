import { error, isHttpError } from "@sveltejs/kit";
import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";
import { reloadOnNextNavigation } from "./post.js";

/** What the root layout hands every page. */
export type SnapshotData = {
  snapshot: CockpitSnapshot | null;
  /** The status and message the store's failure is answered with, or null. */
  failure: { status: number; message: string } | null;
  clockOffsetMs: number;
};

/**
 * A page's view from the layout's snapshot, with the guards `withDb` gave its
 * server load: the store's own failure is that page's 500 or 502, a read the
 * snapshot could not take (`SnapshotGap`), or any other throw while deriving, is
 * the same 502 a thrown Turso read was, and an `error()` passes through untouched.
 * Runs on the server for the first render and in the browser on every navigation
 * after it.
 *
 * A snapshot with a gap is not kept for the session: the next navigation is a
 * full page load, which reads the store again, as every navigation did before.
 */
export async function fromSnapshot<T>(
  page: string,
  parent: () => Promise<SnapshotData>,
  derive: (snapshot: CockpitSnapshot, now: Date) => T,
): Promise<T> {
  const { snapshot, failure, clockOffsetMs } = await parent();
  if (snapshot === null || snapshot.gaps.length > 0) reloadOnNextNavigation();
  if (failure !== null) error(failure.status, failure.message);
  try {
    // Null only off every route (the layout skips it there), where no page loads.
    if (snapshot === null) throw new Error("no snapshot on a page route");
    return derive(snapshot, new Date(Date.now() + clockOffsetMs));
  } catch (err) {
    if (isHttpError(err)) throw err;
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[cockpit:${page}] unexpected failure: ${detail}`);
    error(502, "Temporarily unavailable — please retry in a moment.");
  }
}
