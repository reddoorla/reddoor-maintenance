/** The EXPLAIN-query-plan gate (#539 Phase 1 guard-rail, built before Phase 2's
 *  readers land): every query the request-path db modules actually execute is
 *  captured at the driver and run through EXPLAIN QUERY PLAN; a raw full-table
 *  scan of a real table fails the build. Three closures keep the gate honest:
 *
 *  1. Module completeness — every file in src/db must be classified GATED or
 *     EXEMPT (with a written justification). A new Phase 2 reader module fails
 *     the build until it is brought under the gate.
 *  2. Export completeness — every function a gated module exports must be
 *     exercised by a scenario (or listed pure). A new query function fails the
 *     build until the gate sees its plan.
 *  3. Vacuity — every scenario must capture at least one statement. Several db
 *     functions legitimately early-return without touching the db
 *     (markSubmissionsSpamRetro([]), listRecentSubmissionsForEmail("")); a
 *     scenario that silently exercised nothing is a harness failure, not a pass.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openCapturingDb,
  schemaTables,
  explainQueryPlan,
  rawScanTables,
} from "./query-plan-harness.js";
import * as submissions from "../../src/db/submissions.js";
import * as screenouts from "../../src/db/screenouts.js";
import * as fleetEvents from "../../src/db/fleet-events.js";
import * as deadletter from "../../src/db/deadletter.js";
import * as fleetState from "../../src/db/fleet-state.js";
import * as digestState from "../../src/db/digest-state.js";
import * as prospectAudits from "../../src/db/prospect-audits.js";
import type { Db } from "../../src/db/client.js";
import type { SubmissionFilter } from "../../src/db/submissions.js";

const SRC_DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/db");

/** Modules whose exported query functions the gate exercises below. */
const GATED_MODULES: Record<string, Record<string, unknown>> = {
  "submissions.ts": submissions,
  "screenouts.ts": screenouts,
  "fleet-events.ts": fleetEvents,
  "deadletter.ts": deadletter,
  "fleet-state.ts": fleetState,
  "prospect-audits.ts": prospectAudits,
  "digest-state.ts": digestState,
};

/** Modules the gate deliberately does not plan-check. Every entry needs a reason
 *  a reviewer can veto. */
const EXEMPT_MODULES: Record<string, string> = {
  "client.ts": "connection factory — no queries of its own",
  "migrate.ts": "migration runner — DDL, not a query path",
  "migrations.ts": "DDL scripts",
  "schema.ts": "types only",
  "import-airtable.ts": "one-shot bulk importer — full-table upserts by design, not request-path",
  "parity.ts": "parity harness — full-table comparison is the whole point",
  "dump.ts": "backup dump — full-table reads by design",
  "sync.ts": "orchestrates importer + parity (both exempt) — no queries of its own",
  "header-images.ts": "one-shot backfill + CLI dual-write — bulk by-PK writes, not request-path",
  "site-mirror.ts":
    "best-effort write-through wrapper — issues no SQL of its own, delegates to " +
    "fleet-state's mirrorHealthFields/mirrorSiteFields, which are gated below",
  "freeze.ts": "a single exported constant — no queries, no runtime behaviour of its own",
};

/** Exported functions that never issue SQL (id minting, date math). */
const PURE_EXPORTS = new Set([
  "newSubmissionId",
  "screenOutsSince",
  "newDeadLetterId",
  "generateToken",
  "isValidToken",
  "newProspectAuditId",
]);

/** Raw scans accepted with a written justification. Empty today — the 0008
 *  indexes cover every hot path — but the mechanism stays so a future entry is
 *  a reviewed, named decision instead of a silent regression. */
const ALLOWED_RAW_SCANS: Array<{ scenario: string; table: string; why: string }> = [
  {
    scenario: "listSites (fleet-wide read: cockpit, browse, submissions filter)",
    table: "sites",
    why: "reads all ~44 sites by design; bounded by fleet size, not data growth",
  },
  {
    scenario: "listAllReports (cockpit fleet read)",
    table: "reports",
    why: "the cockpit reads every report today (13 rows, ~44/month growth) — window it before Phase 4's report review adds volume",
  },
  // The two SubmissionFilter shapes that cannot be served by any B-tree index.
  // Both are `LIKE '%…%'` with a LEADING wildcard — `search` ORs it across four
  // columns, `reason` applies it to a `',' || spam_reason || ','` expression — and
  // SQLite has no index form for either. The count sibling has no LIMIT to stop it
  // early, so it decodes the whole table.
  //
  // Accepted rather than fixed, on two grounds: /submissions is operator-only
  // (behind the dashboard gate), so the frequency is bounded by one person's
  // typing rather than by fleet traffic; and the alternative is an FTS5 virtual
  // table plus triggers, which is a real feature, not a tweak.
  //
  // NOT accepted forever. `submissions` is the one unbounded-growth table (354
  // rows today, append-only, one per fleet lead) and Turso meters row scans, so
  // the cost of one search rises linearly and never falls. Revisit at ~10k rows,
  // or sooner if the submissions page ever becomes client-facing — at which point
  // the answer is FTS5 for `search` and a normalised reason table for `reason`.
  {
    scenario: "countSubmissionsFiltered: search",
    table: "submissions",
    why: "LIKE '%term%' across name/email/message/phone — unindexable in SQLite without FTS5; operator-only page, revisit at ~10k rows",
  },
  {
    scenario: "countSubmissionsFiltered: reason",
    table: "submissions",
    why: "comma-boundary LIKE on a concatenation expression — no index can serve it; operator-only page, revisit at ~10k rows",
  },
  // Unindexable-by-shape aggregates, made VISIBLE by tightening the detector (an
  // index-ordered SCAN with no LIMIT reads every row, and Turso bills rows). All
  // four were invisible under the old "any USING is fine" rule.
  //
  // These are not "fine" — they are accepted for now and named so a reviewer can
  // veto them. The real fix is MED-16 of the 2026-08-26 review: these cockpit
  // strips are slow-moving "since a window" numbers that belong in the nightly
  // digest_state singleton the homepage already reads by primary key. That trade
  // makes the figures up to 24h stale, which is an operator call, not mine.
  {
    scenario: "countSubmissionsFiltered: no filters",
    table: "submissions",
    why: "COUNT(*) with no WHERE and no LIMIT — an unfiltered total cannot be anything but a full read; request path (submissions page), 354 rows today",
  },
  {
    scenario: "countNotifyBouncedBySite",
    table: "submissions",
    why: "BATCH ONLY since MED-16 — the nightly digest computes it into the cockpit roll-up; the fleet homepage reads that row by primary key and no longer aggregates per request",
  },
  {
    scenario: "listScreenOutsSince (window on date + marked-spam count)",
    table: "spam_screenouts",
    why: "BATCH ONLY since MED-16 — same roll-up. Bounded by sites × days regardless, but it no longer runs on a request path",
  },
  {
    scenario: "countSubmissionsSinceBySite (digest telemetry)",
    table: "submissions",
    why: "batch only — the digest cron, once a day; a full read is the correct shape for a per-site tally",
  },
];

type Scenario = { name: string; covers: string[]; run: (db: Db) => Promise<unknown> };

const SINCE_DATE = "2026-08-01";
const SINCE_ISO = "2026-08-01T00:00:00.000Z";

/**
 * One representative value per `SubmissionFilter` key.
 *
 * The gate used to name its scenarios by hand, and that is how three request-path
 * raw scans shipped green: `countSubmissionsFiltered` had exactly two scenarios
 * (`{}` and `{siteId}`), both of which happen to land on an index, while its
 * `search` / `reason` / `formType` shapes were never planned at all. Its
 * `listSubmissionsFiltered` sibling — same filter, same request — did get an
 * "every WHERE shape" scenario, and the export-completeness check passed because
 * it matches function NAMES, not predicate shapes.
 *
 * Driving both functions off this one record fixes the class rather than the three
 * instances: adding a key to `SubmissionFilter` without adding it here fails
 * `covers every SubmissionFilter key`, and every key that IS here gets planned
 * against every filtered function automatically.
 */
const FILTER_CASES = {
  siteId: { siteId: "recA" },
  formType: { formType: "contact" as const },
  status: { status: "new" as const },
  search: { search: "ada" },
  from: { from: SINCE_ISO },
  to: { to: "2026-08-31T23:59:59.000Z" },
  reason: { reason: "keywords" },
} satisfies Record<keyof SubmissionFilter, SubmissionFilter>;

/** Every filter shape × every function that takes a `SubmissionFilter`, plus the
 *  unfiltered case each runs on a bare page load. */
function submissionFilterMatrix(): Scenario[] {
  const filtered: Array<{
    fn: string;
    run: (db: Db, f: SubmissionFilter) => Promise<unknown>;
  }> = [
    {
      fn: "listSubmissionsFiltered",
      run: (db, f) => submissions.listSubmissionsFiltered(db, f, { limit: 50, offset: 0 }),
    },
    { fn: "countSubmissionsFiltered", run: (db, f) => submissions.countSubmissionsFiltered(db, f) },
  ];
  const out: Scenario[] = [];
  for (const { fn, run } of filtered) {
    out.push({ name: `${fn}: no filters`, covers: [fn], run: (db) => run(db, {}) });
    for (const [key, filter] of Object.entries(FILTER_CASES)) {
      out.push({ name: `${fn}: ${key}`, covers: [fn], run: (db) => run(db, filter) });
    }
    // Everything at once — the shape the submissions page sends when the operator
    // has filled in the whole filter bar.
    out.push({
      name: `${fn}: every filter at once`,
      covers: [fn],
      run: (db) => run(db, Object.assign({}, ...Object.values(FILTER_CASES)) as SubmissionFilter),
    });
  }
  return out;
}

/** ≥ MIN_DUP_BODY_LEN chars and ≥ MIN_SIMILAR_TOKENS distinct tokens, so the
 *  duplicate scan passes BOTH eligibility gates and actually queries. */
const LONG_MESSAGE =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike " +
  "november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu";

function scenarios(state: { createdId: string }): Scenario[] {
  let prospectToken = "";
  return [
    {
      name: "createSubmission (seeds the db; display number = MAX+1 subquery)",
      covers: ["createSubmission", "getSubmissionById"],
      run: async (db) => {
        const row = await submissions.createSubmission(db, {
          siteId: "recA",
          formType: "contact",
          name: "Ada",
          email: "ada@example.com",
          message: LONG_MESSAGE,
          submittedAt: new Date("2026-08-10T12:00:00.000Z"),
        });
        state.createdId = row.id;
      },
    },
    {
      name: "listNewSubmissions (cockpit unread strip)",
      covers: ["listNewSubmissions"],
      run: (db) => submissions.listNewSubmissions(db),
    },
    {
      name: "listSubmissionsForSite",
      covers: ["listSubmissionsForSite"],
      run: (db) => submissions.listSubmissionsForSite(db, { id: "recA", name: "Acme" }),
    },
    {
      name: "setSubmissionStatusRow",
      covers: ["setSubmissionStatusRow"],
      run: (db) => submissions.setSubmissionStatusRow(db, state.createdId, "read"),
    },
    {
      name: "stampNotified",
      covers: ["stampNotified"],
      run: (db) => submissions.stampNotified(db, state.createdId, "sent", "re_gate_msg"),
    },
    {
      name: "stampFanout",
      covers: ["stampFanout"],
      run: (db) => submissions.stampFanout(db, state.createdId, "crm:ok"),
    },
    ...submissionFilterMatrix(),
    {
      name: "countAutoSpamSince",
      covers: ["countAutoSpamSince"],
      run: (db) => submissions.countAutoSpamSince(db, SINCE_DATE),
    },
    {
      name: "countSubmissionsSinceBySite (digest telemetry)",
      covers: ["countSubmissionsSinceBySite"],
      run: (db) => submissions.countSubmissionsSinceBySite(db, SINCE_ISO),
    },
    {
      name: "findRecentDuplicateSubmissions (spray scan)",
      covers: ["findRecentDuplicateSubmissions"],
      run: (db) => submissions.findRecentDuplicateSubmissions(db, LONG_MESSAGE, SINCE_DATE),
    },
    {
      name: "listRecentSubmissionsForEmail (repeat-sender scan)",
      covers: ["listRecentSubmissionsForEmail"],
      run: (db) => submissions.listRecentSubmissionsForEmail(db, "ada@example.com", SINCE_DATE),
    },
    {
      name: "markSubmissionsSpamRetro (non-empty ids — [] early-returns)",
      covers: ["markSubmissionsSpamRetro"],
      run: (db) => submissions.markSubmissionsSpamRetro(db, [state.createdId], "retro-dup"),
    },
    {
      name: "listSpamReasonsFiltered (facet tally)",
      covers: ["listSpamReasonsFiltered"],
      run: (db) => submissions.listSpamReasonsFiltered(db, {}),
    },
    {
      name: "backfillSubmission",
      covers: ["backfillSubmission"],
      run: (db) =>
        submissions.backfillSubmission(db, {
          id: "sub_backfill_gate",
          submissionId: 999,
          siteId: "recB",
          formType: "newsletter",
          name: "Bea",
          email: "bea@example.com",
          phone: null,
          message: null,
          extraFields: null,
          sourceUrl: null,
          utm: null,
          submittedAt: "2026-08-11T00:00:00.000Z",
          status: "new",
          notifyStatus: "skipped",
          resendMessageId: null,
          spamScore: null,
          spamReason: null,
          fanoutStatus: null,
        }),
    },
    {
      name: "rescoreSubmissionSpam",
      covers: ["rescoreSubmissionSpam"],
      run: (db) => submissions.rescoreSubmissionSpam(db, "sub_backfill_gate", 80, "retro-rescore"),
    },
    {
      name: "markFilteredAsRead (bulk triage with id-subquery)",
      covers: ["markFilteredAsRead"],
      run: (db) => submissions.markFilteredAsRead(db, { siteId: "recA" }),
    },
    {
      name: "markNotifyBouncedByMessageId (webhook bounce lookup)",
      covers: ["markNotifyBouncedByMessageId"],
      run: (db) => submissions.markNotifyBouncedByMessageId(db, "re_gate_msg"),
    },
    {
      name: "countNotifyBouncedBySite",
      covers: ["countNotifyBouncedBySite"],
      run: (db) => submissions.countNotifyBouncedBySite(db, SINCE_DATE),
    },
    {
      name: "recordScreenOut (ingest-path upsert)",
      covers: ["recordScreenOut"],
      run: (db) => screenouts.recordScreenOut(db, "recA", "honeypot", "2026-08-10"),
    },
    {
      name: "listScreenOutsSince (window on date + marked-spam count)",
      covers: ["listScreenOutsSince"],
      run: (db) => screenouts.listScreenOutsSince(db, SINCE_DATE),
    },
    {
      name: "backfillScreenoutBucket",
      covers: ["backfillScreenoutBucket"],
      run: (db) =>
        screenouts.backfillScreenoutBucket(db, {
          siteId: "recA",
          date: "2026-08-09",
          honeypot: 2,
          tooFast: 1,
          markedSpam: 0,
        }),
    },
    {
      name: "recordFleetEvent",
      covers: ["recordFleetEvent"],
      run: (db) =>
        fleetEvents.recordFleetEvent(db, {
          id: "evt_gate_1",
          ts: "2026-08-10T00:00:00.000Z",
          type: "pr_automerged",
          siteId: null,
          siteName: null,
          summary: "gate probe",
          data: null,
        }),
    },
    {
      name: "listFleetEvents (feed window)",
      covers: ["listFleetEvents"],
      run: (db) => fleetEvents.listFleetEvents(db, { sinceIso: SINCE_ISO, limit: 50 }),
    },
    {
      name: "pruneFleetEvents",
      covers: ["pruneFleetEvents"],
      run: (db) => fleetEvents.pruneFleetEvents(db, "2026-01-01T00:00:00.000Z"),
    },
    {
      name: "getSiteBySlug (form ingest / site detail lookup)",
      covers: ["getSiteBySlug"],
      run: (db) => fleetState.getSiteBySlug(db, "acme-gallery"),
    },
    {
      name: "getSiteById (approve-report lookup)",
      covers: ["getSiteById"],
      run: (db) => fleetState.getSiteById(db, "recA"),
    },
    {
      name: "listSites (fleet-wide read: cockpit, browse, submissions filter)",
      covers: ["listSites"],
      run: (db) => fleetState.listSites(db),
    },
    {
      name: "listAllReports (cockpit fleet read)",
      covers: ["listAllReports"],
      run: (db) => fleetState.listAllReports(db),
    },
    {
      name: "listReportsForSite (site page)",
      covers: ["listReportsForSite"],
      run: (db) => fleetState.listReportsForSite(db, "recA"),
    },
    {
      name: "getReportById (approve gate read)",
      covers: ["getReportById"],
      run: (db) => fleetState.getReportById(db, "recA"),
    },
    {
      name: "getReportHtml (preview route)",
      covers: ["getReportHtml"],
      run: (db) => fleetState.getReportHtml(db, "recA"),
    },
    {
      name: "mirrorSiteField (editor write-through)",
      covers: ["mirrorSiteField"],
      run: (db) => fleetState.mirrorSiteField(db, "recA", "Status", "maintenance"),
    },
    {
      // #609. Both readers need the WHOLE snapshot, which is exactly why it is
      // one JSON row rather than a keyed table: this stays a primary-key lookup
      // instead of the raw scan a "give me every key" query would be.
      name: "readDigestState (digest diff + fleet-homepage NEW badges)",
      covers: ["readDigestState"],
      run: (db) => digestState.readDigestState(db),
    },
    {
      name: "writeDigestState (singleton upsert)",
      covers: ["writeDigestState"],
      run: (db) => digestState.writeDigestState(db, {}, "2026-08-26T00:00:00.000Z"),
    },
    {
      // The cockpit roll-up (MED-16). It exists precisely so the fleet homepage
      // stops aggregating over `submissions` per request — so this read landing
      // on anything but a primary-key lookup would defeat its own purpose.
      name: "readCockpitRollup (fleet-homepage spam + bounce strips)",
      covers: ["readCockpitRollup"],
      run: (db) => digestState.readCockpitRollup(db),
    },
    {
      name: "writeCockpitRollup (nightly digest upsert)",
      covers: ["writeCockpitRollup"],
      run: (db) =>
        digestState.writeCockpitRollup(db, {
          spamTotals: { honeypot: 0, tooFast: 0, markedSpam: 0 },
          notifyBounces: {},
          windowDays: { screenOuts: 30, bounces: 14 },
          computedAt: "2026-08-26T00:00:00.000Z",
        }),
    },
    {
      // The site-create mirror (#539 Phase 5). Three upserts, each resolving its
      // conflict on a PK — an unindexed conflict target would scan `sites` on
      // every bootstrap, and that table carries the header-image BLOBs.
      name: "mirrorSiteInsert (ensure-site write-through)",
      covers: ["mirrorSiteInsert"],
      run: (db) =>
        fleetState.mirrorSiteInsert(
          db,
          { id: "recA", fields: { Name: "Acme Gallery" } },
          "2026-08-25T12:00:00.000Z",
        ),
    },
    {
      // The multi-column form (#539 Phase 5). Same by-PK predicate, but it is
      // the one the one-off writers go through, so it is gated in its own right
      // rather than inheriting mirrorSiteField's verdict.
      name: "mirrorSiteFields (one-off writers' write-through)",
      covers: ["mirrorSiteFields"],
      run: (db) =>
        fleetState.mirrorSiteFields(db, "recA", {
          Status: "maintained",
          "Launched at": "2026-08-25",
        }),
    },
    {
      name: "mirrorReportPatch (approve/webhook write-through)",
      covers: ["mirrorReportPatch"],
      run: (db) => fleetState.mirrorReportPatch(db, "recA", { approved_to_send: 1 }),
    },
    {
      // The create-side mirror (#539 Phase 5). Its upsert resolves the conflict
      // on `reports.id`, so the plan must land on the PK — an unindexed
      // conflict target would scan the whole HTML-bearing table on every draft.
      name: "mirrorReportInsert (create-side write-through)",
      covers: ["mirrorReportInsert"],
      run: (db) =>
        fleetState.mirrorReportInsert(db, { id: "recA", fields: { "Report ID": "acme-2026-08" } }),
    },
    {
      // Writes a whole rendered body by PK. Gated like every other reports
      // write: an unindexed predicate here would scan a table whose rows carry
      // ~50–90 KB of HTML each.
      name: "storeRenderedHtml (on-demand preview refresh)",
      covers: ["storeRenderedHtml"],
      run: (db) => fleetState.storeRenderedHtml(db, "recA", "<html>x</html>"),
    },
    {
      name: "mirrorHealthFields (nightly audit write-through)",
      covers: ["mirrorHealthFields"],
      run: (db) => fleetState.mirrorHealthFields(db, "recA", { "Smoke OK": "pass" }),
    },
    {
      name: "mirrorScheduleFields (next-due write-through)",
      covers: ["mirrorScheduleFields"],
      run: (db) =>
        fleetState.mirrorScheduleFields(
          db,
          "recA",
          { "Next maintenance at": "2026-09-01" },
          "2026-08-24T00:00:00.000Z",
        ),
    },
    {
      name: "createDeadLetter",
      covers: ["createDeadLetter"],
      run: (db) =>
        deadletter.createDeadLetter(db, {
          siteSlug: "acme",
          payload: { name: "Ada" },
          turnstile: { outcome: "pass", hostname: "acme.example.com" },
          error: "gate probe",
          receivedAt: new Date("2026-08-10T00:00:00.000Z"),
        }),
    },
    {
      name: "listUnreplayedDeadLetters",
      covers: ["listUnreplayedDeadLetters"],
      run: (db) => deadletter.listUnreplayedDeadLetters(db),
    },
    {
      name: "markDeadLetterReplayed",
      covers: ["markDeadLetterReplayed"],
      run: async (db) => {
        const [row] = await deadletter.listUnreplayedDeadLetters(db);
        if (!row) throw new Error("dead-letter row vanished");
        await deadletter.markDeadLetterReplayed(
          db,
          row.id,
          "accepted",
          "sub_x",
          new Date("2026-08-11T00:00:00.000Z"),
        );
      },
    },
    {
      name: "createProspectAudit (prospect-audit CLI write)",
      covers: ["createProspectAudit"],
      run: async (db) => {
        const { token } = await prospectAudits.createProspectAudit(db, {
          url: "https://prospect.example.com",
          business: "Prospect Co",
          resultJson: "{}",
        });
        prospectToken = token;
      },
    },
    {
      name: "getProspectAuditByToken (public /r/{token} read)",
      covers: ["getProspectAuditByToken"],
      run: (db) => prospectAudits.getProspectAuditByToken(db, prospectToken),
    },
    {
      name: "listRecentProspectAudits (cockpit /audits listing)",
      covers: ["listRecentProspectAudits"],
      run: (db) => prospectAudits.listRecentProspectAudits(db, 5),
    },
  ];
}

describe("EXPLAIN-query-plan gate", () => {
  it("classifies every src/db module as gated or exempt", () => {
    const files = fs.readdirSync(SRC_DB_DIR).filter((f) => f.endsWith(".ts"));
    const unclassified = files.filter((f) => !(f in GATED_MODULES) && !(f in EXEMPT_MODULES));
    expect(unclassified, "new src/db module must be gated or exempted with a reason").toEqual([]);
    const stale = [...Object.keys(GATED_MODULES), ...Object.keys(EXEMPT_MODULES)].filter(
      (f) => !files.includes(f),
    );
    expect(stale, "classification names a module that no longer exists").toEqual([]);
  });

  it("every exported query function of a gated module is exercised by a scenario", () => {
    const exercised = new Set(scenarios({ createdId: "" }).flatMap((s) => s.covers));
    const missing: string[] = [];
    for (const [file, mod] of Object.entries(GATED_MODULES)) {
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== "function") continue;
        if (PURE_EXPORTS.has(name)) continue;
        if (!exercised.has(name)) missing.push(`${file}#${name}`);
      }
    }
    expect(missing, "unexercised db export — add a scenario or mark it pure").toEqual([]);
    // The reverse direction: a scenario claiming to cover a function that does
    // not exist (renamed export) is a silent coverage hole.
    const allExports = new Set(
      Object.values(GATED_MODULES).flatMap((mod) =>
        Object.entries(mod)
          .filter(([, v]) => typeof v === "function")
          .map(([name]) => name),
      ),
    );
    const phantom = [...exercised].filter((name) => !allExports.has(name));
    expect(phantom, "scenario covers a function that is not exported").toEqual([]);
  });

  it("the filter matrix plans every SubmissionFilter key against every filtered function", () => {
    // `FILTER_CASES` is `satisfies Record<keyof SubmissionFilter, …>`, so a new
    // filter key fails to compile until it is added — this asserts the other
    // direction at runtime, and that both functions really are driven off it.
    const names = submissionFilterMatrix().map((s) => s.name);
    for (const fn of ["listSubmissionsFiltered", "countSubmissionsFiltered"]) {
      for (const key of Object.keys(FILTER_CASES)) {
        expect(names, `${fn} has no scenario for the ${key} filter`).toContain(`${fn}: ${key}`);
      }
      expect(names).toContain(`${fn}: no filters`);
      expect(names).toContain(`${fn}: every filter at once`);
    }
  });

  it("no query a gated module executes raw-scans a table", async () => {
    const h = await openCapturingDb();
    const tables = await schemaTables(h.client);
    const state = { createdId: "" };
    const violations: Array<{ scenario: string; table: string; detail: string; sql: string }> = [];
    const observed = new Set<string>();
    let statementCount = 0;
    let scenarioCount = 0;

    for (const scenario of scenarios(state)) {
      const before = h.captured.length;
      await scenario.run(h.db);
      const stmts = h.captured.slice(before);
      expect(
        stmts.length,
        `scenario "${scenario.name}" executed no SQL — vacuous, fix its arguments`,
      ).toBeGreaterThan(0);
      scenarioCount++;
      for (const stmt of stmts) {
        statementCount++;
        const details = await explainQueryPlan(h.client, stmt);
        for (const table of rawScanTables(details, tables, stmt.sql)) {
          observed.add(`${scenario.name}|${table}`);
          const allowed = ALLOWED_RAW_SCANS.some(
            (a) => a.scenario === scenario.name && a.table === table,
          );
          if (!allowed) {
            violations.push({
              scenario: scenario.name,
              table,
              detail: details.join(" | "),
              sql: stmt.sql,
            });
          }
        }
      }
    }

    console.log(
      `DB_QUERY_PLAN scenarios=${scenarioCount} statements=${statementCount} raw_scans=${violations.length}`,
    );
    expect(violations, "raw full-table scan — add an index or an ALLOWED_RAW_SCANS entry").toEqual(
      [],
    );

    // An allowlist entry that no longer describes a real scan is dead permission:
    // it keeps a name exempted after the scenario is renamed or an index makes it
    // unnecessary, and silently re-permits a future regression that happens to
    // reuse the name. Every entry must still be earning its place.
    const stale = ALLOWED_RAW_SCANS.filter((a) => !observed.has(`${a.scenario}|${a.table}`)).map(
      (a) => `${a.scenario} -> ${a.table}`,
    );
    expect(stale, "ALLOWED_RAW_SCANS entry no longer matches a real raw scan — delete it").toEqual(
      [],
    );
  });

  // ————— Prove the instrument (both directions) before trusting its verdict —————

  it("detector unit: flags a bare SCAN of a real table, nothing else", () => {
    const tables = new Set(["submissions"]);
    expect(rawScanTables(["SCAN submissions"], tables)).toEqual(["submissions"]);
    expect(
      rawScanTables(
        [
          "SEARCH submissions USING INDEX idx_submissions_site_submitted (site_id=?)",
          "SCAN 2 CONSTANT ROWS",
          "SCAN (subquery-1)",
          "USE TEMP B-TREE FOR ORDER BY",
        ],
        tables,
      ),
    ).toEqual([]);
  });

  it("detector unit: an index-ordered SCAN counts unless a LIMIT can stop it", () => {
    // The old rule skipped anything containing `USING`, on the reasoning that an
    // index-ordered traversal under a LIMIT stops early. True — but only when
    // there IS a limit. An aggregate has none and reads every row through the
    // index, which on a row-scan-metered store costs exactly what a raw scan does.
    const tables = new Set(["submissions"]);
    const indexScan = ["SCAN submissions USING COVERING INDEX idx_submissions_status"];

    // Both states, so this cannot pass by always answering the same way.
    expect(rawScanTables(indexScan, tables, "select count(*) from submissions")).toEqual([
      "submissions",
    ]);
    expect(rawScanTables(indexScan, tables, "select * from submissions limit 50")).toEqual([]);

    // With no SQL supplied the detector cannot know, and must not silently excuse.
    expect(rawScanTables(indexScan, tables)).toEqual(["submissions"]);
    // A SEARCH is a seek, not a traversal — never flagged, limit or no limit.
    expect(
      rawScanTables(
        ["SEARCH submissions USING INDEX idx_submissions_status (status=?)"],
        tables,
        "select count(*) from submissions where status = ?",
      ),
    ).toEqual([]);
  });

  it("live known-bad probe: an unindexed predicate IS reported as a raw scan", async () => {
    const h = await openCapturingDb();
    const tables = await schemaTables(h.client);
    // email has no index — this genuinely full-scans.
    const details = await explainQueryPlan(h.client, {
      sql: "SELECT * FROM submissions WHERE email = ?",
      args: ["x@example.com"],
    });
    expect(rawScanTables(details, tables)).toEqual(["submissions"]);
  });

  it("live known-good probe: an indexed predicate is SEARCHed and not flagged", async () => {
    const h = await openCapturingDb();
    const tables = await schemaTables(h.client);
    const details = await explainQueryPlan(h.client, {
      sql: "SELECT * FROM submissions WHERE site_id = ? ORDER BY submitted_at DESC",
      args: ["recA"],
    });
    expect(details.some((d) => d.startsWith("SEARCH submissions USING INDEX"))).toBe(true);
    expect(rawScanTables(details, tables)).toEqual([]);
  });
});
