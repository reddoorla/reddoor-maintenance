import type { WebsiteRow } from "../fleet/site-row.js";
import { autoTickChecklist } from "./auto-tick.js";
import { TESTING_CHECKLIST } from "./checklist.js";

/**
 * The Testing checklist fields the nightly automated tests passed, as of `now` (2026-11-25: a
 * Maintenance report adds these rows to its MAINTENANCE CHECKS list, in place of the blurred
 * testing upsell). It reads the site row's latest nightly results through the same evidence
 * rules a Testing report ticks by (`autoTickChecklist`), so a row counts only on a `pass` no
 * more than 3 days old at `now`, and never on a timestamp later than `now`.
 *
 * It is computed when the email is built, never stored: a report is drafted up to a week
 * before it is sent, and evidence saved at draft would be stale (or, filtered for age, gone)
 * by the send. Every render path passes its own `now`: the send its send time. PURE.
 */
export function passedAutomatedTests(site: WebsiteRow, now: Date): string[] {
  const evidence = autoTickChecklist(site, "Testing", now, {
    search: { value: null, softFailed: false, notConfigured: false },
  });
  return TESTING_CHECKLIST.map((i) => i.field).filter((field) => {
    const record = evidence.get(field);
    if (record?.result !== "pass" || !record.checkedAt) return false;
    const at = new Date(record.checkedAt).getTime();
    return !Number.isNaN(at) && at <= now.getTime();
  });
}
