import { describe, it, expect } from "vitest";
import { writeAuditsToAirtable } from "../../src/audits/write-audits-to-airtable.js";
import type { AuditResult } from "../../src/types.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

type UpdateCall = { table: string; id: string; fields: Record<string, unknown> };

function makeFakeBase(): { base: AirtableBase; calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  const tableFn = (table: string) => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      for (const r of recs) calls.push({ table, id: r.id, fields: r.fields });
      return recs;
    },
  });
  const base = tableFn as unknown as AirtableBase;
  return { base, calls };
}

function row(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recACME",
    name: "Acme",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: null,
    rScore: null,
    bpScore: null,
    seoScore: null,
    lastLighthouseAuditAt: null,
    dashboardToken: "tok",
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    ...over,
  };
}

const lhResult = (summary: Record<string, number>): AuditResult =>
  ({
    audit: "lighthouse",
    site: "acme",
    status: "pass",
    summary: "ok",
    details: { summary },
  }) as unknown as AuditResult;

const a11yResult = (totalViolations: number): AuditResult =>
  ({
    audit: "a11y",
    site: "acme",
    status: totalViolations === 0 ? "pass" : "warn",
    summary: "ok",
    details: { totalViolations, byImpact: {} },
  }) as unknown as AuditResult;

const depsResult = (drifts: Array<"same" | "patch" | "minor" | "major" | "newer">): AuditResult =>
  ({
    audit: "deps",
    site: "acme",
    status: "pass",
    summary: "ok",
    details: drifts.map((drift, i) => ({
      pkg: `pkg${i}`,
      baseline: "1.0.0",
      actual: "1.0.0",
      drift,
    })),
  }) as unknown as AuditResult;

const secResult = (counts: {
  low: number;
  moderate: number;
  high: number;
  critical: number;
}): AuditResult =>
  ({
    audit: "security",
    site: "acme",
    status: counts.critical + counts.high > 0 ? "fail" : "pass",
    summary: "ok",
    details: { counts, advisories: [] },
  }) as unknown as AuditResult;

describe("writeAuditsToAirtable", () => {
  it("writes lighthouse scores when a real-scores lighthouse result is present", async () => {
    const { base, calls } = makeFakeBase();
    const summary = await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.87, accessibility: 0.95, "best-practices": 0.78, seo: 1 }),
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fields).toMatchObject({
      pScore: 87,
      rScore: 95,
      bpScore: 78,
      seoScore: 100,
    });
    expect(calls[0]?.fields["Last lighthouse audit at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(summary.siteName).toBe("Acme");
    expect(summary.writes.map((w) => w.audit)).toEqual(["lighthouse"]);
  });

  it("writes a11y / deps / security counts alongside lighthouse when all four ran", async () => {
    const { base, calls } = makeFakeBase();
    const summary = await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
        a11yResult(3),
        depsResult(["same", "patch", "minor", "major", "newer"]),
        secResult({ low: 4, moderate: 3, high: 2, critical: 1 }),
      ],
    });
    expect(summary.writes.map((w) => w.audit)).toEqual(["lighthouse", "a11y", "deps", "security"]);
    expect(calls).toHaveLength(4);
    const merged = Object.assign({}, ...calls.map((c) => c.fields));
    expect(merged).toMatchObject({
      pScore: 90,
      "A11y Violations": 3,
      "Deps Drifted": 4,
      "Deps Major Behind": 1,
      "Security Vulns Critical": 1,
      "Security Vulns High": 2,
      "Security Vulns Moderate": 3,
      "Security Vulns Low": 4,
    });
  });

  it("skips audit types whose result is missing or skipped (predicate false)", async () => {
    const { base, calls } = makeFakeBase();
    const summary = await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
        // a11y missing entirely (e.g. --only lighthouse,deps)
        depsResult([]),
        // security skipped (no audit tool)
        {
          audit: "security",
          site: "acme",
          status: "skip",
          summary: "cannot run audit",
        } as unknown as AuditResult,
      ],
    });
    expect(summary.writes.map((w) => w.audit)).toEqual(["lighthouse", "deps"]);
    expect(calls.map((c) => Object.keys(c.fields).join(","))).toEqual([
      "pScore,rScore,bpScore,seoScore,Last lighthouse audit at",
      "Deps Drifted,Deps Major Behind",
    ]);
  });

  it("throws exit-code-1 with hasRealScores message when lighthouse has no scores", async () => {
    const { base } = makeFakeBase();
    await expect(
      writeAuditsToAirtable({
        base,
        websites: [row()],
        slug: "acme",
        results: [
          {
            audit: "lighthouse",
            site: "acme",
            status: "fail",
            summary: "lighthouse: no lhr-*.json written (exit 1)",
          } as unknown as AuditResult,
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Lighthouse audit produced no scores/),
      exitCode: 1,
    });
  });

  it("throws exit-code-2 when lighthouse result is absent (operator passed --only without lighthouse)", async () => {
    const { base } = makeFakeBase();
    await expect(
      writeAuditsToAirtable({
        base,
        websites: [row()],
        slug: "acme",
        results: [a11yResult(0)],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/requires a lighthouse result/),
      exitCode: 2,
    });
  });

  it("throws exit-code-2 when no Websites row matches the slug", async () => {
    const { base } = makeFakeBase();
    await expect(
      writeAuditsToAirtable({
        base,
        websites: [row({ name: "Beta" })], // slugs to "beta", not "acme"
        slug: "acme",
        results: [lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 })],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/No Websites row matched slug "acme"/),
      exitCode: 2,
    });
  });
});
