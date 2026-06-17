import type { ReportType } from "./types.js";

/**
 * One operator checklist item: a stable `key`, its display `label` (which mirrors
 * the client email's checklist line — kept in sync by a test against DEFAULT_COPY),
 * and the exact Airtable checkbox column `field` it reads/writes.
 */
export type ChecklistItem = { key: string; label: string; field: string };

/** The 6 Maintenance-report items. `label`s mirror DEFAULT_COPY.maintenanceChecks. */
export const MAINTENANCE_CHECKLIST: ChecklistItem[] = [
  { key: "logs", label: "Reviewed Logs", field: "Maint: Reviewed Logs" },
  { key: "cms", label: "CMS Checked", field: "Maint: CMS Checked" },
  { key: "dns", label: "DNS Checked", field: "Maint: DNS Checked" },
  { key: "google", label: "Google Indexed", field: "Maint: Google Indexed" },
  { key: "cert", label: "Reviewed Certificate", field: "Maint: Reviewed Certificate" },
  { key: "security", label: "Security Updates", field: "Maint: Security Updates" },
];

/** The 6 Testing-report items. `label`s mirror DEFAULT_COPY.testingChecklist. */
export const TESTING_CHECKLIST: ChecklistItem[] = [
  { key: "desktop", label: "Desktop Browsers", field: "Test: Desktop Browsers" },
  { key: "mobile", label: "Mobile Browsers", field: "Test: Mobile Browsers" },
  { key: "packages", label: "Package Updates", field: "Test: Package Updates" },
  { key: "bottle", label: "Bottlenecks", field: "Test: Bottlenecks" },
  { key: "forms", label: "Form Functionality", field: "Test: Form Functionality" },
  { key: "animation", label: "Animation Functionality", field: "Test: Animation Functionality" },
];

/** All 12 Airtable checkbox column names. mapRow reads exactly these into the row's checklist. */
export const ALL_CHECKLIST_FIELDS: string[] = [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map(
  (i) => i.field,
);

/**
 * The checklist that gates a report of the given type. Maintenance/Testing gate on
 * their 6 items; Launch/Announcement have no checklist (the gate is vacuously
 * satisfied). PURE.
 */
export function checklistFor(type: ReportType): ChecklistItem[] {
  return type === "Maintenance"
    ? MAINTENANCE_CHECKLIST
    : type === "Testing"
      ? TESTING_CHECKLIST
      : [];
}

/**
 * True when every checklist item for the report's type is checked. Launch/Announcement
 * have an empty checklist → vacuously true. A missing or false cell → incomplete. PURE —
 * the single predicate behind both the approve gate and the send gate.
 */
export function isChecklistComplete(report: {
  reportType: ReportType;
  checklist: Record<string, boolean>;
}): boolean {
  return checklistFor(report.reportType).every((i) => report.checklist[i.field] === true);
}
