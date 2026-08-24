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
    await writeNextDueDates(base, sites, [], TODAY);
    expect(base.__calls.filter((c) => c.kind === "update")).toHaveLength(0);
    expect(log.mock.calls.flat().join("\n")).toContain("NEXT_DUE_WRITE wrote=0 skipped=2");
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
    expect(log.mock.calls.flat().join("\n")).toContain("NEXT_DUE_WRITE wrote=1 skipped=1");
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
      "NEXT_DUE_WRITE wrote=1 skipped=0 mirrored=1 mirror_failed=0",
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
      "NEXT_DUE_WRITE wrote=1 skipped=0 mirrored=0 mirror_failed=1",
    );
    expect(warn.mock.calls.flat().join("\n")).toContain("[schedule-mirror] Stale: turso down");
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
    expect(line).toContain("NEXT_DUE_WRITE wrote=1 skipped=0");
    expect(line).not.toContain("mirrored=");
  });
});
