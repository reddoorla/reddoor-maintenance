import type { LighthouseScores } from "../types.js";
import { ALL_CHECKLIST_FIELDS } from "../checklist.js";
import {
  toReportType,
  parseAutoEvidence,
  type DeliveryStatus,
  type ReportRow,
} from "../report-row.js";

// The report-row model and its pure coercers live in src/reports/report-row.ts
// since #539 Phase 6 step 1 (#646). Re-exported so existing imports resolve unchanged.
export {
  toReportType,
  isPendingApproval,
  parseAutoEvidence,
  type DeliveryStatus,
  type ReportRow,
} from "../report-row.js";

export const REPORTS_TABLE = "Reports";

export function mapRow(rec: { id: string; fields: Record<string, unknown> }): ReportRow {
  const f = rec.fields;
  const linkSites = (f["Site"] as string[] | undefined) ?? [];
  const html =
    ((f["Rendered HTML"] as Array<{ url: string; filename: string }> | undefined) ?? [])[0] ?? null;
  return {
    id: rec.id,
    reportId: String(f["Report ID"] ?? ""),
    siteId: linkSites[0] ?? "",
    reportType: toReportType(f["Report type"] as string | undefined),
    period: (f["Period"] as string | undefined) ?? null,
    periodStart: (f["Period start"] as string | undefined) ?? null,
    periodEnd: (f["Period end"] as string | undefined) ?? null,
    completedOn: (f["Completed on"] as string | undefined) ?? null,
    lighthouse: lighthouseFromFields(f),
    gaUsersCurrent: (f["GA users (period)"] as number | undefined) ?? null,
    gaUsersPrevious: (f["GA users (prev period)"] as number | undefined) ?? null,
    searchFoundPage1:
      typeof f["Search found page 1"] === "boolean" ? (f["Search found page 1"] as boolean) : null,
    searchPosition: (f["Search position"] as number | undefined) ?? null,
    lastTestedDate: (f["Last tested date"] as string | undefined) ?? null,
    commentary: (f["Commentary"] as string | undefined) ?? null,
    subjectOverride: (f["Subject override"] as string | undefined) ?? null,
    draftReady: Boolean(f["Draft ready"]),
    approvedToSend: Boolean(f["Approved to send"]),
    sentAt: (f["Sent at"] as string | undefined) ?? null,
    approvedAt: (f["Approved At"] as string | undefined) ?? null,
    approvedBy: (f["Approved By"] as string | undefined) ?? null,
    deliveryStatus: ((f["Delivery status"] as string | undefined) ?? "pending") as DeliveryStatus,
    renderedHtmlAttachment: html,
    resendMessageId: (f["Resend message ID"] as string | undefined) ?? null,
    checklist: Object.fromEntries(ALL_CHECKLIST_FIELDS.map((name) => [name, Boolean(f[name])])),
    autoEvidence: parseAutoEvidence(f["Checklist auto-evidence"]),
    sendOverride: Boolean(f["Send override"]),
    overrideReason: (f["Override reason"] as string | undefined) ?? null,
    overrideBy: (f["Override by"] as string | undefined) ?? null,
    overrideAt: (f["Override at"] as string | undefined) ?? null,
  };
}

function lighthouseFromFields(f: Record<string, unknown>): LighthouseScores | null {
  const p = f["Lighthouse — Performance"];
  const a = f["Lighthouse — Accessibility"];
  const b = f["Lighthouse — Best Practices"];
  const s = f["Lighthouse — SEO"];
  if (
    typeof p !== "number" ||
    typeof a !== "number" ||
    typeof b !== "number" ||
    typeof s !== "number"
  )
    return null;
  return { performance: p, accessibility: a, bestPractices: b, seo: s };
}

/** The GA + Search-presence fields a draft can carry, written to the Reports row.
 *  `searchFoundPage1` is written whenever the check ran (true or false — false is the
 *  operator-only negative signal); `searchPosition` only when found on page 1. Shared by
 *  the create path (DraftInput) and the reuse path (updateReportScores). */
export type ReportEnrichment = {
  gaUsersCurrent?: number;
  gaUsersPrevious?: number;
  searchFoundPage1?: boolean;
  searchPosition?: number;
};

// The draft's field set and its `DraftInput` moved to src/reports/draft-fields.ts
// in #646 step 4: Turso creates reports now, and the creator must outlive this
// directory. Re-exported so existing imports resolve unchanged.
export { draftFields, ymd, type DraftInput } from "../draft-fields.js";
