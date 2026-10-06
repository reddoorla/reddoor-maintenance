import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lighthouseAudit } from "../../src/audits/lighthouse.js";
import {
  formatLighthouseFailureLines,
  lighthouseFailingAuditsFromResult,
} from "../../src/audits/lighthouse-fields.js";
import { planAuditWrite } from "../../src/audits/write-audits.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import type { AuditResult } from "../../src/types.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

type Run = { bp: number; audits: Record<string, number | null> };

const BP_REFS = [
  { id: "is-on-https", weight: 5 },
  { id: "deprecations", weight: 5 },
  { id: "third-party-cookies", weight: 5 },
  { id: "inspector-issues", weight: 1 },
  { id: "errors-in-console", weight: 1 },
  { id: "valid-source-maps", weight: 0 },
];

function lhr(run: Run): object {
  const audits: Record<string, { score: number | null }> = {
    "is-on-https": { score: 1 },
    deprecations: { score: 1 },
    "third-party-cookies": { score: 1 },
    "inspector-issues": { score: 1 },
    "errors-in-console": { score: 1 },
    "valid-source-maps": { score: 0 },
    "largest-contentful-paint": { score: 0.4 },
  };
  for (const [id, score] of Object.entries(run.audits)) audits[id] = { score };
  return {
    requestedUrl: "https://www.datadynamiq.com/",
    categories: {
      performance: {
        score: 0.95,
        auditRefs: [{ id: "largest-contentful-paint", weight: 25 }],
      },
      accessibility: { score: 1, auditRefs: [] },
      "best-practices": { score: run.bp, auditRefs: BP_REFS },
      seo: { score: 1, auditRefs: [] },
    },
    audits,
  };
}

function spawnWith(runs: Run[], assertions: object[]): SpawnFn {
  return async (_cmd, _args, opts) => {
    const dir = join(opts?.cwd ?? process.cwd(), ".lighthouseci");
    await mkdir(dir, { recursive: true });
    for (const [i, run] of runs.entries()) {
      await writeFile(join(dir, `lhr-${i}.json`), JSON.stringify(lhr(run)), "utf-8");
    }
    await writeFile(join(dir, "assertion-results.json"), JSON.stringify(assertions), "utf-8");
    return { code: assertions.length > 0 ? 1 : 0, stdout: "", stderr: "" };
  };
}

const BP_FAILED = {
  name: "minScore",
  expected: 0.9,
  actual: 0.78,
  values: [0.78, 0.78, 0.78],
  operator: ">=",
  passed: false,
  auditProperty: "best-practices",
  auditId: "categories",
  level: "error",
  url: "https://www.datadynamiq.com/",
};

async function audit(runs: Run[], assertions: object[]): Promise<AuditResult> {
  return lighthouseAudit({
    site: { path: "/x", name: "Data Dynamiq", deployedUrl: "https://www.datadynamiq.com/" },
    spawn: spawnWith(runs, assertions),
  });
}

const THREE_FAILING: Run[] = [
  { bp: 0.78, audits: { "third-party-cookies": 0, "inspector-issues": 0 } },
  { bp: 0.78, audits: { "third-party-cookies": 0, "inspector-issues": 0 } },
  { bp: 0.81, audits: { "third-party-cookies": 0, "errors-in-console": null } },
];

describe("lighthouse names the audits behind a failed category assertion", () => {
  it("lists each weighted audit that scored below 1, with how many runs it failed in", async () => {
    const result = await audit(THREE_FAILING, [BP_FAILED]);
    const details = result.details as {
      failingAudits: unknown[];
      assertions: Array<{ category: string; message: string }>;
    };
    expect(details.assertions[0]).toMatchObject({
      category: "best-practices",
      message: "categories:best-practices minScore >= 0.9 (actual: 0.78)",
    });
    expect(details.failingAudits).toEqual([
      { category: "best-practices", id: "third-party-cookies", weight: 5, runs: 3, of: 3 },
      { category: "best-practices", id: "inspector-issues", weight: 1, runs: 2, of: 3 },
    ]);
    expect(result.summary).toBe(
      "lighthouse: 1 assertion(s) failed — best-practices/third-party-cookies (3/3), best-practices/inspector-issues (2/3)",
    );
  });

  it("prints one machine-readable line per failing site", async () => {
    const result = await audit(THREE_FAILING, [BP_FAILED]);
    const passing = await audit([{ bp: 1, audits: {} }], []);
    expect(formatLighthouseFailureLines([result, passing])).toBe(
      "LIGHTHOUSE_FAILURES assertions=best-practices:0.78<0.9 audits=best-practices/third-party-cookies:w5:3/3,best-practices/inspector-issues:w1:2/3 site=Data Dynamiq",
    );
  });

  it("writes the named audits to site_health beside the scores, and clears them on a passing run", async () => {
    const website = makeWebsiteRow({ name: "Data Dynamiq" });
    const failing = planAuditWrite({
      websites: [website],
      slug: "data-dynamiq",
      results: [await audit(THREE_FAILING, [BP_FAILED])],
    });
    expect(failing.summary.fields?.["Lighthouse failing audits"]).toBe(
      "best-practices/third-party-cookies:w5:3/3,best-practices/inspector-issues:w1:2/3",
    );
    const passing = planAuditWrite({
      websites: [website],
      slug: "data-dynamiq",
      results: [await audit([{ bp: 1, audits: {} }], [])],
    });
    expect(passing.summary.fields).toHaveProperty("Lighthouse failing audits", null);
  });

  it("says unnamed rather than nothing when a category failed but no lhr audit explains it", async () => {
    const result = await audit([{ bp: 0.78, audits: {} }], [BP_FAILED]);
    expect(lighthouseFailingAuditsFromResult(result)).toBe("unnamed");
    expect(formatLighthouseFailureLines([result])).toMatch(/ audits=unnamed site=/);
  });
});
