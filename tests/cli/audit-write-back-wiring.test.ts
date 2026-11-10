import { describe, it, expect, afterEach, vi } from "vitest";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { planAuditWrite } from "../../src/audits/write-audits.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import type { AuditResult } from "../../src/types.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";

/** The seam under test is the audit CLI's fleet write-back step, extracted
 *  from runAuditCommand precisely so its Phase 3 mirror WIRING is pinned:
 *  before this seam existed, deleting the `...(mirror ? { mirror } : {})`
 *  spread silently stopped all five nightly sweeps from mirroring while every
 *  test stayed green (adversarial review of #566, finding 6). */

const websites = websiteRowsFrom([
  { id: "recA", fields: { Name: "Acme Co", Status: "maintenance" } },
]);

/** #646 step 4: the roster is Turso's, injected here. A Turso-backed roster
 *  driving this seam end to end is tests/cli/fleet-roster-turso.test.ts. */
const roster = async () => websites;

function lhResult(siteSlug: string): AuditResult {
  return {
    audit: "lighthouse",
    site: siteSlug,
    status: "pass",
    summary: "",
    details: {
      summary: { performance: 0.9, accessibility: 1, "best-practices": 0.78, seo: 0.92 },
    },
  };
}

describe("runFleetWriteBack mirror wiring (#539 Phase 3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands the built mirror to writeFleetAudits — kills the wiring-deleted mutation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
    const calls: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const events: FleetEvent[] = [];
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co")],
      which: ["lighthouse"],
      deps: {
        roster,
        makeMirror: async () => async (siteId: string, fields: Record<string, unknown>) => {
          calls.push({ siteId, fields });
          return true;
        },
        recordEvents: async (ev) => {
          events.push(...ev);
        },
      },
    });
    // Channel 1: the mirror saw exactly the FieldSet the planner built.
    const planned = planAuditWrite({ websites, slug: "acme-co", results: [lhResult("acme-co")] });
    expect(Object.keys(planned.summary.fields ?? {}).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.siteId).toBe("recA");
    expect(calls[0]!.fields).toEqual(planned.summary.fields);
    // Channel 2: the mirror counts surface on the summary the CLI prints.
    expect(res.anyFailed).toBe(false);
    expect(res.summary).toContain(
      "FLEET_WRITE_SUMMARY wrote=1 failed=0 total=1 mirrored=1 mirror_failed=0 mirror_missed=0",
    );
    // The events step still ran (the per-sweep rollup rides along).
    expect(events.some((e) => e.type === "fleet_swept")).toBe(true);
  });

  it("makeMirror resolving null: the site fails, anyFailed flips, no mirror keys (#612)", async () => {
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co")],
      which: ["lighthouse"],
      deps: {
        roster,
        makeMirror: async () => null,
        recordEvents: async () => {},
      },
    });
    expect(res.anyFailed).toBe(true);
    expect(res.summary).toContain("FLEET_WRITE_SUMMARY wrote=0 failed=1 total=1");
    expect(res.summary).toContain("acme-co (no Turso store configured)");
    expect(res.summary).not.toContain("mirrored=");
  });

  it("a wired mirror that landed everything still passes (positive control)", async () => {
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co")],
      which: ["lighthouse"],
      deps: {
        roster,
        makeMirror: async () => async () => true,
        recordEvents: async () => {},
      },
    });
    expect(res.anyFailed).toBe(false);
  });

  it("a per-site mirror FAILURE flips anyFailed without aborting the sweep", async () => {
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co")],
      which: ["lighthouse"],
      deps: {
        roster,
        makeMirror: async () => async () => {
          throw new Error("turso down");
        },
        recordEvents: async () => {},
      },
    });
    expect(res.anyFailed).toBe(true);
    expect(res.summary).toContain("mirror_failed=1");
  });

  it("a per-site write failure flips anyFailed without aborting the step", async () => {
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co"), lhResult("ghost-site")],
      which: ["lighthouse"],
      deps: {
        roster,
        makeMirror: async () => async () => true,
        recordEvents: async () => {},
      },
    });
    expect(res.anyFailed).toBe(true);
    expect(res.summary).toContain("FLEET_WRITE_SUMMARY wrote=1 failed=1 total=2");
  });
});

// #1755, answering #1669's W6 with one run through the real writer: a night where every
// form-e2e probe threw (`runOneAudit` writes it as status `fail`, "unexpected error") is red
// at the write gate on its own, not only at the workflow's probed-nothing check: the writer
// files each thrown site as "nothing measured" and the gate names that.
describe("a form-e2e night where every probe threw (#1669 W6)", () => {
  it("is red at the write gate, which names form-e2e as having measured nothing", async () => {
    const slugs = Array.from({ length: 6 }, (_, i) => `site-${i}`);
    const rows = websiteRowsFrom(
      slugs.map((s, i) => ({ id: `rec${i}`, fields: { Name: s, Status: "maintenance" } })),
    );
    const results: AuditResult[] = slugs.map((site) => ({
      audit: "form-e2e",
      site,
      status: "fail",
      summary: "form-e2e: unexpected error — Error: browserType.launch: Executable doesn't exist",
    }));
    const wb = await runFleetWriteBack({
      results,
      which: ["form-e2e"],
      expectedSites: slugs,
      deps: {
        roster: async () => rows,
        makeMirror: async () => async () => true,
        recordEvents: async () => {},
      },
    });
    const lines = wb.summary.split("\n");
    expect(lines).toContain("FLEET_WRITE_GATE verdict=red");
    expect(lines).toContain(
      "FLEET_WRITE_GATE_REASON form-e2e measured nothing on 6 of 6 site(s): site-0, site-1, site-2, site-3, site-4, site-5 (>25%25)",
    );
    expect(wb.summary).toContain("FLEET_WRITE_SUMMARY wrote=0 failed=6 total=6");
  });
});
