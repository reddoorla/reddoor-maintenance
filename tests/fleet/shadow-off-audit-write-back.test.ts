import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { writeBackOneSite } from "../../src/audits/write-audits-to-airtable.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";
import type { AuditResult } from "../../src/types.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { untouchableBase, untouchableFetch } from "./_helpers/untouchable-airtable.js";

const ROSTER = [
  makeWebsiteRow({ id: "recA", name: "Acme Co" }),
  makeWebsiteRow({ id: "recB", name: "Beta Corp" }),
];

const SCORES = { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 };

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

let touched: string[] = [];
let logged: () => string;

beforeEach(() => {
  touched = [];
  vi.stubGlobal("fetch", untouchableFetch(touched));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function sweep(results: AuditResult[]) {
  const mirrored: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
  const events: FleetEvent[] = [];
  const res = await runFleetWriteBack({
    results,
    which: ["lighthouse", "a11y"],
    deps: {
      openBase: () => untouchableBase(touched),
      roster: async () => ROSTER,
      makeMirror: async () => async (siteId, fields) => {
        mirrored.push({ siteId, fields });
        return true;
      },
      recordEvents: async (ev) => {
        events.push(...ev);
      },
    },
  });
  return { res, mirrored, events };
}

describe("shipped shadow-off: the nightly fleet audit write-back never touches Airtable", () => {
  it("lands every rec site in Turso and reports a clean, green sweep", async () => {
    const { res, mirrored, events } = await sweep([
      lighthouse("acme-co", SCORES),
      a11y("acme-co"),
      lighthouse("beta-corp", SCORES),
    ]);
    expect(touched).toEqual([]);
    expect(mirrored.map((m) => m.siteId)).toEqual(["recA", "recB"]);
    expect(mirrored[0]!.fields).toMatchObject({
      pScore: 90,
      "A11y Violations": 2,
      "Last lighthouse audit at": expect.any(String),
    });
    expect(mirrored[1]!.fields).toMatchObject({ pScore: 90 });
    expect(res.summary).toContain(
      "FLEET_WRITE_SUMMARY wrote=2 failed=0 total=2 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
    expect(res.anyFailed).toBe(false);
    expect(events.find((e) => e.type === "fleet_swept")?.data).toEqual({
      sweep: "lighthouse",
      count: 2,
    });
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateAuditFieldSet id=recA",
    );
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateAuditFieldSet id=recB",
    );
  });

  it("a Lighthouse-miss site is still mirrored and still filed failed, with no Airtable contact", async () => {
    const { res, mirrored } = await sweep([
      lighthouse("acme-co", SCORES),
      lighthouse("beta-corp", {}),
      a11y("beta-corp"),
    ]);
    expect(touched).toEqual([]);
    expect(mirrored).toEqual([
      { siteId: "recA", fields: expect.objectContaining({ pScore: 90 }) },
      { siteId: "recB", fields: expect.objectContaining({ "A11y Violations": 2 }) },
    ]);
    expect(res.summary).toContain(
      "FLEET_WRITE_SUMMARY wrote=1 failed=1 total=2 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
    expect(res.summary).toMatch(/beta-corp \(Lighthouse audit produced no scores/);
    expect(res.anyFailed).toBe(true);
  });
});

describe("the single-site write-back, with the shipped switch", () => {
  it("lands the site's fields in Turso and never touches Airtable", async () => {
    const mirrored: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const summary = await writeBackOneSite({
      base: untouchableBase(touched),
      websites: ROSTER,
      slug: "acme-co",
      results: [lighthouse("acme-co", SCORES)],
      mirrorHealth: async (siteId, fields) => {
        mirrored.push({ siteId, fields });
      },
    });
    expect(touched).toEqual([]);
    expect(mirrored).toEqual([{ siteId: "recA", fields: summary.fields }]);
    expect(mirrored[0]!.fields).toMatchObject({ pScore: 90 });
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateAuditFieldSet id=recA",
    );
  });
});
