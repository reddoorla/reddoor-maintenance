/**
 * Creating a report, Turso-native (#539 Phase 6 step 4, #646; operator decision
 * 2026-09-17).
 *
 * Until now Airtable MINTED the report id: `createDraft` posted to the Reports
 * table and whatever record id came back became `reports.id` in Turso. That is why
 * a `site_<ULID>` site could not receive a report at all — Airtable has no
 * Websites record for the `Site` link to point at, so `createDraft` refused the
 * site by name (#646 step 3). Turso mints `report_<ULID>` here instead and owns
 * the row, exactly as `ensure-site` does for sites.
 *
 * ## The Airtable shadow for a NEW report: none
 *
 * Airtable cannot be told what record id to use. A shadow record would therefore
 * carry an id that is NOT the report id, which every later write addresses — the
 * approve stamp, the queue flag, `Sent at`, the delivery status — so the shadow
 * would be unreachable from the moment it was written and would drift on its
 * first update. Every Airtable report writer now skips a non-`rec` id with the
 * same `AIRTABLE_SHADOW skipped=non-rec-id` line the site writers log, and a
 * minted report id is never a `rec` id, so the create skips too. This function
 * logs that skip rather than staying silent about it, the same way
 * `ensureSite` does for a new site.
 *
 * Pre-existing `rec…` reports are untouched: both shapes coexist permanently, and
 * a `rec` report's Airtable row still receives its shadow writes until step 6.
 */
import { draftFields, type DraftInput } from "./draft-fields.js";
import { mintReportId } from "../fleet/report-id.js";
import { skipsAirtableShadow } from "../fleet/site-id.js";
import type { ReportRow } from "./report-row.js";
import type { ReportType } from "./types.js";

/** The one Turso operation creating a report needs: insert the row and hand back
 *  what was STORED. Implemented by the report writer (`makeReportMirror().create`),
 *  which owns the db handle and the freeze's error semantics. Reading the row back
 *  rather than mapping the input is the same rule the create mirror already
 *  followed: the caller gets what the store holds, so a coercion can never
 *  diverge the returned row from the persisted one. */
export type ReportInserter = (rec: {
  id: string;
  fields: Record<string, unknown>;
}) => Promise<ReportRow>;

export type CreateReportDeps = {
  create: ReportInserter;
  /** Injectable for tests; defaults to {@link mintReportId}. */
  mintId?: () => string;
};

/** Mint a report id, write the row to Turso, and return the stored row. */
export async function createReportDraft(
  input: DraftInput,
  deps: CreateReportDeps,
): Promise<ReportRow> {
  const id = (deps.mintId ?? mintReportId)();
  const row = await deps.create({ id, fields: draftFields(input) });
  // Logged, not attempted — see "The Airtable shadow for a NEW report" above.
  skipsAirtableShadow("createReportDraft", id);
  return row;
}

/**
 * The `(site, type, period)` idempotency lookup behind search-before-create
 * drafting — the re-run dedupe the `launch` and `announce` recipes make before
 * they draft.
 *
 * It replaces the Airtable `findReportByPeriod`, whose whole design was a
 * workaround: Airtable's formula layer renders a linked-record field as the
 * linked rows' primary-field NAMES, so no formula could filter by site id and
 * the site had to be matched client-side after fetching every row of the
 * (type, period). Here the site scope IS the query (`forSite`, served by
 * idx_reports_site) and the triple is matched in memory over one site's handful
 * of reports.
 */
export async function findReportForPeriod(
  store: { forSite: (siteId: string) => Promise<ReportRow[]> },
  siteId: string,
  reportType: ReportType,
  period: string,
): Promise<ReportRow | null> {
  const rows = await store.forSite(siteId);
  return rows.find((r) => r.reportType === reportType && r.period === period) ?? null;
}
