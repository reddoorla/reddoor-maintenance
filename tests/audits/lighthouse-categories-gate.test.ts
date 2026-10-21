import { describe, it, expect, onTestFinished } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  writeFleetAudits,
  formatFleetWriteSummary,
  fleetWriteGate,
} from "../../src/audits/write-audits.js";
import {
  missingLighthouseCategories,
  LIGHTHOUSE_CATEGORIES,
} from "../../src/audits/lighthouse-fields.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import type { AuditResult } from "../../src/types.js";
import { stepRunScript, workflowPath } from "../build/_helpers/workflow-source.js";

/**
 * #1609: `hasRealScores` passes on any one numeric category, which is right for the
 * write (NO_LCP nulls performance, and the three scores that did arrive still land,
 * clearing the stored performance cell to "—"). It left a fleet-wide missing
 * performance score green: `wrote=10 failed=0`. Each category missing from scores
 * that otherwise landed now counts in the write gate as `lighthouse.<category>`.
 */

const full = { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 0.95 };
const noLcp = { accessibility: 1, "best-practices": 1, seo: 0.95 };

const lh = (site: string, summary: Record<string, number>): AuditResult => ({
  audit: "lighthouse",
  site,
  status: "pass",
  summary: "",
  details: { summary },
});

async function sweep(
  n: number,
  summaryFor: (i: number) => Record<string, number>,
  opts: { extra?: (site: string) => AuditResult[]; mirrorOk?: (i: number) => boolean } = {},
) {
  const slugs = Array.from({ length: n }, (_, i) => `site-${i}`);
  const fields: Array<Record<string, unknown>> = [];
  const result = await writeFleetAudits({
    websites: websiteRowsFrom(
      slugs.map((s, i) => ({ id: `rec${i}`, fields: { Name: s, Status: "maintenance" } })),
    ),
    results: slugs.flatMap((s, i) => [lh(s, summaryFor(i)), ...(opts.extra?.(s) ?? [])]),
    mirror: async (id, f) => {
      fields.push(f);
      return opts.mirrorOk?.(Number(id.slice(3))) ?? true;
    },
    expectedSites: slugs,
  });
  return { result, fields, out: formatFleetWriteSummary(result) };
}

describe("missingLighthouseCategories", () => {
  it.each(LIGHTHOUSE_CATEGORIES)("names %s when it alone is missing", (k) => {
    const summary: Record<string, number> = { ...full };
    delete summary[k];
    expect(missingLighthouseCategories(lh("a", summary))).toEqual([k]);
  });

  it("checks all four categories", () => {
    expect([...LIGHTHOUSE_CATEGORIES]).toEqual([
      "performance",
      "accessibility",
      "best-practices",
      "seo",
    ]);
  });

  it("names every missing category, and a real score of 0 is a score", () => {
    expect(missingLighthouseCategories(lh("a", { performance: 0.9, accessibility: 1 }))).toEqual([
      "best-practices",
      "seo",
    ]);
    expect(missingLighthouseCategories(lh("a", { ...full, performance: 0 }))).toEqual([]);
  });

  it("names absent or NaN categories of scores that landed, and nothing for an unscored result", () => {
    expect(missingLighthouseCategories(lh("a", noLcp))).toEqual(["performance"]);
    expect(missingLighthouseCategories(lh("a", full))).toEqual([]);
    expect(missingLighthouseCategories(lh("a", {}))).toEqual([]);
    // Defensive: lhr JSON cannot hold NaN and readLhrEntries keeps only numbers, but a
    // NaN reaching here must not read as a score.
    expect(missingLighthouseCategories(lh("a", { ...full, seo: Number.NaN }))).toEqual(["seo"]);
  });
});

describe("#1609: a fleet-wide missing performance score is red", () => {
  it("known-good: every category on every site is green with no warning", async () => {
    const { result } = await sweep(10, () => full);
    expect(fleetWriteGate(result)).toEqual({ red: false, reasons: [], warnings: [] });
  });

  it("performance null on all 10 sites: every site still written, the gate red", async () => {
    const { result, fields, out } = await sweep(10, () => noLcp);
    expect(result.written).toHaveLength(10);
    // The three scores that arrived still land; performance is cleared, not zeroed.
    expect(fields[0]).toMatchObject({ pScore: null, rScore: 100, bpScore: 100, seoScore: 95 });
    expect(fleetWriteGate(result).reasons).toContain(
      `lighthouse.performance missing on 10 of 10 site(s): ${result.written
        .map((w) => w.siteName)
        .join(", ")} (>25%)`,
    );
    expect(out).toContain("\nFLEET_WRITE_GATE verdict=red");
  });

  it("control: one NO_LCP site of ten warns and stays green", async () => {
    const { result } = await sweep(10, (i) => (i === 3 ? noLcp : full));
    const gate = fleetWriteGate(result);
    expect(gate.red).toBe(false);
    expect(gate.warnings).toEqual(["lighthouse.performance missing on 1 of 10 site(s): site-3"]);
  });

  it("an unscored site is a lighthouse miss, not a missing category", async () => {
    const { result } = await sweep(10, (i) => (i === 0 ? {} : full));
    expect(result.failed.map((f) => f.slug)).toEqual(["site-0"]);
    expect(
      Object.keys(result.unmeasuredAudits ?? {}).filter((k) => k.startsWith("lighthouse")),
    ).toEqual([]);
    expect(result.applicableAudits?.["lighthouse.performance"]).toHaveLength(9);
  });

  it("every category is judged against the sites lighthouse scored: seo missing on 2 of 7", async () => {
    // 3 unscored sites (lighthouse misses) and seo absent on 2 of the 7 that scored.
    const { result } = await sweep(10, (i) =>
      i < 3 ? {} : i < 5 ? { performance: 0.9, accessibility: 1, "best-practices": 1 } : full,
    );
    expect(result.applicableAudits?.["lighthouse.seo"]).toHaveLength(7);
    expect(fleetWriteGate(result).reasons).toContain(
      "lighthouse.seo missing on 2 of 7 site(s): site-3, site-4 (>25%)",
    );
  });

  it("two categories missing fleet-wide give two reasons", async () => {
    const { result } = await sweep(4, () => ({ performance: 0.9, accessibility: 1 }));
    const reasons = fleetWriteGate(result).reasons;
    expect(reasons.some((r) => r.startsWith("lighthouse.best-practices missing on 4 of 4"))).toBe(
      true,
    );
    expect(reasons.some((r) => r.startsWith("lighthouse.seo missing on 4 of 4"))).toBe(true);
  });

  it("a missing category still counts when another audit on the site measured nothing", async () => {
    const { result } = await sweep(4, () => noLcp, {
      extra: (site) => [{ audit: "browser", site, status: "fail", summary: "browser: boom" }],
    });
    const reasons = fleetWriteGate(result).reasons;
    expect(reasons.some((r) => r.startsWith("lighthouse.performance missing on 4 of 4"))).toBe(
      true,
    );
    expect(reasons.some((r) => r.startsWith("browser measured nothing on 4 of 4"))).toBe(true);
  });

  it("a missing category is counted whether or not the site's write landed", async () => {
    // 4 of 10 NO_LCP; 2 of those 4 have no site_health row. Measured is measured.
    const { result } = await sweep(10, (i) => (i < 4 ? noLcp : full), {
      mirrorOk: (i) => i !== 0 && i !== 1,
    });
    expect(result.unmeasuredAudits?.["lighthouse.performance"]).toEqual([
      "site-0",
      "site-1",
      "site-2",
      "site-3",
    ]);
    expect(fleetWriteGate(result).reasons).toContain(
      "lighthouse.performance missing on 4 of 10 site(s): site-0, site-1, site-2, site-3 (>25%)",
    );
  });
});

describe("#1609 through fleet-lighthouse.yml's own step", () => {
  it("reds the nightly on performance null fleet-wide, with the reason annotated", async () => {
    const { out } = await sweep(10, () => noLcp);
    const step = stepRunScript(
      await readFile(workflowPath("fleet-lighthouse.yml"), "utf-8"),
      "Fleet Lighthouse + domain + browser audit + write-back",
    );
    const dir = await mkdtemp(join(tmpdir(), "lh-1609-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    await mkdir(join(dir, "bin"));
    await writeFile(join(dir, "canned.txt"), `${out}\n`, "utf-8");
    await writeFile(
      join(dir, "bin", "node"),
      `#!/bin/sh\ncat "${join(dir, "canned.txt")}"\nexit 1\n`,
    );
    await chmod(join(dir, "bin", "node"), 0o755);
    const r = await promisify(execFile)("bash", ["-e", "-c", step], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
      },
    }).then(
      (o) => ({ code: 0, out: o.stdout + o.stderr }),
      (e: { code?: number; stdout?: string; stderr?: string }) => ({
        code: e.code ?? 1,
        out: (e.stdout ?? "") + (e.stderr ?? ""),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "::error::fleet Lighthouse: lighthouse.performance missing on 10 of 10",
    );
  });
});
