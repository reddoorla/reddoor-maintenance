/** The next-due diff-guard + site_schedule write (#539 Phase 3).
 *
 *  Before the guard, every one of the 44 sites got a nightly write — ~31 of them
 *  re-writing null over null forever. The guard writes only when the computed
 *  dates differ from what the row already holds (read back via
 *  WebsiteRow.nextMaintenanceAt/nextTestingAt), which also scopes writes to
 *  maintained sites by construction. Each real write goes through the schedule
 *  mirror, which is the store.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { writeNextDueDates } from "../../src/cli/commands/report.js";
import type { ScheduleMirror } from "../../src/audits/health-mirror.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { reportRowsFrom } from "../_helpers/raw-rows.js";

const TODAY = new Date("2026-08-24T09:23:00.000Z");
const TODAY_YMD = "2026-08-24";

afterEach(() => vi.restoreAllMocks());

function quietLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

type Call = { siteId: string; fields: Record<string, unknown>; computedAt: string };

function recorder(): { calls: Call[]; mirror: ScheduleMirror } {
  const calls: Call[] = [];
  return {
    calls,
    mirror: async (siteId, fields, computedAt) => {
      calls.push({ siteId, fields, computedAt });
      return true;
    },
  };
}

describe("writeNextDueDates diff-guard", () => {
  it("skips a site whose computed dates equal the stored ones (incl. the null/null never-maintained case)", async () => {
    const log = quietLog();
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
    const { calls, mirror } = recorder();
    await writeNextDueDates(sites, [], TODAY, mirror);
    expect(calls).toHaveLength(0);
    // The FULL line — a `toContain` on a prefix would tolerate a mirrored= drift.
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=0 skipped=2 failed=0 mirrored=0 mirror_failed=0 mirror_missed=0",
    );
  });

  it("writes (both fields, one write) when a date moved — and only for that site", async () => {
    const log = quietLog();
    const sites = [
      makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" }),
      makeWebsiteRow({ id: "recNONE", name: "Bare" }),
    ];
    const { calls, mirror } = recorder();
    await writeNextDueDates(sites, [], TODAY, mirror);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.siteId).toBe("recSTALE");
    expect(calls[0]!.fields).toEqual({
      "Next maintenance at": TODAY_YMD,
      "Next testing at": null,
    });
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=1 skipped=1 failed=0 mirrored=1 mirror_failed=0 mirror_missed=0",
    );
  });

  it("a testing-only change writes too — BOTH dates are load-bearing in the guard", async () => {
    quietLog();
    // Maintenance side equal (null = null); testing computes today vs stored null.
    const sites = [makeWebsiteRow({ id: "recTEST", name: "TestOnly", testingFreq: "Monthly" })];
    const { calls, mirror } = recorder();
    await writeNextDueDates(sites, [], TODAY, mirror);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fields).toEqual({
      "Next maintenance at": null,
      "Next testing at": TODAY_YMD,
    });
  });

  it("a date CLEAR (schedule removed) is a change, not a skip", async () => {
    quietLog();
    const sites = [
      makeWebsiteRow({ id: "recGONE", name: "Gone", nextMaintenanceAt: "2026-09-01" }),
    ];
    const { calls, mirror } = recorder();
    await writeNextDueDates(sites, [], TODAY, mirror);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fields).toEqual({
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
    const { calls, mirror } = recorder();
    await writeNextDueDates(sites, [], TODAY, mirror);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fields).toEqual({
      "Next maintenance at": "2026-09-01",
      "Next testing at": "2026-11-15",
    });
    expect(log.mock.calls.flat().join("\n")).toContain("NEXT_DUE_WRITE wrote=1 skipped=0 failed=0");
  });
});

describe("per-site blast radius", () => {
  it("one bad row costs ONLY that site — the next site still writes (failed=1)", async () => {
    const log = quietLog();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sites = [
      makeWebsiteRow({
        id: "recBOOM",
        name: "Boom",
        maintenanceFreq: "Monthly",
        maintenanceDay: "not-a-date",
      }),
      makeWebsiteRow({ id: "recOK", name: "Okay", maintenanceFreq: "Monthly" }),
    ];
    const { calls, mirror } = recorder();
    await writeNextDueDates(sites, [], TODAY, mirror);
    expect(calls.map((c) => c.siteId)).toEqual(["recOK"]);
    expect(warn.mock.calls.flat().join("\n")).toContain("next-due write skipped for Boom");
    // failed=1 keeps the outage visible — wrote+skipped alone would undercount.
    expect(log.mock.calls.flat().join("\n")).toContain("NEXT_DUE_WRITE wrote=1 skipped=0 failed=1");
  });

  it("a write that throws for one site still lets the next site write", async () => {
    const log = quietLog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const written: string[] = [];
    await writeNextDueDates(
      [
        makeWebsiteRow({ id: "recBOOM", name: "Boom", maintenanceFreq: "Monthly" }),
        makeWebsiteRow({ id: "recOK", name: "Okay", maintenanceFreq: "Monthly" }),
      ],
      [],
      TODAY,
      async (siteId) => {
        if (siteId === "recBOOM") throw new Error("turso down");
        written.push(siteId);
        return true;
      },
    );
    expect(written).toEqual(["recOK"]);
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=1 skipped=0 failed=0 mirrored=1 mirror_failed=1 mirror_missed=0",
    );
  });
});

describe("the site_schedule mirror", () => {
  it("receives the exact FieldSet, stamped with today", async () => {
    const log = quietLog();
    const { calls, mirror } = recorder();
    await writeNextDueDates(
      [makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
      mirror,
    );
    expect(calls).toEqual([
      {
        siteId: "recSTALE",
        fields: { "Next maintenance at": TODAY_YMD, "Next testing at": null },
        computedAt: TODAY.toISOString(),
      },
    ]);
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=1 skipped=0 failed=0 mirrored=1 mirror_failed=0 mirror_missed=0",
    );
  });

  it("a mirror failure is counted and warned, never thrown, and is not a write", async () => {
    const log = quietLog();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeNextDueDates(
      [makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
      async () => {
        throw new Error("turso down");
      },
    );
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=0 skipped=0 failed=0 mirrored=0 mirror_failed=1 mirror_missed=0",
    );
    expect(warn.mock.calls.flat().join("\n")).toContain("[schedule-mirror] Stale: turso down");
  });

  it("a 0-row mirror UPDATE counts as missed, never as mirrored or written", async () => {
    const log = quietLog();
    await writeNextDueDates(
      [makeWebsiteRow({ id: "recNEW", name: "Fresh", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
      async () => false,
    );
    expect(log.mock.calls.flat().join("\n")).toContain(
      "NEXT_DUE_WRITE wrote=0 skipped=0 failed=0 mirrored=0 mirror_failed=0 mirror_missed=1",
    );
  });

  it("without a mirror the line SAYS SO, and carries no mirror counters", async () => {
    // A null mirror writes nothing and throws nothing, so before `mirror=absent`
    // the only trace was the ABSENCE of a suffix — indistinguishable at a glance
    // from a healthy run. That is precisely how the dual-write ran dead in
    // production: the daily-reports draft step had no Turso credentials.
    // Counters still stay off — reporting mirrored=0 for a mirror that never
    // existed would claim a zero-result write that was never attempted — and
    // wrote=0, because nothing was.
    const log = quietLog();
    await writeNextDueDates(
      [makeWebsiteRow({ id: "recSTALE", name: "Stale", maintenanceFreq: "Monthly" })],
      [],
      TODAY,
    );
    const line = log.mock.calls.flat().join("\n");
    expect(line).toContain("NEXT_DUE_WRITE wrote=0 skipped=0 failed=0 mirror=absent");
    expect(line).not.toContain("mirrored=");
    expect(line).not.toContain("mirror_missed=");
  });
});

describe("writeNextDueDates — a withdrawn draft moves the stored next date (P1-28)", () => {
  it("writes the date a cycle past the withdrawn period, from the same nextDueDate", async () => {
    quietLog();
    const sites = [
      makeWebsiteRow({
        id: "recVLF",
        name: "Vida",
        maintenanceFreq: "Monthly",
        maintenanceDay: "2026-07-24",
        nextMaintenanceAt: TODAY_YMD,
      }),
    ];
    const reports = reportRowsFrom([
      {
        id: "recW",
        fields: {
          Site: ["recVLF"],
          "Report type": "Maintenance",
          Period: "2026-08",
          "Draft ready": true,
          "Withdrawn at": "2026-08-24T10:00:00.000Z",
        },
      },
    ]);
    const { calls, mirror } = recorder();
    await writeNextDueDates(sites, reports, TODAY, mirror);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fields["Next maintenance at"]).toBe("2026-09-24");
  });
});
