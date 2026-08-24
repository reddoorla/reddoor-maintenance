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

export type SiteLookupDeps = {
  fromDb: (slug: string) => Promise<WebsiteRow | null>;
  fromAirtable: (slug: string) => Promise<WebsiteRow | null>;
};

export function makeSiteLookup(deps: SiteLookupDeps): (slug: string) => Promise<WebsiteRow | null> {
  return async (slug) => {
    const hit = await deps.fromDb(slug);
    if (hit) return hit;
    return deps.fromAirtable(slug);
  };
}
