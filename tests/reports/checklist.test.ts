import { describe, it, expect } from "vitest";

import {
  MAINTENANCE_CHECKLIST,
  TESTING_CHECKLIST,
  ALL_CHECKLIST_FIELDS,
  checklistFor,
  isChecklistComplete,
  gatingFields,
  isHealthGateClear,
  gatingHealth,
  isSendOverridden,
} from "../../src/reports/checklist.js";
import type { EvidenceRecord } from "../../src/reports/auto-tick.js";
import { DEFAULT_COPY } from "../../src/reports/copy.js";

describe("checklistFor", () => {
  it("returns the maintenance list for Maintenance", () => {
    expect(checklistFor("Maintenance")).toBe(MAINTENANCE_CHECKLIST);
  });
  it("returns maintenance + testing for Testing (a testing pass also does the maintenance checks)", () => {
    expect(checklistFor("Testing")).toEqual([...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST]);
  });
  it("returns [] for Launch (no gate)", () => {
    expect(checklistFor("Launch")).toEqual([]);
  });
  it("returns [] for Announcement (no gate)", () => {
    expect(checklistFor("Announcement")).toEqual([]);
  });
});

describe("ALL_CHECKLIST_FIELDS", () => {
  it("is the 13 field names across both lists in order", () => {
    expect(ALL_CHECKLIST_FIELDS).toEqual([
      "Maint: Deploy & Function Health",
      "Maint: CMS Checked",
      "Maint: Domain, DNS & SSL",
      "Maint: Google Indexed",
      "Maint: Security Updates",
      "Maint: Uptime Checked",
      "Test: Desktop Browsers",
      "Test: Mobile Browsers",
      "Test: Page Titles & Meta",
      "Test: Links & Navigation",
      "Test: Form Functionality",
      "Test: Interactions & Animations",
      "Test: Verified After Updates",
    ]);
  });
});

describe("isChecklistComplete", () => {
  it("is vacuously true for Launch (empty checklist)", () => {
    expect(isChecklistComplete({ reportType: "Launch", checklist: {} })).toBe(true);
  });
  it("is vacuously true for Announcement (empty checklist)", () => {
    expect(isChecklistComplete({ reportType: "Announcement", checklist: {} })).toBe(true);
  });
  it("is true for Maintenance when all 6 maintenance fields are true", () => {
    const checklist = Object.fromEntries(MAINTENANCE_CHECKLIST.map((i) => [i.field, true]));
    expect(isChecklistComplete({ reportType: "Maintenance", checklist })).toBe(true);
  });
  it("is false for Maintenance when any maintenance field is false", () => {
    const checklist = Object.fromEntries(MAINTENANCE_CHECKLIST.map((i) => [i.field, true]));
    checklist["Maint: Domain, DNS & SSL"] = false;
    expect(isChecklistComplete({ reportType: "Maintenance", checklist })).toBe(false);
  });
  it("is false for Maintenance when a maintenance field is missing entirely", () => {
    const checklist = Object.fromEntries(
      MAINTENANCE_CHECKLIST.slice(0, 5).map((i) => [i.field, true]),
    );
    expect(isChecklistComplete({ reportType: "Maintenance", checklist })).toBe(false);
  });
  it("ignores irrelevant fields: a Maintenance report is not blocked by unchecked Testing fields", () => {
    const checklist = Object.fromEntries(MAINTENANCE_CHECKLIST.map((i) => [i.field, true]));
    for (const i of TESTING_CHECKLIST) checklist[i.field] = false;
    expect(isChecklistComplete({ reportType: "Maintenance", checklist })).toBe(true);
  });
  it("is true for Testing only when all 13 (maintenance + testing) fields are true", () => {
    const checklist = Object.fromEntries(
      [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map((i) => [i.field, true]),
    );
    expect(isChecklistComplete({ reportType: "Testing", checklist })).toBe(true);
  });
  it("is false for Testing when only the testing items are checked (maintenance items still gate it)", () => {
    const checklist = Object.fromEntries(TESTING_CHECKLIST.map((i) => [i.field, true]));
    expect(isChecklistComplete({ reportType: "Testing", checklist })).toBe(false);
  });
  it("is false for Testing when any single field (maintenance or testing) is false", () => {
    const checklist = Object.fromEntries(
      [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map((i) => [i.field, true]),
    );
    checklist["Maint: Uptime Checked"] = false;
    expect(isChecklistComplete({ reportType: "Testing", checklist })).toBe(false);
  });
});

describe("checklist labels stay in sync with the client email copy", () => {
  it("MAINTENANCE_CHECKLIST labels equal DEFAULT_COPY.maintenanceChecks", () => {
    expect(MAINTENANCE_CHECKLIST.map((i) => i.label)).toEqual(DEFAULT_COPY.maintenanceChecks);
  });
  it("TESTING_CHECKLIST labels equal DEFAULT_COPY.testingChecklist", () => {
    expect(TESTING_CHECKLIST.map((i) => i.label)).toEqual(DEFAULT_COPY.testingChecklist);
  });
});

const rec = (result: EvidenceRecord["result"]): EvidenceRecord => ({
  result,
  checkedAt: "2026-07-06T00:00:00.000Z",
  note: "",
});
/** Build an all-pass autoEvidence map for a report type's gating fields. */
const allPass = (type: "Maintenance" | "Testing"): Record<string, EvidenceRecord> =>
  Object.fromEntries(gatingFields(type).map((f) => [f, rec("pass")]));

describe("gatingFields", () => {
  it("gates Maintenance on the 5 availability items, EXCLUDING advisory Google Indexed", () => {
    expect(gatingFields("Maintenance")).toEqual([
      "Maint: Deploy & Function Health",
      "Maint: CMS Checked",
      "Maint: Domain, DNS & SSL",
      "Maint: Security Updates",
      "Maint: Uptime Checked",
    ]);
    expect(gatingFields("Maintenance")).not.toContain("Maint: Google Indexed");
  });
  it("gates Testing on all 13 fields (maintenance incl. Google Indexed + testing)", () => {
    expect(gatingFields("Testing")).toEqual(checklistFor("Testing").map((i) => i.field));
    expect(gatingFields("Testing")).toHaveLength(13);
    expect(gatingFields("Testing")).toContain("Maint: Google Indexed");
  });
  it("returns [] for Launch and Announcement (ungated)", () => {
    expect(gatingFields("Launch")).toEqual([]);
    expect(gatingFields("Announcement")).toEqual([]);
  });
});

describe("isHealthGateClear", () => {
  it("is vacuously true for Launch/Announcement", () => {
    expect(isHealthGateClear({ reportType: "Launch", autoEvidence: {} })).toBe(true);
    expect(isHealthGateClear({ reportType: "Announcement", autoEvidence: {} })).toBe(true);
  });
  it("is true for Maintenance when every gating field is pass", () => {
    expect(
      isHealthGateClear({ reportType: "Maintenance", autoEvidence: allPass("Maintenance") }),
    ).toBe(true);
  });
  it("treats n/a as clearing (a per-site not-applicable item never blocks)", () => {
    const ev = { ...allPass("Testing"), "Test: Form Functionality": rec("n/a") };
    expect(isHealthGateClear({ reportType: "Testing", autoEvidence: ev })).toBe(true);
  });
  it("blocks on a single 'fail' gating field", () => {
    const ev = { ...allPass("Maintenance"), "Maint: CMS Checked": rec("fail") };
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(false);
  });
  it("blocks on a single 'unknown' gating field", () => {
    const ev = { ...allPass("Maintenance"), "Maint: Uptime Checked": rec("unknown") };
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(false);
  });
  it("blocks on an ABSENT gating field (the inversion — no signal cannot clear)", () => {
    const ev = allPass("Maintenance");
    delete ev["Maint: Domain, DNS & SSL"];
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(false);
  });
  it("ignores a failing ADVISORY item on Maintenance (Google Indexed never blocks)", () => {
    const ev = { ...allPass("Maintenance"), "Maint: Google Indexed": rec("fail") };
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(true);
  });
});

describe("gatingHealth", () => {
  it("reports each gating field's status, defaulting an absent record to unknown", () => {
    const ev: Record<string, EvidenceRecord> = {
      ...allPass("Maintenance"),
      "Maint: CMS Checked": rec("fail"),
    };
    delete ev["Maint: Uptime Checked"];
    const health = gatingHealth({ reportType: "Maintenance", autoEvidence: ev });
    expect(health).toContainEqual({ field: "Maint: CMS Checked", status: "fail" });
    expect(health).toContainEqual({ field: "Maint: Uptime Checked", status: "unknown" });
  });
});

describe("isSendOverridden", () => {
  it("is true only when the flag is set AND the reason is non-empty", () => {
    expect(isSendOverridden({ sendOverride: true, overrideReason: "client asked" })).toBe(true);
    expect(isSendOverridden({ sendOverride: true, overrideReason: "   " })).toBe(false);
    expect(isSendOverridden({ sendOverride: true, overrideReason: null })).toBe(false);
    expect(isSendOverridden({ sendOverride: false, overrideReason: "x" })).toBe(false);
  });
});
