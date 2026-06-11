import { describe, it, expect, vi } from "vitest";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";
import { approveReportRow } from "../../../src/reports/airtable/reports.js";

/** A fake AirtableBase that records the update payload for one table. */
function fakeBase() {
  const update = vi.fn().mockResolvedValue([]);
  const base = ((table: string) => {
    expect(table).toBe("Reports");
    return { update };
  }) as unknown as AirtableBase;
  return { base, update };
}

describe("approveReportRow", () => {
  it("writes Approved to send = TRUE plus the Approved At / Approved By audit stamp", async () => {
    const { base, update } = fakeBase();
    const at = new Date("2026-06-11T15:30:00.000Z");
    await approveReportRow(base, "recREP1", at, "dashboard");
    expect(update).toHaveBeenCalledWith([
      {
        id: "recREP1",
        fields: {
          "Approved to send": true,
          "Approved At": "2026-06-11T15:30:00.000Z",
          "Approved By": "dashboard",
        },
      },
    ]);
  });
});
