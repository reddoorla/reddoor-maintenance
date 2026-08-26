/** #539 Phase 5: the Turso write-through for the ONE-OFF Websites writers.
 *
 *  Phase 3 mirrored the nightly sweep — the audit write-back, github-signals and
 *  the next-due dates. It did not touch the writers that run on their own
 *  schedule or on demand: the analytics soft-fail stamp, the Renovate
 *  auto-fix counter, the prismic-models verdict, `updateLaunched`, the
 *  forms notify target, and the SINGLE-SITE audit write-back (only the fleet
 *  path ever passed a mirror). Each of those reached Turso solely via the hourly
 *  sync, which stops existing at the freeze.
 *
 *  It lives in `src/db` rather than a feature folder because its callers span
 *  audits, recipes, CLI commands and the send path — no one feature owns it.
 *
 *  Deliberately UNLIKE `makeHealthMirrorBestEffort`, this never returns null.
 *  #585 is the reason: that factory returned null without creds and the
 *  dual-write silently no-opped in production for weeks, because a dead mirror
 *  and a healthy one produced identical output — the only tell was an ABSENT log
 *  suffix nobody was watching for. Here creds-absent is a state the mirror
 *  REPORTS, so a missing SITE_MIRROR line means the wiring is gone.
 */
import { openDb, readDbConfig, type Db } from "./client.js";
import { mirrorHealthFields, mirrorSiteFields, mirrorSiteInsert } from "./fleet-state.js";

/** Two ops because the Websites row is split across two Turso tables. Callers
 *  pass the EXACT FieldSet the Airtable writer returned, so the mirror can never
 *  carry a different payload than the write it shadows. */
export type SiteMirror = {
  /** A row Airtable just CREATED, as Airtable echoed it back (`ensure-site`).
   *  Every other op is an UPDATE, which does nothing for a row that does not
   *  exist yet — so without this a bootstrapped site is invisible to Turso and
   *  every mirror the rest of the bootstrap fires reports `mirrored=missed`. */
  created: (rec: { id: string; fields: Record<string, unknown> }) => Promise<void>;
  /** Columns that live in `site_health`. */
  health: (siteId: string, fields: Record<string, unknown>) => Promise<void>;
  /** Columns that live in `sites`. */
  site: (siteId: string, fields: Record<string, unknown>) => Promise<void>;
};

/** Build the one-off writers' mirror. Never throws and never returns null:
 *  Airtable is still authoritative through Phase 5, so a mirror problem must not
 *  cost the write it shadows — the hourly sync converges whatever this misses.
 *  `open` is injectable for tests. */
export async function makeSiteMirror(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<SiteMirror> {
  let db: Db | null = null;
  let why = "";
  try {
    db = await open();
  } catch (e) {
    why = (e as Error).message;
  }

  const run = async (siteId: string, op: string, work: (db: Db) => Promise<boolean>) => {
    if (!db) {
      console.log(`SITE_MIRROR site=${siteId} op=${op} mirrored=absent reason=${why}`);
      return;
    }
    try {
      // `missed` is its own outcome: the UPDATE matched no row because the
      // hourly sync has not imported this site yet. Reporting it as mirrored=1
      // would claim a write that never landed.
      const matched = await work(db);
      console.log(`SITE_MIRROR site=${siteId} op=${op} mirrored=${matched ? "1" : "missed"}`);
    } catch (e) {
      console.log(`SITE_MIRROR site=${siteId} op=${op} mirrored=0 error=${(e as Error).message}`);
    }
  };

  return {
    // An INSERT always lands, so it reports 1 rather than routing a row count
    // through `missed` — there was nothing to match in the first place.
    created: (rec) =>
      run(rec.id, "created", async (d) => {
        await mirrorSiteInsert(d, rec, new Date().toISOString());
        return true;
      }),
    health: (siteId, fields) => run(siteId, "health", (d) => mirrorHealthFields(d, siteId, fields)),
    site: (siteId, fields) => run(siteId, "site", (d) => mirrorSiteFields(d, siteId, fields)),
  };
}
