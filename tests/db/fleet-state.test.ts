/** The reader-equivalence instrument for Phase 2 (#539): for the same Airtable
 *  record, the Turso read layer must produce EXACTLY the WebsiteRow the
 *  Airtable module's mapRow produces — proven by deep-equal over the whole row,
 *  so every one of the 76 fields is pinned and a NEW WebsiteRow field fails
 *  here until fleet-state.ts carries it. Three fixtures: rich (every kind of
 *  field populated), sparse (Name only — every default exercised), and weird
 *  (unknown enum values, padded strings, malformed JSON — the coercion edges).
 *
 *  headerImage is asserted separately: per design D5 its source MOVED to Turso
 *  (Airtable's attachment is deliberately not imported), so equivalence with
 *  mapRow is not the contract — "null until the Phase 3 writer lands" is.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { importFleetState, type ImportIo, type RawRecord } from "../../src/db/import-airtable.js";
import {
  getSiteBySlug,
  getSiteById,
  listSites,
  mirrorSiteField,
  mirrorHealthFields,
  mirrorScheduleFields,
  mirrorReportPatch,
  storeRenderedHtml,
  getReportHtml,
  listAllReports,
} from "../../src/db/fleet-state.js";
import { openCapturingDb } from "./query-plan-harness.js";
import { EDITABLE_SITE_FIELDS } from "../../src/dashboard/site-details.js";
import {
  SITE_FIELDS,
  HEALTH_FIELDS,
  HEALTH_BOOLEAN,
  SCHEDULE_FIELDS,
  healthColumnFor,
} from "../../src/db/import-airtable.js";
import { mapRow, siteSlug } from "../../src/reports/airtable/websites.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const RICH: RawRecord = {
  id: "recRICH",
  fields: {
    Name: "Acme Gallery",
    url: "https://acme.example.com",
    Status: "maintained",
    "point of contact": "owner@acme.example.com",
    "maintenence freq": "Monthly",
    "testing freq": "Quarterly",
    "maintenance day": "first-monday",
    "testing day": "mid-month",
    "GA4 property ID": "123456789",
    "Search query": "acme gallery la",
    "Search Console property": "sc-domain:acme.example.com",
    "Analytics soft-fail at": "2026-08-01T00:00:00.000Z",
    "Git repo": "reddoorla/acme",
    "Netlify ID": "nlf-acme-1",
    "Report recipients (To)": "owner@acme.example.com",
    "Report recipients (CC)": "studio@reddoorla.com",
    "Copy — Intro": "Here's your monthly report.",
    "Copy — Contact": "Reply any time.",
    "Copy — Footer": "— the reddoor team",
    "Newsletter Webhook": "https://acme.example.com/api/newsletter",
    "Mailchimp API Key": "mc-key-1",
    "Mailchimp Audience ID": "aud-1",
    "Notify Routing": JSON.stringify({
      field: "interest",
      routes: { classes: "classes@acme.example.com" },
      default: "owner@acme.example.com",
      cc: ["studio@reddoorla.com"],
    }),
    "Require Turnstile": true,
    "Accepted Watch Conditions": ["cert-warning", "prismic"],
    "Prismic Ack Until": "2026-08-30T00:00:00.000Z",
    "Launched at": "2025-11-01",
    pScore: 98,
    rScore: 100,
    bpScore: 96,
    seoScore: 92,
    "Last lighthouse audit at": "2026-08-23T04:00:00.000Z",
    "A11y Violations": 0,
    "Deps Drifted": 2,
    "Deps Major Behind": 1,
    "Deps Outdated": 3,
    "Deps Major Outdated": 0,
    "Security Vulns Critical": 0,
    "Security Vulns High": 0,
    "Security Vulns Moderate": 1,
    "Security Vulns Low": 2,
    "Security Auto-Fix Attempts": 1,
    "Last security audit at": "2026-08-23T05:00:00.000Z",
    "Security advisories": JSON.stringify([
      { id: "GHSA-xxxx", severity: "moderate", package: "left-pad" },
    ]),
    "Cert days remaining": 61,
    "Domain checked at": "2026-08-23T06:00:00.000Z",
    "Deploy status": "ready",
    "Last deploy at": "2026-08-22T20:00:00.000Z",
    "Deploy log URL": "https://app.netlify.com/deploys/abc",
    "Deploy checked at": "2026-08-23T06:10:00.000Z",
    "Function health": "pass",
    "CMS Reachable": "pass",
    "Turnstile widget": "fail",
    "Function health checked at": "2026-08-23T06:20:00.000Z",
    "Crossbrowser OK": true,
    "Mobile OK": false,
    "Links OK": true,
    "Broken links": 0,
    "Browser checked at": "2026-08-23T06:30:00.000Z",
    "Uptime Reachable": "pass",
    "Titles & Meta OK": "pass",
    "Smoke OK": "pass",
    "Last Smoke At": "2026-08-23T07:00:00.000Z",
    "Form E2E OK": "pass",
    "Form E2E checked at": "2026-08-23T07:10:00.000Z",
    "Renovate Failing CIs": 0,
    "Default Branch CI": "success",
    "Last Commit At": "2026-08-21T12:00:00.000Z",
    "GitHub Signals At": "2026-08-23T07:20:00.000Z",
    "Prismic Models": "pass",
    "Prismic Models Checked At": "2026-08-23T05:23:00.000Z",
    "Prismic Models Drift": "- old_slice",
    "Next maintenance at": "2026-09-01",
    "Next testing at": "2026-11-01",
  },
};

const SPARSE: RawRecord = { id: "recSPARSE", fields: { Name: "Bare Site" } };

const WEIRD: RawRecord = {
  id: "recWEIRD",
  fields: {
    Name: "Weird Site",
    Status: "wat", // unknown status value — must round-trip verbatim, not vanish
    "maintenence freq": "Fortnightly", // unrecognized → "None" on BOTH sides
    "Netlify ID": "  padded-id  ", // trimToNull applies on BOTH sides
    "Copy — Intro": "   ", // whitespace-only → null on both sides
    "Notify Routing": "{not json", // malformed → null on both sides
    "Security advisories": "also not json", // malformed → null on both sides
    "Accepted Watch Conditions": "cert-warning,  , prismic\nsmoke", // delimited string + empty entry
    "Function health": "maybe", // not pass/fail → null
    "Prismic Models": "unknown", // the third state must SURVIVE (never null)
    "Crossbrowser OK": true,
    "Broken links": 7,
  },
};

const io = (records: RawRecord[]): ImportIo => ({
  listWebsiteRecords: async () => records,
  listReportRecords: async () => [],
  fetchAttachment: async () => null,
  now: () => NOW,
});

async function importOf(records: RawRecord[]) {
  const db = await openDb({ url: ":memory:" });
  await importFleetState(db, io(records));
  return db;
}

/** Deep-equal against mapRow with headerImage split out (D5 — see header). */
async function expectEquivalent(rec: RawRecord) {
  const db = await importOf([rec]);
  const got = await getSiteBySlug(db, siteSlug(String(rec.fields.Name)));
  expect(got).not.toBeNull();
  const expected = mapRow(rec);
  const { headerImage: _e, ...expectedRest } = expected;
  const { headerImage: gotHeader, ...gotRest } = got!;
  expect(gotRest).toEqual(expectedRest);
  // Nothing writes sites.header_image* yet (verified empty in prod 2026-08-24);
  // approve-report stays on the Airtable reader until the Phase 3 writer lands.
  expect(gotHeader).toBeNull();
}

describe("fleet-state read layer ≡ mapRow (the Phase 2 equivalence instrument)", () => {
  it("rich record: every populated field round-trips identically", async () => {
    await expectEquivalent(RICH);
  });

  it("sparse record: every default matches (nulls, empty url, freq None, requireTurnstile false)", async () => {
    await expectEquivalent(SPARSE);
  });

  it("weird record: coercion edges match (unknown enums, padded strings, bad JSON, the third Prismic state)", async () => {
    await expectEquivalent(WEIRD);
  });

  // The status vocabulary (#539 Phase 4) is canonicalized on BOTH sides of this
  // equivalence, so a one-sided change fails here. `archived` was the riskiest
  // value while the alias map lived: it was the ONE many-to-one merge, with
  // `legacy` and `deprecated` both landing on it while `statusRaw` kept them
  // apart. Since stage 3 those two names cannot be entered in Airtable at all,
  // so `archived` is the only archived fixture production can produce.
  it("archived record: the archived status pairs identically through either reader", async () => {
    await expectEquivalent({
      id: "recARCH",
      fields: { Name: "Archived Site", Status: "archived" },
    });
  });

  it("getSiteBySlug returns null for an unknown slug", async () => {
    const db = await importOf([RICH]);
    expect(await getSiteBySlug(db, "nope")).toBeNull();
  });

  it("getSiteById finds by rec id and returns null for unknown", async () => {
    const db = await importOf([RICH]);
    expect((await getSiteById(db, "recRICH"))?.name).toBe("Acme Gallery");
    expect(await getSiteById(db, "recNOPE")).toBeNull();
  });

  it("listSites returns every site, name-ordered", async () => {
    const db = await importOf([RICH, SPARSE, WEIRD]);
    const names = (await listSites(db)).map((s) => s.name);
    expect(names).toEqual(["Acme Gallery", "Bare Site", "Weird Site"]);
  });

  it("a site row without health/schedule rows still reads (LEFT JOIN, not INNER)", async () => {
    const db = await importOf([RICH]);
    await db.deleteFrom("site_health").execute();
    await db.deleteFrom("site_schedule").execute();
    const row = await getSiteBySlug(db, "acme-gallery");
    expect(row).not.toBeNull();
    expect(row!.pScore).toBeNull();
    expect(row!.name).toBe("Acme Gallery");
  });
});

describe("mirrorSiteField (the site-detail editor's Turso write-through)", () => {
  it("every editor-editable column has an importer-claimed sites column (lockstep)", () => {
    // A field added to the editor without an importer mapping would silently
    // leave Turso stale until the next sync — this makes it a build failure.
    for (const f of Object.values(EDITABLE_SITE_FIELDS)) {
      expect(
        SITE_FIELDS[f.column],
        `editor column '${f.column}' unmapped in SITE_FIELDS`,
      ).toBeDefined();
    }
  });

  it("mirrors an edit into sites immediately, storing the cell VERBATIM", async () => {
    const db = await importOf([RICH]);
    await mirrorSiteField(db, "recRICH", "Status", "archived");
    const mirrored = await getSiteBySlug(db, "acme-gallery");
    // Stored raw, canonicalized on read — the Turso half of the #539 Phase 4
    // status-vocabulary seam (mapRow does the same on the Airtable half).
    //
    // This used to mirror "legacy" and assert it read back as "archived", which
    // demonstrated the seam by making the two halves DIFFER. Stage 3 deleted the
    // alias map, so canonicalization is the identity and no input can make them
    // differ any more. What is still worth pinning, and all that is claimed here,
    // is the write-through itself: an editor save reaches `sites` immediately
    // rather than waiting for the next hourly import, and it lands byte-for-byte.
    expect(mirrored?.statusRaw).toBe("archived");
    expect(mirrored?.status).toBe("archived");
  });

  it("mirrors a value the code does NOT recognize, rather than normalizing it away", async () => {
    // The half of the retired test that still bites. The write-through must not
    // filter or coerce what it is given — a stale or hand-entered cell has to
    // land verbatim so the cockpit can flag it, exactly as the Airtable reader
    // does. `legacy` is the realistic instance: a retired option name that no
    // longer exists in the field and must now read as an anomaly, not as archived.
    const db = await importOf([RICH]);
    await mirrorSiteField(db, "recRICH", "Status", "legacy");
    const mirrored = await getSiteBySlug(db, "acme-gallery");
    expect(mirrored?.statusRaw).toBe("legacy");
    expect(mirrored?.status).toBe("legacy");
  });

  it("an emptied value clears to null — the importer's empty-clears semantics", async () => {
    const db = await importOf([RICH]);
    await mirrorSiteField(db, "recRICH", "GA4 property ID", "  ");
    expect((await getSiteBySlug(db, "acme-gallery"))?.ga4PropertyId).toBeNull();
  });

  it("throws on a column the importer does not claim", async () => {
    const db = await importOf([RICH]);
    await expect(mirrorSiteField(db, "recRICH", "No Such Column", "x")).rejects.toThrow(
      "importer claims no sites column",
    );
  });
});

describe("mirrorHealthFields / mirrorScheduleFields (the Phase 3 writer mirrors)", () => {
  const allHealthFields = [...Object.keys(HEALTH_FIELDS), ...Object.keys(HEALTH_BOOLEAN)];

  it("RICH exercises every claimed health + schedule field (fixture completeness)", () => {
    // The lockstep below is only total if the fixture carries every field —
    // a new HEALTH_FIELDS entry missing from RICH must fail HERE, not silently
    // shrink the equivalence.
    for (const field of [...allHealthFields, ...Object.keys(SCHEDULE_FIELDS)]) {
      expect(RICH.fields, `RICH fixture missing health field '${field}'`).toHaveProperty(field);
    }
  });

  it("stores exactly what the importer stores, for every claimed health field (lockstep)", async () => {
    // Mirror all of RICH's health cells onto the SPARSE site's (all-null) row:
    // it must converge to byte-equality with the row the importer built from
    // the same cells. One coercion diverging fails on that column.
    const db = await importOf([RICH, SPARSE]);
    const healthFields = Object.fromEntries(
      Object.entries(RICH.fields).filter(([k]) => healthColumnFor(k) !== null),
    );
    await mirrorHealthFields(db, "recSPARSE", healthFields);
    const imported = await db
      .selectFrom("site_health")
      .selectAll()
      .where("site_id", "=", "recRICH")
      .executeTakeFirstOrThrow();
    const mirrored = await db
      .selectFrom("site_health")
      .selectAll()
      .where("site_id", "=", "recSPARSE")
      .executeTakeFirstOrThrow();
    expect({ ...mirrored, site_id: "same" }).toEqual({ ...imported, site_id: "same" });
  });

  it("is partial: absent fields stay untouched (updateGitHubSignals' null-lastCommitAt contract)", async () => {
    const db = await importOf([RICH]);
    const before = await db
      .selectFrom("site_health")
      .selectAll()
      .where("site_id", "=", "recRICH")
      .executeTakeFirstOrThrow();
    await mirrorHealthFields(db, "recRICH", { "Smoke OK": "fail" });
    const after = await db
      .selectFrom("site_health")
      .selectAll()
      .where("site_id", "=", "recRICH")
      .executeTakeFirstOrThrow();
    expect(after.smoke_ok).toBe("fail");
    expect({ ...after, smoke_ok: "x" }).toEqual({ ...before, smoke_ok: "x" });
  });

  it("throws on a field no site_health column claims — and writes nothing for it", async () => {
    const db = await importOf([RICH]);
    await expect(mirrorHealthFields(db, "recRICH", { "No Such Column": 1 })).rejects.toThrow(
      "importer claims no site_health column",
    );
  });

  it("an empty FieldSet executes no SQL at all — and reports true (nothing to mirror is not a miss)", async () => {
    const h = await openCapturingDb();
    await expect(mirrorHealthFields(h.db, "recA", {})).resolves.toBe(true);
    await expect(mirrorScheduleFields(h.db, "recA", {}, NOW.toISOString())).resolves.toBe(true);
    expect(h.captured).toHaveLength(0);
  });

  it("reports whether a site_health row matched: true on a known-good site, false on one the hourly sync hasn't imported", async () => {
    const db = await importOf([RICH]);
    // Instrument proof first: the known-good path must return true before the
    // false branch below may be read as a finding (a check that has only ever
    // failed is an untested assertion).
    await expect(mirrorHealthFields(db, "recRICH", { "Smoke OK": "pass" })).resolves.toBe(true);
    // A site created in Airtable after the last import has no site_health row:
    // the UPDATE matches 0 rows and the caller must be told — counting it as
    // "mirrored" is the honesty gap Phase 5 cutover confidence would inherit.
    await expect(mirrorHealthFields(db, "recGHOST", { "Smoke OK": "pass" })).resolves.toBe(false);
  });

  it("schedule mirror reports the same matched/missed distinction", async () => {
    const db = await importOf([RICH]);
    await expect(
      mirrorScheduleFields(db, "recRICH", { "Next testing at": "2026-12-01" }, NOW.toISOString()),
    ).resolves.toBe(true);
    await expect(
      mirrorScheduleFields(db, "recGHOST", { "Next testing at": "2026-12-01" }, NOW.toISOString()),
    ).resolves.toBe(false);
  });

  it("schedule lockstep: mirrored next-due dates equal the importer's schedule row", async () => {
    const db = await importOf([RICH, SPARSE]);
    const scheduleFields = Object.fromEntries(
      Object.entries(RICH.fields).filter(([k]) => k in SCHEDULE_FIELDS),
    );
    // importOf stamps computed_at with NOW — pass the same stamp so the whole
    // row (not all-but-one column) must match.
    await mirrorScheduleFields(db, "recSPARSE", scheduleFields, NOW.toISOString());
    const imported = await db
      .selectFrom("site_schedule")
      .selectAll()
      .where("site_id", "=", "recRICH")
      .executeTakeFirstOrThrow();
    const mirrored = await db
      .selectFrom("site_schedule")
      .selectAll()
      .where("site_id", "=", "recSPARSE")
      .executeTakeFirstOrThrow();
    expect({ ...mirrored, site_id: "same" }).toEqual({ ...imported, site_id: "same" });
  });

  it("schedule mirror clears a date to null, stamps computed_at, rejects unclaimed fields", async () => {
    const db = await importOf([RICH]);
    // A stamp DISTINCT from the import's NOW, so a mirror that forgets to
    // write computed_at cannot hide behind the import's identical value.
    const later = "2026-08-25T03:00:00.000Z";
    await mirrorScheduleFields(
      db,
      "recRICH",
      { "Next maintenance at": null, "Next testing at": "2026-12-01" },
      later,
    );
    const row = await db
      .selectFrom("site_schedule")
      .selectAll()
      .where("site_id", "=", "recRICH")
      .executeTakeFirstOrThrow();
    expect(row.next_maintenance_at).toBeNull();
    expect(row.next_testing_at).toBe("2026-12-01");
    expect(row.computed_at).toBe(later);
    await expect(
      mirrorScheduleFields(db, "recRICH", { Nope: "x" }, NOW.toISOString()),
    ).rejects.toThrow("importer claims no site_schedule column");
  });
});

describe("site reads never haul the header-image BLOB", () => {
  // Since the 2026-08-24 backfill, header_image holds multi-MB JPEGs. A
  // selectAll would ship them on every ingest lookup and 44× per fleet list —
  // the SQL itself is the contract, so capture and inspect it.
  it("getSiteBySlug selects the metadata columns but NOT header_image — and misses no other sites column", async () => {
    const h = await openCapturingDb();
    await getSiteBySlug(h.db, "nope");
    const sql = h.captured.map((c) => c.sql).join("\n");
    expect(sql).toContain('"header_image_filename"');
    expect(sql).not.toMatch(/"sites"\."header_image"|[^_"]"header_image"/);
    // Schema lockstep: every sites column except the BLOB must be selected —
    // a new migration column silently missing from SITE_COLUMNS fails here.
    const pragma = await h.client.execute("SELECT name FROM pragma_table_info('sites')");
    for (const row of pragma.rows) {
      const col = String(row.name);
      if (col === "header_image") continue;
      expect(sql, `sites column '${col}' missing from the read layer's select`).toContain(
        `"${col}"`,
      );
    }
  });
});

describe("report LIST reads never haul the rendered_html body", () => {
  // The exact hazard SITE_COLUMNS already guards for sites, on the table where it
  // is currently worse: live, all 16 reports carry a body totalling 1.17 MB, and
  // listAllReports is called by the cockpit root — every operator page load — to
  // do nothing with the column but test it for null.
  it("listAllReports selects the metadata columns but NOT rendered_html — and misses no other reports column", async () => {
    const h = await openCapturingDb();
    await listAllReports(h.db);
    const sql = h.captured.map((c) => c.sql).join("\n");
    expect(sql).not.toMatch(/"reports"\."rendered_html"|select\s+\*/i);
    // The null-ness is still needed (it drives renderedHtmlAttachment), so it must
    // be computed in SQL rather than by shipping the body.
    expect(sql).toMatch(/rendered_html is not null/i);
    // Schema lockstep, same contract as the sites guard: a new reports column that
    // never reaches REPORT_LIST_COLUMNS fails here rather than going silently
    // missing from the cockpit.
    const pragma = await h.client.execute("SELECT name FROM pragma_table_info('reports')");
    for (const row of pragma.rows) {
      const col = String(row.name);
      if (col === "rendered_html") continue;
      expect(sql, `reports column '${col}' missing from the list read's select`).toContain(
        `"${col}"`,
      );
    }
  });

  it("still reports whether a body exists, in both states", async () => {
    // A guard that only ever saw one state would pass while returning a constant.
    const db = await importOf([RICH]);
    await db
      .insertInto("reports")
      .values({
        id: "recRHTML",
        site_id: RICH.id,
        rendered_html: "<html>body</html>",
      } as never)
      .execute();
    await db
      .insertInto("reports")
      .values({ id: "recNOHTML", site_id: RICH.id, rendered_html: null } as never)
      .execute();

    const byId = new Map((await listAllReports(db)).map((r) => [r.id, r]));
    expect(byId.get("recRHTML")?.renderedHtmlAttachment).not.toBeNull();
    expect(byId.get("recNOHTML")?.renderedHtmlAttachment).toBeNull();
  });
});

describe("mirrorReportPatch (approve/webhook write-through)", () => {
  it("an approve patch is visible on the very next read", async () => {
    const db = await importOf([RICH]);
    await db
      .insertInto("reports")
      .values({
        id: "recRPT9",
        site_id: "recRICH",
        report_id: "R9",
        report_type: "Maintenance",
        period: null,
        period_start: "2026-08-01",
        period_end: null,
        completed_on: null,
        lighthouse_performance: null,
        lighthouse_accessibility: null,
        lighthouse_best_practices: null,
        lighthouse_seo: null,
        ga_users_current: null,
        ga_users_previous: null,
        search_found_page1: null,
        search_position: null,
        last_tested_date: null,
        commentary: null,
        subject_override: null,
        draft_ready: 1,
        approved_to_send: 0,
        approved_at: null,
        approved_by: null,
        send_override: 0,
        override_reason: null,
        override_by: null,
        override_at: null,
        sent_at: null,
        delivery_status: "pending",
        resend_message_id: null,
        checklist: null,
        checklist_auto_evidence: null,
        rendered_html: null,
      })
      .execute();
    await mirrorReportPatch(db, "recRPT9", {
      approved_to_send: 1,
      approved_at: "2026-08-24T12:00:00.000Z",
      approved_by: "op",
    });
    const [row] = await listAllReports(db);
    expect(row!.approvedToSend).toBe(true);
    expect(row!.approvedBy).toBe("op");
  });

  it("an empty patch is a no-op, not invalid SQL", async () => {
    const db = await importOf([RICH]);
    await expect(mirrorReportPatch(db, "recX", {})).resolves.toBeUndefined();
  });
  it("carries COMMENTARY, so an edit shows on the next render not the next sync", async () => {
    // #539 Phase 4: the console now edits report commentary, and the page
    // re-renders straight after the write. Without commentary in the patch the
    // operator would save, see the OLD text, and reasonably conclude the save
    // had failed — up to an hour, until the sync caught up.
    const db = await importOf([RICH]);
    await db
      .insertInto("reports")
      .values({
        id: "recRPT_C",
        site_id: "recRICH",
        report_id: "RC",
        report_type: "Maintenance",
        commentary: "before",
        draft_ready: 1,
        approved_to_send: 0,
        send_override: 0,
      })
      .execute();

    await mirrorReportPatch(db, "recRPT_C", { commentary: "after" });

    const row = await db
      .selectFrom("reports")
      .select("commentary")
      .where("id", "=", "recRPT_C")
      .executeTakeFirst();
    expect(row?.commentary).toBe("after");
  });
});

/**
 * #539 Phase 4: `Require Turnstile` (checkbox) and `Accepted Watch Conditions`
 * (multipleSelects) are the two editor fields that CANNOT be written as strings.
 * The mirror's whole risk is coercing them differently from the importer — the
 * hourly parity check compares raw-to-raw, so a mirror that stores `"true"`
 * where the importer stores `1` reds every run until the next import papers
 * over it.
 */
describe("mirrorSiteField — the non-text editor columns", () => {
  const storedOf = async (db: Awaited<ReturnType<typeof importOf>>) =>
    (await db
      .selectFrom("sites")
      .select(["require_turnstile", "accepted_watch_conditions"])
      .where("id", "=", "recRICH")
      .executeTakeFirst())!;

  it("stores a checkbox as the importer's 1/0, not a string", async () => {
    const db = await importOf([RICH]);
    await mirrorSiteField(db, "recRICH", "Require Turnstile", false);
    expect((await storedOf(db)).require_turnstile).toBe(0);
    await mirrorSiteField(db, "recRICH", "Require Turnstile", true);
    expect((await storedOf(db)).require_turnstile).toBe(1);
  });

  it("stores a multi-select as the importer's trimmed JSON array", async () => {
    const db = await importOf([RICH]);
    await mirrorSiteField(db, "recRICH", "Accepted Watch Conditions", ["Performance", "  SEO  "]);
    expect((await storedOf(db)).accepted_watch_conditions).toBe(
      JSON.stringify(["Performance", "SEO"]),
    );
    // Cleared to nothing selected → null, matching the importer's `awc.length > 0`.
    await mirrorSiteField(db, "recRICH", "Accepted Watch Conditions", []);
    expect((await storedOf(db)).accepted_watch_conditions).toBeNull();
  });

  it("MATCHES the importer byte-for-byte — the property parity actually checks", async () => {
    // The instrument that matters: mirror a value, then import a record whose
    // Airtable cell holds that same value, and require the stored columns to be
    // identical. Any divergence here is an hourly red run.
    const mirrored = await importOf([RICH]);
    await mirrorSiteField(mirrored, "recRICH", "Require Turnstile", false);
    await mirrorSiteField(mirrored, "recRICH", "Accepted Watch Conditions", ["SEO", "stale repo"]);

    const imported = await importOf([
      {
        ...RICH,
        fields: {
          ...RICH.fields,
          "Require Turnstile": false,
          "Accepted Watch Conditions": ["SEO", "stale repo"],
        },
      },
    ]);

    expect(await storedOf(mirrored)).toEqual(await storedOf(imported));
  });
});

/**
 * The write half of the report-preview refresh (#539 Phase 4). `rendered_html`
 * is deliberately NOT in `ReportMirrorPatch` — that patch is for request-path
 * writers, and a rendered body is produced by a batch job, not a dashboard POST.
 */
describe("storeRenderedHtml", () => {
  const insert = async (db: Awaited<ReturnType<typeof importOf>>, id: string) =>
    db
      .insertInto("reports")
      .values({
        id,
        site_id: "recRICH",
        report_id: "RH",
        report_type: "Maintenance",
        draft_ready: 1,
        approved_to_send: 0,
        send_override: 0,
      })
      .execute();

  it("stores a freshly rendered body where the preview route reads it", async () => {
    const db = await importOf([RICH]);
    await insert(db, "recRPT_H");
    await storeRenderedHtml(db, "recRPT_H", "<html>fresh</html>");
    expect((await getReportHtml(db, "recRPT_H"))?.html).toBe("<html>fresh</html>");
  });

  it("REPLACES a previous body rather than appending or skipping", async () => {
    // A refresh whose whole purpose is showing the newest commentary must
    // overwrite; a when-missing style skip would silently serve the stale one.
    const db = await importOf([RICH]);
    await insert(db, "recRPT_H2");
    await storeRenderedHtml(db, "recRPT_H2", "<html>old</html>");
    await storeRenderedHtml(db, "recRPT_H2", "<html>new</html>");
    expect((await getReportHtml(db, "recRPT_H2"))?.html).toBe("<html>new</html>");
  });
});
