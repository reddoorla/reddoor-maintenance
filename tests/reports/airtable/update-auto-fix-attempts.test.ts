import { describe, it, expect } from "vitest";
import { updateAutoFixAttempts } from "../../../src/reports/airtable/websites.js";
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

describe("updateAutoFixAttempts", () => {
  it("writes the counter to the Security Auto-Fix Attempts field on the given row", async () => {
    const { base, calls } = makeFakeBase();
    await updateAutoFixAttempts(base, "recX", 3);
    expect(calls).toEqual([
      { table: "Websites", id: "recX", fields: { "Security Auto-Fix Attempts": 3 } },
    ]);
  });
});
