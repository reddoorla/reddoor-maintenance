import { describe, it, vi, expect, beforeEach, afterEach } from "vitest";
import { runRenovateDispatchCommand } from "../../src/cli/commands/renovate-dispatch.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import type { SiteMirror } from "../../src/db/site-mirror.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const ROSTER = [
  makeWebsiteRow({ id: "recA", name: "Alamo", securityAutoFixAttempts: 7 }),
  makeWebsiteRow({ id: "recB", name: "Beta", securityAutoFixAttempts: 3 }),
];

type Write = { siteId: string; fields: Record<string, unknown> };

function orderedBase(log: string[], sent: Write[], fail: boolean): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      log.push(`airtable:${table}:${records[0]!.id}`);
      sent.push({ siteId: records[0]!.id, fields: records[0]!.fields });
      if (fail) {
        throw Object.assign(new Error("Airtable monthly API call quota exhausted"), {
          code: "AIRTABLE_QUOTA_EXHAUSTED",
        });
      }
      return records;
    },
  })) as unknown as AirtableBase;
}

async function run(fail: boolean, tursoFails = false) {
  const log: string[] = [];
  const mirrored: Write[] = [];
  const shadowed: Write[] = [];
  const siteMirror: SiteMirror = {
    created: async () => {},
    hasRow: async () => true,
    health: async (siteId, fields) => {
      log.push(`turso:${siteId}`);
      if (tursoFails) throw new Error("turso down");
      mirrored.push({ siteId, fields });
    },
    site: async () => {},
  };
  const r = await runRenovateDispatchCommand({
    fleet: true,
    base: orderedBase(log, shadowed, fail),
    roster: async () => ROSTER,
    siteMirror,
  });
  return { r, log, mirrored, shadowed };
}

describe("renovate-dispatch writes the auto-fix counter to Turso before the Airtable shadow", () => {
  const originalGh = process.env.GH_TOKEN;

  beforeEach(() => {
    process.env.GH_TOKEN = "tok";
  });

  afterEach(() => {
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  it("mirrors each counter before its Airtable update (both succeed: known-good control)", async () => {
    const { r, log, mirrored, shadowed } = await run(false);
    expect(r.code).toBe(0);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=2 failed=0");
    expect(log).toEqual([
      "turso:recA",
      "airtable:Websites:recA",
      "turso:recB",
      "airtable:Websites:recB",
    ]);
    expect(mirrored).toEqual(shadowed);
  });

  it("still lands every counter in Turso when every Airtable write fails, and still tallies them as failed", async () => {
    const { r, mirrored, shadowed } = await run(true);
    expect(mirrored).toEqual([
      { siteId: "recA", fields: { "Security Auto-Fix Attempts": 0 } },
      { siteId: "recB", fields: { "Security Auto-Fix Attempts": 0 } },
    ]);
    expect(mirrored).toEqual(shadowed);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=2");
    expect(r.code).toBe(0);
  });

  it("a Turso failure is still tallied as failed, and the shadow is not written ahead of Turso", async () => {
    const { r, log } = await run(false, true);
    expect(log).toEqual(["turso:recA", "turso:recB"]);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=2");
    expect(r.code).toBe(0);
  });
});
