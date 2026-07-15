import { describe, it, expect, vi } from "vitest";
import { preflight } from "../../src/reports/preflight.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

/** Raw Airtable Websites rows (mapRow field names), fully send-clean unless overridden. */
function siteRecord(id: string, name: string, over: Record<string, unknown> = {}): FakeRecord {
  return {
    id,
    fields: {
      Name: name,
      url: `https://${name.toLowerCase().replace(/\s+/g, "")}.example.com`,
      Status: "maintenance",
      "point of contact": `owner@${name.toLowerCase().replace(/\s+/g, "")}.example.com`,
      "maintenence freq": "Monthly",
      "maintenance day": "2026-06-30",
      "Header image": [{ url: "https://x/img.png", filename: "img.png", type: "image/png" }],
      pScore: 90,
      rScore: 100,
      bpScore: 100,
      seoScore: 100,
      ...over,
    },
  };
}

const NOW = new Date("2026-07-02T12:00:00Z");

describe("preflight() orchestrator (fake Airtable base)", () => {
  it("--all with Announcement selects only maintenance-status sites (announce's own filter)", async () => {
    const base = makeFakeBase({
      Websites: [
        siteRecord("rec1", "Acme"),
        siteRecord("rec2", "Hosting Co", { Status: "hosting" }),
        siteRecord("rec3", "Dead Co", { Status: "deprecated" }),
      ],
      Reports: [],
    });
    const { results } = await preflight({ base, all: true, type: "Announcement", now: NOW });
    expect(results.map((r) => r.site)).toEqual(["Acme"]);
  });

  it("--all with Maintenance mirrors report --due eligibility: hosting + null-status included, deprecated excluded", async () => {
    const base = makeFakeBase({
      Websites: [
        siteRecord("rec1", "Acme"),
        siteRecord("rec2", "Hosting Co", { Status: "hosting" }),
        siteRecord("rec3", "Legacy Row", { Status: undefined }),
        siteRecord("rec4", "Dead Co", { Status: "deprecated" }),
        siteRecord("rec5", "Not Ours", { Status: "probably not our problem" }),
      ],
      Reports: [],
    });
    const { results } = await preflight({ base, all: true, type: "Maintenance", now: NOW });
    expect(results.map((r) => r.site).sort()).toEqual(["Acme", "Hosting Co", "Legacy Row"]);
  });

  it("single-site mode matches by slug and skips fleet checks", async () => {
    const base = makeFakeBase({
      Websites: [siteRecord("rec1", "Acme Co"), siteRecord("rec2", "Beta Co")],
      Reports: [],
    });
    const { results, fleet } = await preflight({ base, site: "acme-co", now: NOW });
    expect(results.map((r) => r.site)).toEqual(["Acme Co"]);
    expect(fleet).toEqual([]);
  });

  it("fetches the Reports table exactly once regardless of site count (rate-limit parity with --due)", async () => {
    const base = makeFakeBase({
      Websites: [siteRecord("rec1", "A"), siteRecord("rec2", "B"), siteRecord("rec3", "C")],
      Reports: [],
    });
    await preflight({ base, all: true, type: "Announcement", now: NOW });
    const reportSelects = base.__calls.filter((c) => c.kind === "select" && c.table === "Reports");
    expect(reportSelects).toHaveLength(1);
  });

  it("matches each site to its own reports via the Site link column", async () => {
    const base = makeFakeBase({
      Websites: [siteRecord("rec1", "Acme"), siteRecord("rec2", "Beta")],
      Reports: [
        {
          id: "recR1",
          fields: {
            Site: ["rec1"],
            "Report type": "Maintenance",
            "Draft ready": true,
            Period: "2026-01",
          },
        },
      ],
    });
    const { results } = await preflight({ base, all: true, type: "Announcement", now: NOW });
    const acme = results.find((r) => r.site === "Acme")!;
    const beta = results.find((r) => r.site === "Beta")!;
    expect(acme.findings.map((f) => f.check)).toContain("pending-drafts");
    expect(beta.findings.map((f) => f.check)).not.toContain("pending-drafts");
  });

  it("end-to-end through mapRow: a typo'd frequency cell fails preflight (the reachability regression)", async () => {
    // The rows go through the REAL mapRow, so toFrequency's read-boundary warn
    // fires here too — spy on it (silencing the stderr noise) and assert it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const base = makeFakeBase({
        Websites: [siteRecord("rec1", "Acme", { "maintenence freq": "Quaterly" })],
        Reports: [],
      });
      const { results } = await preflight({ base, site: "acme", now: NOW });
      expect(results[0]!.findings.map((f) => f.check)).toContain("frequency-unrecognized");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/Acme.*unrecognized frequency 'Quaterly'/);
    } finally {
      warn.mockRestore();
    }
  });
});
