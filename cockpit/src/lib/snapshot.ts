import { error, isHttpError } from "@sveltejs/kit";
import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/**
 * A page's view from the layout's snapshot, with the guards `withDb` gave its
 * server load: a read the snapshot could not take (`SnapshotGap`), or any other
 * throw while deriving, is the same 502 a thrown Turso read was, and an `error()`
 * passes through untouched. Runs on the server for the first render and in the
 * browser on every navigation after it.
 */
export async function fromSnapshot<T>(
  page: string,
  parent: () => Promise<{ snapshot: CockpitSnapshot }>,
  derive: (snapshot: CockpitSnapshot, now: Date) => T,
): Promise<T> {
  const { snapshot } = await parent();
  try {
    return derive(snapshot, new Date());
  } catch (err) {
    if (isHttpError(err)) throw err;
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[cockpit:${page}] unexpected failure: ${detail}`);
    error(502, "Temporarily unavailable — please retry in a moment.");
  }
}
