import { describe, it, expect } from "vitest";
import { writeAuditsToAirtable } from "../../src/audits/write-audits-to-airtable.js";
import type { AuditResult } from "../../src/types.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

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
  return makeWebsiteRow({
    id: "recACME",
    name: "Acme",
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    dashboardToken: "tok",
    ...over,
  });
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

const depsResult = (
  drifts: Array<"same" | "patch" | "minor" | "major" | "newer">,
  outdated: { outdated: number; major: number } | null = null,
): AuditResult =>
  ({
    audit: "deps",
    site: "acme",
    status: "pass",
    summary: "ok",
    details: {
      entries: drifts.map((drift, i) => ({
        pkg: `pkg${i}`,
        baseline: "1.0.0",
        actual: "1.0.0",
        drift,
      })),
      outdated,
    },
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
    // ONE atomic update carrying every audit's fields (not four separate updates).
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fields).toMatchObject({
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

  it("writes the real outdated-install count to the Deps Outdated field when determined", async () => {
    const { base, calls } = makeFakeBase();
    await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
        depsResult(["minor"], { outdated: 4, major: 1 }),
      ],
    });
    const merged = Object.assign({}, ...calls.map((c) => c.fields));
    expect(merged["Deps Outdated"]).toBe(4);
  });

  it("omits Deps Outdated from the write when the deps audit couldn't determine it (preserves prior)", async () => {
    const { base, calls } = makeFakeBase();
    await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
        depsResult(["minor"], null),
      ],
    });
    const merged = Object.assign({}, ...calls.map((c) => c.fields));
    expect("Deps Outdated" in merged).toBe(false);
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
    // One merged write carrying only the audits that ran (lighthouse + deps).
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.fields)).toEqual([
      "pScore",
      "rScore",
      "bpScore",
      "seoScore",
      "Last lighthouse audit at",
      "Deps Drifted",
      "Deps Major Behind",
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

  // morning-brief 2026-06-10 MEDIUM-E: a Lighthouse Chrome-timeout (erp's
  // nightly fate) used to throw BEFORE any write, discarding that site's valid
  // a11y/deps/security results. The non-Lighthouse audits must be persisted
  // first; the function still throws exit-code-1 so the site is flagged.
  it("persists a11y/deps/security even when lighthouse has no scores, then still throws exit-code-1", async () => {
    const { base, calls } = makeFakeBase();
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
          a11yResult(3),
          depsResult(["minor", "major"]),
          secResult({ low: 1, moderate: 2, high: 1, critical: 0 }),
        ],
      }),
    ).rejects.toMatchObject({
      // The thrown error enumerates what WAS persisted, so the single-site CLI
      // operator (who sees `console.error(e.message)`) doesn't read the failure
      // as "nothing written".
      message: expect.stringMatching(
        /produced no scores; wrote a11y\/deps\/security but refused Lighthouse/,
      ),
      exitCode: 1,
    });
    // The good non-Lighthouse data was written despite the Lighthouse miss — and
    // ATOMICALLY: exactly one update carries all of it (no half-written row).
    expect(calls).toHaveLength(1);
    const merged = calls[0]!.fields;
    expect(merged).toMatchObject({
      "A11y Violations": 3,
      "Deps Drifted": 2,
      "Security Vulns High": 1,
      "Security Vulns Moderate": 2,
    });
    // ...but no Lighthouse scores were written.
    expect("pScore" in merged).toBe(false);
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
