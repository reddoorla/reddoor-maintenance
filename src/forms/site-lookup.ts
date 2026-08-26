/** Phase 2 (#539): the Turso-primary site lookup for form ingest.
 *
 *  The hot path reads Turso only — this is what retires the 08-17 outage class,
 *  where an Airtable quota outage made `getWebsiteBySlug` throw while the lead
 *  store itself was healthy. Airtable is consulted ONLY when Turso has no row
 *  for the slug: the new-site window, where a site launched since the last
 *  hourly sync exists in Airtable but not yet in Turso. Real traffic posts to
 *  real sites' endpoints, so that fallback fires for brand-new sites and
 *  garbage slugs — never per lead.
 *
 *  Error semantics, both deliberate:
 *  - A Turso failure propagates WITHOUT trying Airtable: the lead store is
 *    Turso, so if it is down the submission cannot persist anyway — a fallback
 *    row would only manufacture a lookup success the write path then wastes.
 *  - An Airtable failure during the fallback propagates too, which hands the
 *    lead to the dead-letter (Turso is up in that scenario) for replay once
 *    the lookup recovers.
 */
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { TURSO_IS_AUTHORITATIVE } from "../db/freeze.js";

export type SiteLookupDeps = {
  fromDb: (slug: string) => Promise<WebsiteRow | null>;
  fromAirtable: (slug: string) => Promise<WebsiteRow | null>;
};

export function makeSiteLookup(
  deps: SiteLookupDeps,
  /** #612. `true` = post-freeze: the Airtable fallback is not consulted at all,
   *  so form ingest touches one store. Injected so both sides stay proven and
   *  the freeze commit stays a one-line change. */
  strict: boolean = TURSO_IS_AUTHORITATIVE,
): (slug: string) => Promise<WebsiteRow | null> {
  return async (slug) => {
    const hit = await deps.fromDb(slug);
    if (hit) return hit;
    // Post-freeze the fallback is not just unnecessary, it is WRONG: Airtable is
    // frozen, so a row it still holds and Turso does not is stale by definition,
    // and resolving a lead against it would attach that lead to a site the
    // system no longer believes in. A miss is an unknown slug, full stop.
    //
    // What made the fallback load-bearing was a site created directly in the
    // Airtable UI, before the next hourly import. Nothing hand-creates rows
    // after the freeze, and `ensure-site` inserts straight into Turso (#608),
    // so the window it covered no longer exists either.
    if (strict) return null;
    return deps.fromAirtable(slug);
  };
}
