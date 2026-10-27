import type { ReportRow } from "../reports/report-fields.js";

/**
 * The confirm prompts the report actions show before they act, shared by the
 * Netlify functions' string renderer and the SvelteKit cockpit (#582).
 */

/** What "Don't send" does, said before it happens. A draft of a higher tier holds
 *  back a lower-tier draft of the same period (src/reports/queue.ts); withdrawing
 *  it lets the nightly run queue that one. */
export function withdrawConfirmText(r: ReportRow): string {
  const base = "Withdraw this draft? It will not be sent, and the next one drafts on schedule.";
  if (r.reportType === "Maintenance") return base;
  const held = r.reportType === "Testing" ? "Maintenance" : "Maintenance or Testing";
  return `${base} If it held back this period's ${held} draft, that one is queued on the next nightly run instead.`;
}

export const UNAPPROVE_CONFIRM_TEXT =
  "Unapprove this report? It goes back to pending and will not send until it is approved again.";
