import { isHttpError } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { loadCockpitSnapshot } from "../../../src/dashboard/snapshot.js";
import { resolveDashboardBaseUrl } from "../../../src/dashboard/handler-helpers.js";
import { withDb } from "../lib/server/db.js";

/**
 * The one server load: the auth chrome and the snapshot, the cockpit's whole
 * working set in one batched Turso read (`src/dashboard/snapshot.ts`). Every page
 * derives its view from it in a universal `+page.ts`, so a client navigation
 * between pages asks the server for nothing. It reads no `url`, `params` or
 * `route`, which would re-run it on every navigation; only
 * `invalidate("cockpit:snapshot")` (or a full load) fetches a fresh one.
 *
 * `private, no-store`: lead details and every client's settings are in it, so no
 * cache keeps a copy; it lives in the signed-in operator's browser memory only.
 */
export const load: LayoutServerLoad = async ({ locals, depends, setHeaders, route, untrack }) => {
  depends("cockpit:snapshot");
  setHeaders({ "cache-control": "private, no-store" });
  // A path no page owns (a mistyped URL, a browser's `/apple-touch-icon.png`) still
  // renders the error page through this layout. It needs no snapshot, and must not
  // cost a read of every table. Read untracked, so a navigation between pages never
  // re-runs this load; the navigation off the error page is a full load instead
  // (`+layout.ts`), which reads the snapshot.
  if (untrack(() => route.id) === null) {
    return { email: locals.email, snapshot: null, failure: null };
  }
  try {
    return await withDb(
      "snapshot",
      async (db) => ({
        email: locals.email,
        snapshot: await loadCockpitSnapshot(
          db,
          new Date(),
          resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL),
        ),
        failure: null,
      }),
      { batchReads: true },
    );
  } catch (err) {
    // `withDb`'s 500 (no store configured) or 502 (the store failed), answered by
    // the page, inside this layout, as each page's own load answered it before:
    // an error thrown here would drop the Shell for SvelteKit's bare error.html.
    if (!isHttpError(err)) throw err;
    return {
      email: locals.email,
      snapshot: null,
      failure: { status: err.status, message: err.body.message },
    };
  }
};
