/**
 * Creating a report, Turso-native (#539 Phase 6 step 4, #646; operator decision
 * 2026-09-17). Turso mints `report_<ULID>` here and owns the row, exactly as
 * `ensure-site` does for sites.
 */
import { draftFields, type DraftInput } from "./draft-fields.js";
import { mintReportId } from "../fleet/report-id.js";
import type { ReportRow } from "./report-row.js";
import type { ReportType } from "./types.js";

/** The one Turso operation creating a report needs: insert the row and hand back
 *  what was STORED. Implemented by the report writer (`makeReportMirror().create`),
 *  which owns the db handle and its error semantics. Reading the row back
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
  return deps.create({ id, fields: draftFields(input) });
}

/**
 * The `(site, type, period)` idempotency lookup behind search-before-create
 * drafting — the re-run dedupe the `launch` and `announce` recipes make before
 * they draft. The site scope IS the query (`forSite`, served by
 * idx_reports_site) and the triple is matched in memory over one site's handful
 * of reports. A withdrawn row (P1-28) is never reused: it can never send, so a
 * re-run drafts a fresh row instead.
 */
export async function findReportForPeriod(
  store: { forSite: (siteId: string) => Promise<ReportRow[]> },
  siteId: string,
  reportType: ReportType,
  period: string,
): Promise<ReportRow | null> {
  const rows = await store.forSite(siteId);
  return (
    rows.find(
      (r) => r.reportType === reportType && r.period === period && r.withdrawnAt === null,
    ) ?? null
  );
}
