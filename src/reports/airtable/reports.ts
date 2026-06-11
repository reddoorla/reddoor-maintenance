import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";
import type { ReportType, LighthouseScores } from "../types.js";

export const REPORTS_TABLE = "Reports";

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
  deliveryStatus: DeliveryStatus;
  renderedHtmlAttachment: { url: string; filename: string } | null;
  /** Read out of the Resend response and stored in a hidden field; needed for webhook reconciliation. */
  resendMessageId: string | null;
};

function mapRow(rec: { id: string; fields: Record<string, unknown> }): ReportRow {
  const f = rec.fields;
  const linkSites = (f["Site"] as string[] | undefined) ?? [];
  const html =
    ((f["Rendered HTML"] as Array<{ url: string; filename: string }> | undefined) ?? [])[0] ?? null;
  return {
    id: rec.id,
    reportId: String(f["Report ID"] ?? ""),
    siteId: linkSites[0] ?? "",
    reportType: ((f["Report type"] as string | undefined) ?? "Maintenance") as ReportType,
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
    deliveryStatus: ((f["Delivery status"] as string | undefined) ?? "pending") as DeliveryStatus,
    renderedHtmlAttachment: html,
    resendMessageId: (f["Resend message ID"] as string | undefined) ?? null,
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

export async function listReportsForSite(base: AirtableBase, siteId: string): Promise<ReportRow[]> {
  // Anchor with commas so a prefix collision (record id A is a substring of
  // record id B) can't pull in another site's reports. ARRAYJOIN({Site}, ",")
  // produces "rec1,rec2,rec3"; wrap both sides with sentinels for safety.
  const safeId = escapeFormulaString(siteId);
  const out: ReportRow[] = [];
  await base(REPORTS_TABLE)
    .select({
      filterByFormula: `FIND(",${safeId},", "," & ARRAYJOIN({Site}, ",") & ",") > 0`,
      pageSize: 100,
    })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return out;
}

/**
 * Mark a row as sent: write `Sent at` and `Resend message ID` only. Crucially
 * does NOT touch `Delivery status` — that's set to "pending" in createDraft
 * and updated by the webhook from there. If we wrote "pending" here we could
 * clobber a "delivered" that the webhook raced ahead and wrote first (H4).
 */
export async function stampSent(
  base: AirtableBase,
  recordId: string,
  sentAt: Date,
  messageId: string,
): Promise<void> {
  await base(REPORTS_TABLE).update([
    {
      id: recordId,
      fields: {
        "Sent at": sentAt.toISOString(),
        "Resend message ID": messageId,
      },
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
 * idempotency lookup behind search-before-create drafting. `Site` is a linked field,
 * so it's matched with the same comma-anchored ARRAYJOIN pattern as listReportsForSite
 * (a prefix collision on record ids can't pull another site's row). reportType and
 * period flow through escapeFormulaString — they're our own values today, but escaping
 * keeps the formula injection-safe if their source ever changes.
 */
export async function findReportByPeriod(
  base: AirtableBase,
  siteId: string,
  reportType: ReportType,
  period: string,
): Promise<ReportRow | null> {
  const safeSite = escapeFormulaString(siteId);
  const safeType = escapeFormulaString(reportType);
  const safePeriod = escapeFormulaString(period);
  const formula = `AND(FIND(",${safeSite},", "," & ARRAYJOIN({Site}, ",") & ",") > 0, {Report type} = "${safeType}", {Period} = "${safePeriod}")`;
  const rows: ReportRow[] = [];
  await base(REPORTS_TABLE)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return rows[0] ?? null;
}
