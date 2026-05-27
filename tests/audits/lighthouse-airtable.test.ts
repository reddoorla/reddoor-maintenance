import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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

  it("defaults missing categories to 0", () => {
    const s = lighthouseScoresFromResult(lhResult({ performance: 0.5 }));
    expect(s).toEqual({ performance: 50, accessibility: 0, bestPractices: 0, seo: 0 });
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

  // Regression: an empty summary (which happens when the audit skipped — no
  // .lighthouseci/ manifest to parse) extracts to all-zero scores. The CLI
  // layer must refuse the write to avoid clobbering good Airtable data;
  // verify the extractor produces the all-zero pattern that the guard checks.
  it("returns all-zero scores when summary is empty (audit didn't actually run)", () => {
    const s = lighthouseScoresFromResult(lhResult({}));
    expect(s).toEqual({ performance: 0, accessibility: 0, bestPractices: 0, seo: 0 });
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
