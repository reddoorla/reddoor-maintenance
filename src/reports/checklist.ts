import type { ReportType } from "./types.js";

/**
 * One operator checklist item: a stable `key`, its display `label` (which mirrors
 * the client email's checklist line — kept in sync by a test against DEFAULT_COPY),
 * and the exact Airtable checkbox column `field` it reads/writes.
 */
export type ChecklistItem = { key: string; label: string; field: string };

/**
 * The 6 Maintenance-report items. `label`s mirror DEFAULT_COPY.maintenanceChecks
 * (same order — "Google Indexed" MUST stay at index 3; the email template special-cases
 * that row to inject the live search position).
 */
export const MAINTENANCE_CHECKLIST: ChecklistItem[] = [
  { key: "deploy", label: "Deploy & Function Health", field: "Maint: Deploy & Function Health" },
  { key: "cms", label: "CMS Checked", field: "Maint: CMS Checked" },
  { key: "domain", label: "Domain, DNS & SSL", field: "Maint: Domain, DNS & SSL" },
  { key: "google", label: "Google Indexed", field: "Maint: Google Indexed" },
  { key: "security", label: "Security Updates", field: "Maint: Security Updates" },
  { key: "uptime", label: "Uptime Checked", field: "Maint: Uptime Checked" },
];

/** The 7 Testing-report items. `label`s mirror DEFAULT_COPY.testingChecklist. */
export const TESTING_CHECKLIST: ChecklistItem[] = [
  { key: "desktop", label: "Desktop Browsers", field: "Test: Desktop Browsers" },
  { key: "mobile", label: "Mobile Browsers", field: "Test: Mobile Browsers" },
  { key: "titles", label: "Page Titles & Meta", field: "Test: Page Titles & Meta" },
  { key: "links", label: "Links & Navigation", field: "Test: Links & Navigation" },
  { key: "forms", label: "Form Functionality", field: "Test: Form Functionality" },
  {
    key: "interactions",
    label: "Interactions & Animations",
    field: "Test: Interactions & Animations",
  },
  { key: "updates", label: "Verified After Updates", field: "Test: Verified After Updates" },
];

/** All 13 Airtable checkbox column names. mapRow reads exactly these into the row's checklist. */
export const ALL_CHECKLIST_FIELDS: string[] = [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map(
  (i) => i.field,
);

/**
 * The checklist that gates a report of the given type, in the order the email renders it.
 * Maintenance gates on its 6 items. A Testing pass also performs the maintenance checks —
 * and the Testing email shows BOTH lists — so a Testing report gates on all 13
 * (maintenance first, then testing). Launch/Announcement have no checklist (the gate is
 * vacuously satisfied). PURE.
 */
export function checklistFor(type: ReportType): ChecklistItem[] {
  if (type === "Maintenance") return MAINTENANCE_CHECKLIST;
  if (type === "Testing") return [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST];
  return [];
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
