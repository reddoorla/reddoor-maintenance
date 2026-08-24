/** The next-due diff-guard + site_schedule mirror (#539 Phase 3).
 *
 *  Before the guard, every one of the 44 sites got a nightly Airtable write —
 *  ~31 of them re-writing null over null forever. The guard writes only when
 *  the computed dates differ from what the row already holds (read back via
 *  WebsiteRow.nextMaintenanceAt/nextTestingAt), which also scopes writes to
 *  maintained sites by construction. Real writes dual-write through the
 *  schedule mirror with the exact FieldSet Airtable got.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { writeNextDueDates } from "../../src/cli/commands/report.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const TODAY = new Date("2026-08-24T09:23:00.000Z");
const TODAY_YMD = "2026-08-24";

afterEach(() => vi.restoreAllMocks());

function quietLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

describe("writeNextDueDates diff-guard", () => {
  it("skips a site whose computed dates equal the stored ones (incl. the null/null never-maintained case)", async () => {
    const log = quietLog();
    const base = makeFakeBase({ Websites: [] });
    const sites = [
      // Never maintained: computes null/null, row holds null/null → skip.
      makeWebsiteRow({ id: "recNONE", name: "Bare", maintenanceFreq: "None", testingFreq: "None" }),
      // Maintained but already current: Monthly with no base date computes
      // "due today"; the row already says today → skip.
      makeWebsiteRow({
        id: "recCUR",
        name: "Current",
        maintenanceFreq: "Monthly",
        nextMaintenanceAt: TODAY_YMD,
      }),
    ];
    // A skipped site must never reach the mirror either — record every call.
    const mirrorCalls: unknown[] = [];
    await writeNextDueDates(base, sites, [], TODAY, async (...args) => {
      mirrorCalls.push(args);
      return true;
    });
    expect(base.__calls.filter((c) => c.kind === "update")).toHaveLength(0);
    expect(mirrorCalls).toHaveLength(0);
    // The FULL line — a `toContain` on a prefix would tolerate a mirrored= drift.
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=0 skipped=2 failed=0 mirrored=0 mirror_failed=0 mirror_missed=0",
    );
  });

  it("writes (both fields, one update) when a date moved — and only for that site", async () => {
    const log = quietLog();
    const base = makeFakeBase({ Websites: [] });
    const sites = [
      makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" }),
      makeWebsiteRow({ id: "recNONE", name: "Bare" }),
    ];
    await writeNextDueDates(base, sites, [], TODAY);
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.id).toBe("recSTALE");
    expect(updates[0]!.records[0]!.fields).toEqual({
      "Next maintenance at": TODAY_YMD,
      "Next testing at": null,
    });
    expect(log.mock.calls.flat().join("\n")).toContain("NEXT_DUE_WRITE wrote=1 skipped=1 failed=0");
  });

  it("a testing-only change writes too — BOTH dates are load-bearing in the guard", async () => {
    quietLog();
    const base = makeFakeBase({ Websites: [] });
    // Maintenance side equal (null = null); testing computes today vs stored null.
    const sites = [makeWebsiteRow({ id: "recTEST", name: "TestOnly", testingFreq: "Monthly" })];
    await writeNextDueDates(base, sites, [], TODAY);
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.fields).toEqual({
      "Next maintenance at": null,
      "Next testing at": TODAY_YMD,
    });
  });

  it("a date CLEAR (schedule removed) is a change, not a skip", async () => {
    quietLog();
    const base = makeFakeBase({ Websites: [] });
    const sites = [
      makeWebsiteRow({ id: "recGONE", name: "Gone", nextMaintenanceAt: "2026-09-01" }),
    ];
    await writeNextDueDates(base, sites, [], TODAY);
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.fields).toEqual({
      "Next maintenance at": null,
      "Next testing at": null,
    });
  });

  it("both stored dates non-null, exactly ONE moved (same month) → writes", async () => {
    // The comparison-matrix cell the original suite lacked. Stored 2026-09-01 /
    // 2026-11-01; computed maintenance EQUAL (Monthly from the 2026-08-01 anchor
    // → 2026-09-01) and computed testing DIFFERENT but within the stored month
    // (Quarterly from the 2026-08-15 anchor → 2026-11-15). Kills two verified
    // surviving mutants: a `??`-collapsed guard (the equal maintenance side masks
    // the testing diff) and a month-truncating `?.slice(0, 7)` compare (2026-11
    // === 2026-11 would skip).
    const log = quietLog();
    const base = makeFakeBase({ Websites: [] });
    const sites = [
      makeWebsiteRow({
        id: "recONE",
        name: "OneMoved",
        maintenanceFreq: "Monthly",
        maintenanceDay: "2026-08-01",
        testingFreq: "Quarterly",
        testingDay: "2026-08-15",
        nextMaintenanceAt: "2026-09-01",
        nextTestingAt: "2026-11-01",
      }),
    ];
    await writeNextDueDates(base, sites, [], TODAY);
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.fields).toEqual({
      "Next maintenance at": "2026-09-01",
      "Next testing at": "2026-11-15",
    });
    expect(log.mock.calls.flat().join("\n")).toContain("NEXT_DUE_WRITE wrote=1 skipped=0 failed=0");
  });
});

describe("per-site blast radius", () => {
  it("one site's Airtable failure costs ONLY that site — the next site still writes (failed=1)", async () => {
    const log = quietLog();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // makeFakeBase's update can never throw, so wrap it: recBOOM's write 422s
    // (the 08-17 incident shape — one quota/validation failure mid-fleet) while
    // recOK's passes through to the fake and lands in __calls as usual.
    const fake = makeFakeBase({ Websites: [] });
    type Updatable = {
      update: (recs: Array<{ id: string; fields: Record<string, unknown> }>) => Promise<unknown>;
    };
    const base = ((table: string) => {
      const t = (fake as unknown as (table: string) => Updatable)(table);
      return {
        ...t,
        update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
          if (recs.some((r) => r.id === "recBOOM")) {
            throw new Error("422 INVALID_VALUE_FOR_COLUMN");
          }
          return t.update(recs);
        },
      };
    }) as unknown as typeof fake;
    const sites = [
      makeWebsiteRow({ id: "recBOOM", name: "Boom", maintenanceFreq: "Monthly" }),
      makeWebsiteRow({ id: "recOK", name: "Okay", maintenanceFreq: "Monthly" }),
    ];
    await writeNextDueDates(base, sites, [], TODAY);
    // Site 2's write landed: the failure's blast radius was one site, not the run.
    const updates = fake.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.id).toBe("recOK");
    expect(warn.mock.calls.flat().join("\n")).toContain("next-due write skipped for Boom");
    // failed=1 keeps the outage visible — wrote+skipped alone would undercount.
    expect(log.mock.calls.flat().join("\n")).toContain("NEXT_DUE_WRITE wrote=1 skipped=0 failed=1");
  });
});

describe("the site_schedule mirror", () => {
  it("receives the EXACT FieldSet Airtable got, stamped with today", async () => {
    const log = quietLog();
    const base = makeFakeBase({ Websites: [] });
    const calls: Array<{ siteId: string; fields: Record<string, unknown>; computedAt: string }> =
      [];
    await writeNextDueDates(
      base,
      [makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
      async (siteId, fields, computedAt) => {
        calls.push({ siteId, fields, computedAt });
        return true;
      },
    );
    const update = base.__calls.find((c) => c.kind === "update")!;
    expect(calls).toEqual([
      {
        siteId: "recSTALE",
        fields: update.records[0]!.fields,
        computedAt: TODAY.toISOString(),
      },
    ]);
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=1 skipped=0 failed=0 mirrored=1 mirror_failed=0 mirror_missed=0",
    );
  });

  it("a mirror failure is counted and warned, never thrown — the Airtable write stands", async () => {
    const log = quietLog();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = makeFakeBase({ Websites: [] });
    await writeNextDueDates(
      base,
      [makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
      async () => {
        throw new Error("turso down");
      },
    );
    expect(base.__calls.filter((c) => c.kind === "update")).toHaveLength(1);
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=1 skipped=0 failed=0 mirrored=0 mirror_failed=1 mirror_missed=0",
    );
    expect(warn.mock.calls.flat().join("\n")).toContain("[schedule-mirror] Stale: turso down");
  });

  it("a 0-row mirror UPDATE counts as missed, never as mirrored (site not yet imported)", async () => {
    const log = quietLog();
    const base = makeFakeBase({ Websites: [] });
    await writeNextDueDates(
      base,
      [makeWebsiteRow({ id: "recNEW", name: "Fresh", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
      async () => false,
    );
    expect(base.__calls.filter((c) => c.kind === "update")).toHaveLength(1);
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=1 skipped=0 failed=0 mirrored=0 mirror_failed=0 mirror_missed=1",
    );
  });

  it("without a mirror the summary line carries no mirror keys", async () => {
    const log = quietLog();
    const base = makeFakeBase({ Websites: [] });
    await writeNextDueDates(
      base,
      [makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
    );
    const line = log.mock.calls.flat().join("\n");
    expect(line).toContain("NEXT_DUE_WRITE wrote=1 skipped=0 failed=0");
    expect(line).not.toContain("mirrored=");
    expect(line).not.toContain("mirror_missed=");
  });
});
