import { describe, it, expect, vi } from "vitest";
import { collectAttention } from "../../src/reports/digest.js";
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { listAllReports } from "../../src/reports/airtable/reports.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

const BASE_URL = "https://reddoor-maintenance.netlify.app";

/** A site row carrying the nightly-persisted GitHub-signal fields the renovate/ci
 *  collectors read (NOT a live sweep — those fields are written by github-signals). */
function signalSite(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      "Security Vulns Critical": 2,
      "Renovate Failing CIs": 1,
      "Default Branch CI": "failing",
      ...over,
    },
  };
}

function vulnSite(): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: { Name: "Acme Co", url: "https://acme.example.com", "Security Vulns Critical": 2 },
  };
}

/** A bounced report on a site that exists — collectDeliveryFailures should keep it. */
function bouncedReport(): FakeRecord {
  return {
    id: "rec_report_bounced",
    fields: {
      "Report ID": "Acme Co — Maintenance — 2026-06",
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      Period: "2026-06",
      "Delivery status": "bounced",
    },
  };
}

describe("collectAttention", () => {
  it("fetches once, builds sitesById, and merges both collectors' items", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSite()] });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    const keys = items.map((i) => i.key).sort();
    expect(keys).toContain("vuln:rec_site_acme");
    expect(keys).toContain("delivery:rec_report_bounced");
  });

  it("surfaces a low-Lighthouse-score site alongside vuln + delivery", async () => {
    // Acme carries a critical vuln (vuln item), a bounced report (delivery item),
    // AND a Performance score below the 75 floor (lighthouse item).
    const acme: FakeRecord = {
      id: "rec_site_acme",
      fields: {
        Name: "Acme Co",
        url: "https://acme.example.com",
        "Security Vulns Critical": 2,
        pScore: 55,
      },
    };
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [acme] });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    const keys = items.map((i) => i.key).sort();
    expect(keys).toContain("vuln:rec_site_acme");
    expect(keys).toContain("delivery:rec_report_bounced");
    expect(keys).toContain("lighthouse:rec_site_acme:performance");
    const lh = items.find((i) => i.kind === "lighthouse")!;
    expect(lh.title).toBe("Lighthouse Performance 55 (below 75)");
    expect(lh.metric).toBe(45); // 100 - 55
  });

  it("isolates a failing collector: a throw in one yields [] for it, the other still returns", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSite()] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Force collectVulnAlerts to throw; collectDeliveryFailures must still contribute.
    const collectors = await import("../../src/alerts/digest-collectors.js");
    vi.spyOn(collectors, "collectVulnAlerts").mockImplementation(() => {
      throw new Error("vuln collector boom");
    });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    expect(items.map((i) => i.key)).toEqual(["delivery:rec_report_bounced"]);
    expect(items.some((i) => i.kind === "vuln")).toBe(false);
    expect(warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("emits renovate + ci items from the PERSISTED fields, keyed by siteId (cockpit-aligned)", async () => {
    // The github-signals nightly sweep persists `Renovate Failing CIs` + `Default
    // Branch CI`; the digest reads those, NOT a live GitHub sweep. The keys are
    // `renovate:<siteId>` / `ci:<siteId>` — the SAME keys buildCockpitModel emits,
    // which is what lets the shared Digest State snapshot badge NEW/WORSE correctly.
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [signalSite()] });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    const keys = items.map((i) => i.key).sort();
    expect(keys).toContain("vuln:rec_site_acme");
    expect(keys).toContain("delivery:rec_report_bounced");
    expect(keys).toContain("renovate:rec_site_acme");
    expect(keys).toContain("ci:rec_site_acme");
    const ren = items.find((i) => i.kind === "renovate")!;
    expect(ren.title).toBe("1 Renovate PR failing CI");
    expect(ren.severity).toBe("warning");
    const ci = items.find((i) => i.kind === "ci")!;
    expect(ci.title).toBe("Default-branch CI failing");
  });

  it("emits NO renovate/ci items for a site whose persisted fields are clean/absent", async () => {
    // No "Renovate Failing CIs" / "Default Branch CI" → null → both collectors skip.
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSite()] });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    expect(items.some((i) => i.kind === "renovate")).toBe(false);
    expect(items.some((i) => i.kind === "ci")).toBe(false);
    // The other collectors still contribute.
    expect(items.some((i) => i.kind === "vuln")).toBe(true);
    expect(items.some((i) => i.kind === "delivery")).toBe(true);
  });

  it("issues ZERO Reports/Websites selects when both arrays are pre-fetched (dedup seam)", async () => {
    // Materialize real rows from a throwaway base (the only fetch here).
    const seedBase = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSite()] });
    const reports = await listAllReports(seedBase);
    const websites = await listWebsites(seedBase);

    // A FRESH base whose tables are empty — if collectAttention re-fetches, the
    // selects show up in __calls AND the seeded rows vanish (items would be empty).
    const base = makeFakeBase({});
    const items = await collectAttention({ base, baseUrl: BASE_URL, websites, reports });

    // The pre-fetched arrays must be used: no select against either table.
    const selects = base.__calls.filter((c) => c.kind === "select");
    expect(selects).toEqual([]);

    // And the items must derive from the injected arrays, not the empty base.
    const keys = items.map((i) => i.key).sort();
    expect(keys).toContain("vuln:rec_site_acme");
    expect(keys).toContain("delivery:rec_report_bounced");
  });

  it("digest and cockpit produce the SAME renovate/ci keys for one site (key-space pinned)", async () => {
    // The crux of the fix: the digest path (collectAttention) and the cockpit path
    // (buildCockpitModel) must emit IDENTICAL diff keys for the same site, so the
    // Digest State snapshot the digest writes lets the cockpit badge NEW/WORSE. If
    // these key-spaces ever diverge again, this assertion breaks.
    const siteId = "rec_site_acme";
    const base = makeFakeBase({
      Reports: [],
      Websites: [
        signalSite({
          // dashboardToken makes the site cockpit-visible
          "Dashboard Token": "tok_acme",
          "Renovate Failing CIs": 2,
          "Default Branch CI": "failing",
        }),
      ],
    });
    const digestItems = await collectAttention({ base, baseUrl: BASE_URL });

    // Same fake rows → cockpit path.
    const websites = await listWebsites(base);
    const { buildCockpitModel } = await import("../../src/dashboard/fleet-cockpit.js");
    const cockpit = buildCockpitModel(websites, [], {}, BASE_URL, new Date());
    const cockpitKeys = cockpit.cards.flatMap((c) => c.items.map((i) => i.key));

    // The digest must emit renovate:<siteId> and ci:<siteId> for this site …
    expect(digestItems.map((i) => i.key)).toContain(`renovate:${siteId}`);
    expect(digestItems.map((i) => i.key)).toContain(`ci:${siteId}`);
    // … and those must be the EXACT keys the cockpit produces for the same site.
    expect(cockpitKeys).toContain(`renovate:${siteId}`);
    expect(cockpitKeys).toContain(`ci:${siteId}`);
  });
});
