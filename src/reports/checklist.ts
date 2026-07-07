import type { ReportType } from "./types.js";
import type { EvidenceResult, EvidenceRecord } from "./auto-tick.js";

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
  // `field` keeps its original Airtable column name ("…Verified After Updates") even though
  // the client-facing label is now "Tested After Updates" — the column holds operator data,
  // so renaming the label is display-only and avoids a live-base column migration.
  { key: "updates", label: "Tested After Updates", field: "Test: Verified After Updates" },
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

/** The maintenance items whose HEALTH gates a Maintenance send. Google Indexed is advisory
 *  (reported, never blocks) so it is excluded. */
const MAINTENANCE_GATING_FIELDS: string[] = [
  "Maint: Deploy & Function Health",
  "Maint: CMS Checked",
  "Maint: Domain, DNS & SSL",
  "Maint: Security Updates",
  "Maint: Uptime Checked",
];

/**
 * The checklist fields whose health gates a send of this report type. Maintenance gates
 * availability/integrity only (Google Indexed is advisory); Testing holds the full bar (all 13,
 * including Google Indexed); Launch/Announcement are ungated. PURE.
 */
export function gatingFields(type: ReportType): string[] {
  if (type === "Maintenance") return MAINTENANCE_GATING_FIELDS;
  if (type === "Testing") return checklistFor("Testing").map((i) => i.field);
  return [];
}

/**
 * The health gate: clear iff EVERY gating field's evidence result is `pass` or `n/a`. A `fail`,
 * an `unknown`, or an ABSENT record all block — the semantic inversion (no fresh signal → cannot
 * confirm health → don't send). Launch/Announcement have no gating fields → vacuously clear. PURE.
 */
export function isHealthGateClear(report: {
  reportType: ReportType;
  autoEvidence: Record<string, EvidenceRecord>;
}): boolean {
  return gatingFields(report.reportType).every((field) => {
    const r = report.autoEvidence[field]?.result;
    return r === "pass" || r === "n/a";
  });
}

/** Per-gating-field status for by-name blocker messaging (send log, dashboard). An absent record
 *  surfaces as `unknown`. PURE. */
export function gatingHealth(report: {
  reportType: ReportType;
  autoEvidence: Record<string, EvidenceRecord>;
}): { field: string; status: EvidenceResult }[] {
  return gatingFields(report.reportType).map((field) => ({
    field,
    status: report.autoEvidence[field]?.result ?? "unknown",
  }));
}

/**
 * True when a logged send-anyway override is active AND carries a non-empty reason. The effective
 * send gate is `isHealthGateClear(report) || isSendOverridden(report)`. PURE — takes the minimal
 * structural shape so it can be evaluated over a ReportRow or a synthetic "about to override" copy.
 */
export function isSendOverridden(report: {
  sendOverride: boolean;
  overrideReason: string | null;
}): boolean {
  return report.sendOverride && (report.overrideReason ?? "").trim() !== "";
}
