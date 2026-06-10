import { describe, it, expect } from "vitest";
import {
  writeFleetAuditsToAirtable,
  formatFleetWriteSummary,
  type FleetWriteResult,
} from "../../src/audits/write-audits-to-airtable.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { AuditResult } from "../../src/types.js";

function lhResult(siteSlug: string, scores: Record<string, number>): AuditResult {
  return {
    audit: "lighthouse",
    site: siteSlug,
    status: "pass",
    summary: "",
    details: { summary: scores },
  };
}

const websites = [
  { id: "recA", fields: { Name: "Acme Co", Status: "maintenance" } },
  { id: "recB", fields: { Name: "Beta Corp", Status: "maintenance" } },
];

describe("writeFleetAuditsToAirtable", () => {
  it("writes each site's lighthouse scores to its own row, grouped by result.site slug", async () => {
    const base = makeFakeBase({ Websites: websites });
    const results = [
      lhResult("acme-co", {
        performance: 0.9,
        accessibility: 1,
        "best-practices": 0.78,
        seo: 0.92,
      }),
      lhResult("beta-corp", { performance: 0.5, accessibility: 0.9, "best-practices": 1, seo: 1 }),
    ];
    const out = await writeFleetAuditsToAirtable({
      base,
      websites: await loadWebsites(base),
      results,
    });
    expect(out.failed).toEqual([]);
    expect(out.written.map((w) => w.siteName).sort()).toEqual(["Acme Co", "Beta Corp"]);
    // Two update calls, one per row.
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates.map((u) => u.records[0]!.id).sort()).toEqual(["recA", "recB"]);
  });

  it("collects a per-site failure (no matching row) without aborting the batch", async () => {
    const base = makeFakeBase({ Websites: websites });
    const results = [
      lhResult("acme-co", { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
      lhResult("ghost-site", { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
    ];
    const out = await writeFleetAuditsToAirtable({
      base,
      websites: await loadWebsites(base),
      results,
    });
    expect(out.written.map((w) => w.siteName)).toEqual(["Acme Co"]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]!.slug).toBe("ghost-site");
    expect(out.failed[0]!.error).toMatch(/No Websites row matched/);
  });

  it("files a no-real-scores site under failed but STILL writes its a11y/deps/security (MEDIUM-E)", async () => {
    const base = makeFakeBase({ Websites: websites });
    const results: AuditResult[] = [
      lhResult("acme-co", { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
      lhResult("beta-corp", {}), // lighthouse ran but produced no real scores
      // beta-corp's OTHER audits are valid — a lighthouse miss must not discard
      // them. This case failed on the pre-fix early-gate code (threw before any
      // write); it guards against that regression at the fleet level.
      {
        audit: "a11y",
        site: "beta-corp",
        status: "warn",
        summary: "",
        details: { totalViolations: 2, byImpact: {} },
      } as unknown as AuditResult,
      {
        audit: "deps",
        site: "beta-corp",
        status: "pass",
        summary: "",
        details: {
          entries: [{ pkg: "x", baseline: "1.0.0", actual: "1.0.0", drift: "minor" }],
          outdated: null,
        },
      } as unknown as AuditResult,
      {
        audit: "security",
        site: "beta-corp",
        status: "fail",
        summary: "",
        details: { counts: { low: 0, moderate: 0, high: 1, critical: 0 }, advisories: [] },
      } as unknown as AuditResult,
    ];
    const out = await writeFleetAuditsToAirtable({
      base,
      websites: await loadWebsites(base),
      results,
    });
    expect(out.written.map((w) => w.siteName)).toEqual(["Acme Co"]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]!.slug).toBe("beta-corp");
    expect(out.failed[0]!.error).toMatch(/produced no scores/i);
    // beta-corp's non-LH audits WERE written to its row (recB) despite the miss.
    const betaFields: Record<string, unknown> = {};
    for (const c of base.__calls) {
      if (c.kind === "update" && c.records[0]?.id === "recB") {
        Object.assign(betaFields, c.records[0].fields);
      }
    }
    expect(betaFields).toMatchObject({
      "A11y Violations": 2,
      "Deps Drifted": 1,
      "Security Vulns High": 1,
    });
    expect("pScore" in betaFields).toBe(false); // no lighthouse scores (the miss)
  });
});

// loadWebsites: reads the seeded Websites table off the fake base via listWebsites.
async function loadWebsites(base: ReturnType<typeof makeFakeBase>) {
  const { listWebsites } = await import("../../src/reports/airtable/websites.js");
  return listWebsites(base as never);
}

function fleetResult(wrote: number, failed: FleetWriteResult["failed"]): FleetWriteResult {
  return {
    written: Array.from({ length: wrote }, (_, i) => ({ siteName: `site-${i}`, writes: [] })),
    failed,
  };
}

describe("formatFleetWriteSummary", () => {
  it("emits a machine-readable summary line with wrote/failed/total counts when all sites write", () => {
    const out = formatFleetWriteSummary(fleetResult(2, []));
    expect(out).toContain("→ wrote 2 site(s) to Airtable");
    // The CI gate keys off this exact line, not the human-readable prose above.
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=2 failed=0 total=2");
    expect(out).not.toContain("not written");
  });

  it("lists the not-written sites and counts them in the summary line on a partial write", () => {
    const out = formatFleetWriteSummary(
      fleetResult(9, [{ slug: "erp-industrials", error: "no scores" }]),
    );
    expect(out).toContain("→ wrote 9 site(s) to Airtable");
    expect(out).toContain("⚠ 1 site(s) not written: erp-industrials (no scores)");
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=9 failed=1 total=10");
  });

  it("reports wrote=0 in the summary line when the whole batch fails", () => {
    const out = formatFleetWriteSummary(
      fleetResult(0, [
        { slug: "a", error: "x" },
        { slug: "b", error: "y" },
        { slug: "c", error: "z" },
      ]),
    );
    expect(out).toContain("→ wrote 0 site(s) to Airtable");
    expect(out).toContain("FLEET_WRITE_SUMMARY wrote=0 failed=3 total=3");
  });

  it("emits the real summary as the LAST match even when an error string embeds a decoy (the tail -n1 invariant the CI gate depends on)", () => {
    // The workflow gate does `grep -oE 'FLEET_WRITE_SUMMARY ...' | tail -n1`. That
    // is only safe because the real line is emitted AFTER the failed-sites block,
    // so a hostile error string containing the pattern can't win. Pin it by
    // replicating the grep+tail: global-match, take the last.
    const out = formatFleetWriteSummary(
      fleetResult(1, [{ slug: "x", error: "FLEET_WRITE_SUMMARY wrote=9 failed=0 total=9" }]),
    );
    const matches = out.match(/FLEET_WRITE_SUMMARY wrote=\d+ failed=\d+ total=\d+/g)!;
    expect(matches.at(-1)).toBe("FLEET_WRITE_SUMMARY wrote=1 failed=1 total=2");
  });
});
