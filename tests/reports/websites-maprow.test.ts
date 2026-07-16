import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapRow,
  isArchivedStatus,
  isUnrecognizedStatus,
  type Status,
} from "../../src/reports/airtable/websites.js";

describe("mapRow frequency coercion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a recognized frequency value", () => {
    const row = mapRow({
      id: "r1",
      fields: { "maintenence freq": "Monthly", "testing freq": "Quarterly" },
    });
    expect(row.maintenanceFreq).toBe("Monthly");
    expect(row.testingFreq).toBe("Quarterly");
  });

  it("accepts a whitespace-padded value as its trimmed frequency, silently", () => {
    // An operator's trailing-space select option ("Monthly ") must degrade
    // gracefully — schedule as Monthly — not silently unschedule the site.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = mapRow({
      id: "r1",
      fields: { "maintenence freq": "Monthly ", "testing freq": " Quarterly" },
    });
    expect(row.maintenanceFreq).toBe("Monthly");
    expect(row.testingFreq).toBe("Quarterly");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns LOUDLY and falls back to None for a genuinely unrecognized value", () => {
    // A renamed or mistyped Airtable single-select option must NOT flow downstream — the
    // announcement would otherwise render "We do this undefined." into a client email.
    // But it must not be SILENT either: that drops the site from report scheduling
    // with zero signal.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = mapRow({
      id: "r1",
      fields: { Name: "Acme", "maintenence freq": "Quaterly", "testing freq": "weekly" },
    });
    expect(row.maintenanceFreq).toBe("None");
    expect(row.testingFreq).toBe("None");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatch(/Acme.*unrecognized frequency 'Quaterly'/);
    expect(warn.mock.calls[1]![0]).toMatch(/Acme.*unrecognized frequency 'weekly'/);
  });

  it("defaults a missing or blank frequency field to None, silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = mapRow({ id: "r1", fields: { "maintenence freq": "   " } });
    expect(row.maintenanceFreq).toBe("None");
    expect(row.testingFreq).toBe("None");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("mapRow status", () => {
  it("reads a 'legacy' Status cell as the recognized union member", () => {
    expect(mapRow({ id: "r1", fields: { Status: "legacy" } }).status).toBe("legacy");
  });

  it("isArchivedStatus recognizes legacy + deprecated only", () => {
    expect(isArchivedStatus("legacy")).toBe(true);
    expect(isArchivedStatus("deprecated")).toBe(true);
    expect(isArchivedStatus("maintenance")).toBe(false);
    expect(isArchivedStatus(null)).toBe(false);
  });

  it("isUnrecognizedStatus flags only values outside the union (typos), never null", () => {
    expect(isUnrecognizedStatus("legacy")).toBe(false);
    // A typo'd cell flows through mapRow's blind cast; the helper is how the
    // cockpit detects it WITHOUT nulling it (null status is schedulable-by-default
    // in due.ts/preflight.ts, so nulling a typo would activate the row).
    expect(isUnrecognizedStatus("maintenence " as Status)).toBe(true);
    expect(isUnrecognizedStatus(null)).toBe(false);
  });
});
