import { describe, it, expect } from "vitest";

import {
  MAINTENANCE_CHECKLIST,
  TESTING_CHECKLIST,
  ALL_CHECKLIST_FIELDS,
  checklistFor,
  isChecklistComplete,
} from "../../src/reports/checklist.js";
import { DEFAULT_COPY } from "../../src/reports/copy.js";

describe("checklistFor", () => {
  it("returns the maintenance list for Maintenance", () => {
    expect(checklistFor("Maintenance")).toBe(MAINTENANCE_CHECKLIST);
  });
  it("returns the testing list for Testing", () => {
    expect(checklistFor("Testing")).toBe(TESTING_CHECKLIST);
  });
  it("returns [] for Launch (no gate)", () => {
    expect(checklistFor("Launch")).toEqual([]);
  });
  it("returns [] for Announcement (no gate)", () => {
    expect(checklistFor("Announcement")).toEqual([]);
  });
});

describe("ALL_CHECKLIST_FIELDS", () => {
  it("is the 12 field names across both lists in order", () => {
    expect(ALL_CHECKLIST_FIELDS).toEqual([
      "Maint: Reviewed Logs",
      "Maint: CMS Checked",
      "Maint: DNS Checked",
      "Maint: Google Indexed",
      "Maint: Reviewed Certificate",
      "Maint: Security Updates",
      "Test: Desktop Browsers",
      "Test: Mobile Browsers",
      "Test: Package Updates",
      "Test: Bottlenecks",
      "Test: Form Functionality",
      "Test: Animation Functionality",
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
    checklist["Maint: DNS Checked"] = false;
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
  it("is true for Testing when all 6 testing fields are true", () => {
    const checklist = Object.fromEntries(TESTING_CHECKLIST.map((i) => [i.field, true]));
    expect(isChecklistComplete({ reportType: "Testing", checklist })).toBe(true);
  });
  it("is false for Testing when any testing field is false", () => {
    const checklist = Object.fromEntries(TESTING_CHECKLIST.map((i) => [i.field, true]));
    checklist["Test: Bottlenecks"] = false;
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
