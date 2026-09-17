/** #646 step 3: the Turso half of the Turso-native `ensure-site`.
 *
 *  Turso is the source of truth for a new site, so this is NOT a mirror: nothing
 *  shadows it and nothing converges it. It adapts `fleet-state`'s gated queries
 *  to the `SiteStore` the creator (`src/fleet/ensure-site.ts`) drives, and adds
 *  the one thing those queries cannot express on their own — the transaction.
 *
 *  It lives in its own module, exempt from the EXPLAIN gate, for a concrete
 *  reason: the gate runs every scenario against ONE shared `:memory:` libSQL
 *  client, and `client.transaction()` on an in-memory client hands its connection
 *  to the transaction and opens a fresh, EMPTY database for the next statement
 *  (verified 2026-09-17: the statement after a committed transaction failed with
 *  `no such table`). Every SQL statement this module issues is `insertSiteRows` /
 *  `updateSiteIdentity` / `getSiteBySlug`, which the gate plans directly.
 *
 *  The same hazard means any test driving `create` must use a `file:` database.
 */
import type { Db } from "./client.js";
import { getSiteBySlug, insertSiteRows, updateSiteIdentity } from "./fleet-state.js";
import type { SiteStore } from "../fleet/ensure-site.js";

/** SQLite's message for the `sites.slug` UNIQUE index, as libSQL surfaces it. */
const SLUG_TAKEN = /UNIQUE constraint failed: sites\.slug/;

export function makeSiteStore(db: Db, now: () => Date = () => new Date()): SiteStore {
  return {
    findBySlug: async (slug) => {
      const row = await getSiteBySlug(db, slug);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        // `rowFromJoined` maps a null url to "" — undo that, so "blank" means one thing.
        url: row.url === "" ? null : row.url,
        pointOfContact: row.pointOfContact,
        gitRepo: row.gitRepo,
      };
    },
    create: async (site) => {
      try {
        await db.transaction().execute((trx) => insertSiteRows(trx, site, now().toISOString()));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const causeMessage =
          err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
        if (SLUG_TAKEN.test(message) || SLUG_TAKEN.test(causeMessage)) {
          throw Object.assign(new Error(message, { cause: err }), { code: "SLUG_TAKEN" });
        }
        throw err;
      }
    },
    updateIdentity: (siteId, patch) => updateSiteIdentity(db, siteId, patch),
  };
}
