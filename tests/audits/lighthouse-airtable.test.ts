import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasRealScores,
  lighthouseScoresFromResult,
  resolveSlugFromCwd,
} from "../../src/audits/lighthouse-airtable.js";
import type { AuditResult } from "../../src/types.js";

function lhResult(summary: Record<string, number>): AuditResult {
  return {
    audit: "lighthouse",
    site: "acme",
    status: "pass",
    summary: "ok",
    details: { summary },
  } as unknown as AuditResult;
}

describe("lighthouseScoresFromResult", () => {
  it("converts LHCI fractions to integer percentages", () => {
    const s = lighthouseScoresFromResult(
      lhResult({ performance: 0.87, accessibility: 0.91, "best-practices": 1.0, seo: 0.95 }),
    );
    expect(s).toEqual({ performance: 87, accessibility: 91, bestPractices: 100, seo: 95 });
  });

  it("leaves missing categories null (write path clears the cell → dashboard '—')", () => {
    // A metric absent from the summary (e.g. NO_LCP nulls performance) must NOT
    // become a misleading 0 — it's unknown, not catastrophic. The write path
    // persists null to clear the Airtable cell.
    const s = lighthouseScoresFromResult(lhResult({ performance: 0.5 }));
    expect(s).toEqual({ performance: 50, accessibility: null, bestPractices: null, seo: null });
  });

  it("rounds half-up to the nearest integer", () => {
    const s = lighthouseScoresFromResult(
      lhResult({ performance: 0.895, accessibility: 0.504, "best-practices": 0, seo: 1 }),
    );
    expect(s.performance).toBe(90);
    expect(s.accessibility).toBe(50);
  });

  it("throws if given a non-lighthouse AuditResult", () => {
    const bad = { ...lhResult({}), audit: "deps" } as AuditResult;
    expect(() => lighthouseScoresFromResult(bad)).toThrow(/Expected a 'lighthouse'/);
  });
});

describe("hasRealScores", () => {
  // Behavioral contract for `audit --write-airtable`: write iff the audit
  // actually produced numeric scores. Below-threshold scores ARE real data
  // worth tracking; only absent/empty summary should block the write.
  it("returns true when all four lighthouse categories are present", () => {
    expect(
      hasRealScores(
        lhResult({ performance: 0.9, accessibility: 0.95, "best-practices": 0.92, seo: 1 }),
      ),
    ).toBe(true);
  });

  it("returns true even when only one category is present", () => {
    // Real lhr-*.json output, just an unusually pared-down config.
    expect(hasRealScores(lhResult({ performance: 0.5 }))).toBe(true);
  });

  it("returns true for an assertion-failed audit that still has real scores", () => {
    // Caltex 2026-05-28 case: best-practices = 0.78 below the 0.9 threshold
    // → status: "fail", but the dashboard NEEDS these numbers.
    const result: AuditResult = {
      audit: "lighthouse",
      site: "caltex",
      status: "fail",
      summary: "lighthouse: 2 assertion(s) failed",
      details: {
        summary: { performance: 0.89, accessibility: 1, "best-practices": 0.78, seo: 1 },
      },
    } as unknown as AuditResult;
    expect(hasRealScores(result)).toBe(true);
  });

  it("returns false for an infrastructure-failed audit (no manifest written)", () => {
    const result: AuditResult = {
      audit: "lighthouse",
      site: "caltex",
      status: "fail",
      summary: "lighthouse: no lhr-*.json written (exit 1)",
    } as unknown as AuditResult;
    expect(hasRealScores(result)).toBe(false);
  });

  it("returns false for an empty summary object", () => {
    expect(hasRealScores(lhResult({}))).toBe(false);
  });

  it("returns false when the audit name is not lighthouse", () => {
    const bad = { ...lhResult({ performance: 0.5 }), audit: "deps" } as AuditResult;
    expect(hasRealScores(bad)).toBe(false);
  });
});

describe("resolveSlugFromCwd", () => {
  it("slugifies package.json#name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lh-airtable-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "Med Solutions of Texas" }));
    expect(await resolveSlugFromCwd(dir)).toBe("med-solutions-of-texas");
    await rm(dir, { recursive: true });
  });

  it("throws on missing package.json", async () => {
    await expect(resolveSlugFromCwd("/nonexistent-path-xyz")).rejects.toThrow(
      /Could not derive site slug/,
    );
  });

  it("throws on package.json with no name field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lh-airtable-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
    await expect(resolveSlugFromCwd(dir)).rejects.toThrow(/Pass --write-airtable=<slug>/);
    await rm(dir, { recursive: true });
  });
});
