/**
 * The fleet roster for batch jobs — every site row, read from Turso (#646 step 4).
 *
 * Every site, one `WebsiteRow` each — the rows the reader-equivalence
 * instrument pins field-for-field to `mapRow` (tests/db/fleet-state.test.ts).
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
