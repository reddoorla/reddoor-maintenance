import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  mapWebsiteRecord,
  mapReportRecord,
  renderedHtmlUrl,
  importFleetState,
  EXCLUDED_WEBSITE_FIELDS,
  type RawRecord,
  type ImportIo,
} from "../../src/db/import-airtable.js";
import { checkFleetParity, formatParityResult } from "../../src/db/parity.js";

const NOW = new Date("2026-08-23T12:00:00.000Z");

/** A realistic Websites record: config + health + schedule + legacy + the cells
 *  that must never migrate. */
const ACME: RawRecord = {
  id: "recACME",
  fields: {
    Name: "Acme Gallery",
    Status: "maintenance",
    url: "https://acme.example.com",
    "point of contact": "owner@acme.example.com",
    "maintenence freq": "Monthly",
    "testing freq": "Quarterly",
    "GA4 property ID": "123456",
    "Git repo": "reddoorla/acme",
    "Netlify ID": "nlf-1",
    "Require Turnstile": true,
    "Accepted Watch Conditions": "cert-warning, prismic",
    "Prismic Ack Until": "2026-08-30T00:00:00.000Z",
    pScore: 98,
    rScore: 100,
    "Smoke OK": "pass",
    "Last Smoke At": "2026-08-23T10:00:00.000Z",
    "Crossbrowser OK": true,
    "Broken links": 0,
    "Security advisories": "[]",
    "Next maintenance at": "2026-09-01",
    "Next testing at": "2026-11-01",
    // Populated but code-unreferenced → legacy JSON.
    "client approval": true,
    "DNS Host": "cloudflare",
    // Plaintext creds → must never reach Turso in ANY column.
    "DNS password": "hunter2",
    "cms username": "adminuser",
    // Link column → excluded.
    Reports: ["recR1"],
  },
};

const REPORT: RawRecord = {
  id: "recR1",
  fields: {
    Site: ["recACME"],
    "Report ID": "ACME-2026-08-M",
    "Report type": "Maintenance",
    "Period start": "2026-08-01",
    "Period end": "2026-08-31",
    "Lighthouse — Performance": 98,
    "GA users (period)": 120,
    "Search found page 1": true,
    "Draft ready": true,
    "Maint: Deploy & Function Health": true,
    "Maint: CMS Checked": true,
    "Test: Verified After Updates": true,
    "Checklist auto-evidence": { deploy: { ok: true } },
    "Rendered HTML": [{ url: "https://airtable.example/signed/abc", filename: "r.html" }],
  },
};

const io = (over: Partial<ImportIo> = {}): ImportIo => ({
  listWebsiteRecords: async () => [ACME],
  listReportRecords: async () => [REPORT],
  fetchAttachment: async () => "<html>report</html>",
  now: () => NOW,
  ...over,
});

describe("mapWebsiteRecord", () => {
  const m = mapWebsiteRecord(ACME, NOW.toISOString());

  it("splits config / health / schedule on the writer-map lines", () => {
    expect(m.site).toMatchObject({
      id: "recACME",
      slug: "acme-gallery",
      name: "Acme Gallery",
      // RAW, not canonical: the importer stores the Airtable cell verbatim so the
      // hourly parity check compares raw-to-raw. Canonicalization is a READ-side
      // concern (mapRow / fleet-state), never at rest.
      status: "maintenance",
      maintenance_freq: "Monthly", // the misspelled source column dies at the boundary
      require_turnstile: 1,
      netlify_id: "nlf-1",
      prismic_ack_until: "2026-08-30T00:00:00.000Z",
    });
    expect(m.health).toMatchObject({
      site_id: "recACME",
      p_score: 98,
      smoke_ok: "pass",
      crossbrowser_ok: 1,
      broken_links: 0,
    });
    expect(m.schedule).toEqual({
      site_id: "recACME",
      next_maintenance_at: "2026-09-01",
      next_testing_at: "2026-11-01",
      computed_at: NOW.toISOString(),
    });
  });

  it("normalizes Accepted Watch Conditions to a JSON array, string or array input", () => {
    expect(JSON.parse(m.site.accepted_watch_conditions!)).toEqual(["cert-warning", "prismic"]);
    const arr = mapWebsiteRecord(
      { id: "recX", fields: { Name: "X", "Accepted Watch Conditions": [" a ", "b"] } },
      NOW.toISOString(),
    );
    expect(JSON.parse(arr.site.accepted_watch_conditions!)).toEqual(["a", "b"]);
  });

  it("keeps populated-but-unreferenced columns in legacy, keyed by original name", () => {
    const legacy = JSON.parse(m.site.legacy!) as Record<string, unknown>;
    expect(legacy["client approval"]).toBe(true);
    expect(legacy["DNS Host"]).toBe("cloudflare");
  });

  it("plaintext credentials reach NO column — not legacy, not anywhere", () => {
    // The operator ruling this encodes: creds live on only in the frozen base.
    // Serialize the ENTIRE mapped output and assert the secret is absent, so a
    // future column addition cannot quietly start carrying it.
    const everything = JSON.stringify(m);
    expect(everything).not.toContain("hunter2");
    expect(everything).not.toContain("adminuser");
    expect(EXCLUDED_WEBSITE_FIELDS.has("DNS password")).toBe(true);
  });

  it("throws on a blank Name rather than minting an unaddressable row", () => {
    expect(() => mapWebsiteRecord({ id: "recBad", fields: {} }, NOW.toISOString())).toThrow(
      /blank Name/,
    );
  });
});

describe("mapReportRecord", () => {
  const r = mapReportRecord(REPORT, "<html>report</html>");

  it("resolves the site link and re-keys the checklist to stable keys", () => {
    expect(r.site_id).toBe("recACME");
    const checklist = JSON.parse(r.checklist!) as Record<string, boolean>;
    // Airtable column names ("Maint: …", "Test: Verified After Updates") do NOT
    // leak into the new store; the stable keys from checklist.ts do.
    expect(checklist).toMatchObject({ deploy: true, cms: true, updates: true, forms: false });
    expect(r.checklist).not.toContain("Maint:");
  });

  it("carries booleans, numbers, and defaults delivery_status to pending", () => {
    expect(r).toMatchObject({
      draft_ready: 1,
      approved_to_send: 0,
      search_found_page1: 1,
      lighthouse_performance: 98,
      ga_users_current: 120,
      delivery_status: "pending",
      rendered_html: "<html>report</html>",
    });
    expect(renderedHtmlUrl(REPORT)).toBe("https://airtable.example/signed/abc");
  });
});

describe("importFleetState + checkFleetParity", () => {
  // PROVE THE INSTRUMENT FIRST: on the pre-cutover state — an import that just
  // ran, both stores agreeing — the harness must pass green. Until it has, any
  // mismatch it reports is suspect, not evidence (repo rule; design §Verification).
  it("parity is GREEN immediately after an import (the known-good pass)", async () => {
    const db = await openDb({ url: ":memory:" });
    const summary = await importFleetState(db, io());
    expect(summary).toEqual({
      sites: 1,
      reports: 1,
      renderedHtmlMisses: [],
      renderedHtmlFetched: 1,
      renderedHtmlSkipped: 0,
    });

    const parity = await checkFleetParity(db, io());
    expect(parity.mismatches).toEqual([]);
    expect(parity.compared).toEqual({ sites: 1, site_health: 1, site_schedule: 1, reports: 1 });
    expect(formatParityResult(parity)).toContain(
      "FLEET_PARITY sites=1 health=1 schedule=1 reports=1 mismatches=0",
    );
  });

  it("re-running the import converges — no duplicates, updates applied", async () => {
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io());
    const changed: RawRecord = {
      ...ACME,
      fields: { ...ACME.fields, Status: "legacy", pScore: 90 },
    };
    await importFleetState(db, io({ listWebsiteRecords: async () => [changed] }));

    const sites = await db.selectFrom("sites").selectAll().execute();
    expect(sites).toHaveLength(1);
    expect(sites[0]?.status).toBe("legacy");
    const health = await db.selectFrom("site_health").selectAll().execute();
    expect(health[0]?.p_score).toBe(90);
  });

  it("a re-import never wipes a regenerated header image", async () => {
    // Airtable stopped being the header image's source (D5) — the importer's
    // upsert must leave the BLOB columns alone or every re-import erases the
    // regeneration work.
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io());
    await db
      .updateTable("sites")
      .set({ header_image_filename: "acme.png", header_image_generated_at: NOW.toISOString() })
      .where("id", "=", "recACME")
      .execute();
    await importFleetState(db, io());
    const row = await db.selectFrom("sites").selectAll().executeTakeFirst();
    expect(row?.header_image_filename).toBe("acme.png");
  });

  it("a re-import with an expired attachment URL keeps the captured rendered_html", async () => {
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io());
    const second = await importFleetState(db, io({ fetchAttachment: async () => null }));
    expect(second.renderedHtmlMisses).toEqual(["recR1"]); // named, not silent
    const row = await db.selectFrom("reports").selectAll().executeTakeFirst();
    expect(row?.rendered_html).toBe("<html>report</html>");
  });

  it('reportHtml "when-missing" skips the fetch for a report whose body is stored', async () => {
    // The hourly sync's mode: 24 runs a day must not re-download every
    // attachment every hour. The skip keeps the stored body (rowSansHtml
    // branch) and is COUNTED, never confused with a miss.
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io());
    let fetches = 0;
    const second = await importFleetState(
      db,
      io({
        fetchAttachment: async () => {
          fetches++;
          return "<html>would-be-refetch</html>";
        },
      }),
      { reportHtml: "when-missing" },
    );
    expect(fetches).toBe(0);
    expect(second.renderedHtmlSkipped).toBe(1);
    expect(second.renderedHtmlMisses).toEqual([]);
    const row = await db.selectFrom("reports").selectAll().executeTakeFirst();
    expect(row?.rendered_html).toBe("<html>report</html>"); // original, untouched
  });

  it('reportHtml "when-missing" STILL fetches a report with no stored body', async () => {
    // The mode must never freeze a miss: a report imported while its signed URL
    // was expired gets its body on the next sync, not never.
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io({ fetchAttachment: async () => null })); // miss
    const second = await importFleetState(db, io(), { reportHtml: "when-missing" });
    expect(second.renderedHtmlFetched).toBe(1);
    expect(second.renderedHtmlSkipped).toBe(0);
    const row = await db.selectFrom("reports").selectAll().executeTakeFirst();
    expect(row?.rendered_html).toBe("<html>report</html>");
  });

  it("a STRING auto-evidence cell is stored verbatim, never double-encoded", async () => {
    // Airtable long-text cells arrive as strings; JSON.stringify-ing one again
    // would make parseAutoEvidence yield a string → null on the read side.
    const evidence = JSON.stringify({ deploy: { result: "pass", checkedAt: null, note: "" } });
    const rec: RawRecord = {
      ...REPORT,
      fields: { ...REPORT.fields, "Checklist auto-evidence": evidence },
    };
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io({ listReportRecords: async () => [rec] }));
    const row = await db.selectFrom("reports").selectAll().executeTakeFirst();
    expect(row?.checklist_auto_evidence).toBe(evidence);
  });

  it("parity NAMES a drifted cell — table, id, column, both values", async () => {
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io());
    await db
      .updateTable("site_health")
      .set({ smoke_ok: "fail" })
      .where("site_id", "=", "recACME")
      .execute();
    const parity = await checkFleetParity(db, io());
    expect(parity.mismatches).toEqual([
      { table: "site_health", id: "recACME", column: "smoke_ok", airtable: "pass", turso: "fail" },
    ]);
  });

  it("parity flags rows missing from either side", async () => {
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io());
    // Airtable gains a site Turso lacks…
    const extra: RawRecord = { id: "recNEW", fields: { Name: "Newsite" } };
    const p1 = await checkFleetParity(db, io({ listWebsiteRecords: async () => [ACME, extra] }));
    expect(p1.mismatches).toContainEqual({
      table: "sites",
      id: "recNEW",
      column: "(row)",
      airtable: "present",
      turso: "ABSENT",
    });
    // …and Turso holds a site Airtable no longer has.
    const p2 = await checkFleetParity(db, io({ listWebsiteRecords: async () => [] }));
    expect(p2.mismatches).toContainEqual({
      table: "sites",
      id: "recACME",
      column: "(row)",
      airtable: "ABSENT",
      turso: "present",
    });
  });

  it("throws on a slug collision instead of silently overwriting a site", async () => {
    const db = await openDb({ url: ":memory:" });
    const twin: RawRecord = { id: "recTWIN", fields: { Name: "Acme  Gallery" } };
    await expect(
      importFleetState(db, io({ listWebsiteRecords: async () => [ACME, twin] })),
    ).rejects.toThrow(/slug collision/);
  });
});
