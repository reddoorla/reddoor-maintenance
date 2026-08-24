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
import { getSiteBySlug, getSiteById, listSites } from "../../src/db/fleet-state.js";
import { mapRow, siteSlug } from "../../src/reports/airtable/websites.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const RICH: RawRecord = {
  id: "recRICH",
  fields: {
    Name: "Acme Gallery",
    url: "https://acme.example.com",
    Status: "maintenance",
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
