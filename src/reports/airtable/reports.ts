import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";
import type { ReportType, LighthouseScores } from "../types.js";
import { ALL_CHECKLIST_FIELDS } from "../checklist.js";

export const REPORTS_TABLE = "Reports";

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

function mapRow(rec: { id: string; fields: Record<string, unknown> }): ReportRow {
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
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Escape a string for safe interpolation into an Airtable filterByFormula.
 * Airtable formulas use SQL-like string literals; we escape backslash and
 * double quote. Used wherever an externally-supplied string flows into a
 * formula (e.g. Resend message ids on the webhook path).
 */
export function escapeFormulaString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function createDraft(base: AirtableBase, input: DraftInput): Promise<ReportRow> {
  // Set Delivery status to "pending" at creation time, NOT at send time. This
  // matters for H4: if stampSent wrote "pending" after the webhook had already
  // written "delivered" (race), the operator would see a regressed status.
  const fields: FieldSet = {
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
  // GA fields are written only when supplied (GA configured + fetch succeeded). When
  // omitted the row keeps them blank for manual entry — the pre-GA behavior.
  if (input.gaUsersCurrent !== undefined) fields["GA users (period)"] = input.gaUsersCurrent;
  if (input.gaUsersPrevious !== undefined) fields["GA users (prev period)"] = input.gaUsersPrevious;
  if (input.searchFoundPage1 !== undefined) fields["Search found page 1"] = input.searchFoundPage1;
  if (input.searchPosition !== undefined) fields["Search position"] = input.searchPosition;
  if (input.period !== undefined) fields["Period"] = input.period;
  if (input.subjectOverride !== undefined) fields["Subject override"] = input.subjectOverride;
  const created = (await base(REPORTS_TABLE).create([{ fields }])) as Records<FieldSet>;
  const rec = created[0];
  if (!rec) throw new Error("Airtable create returned no records");
  return mapRow({ id: rec.id, fields: rec.fields });
}

export async function setDraftReady(
  base: AirtableBase,
  recordId: string,
  ready: boolean,
): Promise<void> {
  await base(REPORTS_TABLE).update([{ id: recordId, fields: { "Draft ready": ready } }]);
}

/**
 * Overwrite the four `Lighthouse — *` score cells (and, when supplied, `Completed
 * on`) on an EXISTING Reports row. The launch re-run path uses this: it reuses the
 * already-created Launch row but must refresh its scores to match the freshly-run
 * audit — otherwise the re-rendered preview shows new scores while the row (and the
 * eventually-sent email, which reads the row) keeps the stale ones. The create path
 * already writes fresh scores via `createDraft`; this is its update-side mirror, using
 * the same exact field names so the two stay in lockstep.
 */
export async function updateReportScores(
  base: AirtableBase,
  recordId: string,
  scores: LighthouseScores,
  completedOn?: Date,
): Promise<void> {
  const fields: FieldSet = {
    "Lighthouse — Performance": scores.performance,
    "Lighthouse — Accessibility": scores.accessibility,
    "Lighthouse — Best Practices": scores.bestPractices,
    "Lighthouse — SEO": scores.seo,
  };
  if (completedOn) fields["Completed on"] = ymd(completedOn);
  await base(REPORTS_TABLE).update([{ id: recordId, fields }]);
}

export async function listSendableReports(base: AirtableBase): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  await base(REPORTS_TABLE)
    .select({
      filterByFormula:
        "AND({Draft ready} = TRUE(), {Approved to send} = TRUE(), {Sent at} = BLANK())",
      pageSize: 100,
    })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return out;
}

/**
 * Fetch every Reports row, unfiltered. Site-scoped callers filter the result in
 * memory: the `Site` linked-record field CANNOT be formula-filtered by record id
 * (see findReportByPeriod's doc for why), and the fleet's Reports table is small
 * enough that one paged fetch-all beats N broken-or-per-site queries.
 */
export async function listAllReports(base: AirtableBase): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  await base(REPORTS_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return out;
}

export async function listReportsForSite(base: AirtableBase, siteId: string): Promise<ReportRow[]> {
  // Client-side match on the mapped siteId (mapRow reads the record id from the
  // REST response, where it IS present) — record ids can't appear in formulas.
  return (await listAllReports(base)).filter((r) => r.siteId === siteId);
}

/**
 * Mark a row as sent: write `Sent at` and (when known) `Resend message ID`.
 * Crucially does NOT touch `Delivery status` — that's set to "pending" in
 * createDraft and updated by the webhook from there. If we wrote "pending" here
 * we could clobber a "delivered" that the webhook raced ahead and wrote first (H4).
 *
 * `messageId` may be `null`: the 409 idempotency-conflict path has no recoverable
 * id (the original send's id was lost when the prior run's stamp failed), so it
 * passes null and we write ONLY `Sent at`. Writing a sentinel string like
 * "idempotent-conflict" into the id column would masquerade as a real Resend id
 * and silently orphan `findReportByMessageId` lookups; leaving it null is honest —
 * the row still stops replaying (Sent at is set), delivery tracking for that one
 * report is simply degraded (the id is genuinely unknowable on that path).
 */
export async function stampSent(
  base: AirtableBase,
  recordId: string,
  sentAt: Date,
  messageId: string | null,
): Promise<void> {
  const fields: Record<string, string> = { "Sent at": sentAt.toISOString() };
  if (messageId !== null) fields["Resend message ID"] = messageId;
  await base(REPORTS_TABLE).update([
    {
      id: recordId,
      fields,
    },
  ]);
}

export async function setDeliveryStatus(
  base: AirtableBase,
  recordId: string,
  status: DeliveryStatus,
): Promise<void> {
  await base(REPORTS_TABLE).update([{ id: recordId, fields: { "Delivery status": status } }]);
}

/**
 * Stamp the approval on a Reports row: flips `Approved to send` TRUE and records
 * who/when for the audit trail. The caller (approveReport handler) is responsible
 * for idempotency — this is the raw write. Never touches `Sent at`.
 */
export async function approveReportRow(
  base: AirtableBase,
  recordId: string,
  approvedAt: Date,
  approvedBy: string,
): Promise<void> {
  await base(REPORTS_TABLE).update([
    {
      id: recordId,
      fields: {
        "Approved to send": true,
        "Approved At": approvedAt.toISOString(),
        "Approved By": approvedBy,
      },
    },
  ]);
}

/**
 * True when an `.find` rejection is a GENUINE not-found, not a transient failure.
 * The Airtable SDK stamps `.statusCode` (404) and/or `.error` ("NOT_FOUND") on
 * its errors. Anything else (429 rate-limit, 500 outage, bad-PAT 401, network
 * error) must NOT be masked as a 404 — see getReportById.
 */
function isNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { statusCode?: unknown; error?: unknown; name?: unknown; message?: unknown };
  if (e.statusCode === 404) return true;
  const tag = String(e.error ?? e.name ?? e.message ?? "");
  return tag === "NOT_FOUND" || /not found/i.test(tag);
}

/**
 * Fetch one Reports row by its Airtable record id, or null if it doesn't exist.
 * Only a GENUINE not-found (404 / NOT_FOUND) collapses to null; every other
 * failure (outage, 429, bad PAT, network error) is rethrown so the adapter
 * surfaces a 500 instead of a misleading 404. Swallowing all throws previously
 * turned an Airtable outage into a "no such report".
 */
export async function getReportById(
  base: AirtableBase,
  recordId: string,
): Promise<ReportRow | null> {
  try {
    const rec = await base(REPORTS_TABLE).find(recordId);
    return mapRow({ id: rec.id, fields: rec.fields as Record<string, unknown> });
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export async function findReportByMessageId(
  base: AirtableBase,
  messageId: string,
): Promise<ReportRow | null> {
  const rows: ReportRow[] = [];
  await base(REPORTS_TABLE)
    .select({
      filterByFormula: `{Resend message ID} = "${escapeFormulaString(messageId)}"`,
      maxRecords: 1,
    })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return rows[0] ?? null;
}

/**
 * Find the Reports row for a `(site, reportType, period)` triple, or null. The
 * idempotency lookup behind search-before-create drafting.
 *
 * The site is matched CLIENT-side, never in the formula: Airtable's formula layer
 * renders linked-record fields ({Site}) as the linked rows' PRIMARY-FIELD NAMES,
 * not record ids, so any formula comparing {Site} or ARRAYJOIN({Site}) against a
 * `recXXX` id matches NOTHING (live-proven against the real base — do not
 * reintroduce that idiom). Record ids exist only in the REST response, where
 * mapRow reads them. So the formula filters on the real scalar fields (Report
 * type + Period — escaped, keeping it injection-safe if their source ever
 * changes), and the first mapped row whose siteId matches wins. The candidate
 * set is at most one row per site for the (type, period), so this stays small.
 */
export async function findReportByPeriod(
  base: AirtableBase,
  siteId: string,
  reportType: ReportType,
  period: string,
): Promise<ReportRow | null> {
  const safeType = escapeFormulaString(reportType);
  const safePeriod = escapeFormulaString(period);
  const formula = `AND({Report type} = "${safeType}", {Period} = "${safePeriod}")`;
  const rows: ReportRow[] = [];
  await base(REPORTS_TABLE)
    .select({ filterByFormula: formula, pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return rows.find((r) => r.siteId === siteId) ?? null;
}
