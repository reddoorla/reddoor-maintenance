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
export const load: LayoutServerLoad = ({ locals, depends, setHeaders }) => {
  depends("cockpit:snapshot");
  setHeaders({ "cache-control": "private, no-store" });
  return withDb(
    "snapshot",
    async (db) => ({
      email: locals.email,
      snapshot: await loadCockpitSnapshot(
        db,
        new Date(),
        resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL),
      ),
    }),
    { batchReads: true },
  );
};
