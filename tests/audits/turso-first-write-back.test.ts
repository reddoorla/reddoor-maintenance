import { describe, it, expect, vi, afterEach } from "vitest";
import {
  writeFleetAuditsToAirtable,
  writeAuditsToAirtable,
  planAuditWrite,
  writeBackOneSite,
} from "../../src/audits/write-audits-to-airtable.js";
import { listWebsites } from "../../src/reports/airtable/websites.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { AuditResult } from "../../src/types.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

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
  return listWebsites(makeFakeBase({ Websites: ROWS }) as never);
}

function orderedBase(log: string[], fail: boolean): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string }>) => {
      log.push(`airtable:${table}:${records[0]!.id}`);
      if (fail) {
        throw Object.assign(new Error("Airtable monthly API call quota exhausted"), {
          code: "AIRTABLE_QUOTA_EXHAUSTED",
        });
      }
      return records;
    },
  })) as unknown as AirtableBase;
}

function recordingMirror(log: string[]) {
  const seen: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
  const mirror = async (siteId: string, fields: Record<string, unknown>) => {
    log.push(`turso:${siteId}`);
    seen.push({ siteId, fields });
    return true;
  };
  return { mirror, seen };
}

describe("fleet audit write-back writes Turso before the Airtable shadow", () => {
  it("mirrors each site before its Airtable update (both succeed: known-good control)", async () => {
    const log: string[] = [];
    const { mirror } = recordingMirror(log);
    const out = await writeFleetAuditsToAirtable({
      base: orderedBase(log, false),
      websites: await roster(),
      results: [lighthouse("acme-co", SCORES), lighthouse("beta-corp", SCORES)],
      mirror,
    });
    expect(out.failed).toEqual([]);
    expect(out.mirrored).toBe(2);
    expect(log).toEqual([
      "turso:recA",
      "airtable:Websites:recA",
      "turso:recB",
      "airtable:Websites:recB",
    ]);
  });

  it("still lands every site in Turso when every Airtable write fails", async () => {
    const log: string[] = [];
    const { mirror, seen } = recordingMirror(log);
    const out = await writeFleetAuditsToAirtable({
      base: orderedBase(log, true),
      websites: await roster(),
      results: [lighthouse("acme-co", SCORES), lighthouse("beta-corp", SCORES)],
      mirror,
    });
    expect(out.mirrored).toBe(2);
    expect(seen.map((s) => s.siteId)).toEqual(["recA", "recB"]);
    expect(seen[0]!.fields).toMatchObject({ pScore: 90 });
    expect(out.written).toEqual([]);
    expect(out.failed.map((f) => f.slug)).toEqual(["acme-co", "beta-corp"]);
    expect(out.failed[0]!.error).toMatch(/quota exhausted/);
  });

  it("mirrors a Lighthouse-miss site's other audits, then files it as failed", async () => {
    const log: string[] = [];
    const { mirror, seen } = recordingMirror(log);
    const out = await writeFleetAuditsToAirtable({
      base: orderedBase(log, false),
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

describe("the shadow carries the Turso payload byte for byte", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("even when the clock moves between the two writes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
    const base = makeFakeBase({ Websites: ROWS });
    const mirrored: Array<Record<string, unknown>> = [];
    await writeFleetAuditsToAirtable({
      base,
      websites: await roster(),
      results: [lighthouse("acme-co", SCORES)],
      mirror: async (_siteId, fields) => {
        mirrored.push(fields);
        vi.setSystemTime(new Date("2026-09-28T12:00:05.000Z"));
        return true;
      },
    });
    const update = base.__calls.find((c) => c.kind === "update");
    expect(update && update.kind === "update" ? update.records[0]!.fields : null).toEqual(
      mirrored[0],
    );
    expect(mirrored[0]).toMatchObject({ "Last lighthouse audit at": "2026-09-28T12:00:00.000Z" });
  });
});

describe("planAuditWrite", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the same FieldSet the shadow writes, without touching Airtable", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
    const websites = await roster();
    const plan = planAuditWrite({
      websites,
      slug: "acme-co",
      results: [lighthouse("acme-co", SCORES)],
    });
    expect(plan.lighthouseMiss).toBeNull();
    const base = makeFakeBase({ Websites: ROWS });
    const summary = await writeAuditsToAirtable({
      base,
      websites,
      slug: "acme-co",
      results: [lighthouse("acme-co", SCORES)],
    });
    expect(summary.fields).toEqual(plan.summary.fields);
    const update = base.__calls.find((c) => c.kind === "update");
    expect(update && update.kind === "update" ? update.records[0]!.fields : null).toEqual(
      plan.summary.fields,
    );
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

describe("the single-site write-back writes Turso before the Airtable shadow", () => {
  async function run(fail: boolean) {
    const log: string[] = [];
    const seen: Array<Record<string, unknown>> = [];
    const outcome = await writeBackOneSite({
      base: orderedBase(log, fail),
      websites: await roster(),
      slug: "acme-co",
      results: [lighthouse("acme-co", SCORES)],
      mirrorHealth: async (siteId, fields) => {
        log.push(`turso:${siteId}`);
        seen.push(fields);
      },
    }).then(
      (summary) => ({ summary, error: null as Error | null }),
      (error: Error) => ({ summary: null, error }),
    );
    return { log, seen, ...outcome };
  }

  it("orders Turso first (known-good control)", async () => {
    const { log, summary } = await run(false);
    expect(log).toEqual(["turso:recA", "airtable:Websites:recA"]);
    expect(summary?.siteName).toBe("Acme Co");
  });

  it("keeps the Turso write when the shadow throws, and still throws", async () => {
    const { log, seen, error } = await run(true);
    expect(log).toEqual(["turso:recA", "airtable:Websites:recA"]);
    expect(seen[0]).toMatchObject({ pScore: 90 });
    expect(error?.message).toMatch(/quota exhausted/);
  });
});
