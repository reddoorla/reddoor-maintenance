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
  it("reads an 'archived' cell as archived — the merge now lives in the DATA, not the map", () => {
    // This test used to prove that 'legacy' and 'deprecated' BOTH read as
    // 'archived'. That merge happened for real on 2026-08-24: all 12 archived
    // cells were rewritten to 'archived' and, on 2026-08-25, the two old options
    // were deleted from the Airtable field outright. With the alias map gone
    // (stage 3), neither old name is translated any more — so the merge is no
    // longer a mapping this seam performs, it is a fact about the stored data.
    expect(mapRow({ id: "r1", fields: { Status: "archived" } }).status).toBe("archived");
    expect(mapRow({ id: "r1", fields: { Status: "archived" } }).statusRaw).toBe("archived");
    // A retired name is now an anomaly, not a synonym: it survives verbatim so
    // the cockpit can surface it rather than absorbing it into 'archived'.
    expect(mapRow({ id: "r1", fields: { Status: "legacy" } }).status).toBe("legacy");
    expect(isArchivedStatus(mapRow({ id: "r1", fields: { Status: "legacy" } }).status)).toBe(false);
  });

  it("isArchivedStatus recognizes the archived state only", () => {
    expect(isArchivedStatus("archived")).toBe(true);
    expect(isArchivedStatus("maintained")).toBe(false);
    expect(isArchivedStatus(null)).toBe(false);
  });

  it("isUnrecognizedStatus flags only values outside the union (typos), never null", () => {
    expect(isUnrecognizedStatus("archived")).toBe(false);
    // A typo'd cell flows through mapRow's blind cast; the helper is how the
    // cockpit detects it WITHOUT nulling it (null status is schedulable-by-default
    // in due.ts/preflight.ts, so nulling a typo would activate the row).
    expect(isUnrecognizedStatus("maintenence " as Status)).toBe(true);
    expect(isUnrecognizedStatus(null)).toBe(false);
  });
});

/**
 * `notifyRoutingRaw` exists for the same reason `statusRaw` does: the dashboard
 * editor round-trips this cell, and the parsed object is not a faithful stand-in
 * for it (#539 Phase 4).
 */
describe("mapRow notifyRoutingRaw", () => {
  it("keeps the cell VERBATIM — re-serializing the parsed object would rewrite it", () => {
    // Pretty-printed, with a key the parser does not model. Rendering
    // JSON.stringify(notifyRouting) instead would hand the operator a reformatted
    // cell with `note` missing, and saving it would destroy both — a silent
    // rewrite of a cell they only opened to look at.
    const raw =
      '{\n  "field": "Department",\n  "routes": {"Sales": "s@acme.com"},\n  "note": "keep"\n}';
    const row = mapRow({ id: "r1", fields: { Name: "Acme", "Notify Routing": raw } });
    expect(row.notifyRoutingRaw).toBe(raw);
    expect(row.notifyRouting).toMatchObject({ field: "Department" });
    expect(JSON.stringify(row.notifyRouting)).not.toBe(row.notifyRoutingRaw);
  });

  it("keeps a MALFORMED cell too, so the editor can show what needs fixing", () => {
    // The parsed side degrades to null by design (routing falls back to the POC).
    // If the editor rendered the parsed value it would show an empty box, and the
    // operator's next save would silently discard the broken text they came to fix.
    const row = mapRow({ id: "r1", fields: { Name: "Acme", "Notify Routing": "{not json" } });
    expect(row.notifyRouting).toBeNull();
    expect(row.notifyRoutingRaw).toBe("{not json");
  });

  it("is null for a blank cell", () => {
    expect(mapRow({ id: "r1", fields: { Name: "Acme" } }).notifyRoutingRaw).toBeNull();
    expect(
      mapRow({ id: "r1", fields: { Name: "Acme", "Notify Routing": "   " } }).notifyRoutingRaw,
    ).toBeNull();
  });
});
