/**
 * The report-row model and its pure, vendor-neutral coercers.
 *
 * `ReportRow` is what BOTH readers return — `mapRow` over an Airtable record
 * (`src/reports/airtable/reports.ts`) and the Turso report reader in
 * `src/db/fleet-state.ts`. Moved out of the Airtable module in #539 Phase 6
 * step 1 (#646) so the Turso read path does not depend on the directory Phase 6
 * deletes. `src/reports/airtable/reports.ts` re-exports every name.
 */
import type { ReportType, LighthouseScores } from "./types.js";
import type { EvidenceRecord } from "./auto-tick.js";

const REPORT_TYPES: readonly ReportType[] = ["Maintenance", "Testing", "Launch", "Announcement"];

/** Coerce the Airtable `Report type` (a single-select string) to a known
 *  ReportType. A bare `as ReportType` cast is a compile-time lie: if the
 *  single-select gains an unexpected option, the bad value flows to render.ts,
 *  where `reportType === "Launch"` silently falls through to the Maintenance
 *  template. Validate at the boundary; warn + default to "Maintenance" so an
 *  unknown type is VISIBLE in the logs rather than silently mis-templated. */
export function toReportType(raw: string | undefined): ReportType {
  if (raw && (REPORT_TYPES as readonly string[]).includes(raw)) return raw as ReportType;
  if (raw)
    console.warn(`[reports] unknown Report type ${JSON.stringify(raw)} — treating as Maintenance`);
  return "Maintenance";
}

export type DeliveryStatus = "pending" | "delivered" | "bounced" | "complained";

export type ReportRow = {
  id: string;
  reportId: string;
  siteId: string;
  reportType: ReportType;
  /** UTC `YYYY-MM` recurrence key (idempotency for search-before-create). Null on legacy rows. */
  period: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  completedOn: string | null;
  lighthouse: LighthouseScores | null;
  gaUsersCurrent: number | null;
  gaUsersPrevious: number | null;
  searchFoundPage1: boolean | null;
  searchPosition: number | null;
  lastTestedDate: string | null;
  commentary: string | null;
  subjectOverride: string | null;
  draftReady: boolean;
  approvedToSend: boolean;
  sentAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  deliveryStatus: DeliveryStatus;
  renderedHtmlAttachment: { url: string; filename: string } | null;
  /** Read out of the Resend response and stored in a hidden field; needed for webhook reconciliation. */
  resendMessageId: string | null;
  /** The 12 operator-checklist checkboxes, keyed by their Airtable column name (ALL_CHECKLIST_FIELDS);
   *  missing/false cells read false. Maintenance/Testing reports gate approve+send on the relevant
   *  subset (see src/reports/checklist.ts). */
  checklist: Record<string, boolean>;
  /** Snapshot of the auto-tick evidence at draft time, keyed by checklist field → evidence
   *  record. Null when the report predates auto-tick or carried no auto-checked items. This is the
   *  health gate's source of truth: `isHealthGateClear`/`gatingHealth` (src/reports/checklist.ts)
   *  read these evidence records, NOT the checklist booleans — and also drive the dashboard badges. */
  autoEvidence: Record<string, EvidenceRecord> | null;
  /** Logged send-anyway override (Phase 10). When `sendOverride` is true AND `overrideReason` is
   *  non-empty, the health gate is bypassed for THIS report; `overrideBy`/`overrideAt` are the
   *  audit trail (parallel to approvedBy/approvedAt). Missing cells read false/null. */
  sendOverride: boolean;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
};

/**
 * The "Ready for your yes" gate: Draft ready ∧ ¬Approved to send ∧ Sent at BLANK.
 * The single source of truth for "pending the operator's approval" — `listPendingApproval`,
 * `runDigest`'s ready-list, the per-site dashboard, and the fleet cockpit all key off this
 * one predicate so the surfaces can't drift.
 */
export function isPendingApproval(r: ReportRow): boolean {
  return r.draftReady && !r.approvedToSend && r.sentAt === null;
}

/**
 * Parse the `Checklist auto-evidence` JSON field → a field→EvidenceRecord map, or null when
 * absent/malformed. Permissive on inner shape (it's display-only — a bad blob just yields null,
 * never throws), mirroring `parseNotifyRouting`.
 */
export function parseAutoEvidence(raw: unknown): Record<string, EvidenceRecord> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  // Validate each entry's inner shape (it drives display) — drop any record whose `result` isn't
  // one of the four literals, and coerce `note`/`checkedAt` to safe types. A garbage blob yields
  // null rather than a record that would render "auto: undefined" on the dashboard.
  const out: Record<string, EvidenceRecord> = {};
  for (const [field, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (o.result !== "pass" && o.result !== "fail" && o.result !== "unknown" && o.result !== "n/a")
      continue;
    out[field] = {
      result: o.result,
      checkedAt: typeof o.checkedAt === "string" ? o.checkedAt : null,
      note: typeof o.note === "string" ? o.note : "",
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}
