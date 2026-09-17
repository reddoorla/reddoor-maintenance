/**
 * The fleet roster for batch jobs — every site row, read from Turso (#646 step 4).
 *
 * Until step 4 each batch job (the audit write-back, `github-signals`,
 * `renovate-dispatch`, `header-image`, the Prismic verdict sink) listed sites
 * with the Airtable `listWebsites` and matched its results against that list.
 * Since step 3 a site created by `ensure-site` has a `site_<ULID>` id and no
 * Airtable record, so an Airtable roster is silently short: the site is never
 * swept, or it is swept and then fails its write-back with "no Websites row
 * matched". Turso holds every site.
 *
 * Same contract as `listWebsites` — every site, one `WebsiteRow` each — and the
 * rows are the ones the reader-equivalence instrument pins field-for-field to
 * Airtable's `mapRow` (tests/db/fleet-state.test.ts).
 *
 * The Airtable SHADOW writes these jobs still make are untouched: each Airtable
 * writer skips a non-`rec` id itself (`AIRTABLE_SHADOW skipped=non-rec-id`).
 *
 * `open` defaults to `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`; tests inject a temp
 * `file:` db or a whole `FleetRoster`. The connection this opens is closed before
 * returning — the roster is a snapshot, not a handle. The db stack is imported
 * lazily: `kysely` and the libSQL client are devDependencies.
 */
import type { Db } from "../db/client.js";
import type { WebsiteRow } from "./site-row.js";

/** A source of the fleet's site rows. Injected by tests; defaulted to Turso. */
export type FleetRoster = () => Promise<WebsiteRow[]>;

export async function readFleetRoster(open?: () => Promise<Db>): Promise<WebsiteRow[]> {
  const { listSites } = await import("../db/fleet-state.js");
  let opener = open;
  if (!opener) {
    const { openDb, readDbConfig } = await import("../db/client.js");
    opener = () => openDb(readDbConfig());
  }
  const db = await opener();
  try {
    return await listSites(db);
  } finally {
    await db.destroy();
  }
}
