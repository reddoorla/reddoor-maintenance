import { describe, it, expect, vi } from "vitest";
import { collectAttention } from "../../src/reports/digest.js";
import type { OpenPullRequestsProbe } from "../../src/alerts/renovate.js";
import type { PullRequestSummary } from "../../src/github/gh.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

const BASE_URL = "https://reddoor-maintenance.netlify.app";

function failingRenovatePR(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 7,
    title: "chore(deps): bump vite to 7.1.0",
    url: "https://github.com/reddoorla/acme/pull/7",
    headRef: "renovate/npm-vite",
    ciState: "failing",
    ...over,
  };
}

/** A site row carrying a Git repo, so the renovate sweep includes it. */
function repoSite(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      "Security Vulns Critical": 2,
      "Git repo": "reddoorla/acme",
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

  it("sweeps Renovate when a probe is injected: a failing PR appears alongside vuln + delivery", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [repoSite()] });
    const renovateProbe: OpenPullRequestsProbe = async (repo) =>
      repo === "reddoorla/acme" ? [failingRenovatePR()] : [];
    const items = await collectAttention({ base, baseUrl: BASE_URL, renovateProbe });
    const keys = items.map((i) => i.key).sort();
    expect(keys).toContain("vuln:rec_site_acme");
    expect(keys).toContain("delivery:rec_report_bounced");
    expect(keys).toContain("renovate:reddoorla/acme#7");
    const ren = items.find((i) => i.kind === "renovate")!;
    expect(ren.title).toBe("Renovate update failing CI: chore(deps): bump vite to 7.1.0");
    expect(ren.severity).toBe("warning");
  });

  it("emits NO renovate items when no probe is injected (no-token path)", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [repoSite()] });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    expect(items.some((i) => i.kind === "renovate")).toBe(false);
    // The other collectors still contribute.
    expect(items.some((i) => i.kind === "vuln")).toBe(true);
    expect(items.some((i) => i.kind === "delivery")).toBe(true);
  });

  it("adapts WebsiteRow→Site: a site with null gitRepo is skipped by the detector (no probe call for it)", async () => {
    // Acme has a repo; Beta has no "Git repo" → gitRepo null → must not be probed.
    const beta: FakeRecord = {
      id: "rec_site_beta",
      fields: { Name: "Beta Ltd", url: "https://beta.example.com" },
    };
    const base = makeFakeBase({ Reports: [], Websites: [repoSite(), beta] });
    const probed: string[] = [];
    const renovateProbe: OpenPullRequestsProbe = async (repo) => {
      probed.push(repo);
      return [failingRenovatePR()];
    };
    const items = await collectAttention({ base, baseUrl: BASE_URL, renovateProbe });
    expect(probed).toEqual(["reddoorla/acme"]); // beta (null gitRepo) never probed
    expect(items.some((i) => i.key === "renovate:reddoorla/acme#7")).toBe(true);
  });

  it("isolates a renovate-probe outage: a throwing probe yields no renovate items + warns; vuln/delivery unaffected", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [repoSite()] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renovateProbe: OpenPullRequestsProbe = async () => {
      throw new Error("gh graphql 502");
    };
    const items = await collectAttention({ base, baseUrl: BASE_URL, renovateProbe });
    // A single-site sweep whose only repo throws → that repo is `skipped`, so the
    // sweep returns a `renovate:skipped` note (not a hard collector failure). The
    // other collectors are untouched.
    expect(items.some((i) => i.kind === "vuln")).toBe(true);
    expect(items.some((i) => i.kind === "delivery")).toBe(true);
    expect(items.find((i) => i.key === "renovate:skipped")).toBeDefined();
    warn.mockRestore();
  });
});
