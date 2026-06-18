import { describe, it, expect } from "vitest";
import { mapRow } from "../../src/reports/airtable/websites.js";

describe("mapRow frequency coercion", () => {
  it("keeps a recognized frequency value", () => {
    const row = mapRow({
      id: "r1",
      fields: { "maintenence freq": "Monthly", "testing freq": "Quarterly" },
    });
    expect(row.maintenanceFreq).toBe("Monthly");
    expect(row.testingFreq).toBe("Quarterly");
  });

  it("falls back to None for an unrecognized / typo'd / whitespace value", () => {
    // A renamed or mistyped Airtable single-select option must NOT flow downstream — the
    // announcement would otherwise render "We do this undefined." into a client email.
    const row = mapRow({
      id: "r1",
      fields: { "maintenence freq": "Monthly ", "testing freq": "weekly" },
    });
    expect(row.maintenanceFreq).toBe("None");
    expect(row.testingFreq).toBe("None");
  });

  it("defaults a missing frequency field to None", () => {
    const row = mapRow({ id: "r1", fields: {} });
    expect(row.maintenanceFreq).toBe("None");
    expect(row.testingFreq).toBe("None");
  });
});
