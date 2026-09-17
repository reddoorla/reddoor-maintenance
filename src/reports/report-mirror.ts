/** #539 Phase 5: the Turso write-through for the Reports write surface — and,
 *  since #646 step 4, the surface itself: `create` MINTS nothing (the creator
 *  does) but it is the only place a report row comes into existence, and
 *  `forSite` is the drafting path's read.
 *
 *  Before this, the only report mirrors were UPDATEs on the request path
 *  (approve, override, delivery status, commentary). Everything the DRAFTING
 *  path writes — the row itself, the rendered body, the queue flag, a re-run's
 *  refreshed scores — reached Turso only via the hourly sync. Two of those are
 *  visible to the operator today: a fresh draft's row does not exist, and its
 *  preview route answers "No rendered body stored" for up to an hour. At the
 *  freeze they stop being windows.
 *
 *  Deliberately UNLIKE `makeHealthMirrorBestEffort`, this never returns null.
 *  #585 is the reason: Phase 3's next-due mirror silently no-opped in production
 *  for weeks because the factory returned null without creds, and a dead
 *  dual-write then looked exactly like a healthy one — the only tell was an
 *  ABSENT log suffix nobody was watching for. Here creds-absent is a state the
 *  mirror REPORTS, so every write emits one REPORT_MIRROR line and an absent
 *  line means the wiring is gone, not that conditions were quiet.
 */
import { openDb, readDbConfig, type Db } from "../db/client.js";
import {
  getReportById,
  insertReportRow,
  listReportsForSite,
  mirrorReportInsert,
  mirrorReportPatch,
  storeRenderedHtml,
  type ReportMirrorPatch,
} from "../db/fleet-state.js";
import type { ReportRow } from "./report-row.js";
import { TURSO_IS_AUTHORITATIVE } from "../db/freeze.js";

/** The drafting path's whole report surface. Injected as ONE object rather than
 *  as separate parameters because they share a db handle and always travel
 *  together: a caller holding `create` but not `body` produces exactly the
 *  half-written state (row present, preview 404) this module exists to prevent.
 *
 *  Since #646 step 4 this is no longer only a mirror. `create` is the PRIMARY
 *  write — Turso mints the report id and owns the row, and there is no Airtable
 *  record for it to shadow (see `src/reports/create-report.ts`) — and `forSite`
 *  is a READ the drafting path used to make against Airtable, which cannot see a
 *  report for a `site_<ULID>` site. `body` and `patch` keep their older meaning:
 *  write-throughs for state whose `rec…` rows Airtable may still shadow. The name
 *  is kept because every composition root and every injection site already uses
 *  it, and a rename would churn ten files to say what this comment says. */
export type ReportMirror = {
  /** Insert a brand-new report row and return what Turso stored. Not a mirror:
   *  the row exists nowhere else. */
  create: (rec: { id: string; fields: Record<string, unknown> }) => Promise<ReportRow>;
  /** A row AIRTABLE created, as Airtable echoed it back — the pre-step-4 shape.
   *  NO production path calls it any more: it pairs with the legacy Airtable
   *  `createDraft`, which nothing calls either. Both are kept rather than
   *  deleted because deleting from the Airtable layer is step 6, and both go
   *  together when it comes. */
  created: (rec: { id: string; fields: Record<string, unknown> }) => Promise<void>;
  /** Every report for one site — the single-queue rule's and the period
   *  derivation's read. */
  forSite: (siteId: string) => Promise<ReportRow[]>;
  /** A freshly rendered body for an existing row. */
  body: (reportId: string, html: string) => Promise<void>;
  /** Columns just written to an existing row. */
  patch: (reportId: string, patch: ReportMirrorPatch) => Promise<void>;
};

/** Build the drafting-path mirror. Never throws and never returns null:
 *  Airtable is still authoritative through Phase 5, so a mirror problem must
 *  not cost a draft the operator is waiting on — the hourly sync converges
 *  whatever this misses. `open` is injectable for tests. */
export async function makeReportMirror(
  open: () => Promise<Db> = () => openDb(readDbConfig()),
  /** #612. `true` = Turso is the store that must succeed, so every failure
   *  throws instead of being logged and swallowed. Defaulted from the shipped
   *  constant and injected by tests, so both sides stay proven. */
  strict: boolean = TURSO_IS_AUTHORITATIVE,
): Promise<ReportMirror> {
  let db: Db | null = null;
  let why = "";
  try {
    db = await open();
  } catch (e) {
    why = (e as Error).message;
  }
  // Frozen: refuse to hand back a mirror that cannot write — see makeSiteMirror
  // for why this fails at construction rather than per write.
  if (strict && !db) throw new Error(`REPORT_MIRROR unavailable: ${why}`);

  const run = async (
    reportId: string,
    op: string,
    /** `false` = the UPDATE matched no row; void = a writer that reports no count. */
    work: (db: Db) => Promise<void | boolean>,
  ) => {
    if (!db) {
      console.log(`REPORT_MIRROR report=${reportId} op=${op} mirrored=absent reason=${why}`);
      return;
    }
    // Every path below logs EXACTLY ONE line, then strict adds a throw — the
    // run log reads the same in both worlds, not just a stack.
    let matched: boolean;
    try {
      matched = (await work(db)) !== false;
    } catch (e) {
      console.log(
        `REPORT_MIRROR report=${reportId} op=${op} mirrored=0 error=${(e as Error).message}`,
      );
      if (strict) throw e;
      return;
    }
    // `missed` is its own outcome (#647), the same one `makeSiteMirror` already
    // reports: the UPDATE matched no row. Before the freeze the hourly sync
    // would import the row — a transient; after it no importer exists, so an
    // absent row stays absent and reporting mirrored=1 would claim a write
    // that never landed.
    console.log(`REPORT_MIRROR report=${reportId} op=${op} mirrored=${matched ? "1" : "missed"}`);
    if (strict && !matched) {
      throw new Error(`REPORT_MIRROR report=${reportId} op=${op}: no such row in Turso`);
    }
  };

  /** The two READS. They take the same handle but none of `run`'s write
   *  semantics: there is no `mirrored=` outcome to report for a read, and a read
   *  that cannot reach the store is never something to swallow — under the freeze
   *  a missing handle already threw at construction, so this only restates it for
   *  the non-strict world, where a drafting read silently answering "no reports"
   *  would break the single-queue rule instead of failing. */
  const reading = (op: string): Db => {
    if (!db) throw new Error(`REPORT_MIRROR op=${op} unavailable: ${why}`);
    return db;
  };

  return {
    create: async (rec) => {
      await run(rec.id, "create", (d) => insertReportRow(d, rec));
      // Read back rather than map the input: the caller gets what Turso STORED,
      // so a coercion in the mapper can never diverge the returned row from the
      // persisted one. The same rule the Airtable create followed by returning
      // Airtable's echo.
      const row = await getReportById(reading("create"), rec.id);
      if (!row)
        throw new Error(`REPORT_MIRROR report=${rec.id} op=create: row not found after insert`);
      return row;
    },
    created: (rec) => run(rec.id, "created", (d) => mirrorReportInsert(d, rec)),
    // `async` so a missing handle REJECTS rather than throwing synchronously —
    // every caller awaits this, and a synchronous throw would escape a
    // `.catch()` written around the await.
    forSite: async (siteId) => listReportsForSite(reading("forSite"), siteId),
    body: (reportId, html) => run(reportId, "body", (d) => storeRenderedHtml(d, reportId, html)),
    patch: (reportId, patch) =>
      run(reportId, "patch", (d) => mirrorReportPatch(d, reportId, patch)),
  };
}
