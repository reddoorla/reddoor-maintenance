import { describe, it, expect } from "vitest";
import { updateNextDueDates } from "../../../src/reports/airtable/websites.js";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";

type UpdateCall = { table: string; id: string; fields: Record<string, unknown> };

function makeFakeBase(): { base: AirtableBase; calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  const tableFn = (table: string) => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      for (const r of recs) calls.push({ table, id: r.id, fields: r.fields });
      return recs;
    },
  });
  return { base: tableFn as unknown as AirtableBase, calls };
}

describe("updateNextDueDates", () => {
  it("writes both next-due dates to the Websites row", async () => {
    const { base, calls } = makeFakeBase();
    await updateNextDueDates(base, "recX", {
      maintenanceAt: "2026-07-30",
      testingAt: "2026-09-30",
    });
    expect(calls).toEqual([
      {
        table: "Websites",
        id: "recX",
        fields: { "Next maintenance at": "2026-07-30", "Next testing at": "2026-09-30" },
      },
    ]);
  });

  it("clears a field with null when that schedule is absent", async () => {
    const { base, calls } = makeFakeBase();
    await updateNextDueDates(base, "recX", { maintenanceAt: "2026-07-30", testingAt: null });
    expect(calls).toEqual([
      {
        table: "Websites",
        id: "recX",
        fields: { "Next maintenance at": "2026-07-30", "Next testing at": null },
      },
    ]);
  });
});
