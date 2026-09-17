/** The fields a new report row carries, as ONE pure function (#646 step 4).
 *
 *  This used to live inside `createDraft` in the Airtable layer, because Airtable
 *  was the primary write. Turso mints the report id and owns the row now, so the
 *  field set has two consumers: the Turso creator (`createReportDraft`, via the
 *  importer's `mapReportRecord`) and the legacy Airtable `createDraft`. It lives
 *  OUT of `src/reports/airtable/` so the creator survives step 6 deleting that
 *  directory.
 *
 *  The keys are Airtable COLUMN NAMES and stay that way on purpose: they are the
 *  vocabulary `mapReportRecord` reads, so a draft maps to a `reports` row through
 *  the very function the parity harness diffs against — parity-clean by
 *  construction rather than by a second column list someone has to remember to
 *  extend. The column names outlive the Airtable client either way (design D1 kept
 *  them as the import vocabulary; #646's own checklist notes that step 6 must
 *  replace those maps, and this does not add a new place that has to change).
 */
import type { ReportType, LighthouseScores } from "./types.js";
import type { EvidenceRecord } from "./auto-tick.js";

export type DraftInput = {
  reportId: string;
  siteId: string;
  reportType: ReportType;
  /** UTC `YYYY-MM` recurrence key. Omitted on legacy callers; written only when supplied. */
  period?: string;
  periodStart: Date;
  periodEnd: Date;
  completedOn: Date;
  lighthouse: LighthouseScores;
  lastTestedDate: Date | null;
  /** GA "Users" for the period / previous period. Omitted when GA is not configured
   *  for the site or the fetch failed — the operator fills the fields manually. */
  gaUsersCurrent?: number;
  gaUsersPrevious?: number;
  /** Search-presence result. `searchFoundPage1` is written whenever the check ran (true or
   *  false — false is the operator-only negative signal). `searchPosition` only when found. */
  searchFoundPage1?: boolean;
  searchPosition?: number;
  subjectOverride?: string;
  /** Checklist fields to tick at create time (the auto-tick "pass" set). */
  checklistTicks?: string[];
  /** Auto-tick evidence snapshot to persist (keyed by checklist field). */
  autoEvidence?: Record<string, EvidenceRecord>;
};

/** `YYYY-MM-DD`, the date shape every report date column stores. */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The full field set for a new report row.
 *
 * `Delivery status` is set to "pending" at CREATION time, not at send time. This
 * matters for H4: if the send's stamp wrote "pending" after the webhook had
 * already written "delivered" (a race), the operator would see a regressed status.
 *
 * Optional values are OMITTED rather than written as null — the pre-GA behaviour,
 * where a blank cell means "fill this in by hand" and a written null would claim
 * the value was measured as absent.
 */
export function draftFields(input: DraftInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    "Report ID": input.reportId,
    Site: [input.siteId],
    "Report type": input.reportType,
    "Period start": ymd(input.periodStart),
    "Period end": ymd(input.periodEnd),
    "Completed on": ymd(input.completedOn),
    "Lighthouse — Performance": input.lighthouse.performance,
    "Lighthouse — Accessibility": input.lighthouse.accessibility,
    "Lighthouse — Best Practices": input.lighthouse.bestPractices,
    "Lighthouse — SEO": input.lighthouse.seo,
    "Delivery status": "pending",
  };
  if (input.lastTestedDate) fields["Last tested date"] = ymd(input.lastTestedDate);
  if (input.gaUsersCurrent !== undefined) fields["GA users (period)"] = input.gaUsersCurrent;
  if (input.gaUsersPrevious !== undefined) fields["GA users (prev period)"] = input.gaUsersPrevious;
  if (input.searchFoundPage1 !== undefined) fields["Search found page 1"] = input.searchFoundPage1;
  if (input.searchPosition !== undefined) fields["Search position"] = input.searchPosition;
  if (input.period !== undefined) fields["Period"] = input.period;
  if (input.subjectOverride !== undefined) fields["Subject override"] = input.subjectOverride;
  // Auto-ticked checklist boxes + the evidence snapshot. The booleans are the same columns the
  // operator/dashboard toggle; the JSON is what the health gate reads (isHealthGateClear/gatingHealth)
  // and also drives the dashboard's green/amber badges.
  for (const field of input.checklistTicks ?? []) fields[field] = true;
  if (input.autoEvidence && Object.keys(input.autoEvidence).length > 0) {
    fields["Checklist auto-evidence"] = JSON.stringify(input.autoEvidence);
  }
  return fields;
}
