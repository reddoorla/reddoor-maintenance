import { describe, it, expect } from "vitest";
import {
  mapWebsiteRecord,
  mapReportRecord,
  EXCLUDED_WEBSITE_FIELDS,
  type RawRecord,
} from "../../src/db/field-map.js";

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
    "Rendered HTML": [{ url: "https://files.example/signed/abc", filename: "r.html" }],
  },
};

describe("mapWebsiteRecord", () => {
  const m = mapWebsiteRecord(ACME, NOW.toISOString());

  it("splits config / health / schedule on the writer-map lines", () => {
    expect(m.site).toMatchObject({
      id: "recACME",
      slug: "acme-gallery",
      name: "Acme Gallery",
      // RAW, not canonical: the cell is stored verbatim. Canonicalization is a
      // READ-side concern (mapRow / fleet-state), never at rest.
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
    // Column names ("Maint: …", "Test: Verified After Updates") do NOT leak
    // into the store; the stable keys from checklist.ts do.
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
  });

  it("a STRING auto-evidence cell is stored verbatim, never double-encoded", () => {
    // Long-text cells arrive as strings; JSON.stringify-ing one again
    // would make parseAutoEvidence yield a string → null on the read side.
    const evidence = JSON.stringify({ deploy: { result: "pass", checkedAt: null, note: "" } });
    const rec: RawRecord = {
      ...REPORT,
      fields: { ...REPORT.fields, "Checklist auto-evidence": evidence },
    };
    expect(mapReportRecord(rec, null).checklist_auto_evidence).toBe(evidence);
  });
});
