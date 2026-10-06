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

type AuditState = { score: number | null; scoreDisplayMode?: string };
type Run = { bp?: number; perf?: number; audits?: Record<string, AuditState> };

const BP_REFS = [
  { id: "is-on-https", weight: 5 },
  { id: "deprecations", weight: 5 },
  { id: "third-party-cookies", weight: 5 },
  { id: "inspector-issues", weight: 1 },
  { id: "errors-in-console", weight: 1 },
  { id: "valid-source-maps", weight: 0 },
];

const PERF_REFS = [
  { id: "largest-contentful-paint", weight: 25 },
  { id: "total-blocking-time", weight: 30 },
  { id: "first-contentful-paint", weight: 10 },
  { id: "diagnostics", weight: 0 },
];

const PASSING: Record<string, AuditState> = {
  "is-on-https": { score: 1, scoreDisplayMode: "binary" },
  deprecations: { score: 1, scoreDisplayMode: "binary" },
  "third-party-cookies": { score: 1, scoreDisplayMode: "binary" },
  "inspector-issues": { score: 1, scoreDisplayMode: "binary" },
  "errors-in-console": { score: 1, scoreDisplayMode: "binary" },
  "valid-source-maps": { score: 0, scoreDisplayMode: "binary" },
  "largest-contentful-paint": { score: 1, scoreDisplayMode: "numeric" },
  "total-blocking-time": { score: 1, scoreDisplayMode: "numeric" },
  "first-contentful-paint": { score: 1, scoreDisplayMode: "numeric" },
  diagnostics: { score: null, scoreDisplayMode: "informative" },
};

function lhr(run: Run): object {
  return {
    requestedUrl: "https://www.datadynamiq.com/",
    categories: {
      performance: { score: run.perf ?? 1, auditRefs: PERF_REFS },
      accessibility: { score: 1, auditRefs: [] },
      "best-practices": { score: run.bp ?? 1, auditRefs: BP_REFS },
      seo: { score: 1, auditRefs: [] },
    },
    audits: { ...PASSING, ...run.audits },
  };
}

function spawnWith(runs: Run[], assertions: object[] | null, code?: number): SpawnFn {
  return async (_cmd, _args, opts) => {
    const dir = join(opts?.cwd ?? process.cwd(), ".lighthouseci");
    await mkdir(dir, { recursive: true });
    for (const [i, run] of runs.entries()) {
      await writeFile(join(dir, `lhr-${i}.json`), JSON.stringify(lhr(run)), "utf-8");
    }
    if (assertions !== null) {
      await writeFile(join(dir, "assertion-results.json"), JSON.stringify(assertions), "utf-8");
    }
    return {
      code: code ?? (assertions && assertions.length > 0 ? 1 : 0),
      stdout: "",
      stderr: "",
    };
  };
}

function categoryAssertion(category: string, over: Record<string, unknown>): object {
  return {
    name: "minScore",
    expected: 0.9,
    actual: 0.78,
    values: [0.78, 0.78, 0.78],
    operator: ">=",
    passed: false,
    auditProperty: category,
    auditId: "categories",
    level: "error",
    url: "https://www.datadynamiq.com/",
    ...over,
  };
}

const BP_FAILED = categoryAssertion("best-practices", {});

async function audit(
  runs: Run[],
  assertions: object[] | null,
  code?: number,
): Promise<AuditResult> {
  return lighthouseAudit({
    site: { path: "/x", name: "Data Dynamiq", deployedUrl: "https://www.datadynamiq.com/" },
    spawn: spawnWith(runs, assertions, code),
  });
}

const zero = (mode = "binary"): AuditState => ({ score: 0, scoreDisplayMode: mode });

const THREE_FAILING: Run[] = [
  {
    bp: 0.78,
    audits: {
      "third-party-cookies": zero(),
      "inspector-issues": zero(),
      "first-contentful-paint": { score: 0.95, scoreDisplayMode: "numeric" },
    },
  },
  { bp: 0.78, audits: { "third-party-cookies": zero(), "inspector-issues": zero() } },
  {
    bp: 0.81,
    audits: { "third-party-cookies": zero(), "errors-in-console": { score: null } },
  },
];

function failingAudits(result: AuditResult): unknown[] {
  return (result.details as { failingAudits: unknown[] }).failingAudits;
}

describe("lighthouse names the audits behind a failed category assertion", () => {
  it("lists each weighted audit that scored below 1, with how many runs it failed in", async () => {
    const result = await audit(THREE_FAILING, [BP_FAILED]);
    const details = result.details as {
      assertions: Array<{ category: string; message: string }>;
    };
    expect(details.assertions[0]).toMatchObject({
      category: "best-practices",
      message: "categories:best-practices minScore >= 0.9 (actual: 0.78)",
    });
    expect(failingAudits(result)).toEqual([
      {
        category: "best-practices",
        id: "third-party-cookies",
        weight: 5,
        runs: 3,
        of: 3,
        errored: false,
      },
      {
        category: "best-practices",
        id: "inspector-issues",
        weight: 1,
        runs: 2,
        of: 3,
        errored: false,
      },
    ]);
    expect(result.summary).toBe(
      "lighthouse: 1 assertion(s) failed — best-practices/third-party-cookies (3/3), best-practices/inspector-issues (2/3)",
    );
  });

  it("orders by category, then weight, then runs, and counts a single-run audit out of one", async () => {
    const runs: Run[] = [
      {
        bp: 0.7,
        perf: 0.5,
        audits: {
          "third-party-cookies": zero(),
          "inspector-issues": zero(),
          "errors-in-console": zero(),
          "first-contentful-paint": { score: 0.62, scoreDisplayMode: "numeric" },
          "total-blocking-time": { score: 0.99, scoreDisplayMode: "numeric" },
        },
      },
      { bp: 0.9, audits: { "inspector-issues": zero(), "errors-in-console": zero() } },
      { bp: 0.9, audits: { "inspector-issues": zero() } },
    ];
    const result = await audit(runs, [
      BP_FAILED,
      categoryAssertion("performance", { expected: 0.7, actual: 0.5, level: "warn" }),
    ]);
    expect(
      failingAudits(result).map((f) => {
        const a = f as { category: string; id: string; runs: number; of: number };
        return `${a.category}/${a.id} ${a.runs}/${a.of}`;
      }),
    ).toEqual([
      "best-practices/third-party-cookies 1/3",
      "best-practices/inspector-issues 3/3",
      "best-practices/errors-in-console 2/3",
      "performance/total-blocking-time 1/3",
      "performance/first-contentful-paint 1/3",
    ]);

    const single = await audit([THREE_FAILING[0]!], [BP_FAILED]);
    expect(lighthouseFailingAuditsFromResult(single)).toBe(
      "best-practices/third-party-cookies:w5:1/1,best-practices/inspector-issues:w1:1/1",
    );
  });

  it("names a weighted audit that errored, which is what nulls a category", async () => {
    const result = await audit(
      [
        {
          perf: 0.6,
          audits: {
            "largest-contentful-paint": { score: 0.5, scoreDisplayMode: "numeric" },
            "first-contentful-paint": { score: 0.99, scoreDisplayMode: "numeric" },
          },
        },
        {
          perf: 0.5,
          audits: {
            "largest-contentful-paint": { score: null, scoreDisplayMode: "error" },
            "first-contentful-paint": { score: 0.99, scoreDisplayMode: "numeric" },
          },
        },
      ],
      [categoryAssertion("performance", { expected: 0.7, actual: 0.6, level: "warn" })],
    );
    expect(lighthouseFailingAuditsFromResult(result)).toBe(
      "performance/largest-contentful-paint:w25:2/2:error,performance/first-contentful-paint:w10:2/2",
    );
    expect(result.summary).toContain("performance/largest-contentful-paint (2/2, errored)");
  });

  it("prints one machine-readable line per failing or warning site", async () => {
    const result = await audit(THREE_FAILING, [BP_FAILED]);
    const passing = await audit([{}], []);
    const warned = await audit(
      [{ perf: 0.6, audits: { "total-blocking-time": { score: 0.4 } } }],
      [categoryAssertion("performance", { expected: 0.7, actual: 0.6123, level: "warn" })],
    );
    expect(warned.status).toBe("warn");
    expect(formatLighthouseFailureLines([result, passing, warned])).toBe(
      [
        "LIGHTHOUSE_FAILURES assertions=best-practices:0.78<0.9 audits=best-practices/third-party-cookies:w5:3/3,best-practices/inspector-issues:w1:2/3 site=Data Dynamiq",
        "LIGHTHOUSE_FAILURES assertions=performance:0.61<0.7 audits=performance/total-blocking-time:w30:1/1 site=Data Dynamiq",
      ].join("\n"),
    );
  });

  it("prints n/a for an assertion whose actual is missing", async () => {
    const result = await audit(
      [{ bp: 0.78, audits: { deprecations: zero() } }],
      [categoryAssertion("best-practices", { actual: undefined })],
    );
    expect(formatLighthouseFailureLines([result])).toMatch(
      /^LIGHTHOUSE_FAILURES assertions=best-practices:n\/a<0\.9 /,
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
      results: [await audit([{}], [])],
    });
    expect(passing.summary.fields).toHaveProperty("Lighthouse failing audits", null);
  });

  it("warns, not passes, when lhci exited non-zero without writing assertion results", async () => {
    const crashed = await audit([{ bp: 0.7 }, { bp: 0.7 }], null, 1);
    expect(crashed.status).toBe("warn");
    expect(crashed.summary).toBe(
      "lighthouse: no assertion results (exit 1) — scores from 2 run(s) were not checked",
    );
    const unasserted = await audit([{ bp: 0.7 }], null, 0);
    expect(unasserted.status).toBe("pass");
    const asserted = await audit([{ bp: 1 }], [], 1);
    expect(asserted.status).toBe("pass");
  });

  it("leaves the stored list alone when lhci wrote no assertion results", async () => {
    const result = await audit([{ bp: 0.7, audits: { deprecations: zero() } }], null);
    expect(lighthouseFailingAuditsFromResult(result)).toBeUndefined();
    const plan = planAuditWrite({
      websites: [makeWebsiteRow({ name: "Data Dynamiq" })],
      slug: "data-dynamiq",
      results: [result],
    });
    expect(plan.summary.fields).toHaveProperty("bpScore", 70);
    expect(plan.summary.fields).not.toHaveProperty("Lighthouse failing audits");
  });

  it("says unnamed rather than nothing when a category failed but no lhr audit explains it", async () => {
    const result = await audit([{ bp: 0.78 }], [BP_FAILED]);
    expect(lighthouseFailingAuditsFromResult(result)).toBe("unnamed");
    expect(formatLighthouseFailureLines([result])).toMatch(/ audits=unnamed site=/);
  });
});
