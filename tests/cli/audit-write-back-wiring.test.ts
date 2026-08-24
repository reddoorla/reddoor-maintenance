import { describe, it, expect } from "vitest";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { AuditResult } from "../../src/types.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";

/** The seam under test is the audit CLI's fleet write-back step, extracted
 *  from runAuditCommand precisely so its Phase 3 mirror WIRING is pinned:
 *  before this seam existed, deleting the `...(mirror ? { mirror } : {})`
 *  spread silently stopped all five nightly sweeps from mirroring while every
 *  test stayed green (adversarial review of #566, finding 6). */

const websites = [{ id: "recA", fields: { Name: "Acme Co", Status: "maintenance" } }];

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
  it("hands the built mirror to writeFleetAuditsToAirtable — kills the wiring-deleted mutation", async () => {
    const base = makeFakeBase({ Websites: websites });
    const calls: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const events: FleetEvent[] = [];
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co")],
      which: ["lighthouse"],
      deps: {
        openBase: () => base,
        makeMirror: async () => async (siteId: string, fields: Record<string, unknown>) => {
          calls.push({ siteId, fields });
          return true;
        },
        recordEvents: async (ev) => {
          events.push(...ev);
        },
      },
    });
    // Channel 1: the mirror saw exactly what the sweep wrote to Airtable.
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.siteId).toBe("recA");
    expect(calls[0]!.fields).toEqual(updates[0]!.records[0]!.fields);
    // Channel 2: the mirror counts surface on the summary the CLI prints.
    expect(res.anyFailed).toBe(false);
    expect(res.summary).toContain(
      "FLEET_WRITE_SUMMARY wrote=1 failed=0 total=1 mirrored=1 mirror_failed=0 mirror_missed=0",
    );
    // The events step still ran (the per-sweep rollup rides along).
    expect(events.some((e) => e.type === "fleet_swept")).toBe(true);
  });

  it("makeMirror resolving null (no libSQL creds): Airtable-only write-back, no mirror keys", async () => {
    const base = makeFakeBase({ Websites: websites });
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co")],
      which: ["lighthouse"],
      deps: {
        openBase: () => base,
        makeMirror: async () => null,
        recordEvents: async () => {},
      },
    });
    expect(res.anyFailed).toBe(false);
    expect(res.summary).toContain("FLEET_WRITE_SUMMARY wrote=1 failed=0 total=1");
    expect(res.summary).not.toContain("mirrored=");
  });

  it("a per-site write failure flips anyFailed without aborting the step", async () => {
    const base = makeFakeBase({ Websites: websites });
    const res = await runFleetWriteBack({
      results: [lhResult("acme-co"), lhResult("ghost-site")],
      which: ["lighthouse"],
      deps: {
        openBase: () => base,
        makeMirror: async () => null,
        recordEvents: async () => {},
      },
    });
    expect(res.anyFailed).toBe(true);
    expect(res.summary).toContain("FLEET_WRITE_SUMMARY wrote=1 failed=1 total=2");
  });
});
