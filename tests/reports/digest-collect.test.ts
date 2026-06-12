import { describe, it, expect, vi } from "vitest";
import { collectAttention } from "../../src/reports/digest.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

const BASE_URL = "https://reddoor-maintenance.netlify.app";

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
});
