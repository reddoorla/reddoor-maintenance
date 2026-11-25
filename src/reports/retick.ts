import type { WebsiteRow } from "../fleet/site-row.js";
import type { ReportRow } from "./report-fields.js";
import { autoTickChecklist, type AutoTickSignals, type EvidenceRecord } from "./auto-tick.js";

const GOOGLE_INDEXED = "Maint: Google Indexed";

/** The two search columns a re-measured Google Indexed record carries, in the
 *  shape a fresh draft writes them: no property matched means both NULL, and a
 *  position only when found on page 1. */
export type SearchColumns = { searchFoundPage1: boolean | null; searchPosition: number | null };

export type RetickOutcome =
  | {
      status: "reticked";
      changed: string[];
      ticked: string[];
      checklist: Record<string, boolean>;
      autoEvidence: Record<string, EvidenceRecord>;
      /** Set only when Google Indexed was replaced by a query that ran. */
      search: SearchColumns | null;
    }
  | { status: "unchanged" }
  | { status: "locked" };

function sameRecord(a: EvidenceRecord | undefined, b: EvidenceRecord): boolean {
  return (
    a !== undefined && a.result === b.result && a.checkedAt === b.checkedAt && a.note === b.note
  );
}

function isVerdict(r: EvidenceRecord | undefined): boolean {
  return r?.result === "pass" || r?.result === "fail";
}

function searchColumns(value: NonNullable<AutoTickSignals["search"]["value"]>): SearchColumns {
  if (value.propertyFound === false) return { searchFoundPage1: null, searchPosition: null };
  return {
    searchFoundPage1: value.foundOnPage1,
    searchPosition: value.foundOnPage1 ? value.position : null,
  };
}

/**
 * Re-derive an unsent, unapproved report's evidence from the site's current health.
 *
 * Google Indexed is an inline Search Console signal, so without `search` it is kept
 * exactly as drafted (#929). With `search` (the refresh ran the draft's own
 * `fetchSearch`), a measured result replaces it, but an `unknown` never replaces a
 * stored pass or fail: a soft-fail or an unwired environment is not evidence that
 * the earlier verdict was wrong.
 */
export function retickEvidence(
  site: WebsiteRow,
  report: ReportRow,
  now: Date,
  search?: AutoTickSignals["search"],
): RetickOutcome {
  if (report.sentAt !== null || report.approvedToSend) return { status: "locked" };

  const stored = report.autoEvidence ?? {};
  const fresh = autoTickChecklist(site, report.reportType, now, {
    search: search ?? { value: null, softFailed: false, notConfigured: false },
  });

  const autoEvidence: Record<string, EvidenceRecord> = { ...stored };
  const changed: string[] = [];
  let columns: SearchColumns | null = null;
  for (const [field, record] of fresh) {
    if (field === GOOGLE_INDEXED) {
      if (!search) continue;
      if (record.result === "unknown" && isVerdict(stored[field])) continue;
    }
    if (sameRecord(stored[field], record)) continue;
    autoEvidence[field] = record;
    changed.push(field);
    if (field === GOOGLE_INDEXED && search?.value) columns = searchColumns(search.value);
  }

  const checklist: Record<string, boolean> = { ...report.checklist };
  const ticked: string[] = [];
  for (const field of changed) {
    if (autoEvidence[field]!.result === "pass" && checklist[field] !== true) {
      checklist[field] = true;
      ticked.push(field);
    }
  }

  if (changed.length === 0) return { status: "unchanged" };
  return { status: "reticked", changed, ticked, checklist, autoEvidence, search: columns };
}
