import { describe, it, expect } from "vitest";
import { writeFleetAuditsToAirtable } from "../../src/audits/write-audits-to-airtable.js";
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
});

// listWebsites reads the seeded Websites table off the fake base.
async function loadWebsites(base: ReturnType<typeof makeFakeBase>) {
  const { listWebsites } = await import("../../src/reports/airtable/websites.js");
  return listWebsites(base as never);
}
