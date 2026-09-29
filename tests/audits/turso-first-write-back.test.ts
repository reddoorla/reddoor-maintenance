import { describe, it, expect, vi, afterEach } from "vitest";
import {
  writeFleetAudits,
  planAuditWrite,
  writeBackOneSite,
} from "../../src/audits/write-audits.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import type { AuditResult } from "../../src/types.js";

const ROWS = [
  { id: "recA", fields: { Name: "Acme Co", Status: "maintained" } },
  { id: "recB", fields: { Name: "Beta Corp", Status: "maintained" } },
];

const lighthouse = (site: string, summary: Record<string, number>): AuditResult => ({
  audit: "lighthouse",
  site,
  status: "pass",
  summary: "",
  details: { summary },
});

const a11y = (site: string): AuditResult =>
  ({
    audit: "a11y",
    site,
    status: "warn",
    summary: "",
    details: { totalViolations: 2, byImpact: {} },
  }) as unknown as AuditResult;

const SCORES = { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 };

async function roster() {
  return websiteRowsFrom(ROWS);
}

function recordingMirror() {
  const seen: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
  const mirror = async (siteId: string, fields: Record<string, unknown>) => {
    seen.push({ siteId, fields });
    return true;
  };
  return { mirror, seen };
}

describe("fleet audit write-back writes Turso", () => {
  it("mirrors each site in roster order (known-good control)", async () => {
    const { mirror, seen } = recordingMirror();
    const out = await writeFleetAudits({
      websites: await roster(),
      results: [lighthouse("acme-co", SCORES), lighthouse("beta-corp", SCORES)],
      mirror,
    });
    expect(out.failed).toEqual([]);
    expect(out.mirrored).toBe(2);
    expect(seen.map((s) => s.siteId)).toEqual(["recA", "recB"]);
    expect(seen[0]!.fields).toMatchObject({ pScore: 90 });
    expect(out.written.map((w) => w.siteName)).toEqual(["Acme Co", "Beta Corp"]);
  });

  it("mirrors a Lighthouse-miss site's other audits, then files it as failed", async () => {
    const { mirror, seen } = recordingMirror();
    const out = await writeFleetAudits({
      websites: await roster(),
      results: [lighthouse("beta-corp", {}), a11y("beta-corp")],
      mirror,
    });
    expect(seen).toEqual([
      { siteId: "recB", fields: expect.objectContaining({ "A11y Violations": 2 }) },
    ]);
    expect(out.mirrored).toBe(1);
    expect(out.failed.map((f) => f.slug)).toEqual(["beta-corp"]);
    expect(out.failed[0]!.error).toMatch(/produced no scores/i);
  });
});

describe("planAuditWrite", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the FieldSet the single-site write-back mirrors", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
    const websites = await roster();
    const plan = planAuditWrite({
      websites,
      slug: "acme-co",
      results: [lighthouse("acme-co", SCORES)],
    });
    expect(plan.lighthouseMiss).toBeNull();
    const mirrored: Array<Record<string, unknown>> = [];
    const summary = await writeBackOneSite({
      websites,
      slug: "acme-co",
      results: [lighthouse("acme-co", SCORES)],
      mirrorHealth: async (_siteId, fields) => {
        mirrored.push(fields);
      },
    });
    expect(summary.fields).toEqual(plan.summary.fields);
    expect(mirrored).toEqual([plan.summary.fields]);
    expect(mirrored[0]).toMatchObject({ "Last lighthouse audit at": "2026-09-28T12:00:00.000Z" });
  });

  it("carries a Lighthouse miss instead of throwing it", async () => {
    const plan = planAuditWrite({
      websites: await roster(),
      slug: "beta-corp",
      results: [lighthouse("beta-corp", {}), a11y("beta-corp")],
    });
    expect(plan.lighthouseMiss?.message).toMatch(/produced no scores/i);
    expect(plan.summary.fields).toMatchObject({ "A11y Violations": 2 });
  });
});

describe("the single-site write-back writes Turso", () => {
  async function run(results: AuditResult[], slug: string) {
    const seen: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const outcome = await writeBackOneSite({
      websites: await roster(),
      slug,
      results,
      mirrorHealth: async (siteId, fields) => {
        seen.push({ siteId, fields });
      },
    }).then(
      (summary) => ({ summary, error: null as Error | null }),
      (error: Error) => ({ summary: null, error }),
    );
    return { seen, ...outcome };
  }

  it("mirrors the site's scores and returns its summary (known-good control)", async () => {
    const { seen, summary, error } = await run([lighthouse("acme-co", SCORES)], "acme-co");
    expect(error).toBeNull();
    expect(seen).toEqual([{ siteId: "recA", fields: expect.objectContaining({ pScore: 90 }) }]);
    expect(summary?.siteName).toBe("Acme Co");
  });

  it("mirrors a Lighthouse miss's other audits, then still throws", async () => {
    const { seen, error } = await run(
      [lighthouse("beta-corp", {}), a11y("beta-corp")],
      "beta-corp",
    );
    expect(seen).toEqual([
      { siteId: "recB", fields: expect.objectContaining({ "A11y Violations": 2 }) },
    ]);
    expect(seen[0]!.fields).not.toHaveProperty("pScore");
    expect(error?.message).toMatch(/produced no scores/i);
  });
});
