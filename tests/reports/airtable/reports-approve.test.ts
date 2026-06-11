import { describe, it, expect, vi } from "vitest";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";
import { approveReportRow, getReportById } from "../../../src/reports/airtable/reports.js";

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

describe("getReportById", () => {
  // The FakeAirtableBase helper supports select/create/update but NOT find (it is
  // a `.find`-less fake). getReportById's surface is small enough that an inline
  // vi.fn() fake is cleaner and more explicit than extending FakeAirtableBase —
  // the plan and this test's comments both document this choice.

  it("maps a found record onto a ReportRow", async () => {
    const find = vi.fn().mockResolvedValue({
      id: "recREP1",
      fields: { "Report ID": "rep_001", Site: ["recSITE1"], "Report type": "Maintenance" },
    });
    const base = ((table: string) => {
      expect(table).toBe("Reports");
      return { find };
    }) as unknown as AirtableBase;

    const row = await getReportById(base, "recREP1");

    expect(find).toHaveBeenCalledWith("recREP1");
    expect(row).not.toBeNull();
    expect(row!.id).toBe("recREP1");
    expect(row!.reportId).toBe("rep_001");
    expect(row!.siteId).toBe("recSITE1");
    expect(row!.reportType).toBe("Maintenance");
  });

  it("returns null when find throws (Airtable NOT_FOUND / bad id)", async () => {
    const find = vi.fn().mockRejectedValue(new Error("NOT_FOUND"));
    const base = ((_table: string) => ({ find })) as unknown as AirtableBase;

    const row = await getReportById(base, "recNOPE");

    expect(row).toBeNull();
  });

  it("returns null when find throws any error (not just NOT_FOUND)", async () => {
    const find = vi.fn().mockRejectedValue(new Error("RECORD_INVALID"));
    const base = ((_table: string) => ({ find })) as unknown as AirtableBase;

    expect(await getReportById(base, "recBAD")).toBeNull();
  });
});
