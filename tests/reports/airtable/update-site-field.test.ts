import { describe, it, expect } from "vitest";
import { updateSiteField } from "../../../src/reports/airtable/websites.js";
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

describe("updateSiteField", () => {
  it("writes the given column/value to the Websites row", async () => {
    const { base, calls } = makeFakeBase();
    await updateSiteField(base, "recX", "point of contact", "a@b.com");
    expect(calls).toEqual([
      { table: "Websites", id: "recX", fields: { "point of contact": "a@b.com" } },
    ]);
  });
});
