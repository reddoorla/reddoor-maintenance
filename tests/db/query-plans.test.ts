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
import * as prospectAudits from "../../src/db/prospect-audits.js";
import type { Db } from "../../src/db/client.js";

const SRC_DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/db");

/** Modules whose exported query functions the gate exercises below. */
const GATED_MODULES: Record<string, Record<string, unknown>> = {
  "submissions.ts": submissions,
  "screenouts.ts": screenouts,
  "fleet-events.ts": fleetEvents,
  "deadletter.ts": deadletter,
  "fleet-state.ts": fleetState,
  "prospect-audits.ts": prospectAudits,
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
};

/** Exported functions that never issue SQL (id minting, date math). */
const PURE_EXPORTS = new Set([
  "newSubmissionId",
  "screenOutsSince",
  "newDeadLetterId",
  "generateToken",
  "isValidToken",
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
];

type Scenario = { name: string; covers: string[]; run: (db: Db) => Promise<unknown> };

/** ≥ MIN_DUP_BODY_LEN chars and ≥ MIN_SIMILAR_TOKENS distinct tokens, so the
 *  duplicate scan passes BOTH eligibility gates and actually queries. */
const LONG_MESSAGE =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike " +
  "november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu";

const SINCE_DATE = "2026-08-01";
const SINCE_ISO = "2026-08-01T00:00:00.000Z";

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
    {
      name: "listSubmissionsFiltered: default page (no filters — the /submissions landing view)",
      covers: ["listSubmissionsFiltered"],
      run: (db) => submissions.listSubmissionsFiltered(db, {}, { limit: 50, offset: 0 }),
    },
    {
      name: "listSubmissionsFiltered: by site",
      covers: ["listSubmissionsFiltered"],
      run: (db) =>
        submissions.listSubmissionsFiltered(db, { siteId: "recA" }, { limit: 50, offset: 0 }),
    },
    {
      name: "listSubmissionsFiltered: by status",
      covers: ["listSubmissionsFiltered"],
      run: (db) =>
        submissions.listSubmissionsFiltered(db, { status: "new" }, { limit: 50, offset: 0 }),
    },
    {
      name: "listSubmissionsFiltered: search + form type + window + reason (every WHERE shape)",
      covers: ["listSubmissionsFiltered"],
      run: (db) =>
        submissions.listSubmissionsFiltered(
          db,
          {
            formType: "contact",
            search: "ada",
            from: SINCE_ISO,
            to: "2026-08-31T23:59:59.000Z",
            reason: "keywords",
          },
          { limit: 50, offset: 0 },
        ),
    },
    {
      name: "countSubmissionsFiltered: no filters (page total)",
      covers: ["countSubmissionsFiltered"],
      run: (db) => submissions.countSubmissionsFiltered(db, {}),
    },
    {
      name: "countSubmissionsFiltered: by site",
      covers: ["countSubmissionsFiltered"],
      run: (db) => submissions.countSubmissionsFiltered(db, { siteId: "recA" }),
    },
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
      name: "mirrorReportPatch (approve/webhook write-through)",
      covers: ["mirrorReportPatch"],
      run: (db) => fleetState.mirrorReportPatch(db, "recA", { approved_to_send: 1 }),
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

  it("no query a gated module executes raw-scans a table", async () => {
    const h = await openCapturingDb();
    const tables = await schemaTables(h.client);
    const state = { createdId: "" };
    const violations: Array<{ scenario: string; table: string; detail: string; sql: string }> = [];
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
        for (const table of rawScanTables(details, tables)) {
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
  });

  // ————— Prove the instrument (both directions) before trusting its verdict —————

  it("detector unit: flags a bare SCAN of a real table, nothing else", () => {
    const tables = new Set(["submissions"]);
    expect(rawScanTables(["SCAN submissions"], tables)).toEqual(["submissions"]);
    expect(
      rawScanTables(
        [
          "SCAN submissions USING INDEX idx_submissions_submitted",
          "SCAN submissions USING COVERING INDEX idx_submissions_status",
          "SEARCH submissions USING INDEX idx_submissions_site_submitted (site_id=?)",
          "SCAN 2 CONSTANT ROWS",
          "SCAN (subquery-1)",
          "USE TEMP B-TREE FOR ORDER BY",
        ],
        tables,
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
