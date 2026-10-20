import type { SubmissionRow } from "../reports/submission-row.js";

/**
 * Display rules for a submission that every renderer of one shares: the
 * Netlify functions' string renderer and the SvelteKit cockpit (#582). Kept out
 * of the renderer module so the cockpit never imports a renderer.
 */

/** A submission belongs in the per-site strip unless it was auto-filtered as spam
 *  (status "spam_auto"): auto-spam is reviewed only on /submissions, so it never
 *  crowds the real-lead window. PURE. */
export function isVisibleInStrip(s: SubmissionRow): boolean {
  return s.status !== "spam_auto";
}

/** The fan-out tokens that did NOT succeed (see ingest.ts for the grammar: one
 *  `<destination>:<outcome>` token per attempt, `ok` being the only good outcome).
 *  A failure here means the signup never reached that destination — the row itself
 *  still looks perfectly healthy, which is exactly why it needs surfacing. PURE. */
export function fanoutFailures(fanoutStatus: string | null | undefined): string[] {
  return (fanoutStatus ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "" && !t.endsWith(":ok"));
}
