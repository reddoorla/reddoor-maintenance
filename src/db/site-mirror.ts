/** #539 Phase 5: the Turso write for the ONE-OFF Websites writers.
 *
 *  Phase 3 mirrored the nightly sweep — the audit write-back, github-signals and
 *  the next-due dates. It did not touch the writers that run on their own
 *  schedule or on demand: the analytics soft-fail stamp, the Renovate
 *  auto-fix counter, the prismic-models verdict, the launch stamp, the
 *  forms notify target, and the SINGLE-SITE audit write-back (only the fleet
 *  path ever passed a mirror). Each of those reached Turso solely via the hourly
 *  sync, which stopped existing at the freeze.
 *
 *  It lives in `src/db` rather than a feature folder because its callers span
 *  audits, recipes, CLI commands and the send path — no one feature owns it.
 *
 *  This never returns null. #585 is the reason: the health mirror factory once
 *  returned null without creds and the dual-write silently no-opped in
 *  production for weeks, because a dead mirror and a healthy one produced
 *  identical output — the only tell was an ABSENT log suffix nobody was watching
 *  for. Here an unreachable store throws at construction and every write logs
 *  one SITE_MIRROR line, so a missing line means the wiring is gone.
 */
import { openDb, readDbConfig, type Db } from "./client.js";
import { mirrorHealthFields, mirrorSiteFields } from "./fleet-state.js";

/** Two ops because a site row is split across two Turso tables. Callers pass a
 *  column-named FieldSet from the pure builders in `src/fleet/site-fields.ts`. */
export type SiteMirror = {
  /** Columns that live in `site_health`. */
  health: (siteId: string, fields: Record<string, unknown>) => Promise<void>;
  /** Columns that live in `sites`. */
  site: (siteId: string, fields: Record<string, unknown>) => Promise<void>;
};

/** Build the one-off writers' mirror. Never returns null.
 *  `open` is injectable for tests. */
export async function makeSiteMirror(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<SiteMirror> {
  let db: Db;
  try {
    db = await open();
  } catch (e) {
    // Refuse to hand back a mirror that cannot write. Failing at CONSTRUCTION
    // rather than per write matters — a caller holding a working-looking mirror
    // would run its whole batch before anyone noticed that nothing had persisted.
    throw new Error(`SITE_MIRROR unavailable: ${(e as Error).message}`, { cause: e });
  }

  const run = async (siteId: string, op: string, work: (db: Db) => Promise<boolean>) => {
    // Every path below logs EXACTLY ONE line before it throws, so a failed run
    // leaves a trace in the run log, not just a stack.
    let matched: boolean;
    try {
      matched = await work(db);
    } catch (e) {
      console.log(`SITE_MIRROR site=${siteId} op=${op} mirrored=0 error=${(e as Error).message}`);
      throw e;
    }
    // `missed` is its own outcome: the UPDATE matched no row. No importer
    // exists, so an absent row stays absent: it is a bug, not a wait, and
    // reporting it as mirrored=1 would claim a write that never landed.
    console.log(`SITE_MIRROR site=${siteId} op=${op} mirrored=${matched ? "1" : "missed"}`);
    if (!matched) {
      throw new Error(`SITE_MIRROR site=${siteId} op=${op}: no such row in Turso`);
    }
  };

  return {
    health: (siteId, fields) => run(siteId, "health", (d) => mirrorHealthFields(d, siteId, fields)),
    site: (siteId, fields) => run(siteId, "site", (d) => mirrorSiteFields(d, siteId, fields)),
  };
}
