import type { ReportType } from "./types.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { SearchPresence } from "./search/client.js";
import { checklistFor } from "./checklist.js";

/** A single auto-check outcome. `pass` + fresh ⇒ the caller ticks the box. */
export type EvidenceResult = "pass" | "fail" | "unknown";
export type EvidenceRecord = { result: EvidenceResult; checkedAt: string | null; note: string };

/**
 * Inline signals fetched during the draft. Phase 1 carries Search Console only; Phase 2/3 read
 * the remaining signals (security, domain, browser) off the Websites row passed as `site`.
 */
export type AutoTickSignals = {
  search: { value: SearchPresence | null; softFailed: boolean };
};

/**
 * Decide, per checklist item for this report type, an evidence record — ONLY for items that
 * currently have a signal. Items with no signal are omitted, so the caller leaves them manual.
 * PURE. The fail-safe invariant lives here: a box is only tickable when `result === "pass"`.
 * Google Indexed is an inline signal (fetched at draft), so its evidence is inherently fresh
 * (`checkedAt = now`).
 */
export function autoTickChecklist(
  site: WebsiteRow,
  reportType: ReportType,
  now: Date,
  signals: AutoTickSignals,
): Map<string, EvidenceRecord> {
  const out = new Map<string, EvidenceRecord>();
  const fields = new Set(checklistFor(reportType).map((i) => i.field));

  // Google Indexed — Search Console (inline, always fresh).
  if (fields.has("Maint: Google Indexed")) {
    const g = googleEvidence(now, signals.search);
    if (g) out.set("Maint: Google Indexed", g);
  }

  return out;
}

/** Search Console → Google Indexed evidence. `null` (not configured) emits nothing so the box
 *  stays manual; a soft-fail is `unknown`; page-1 is `pass` (with the position in the note). */
function googleEvidence(now: Date, search: AutoTickSignals["search"]): EvidenceRecord | null {
  const at = now.toISOString();
  if (search.softFailed) {
    return { result: "unknown", checkedAt: at, note: "Search Console unavailable this run" };
  }
  if (search.value === null) return null;
  if (search.value.foundOnPage1) {
    const pos = search.value.position;
    return {
      result: "pass",
      checkedAt: at,
      note: `Page 1 on Google${pos !== null ? ` (#${pos})` : ""}`,
    };
  }
  const pos = search.value.position;
  return {
    result: "fail",
    checkedAt: at,
    note: `Not on page 1${pos !== null ? ` (avg #${pos})` : ""}`,
  };
}
