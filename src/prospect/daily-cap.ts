/**
 * The prospect-audit runaway brake — the numbers and the arithmetic, in one
 * place both callers reach.
 *
 * It lived inside `src/dashboard/prospect-audit-trigger.ts`, which meant it
 * guarded the dashboard dispatch path and nothing else, while every batch to
 * date — including the 29-site corpus — went through `prospect-audit` on the
 * CLI, which had no cap at all (MED-15 of the 2026-09-02 review).
 *
 * That is the same shape #618 already fixed once in this feature, and said so
 * in `src/cli/commands/prospect-audit.ts` while fixing it: *"The sole private-
 * address guard was in `triggerProspectAudit` — one layer at the far end of the
 * chain — so anyone running the CLI directly, or any future second caller, had
 * none."* Identical sentence, different guard.
 *
 * Dependency-free on purpose: the CLI's command modules are lazily loaded and
 * must not drag the GitHub/dispatch layer in behind a constant, and the count
 * needs nothing from a row but its timestamp.
 */

/** Anything with a creation timestamp — `ProspectAuditListItem` satisfies it.
 *  Structural so this module needs no import from `src/db`. */
export type DatedAudit = { created_at: string };

/** Most audits that may be STARTED in any rolling 24 hours (#612 review).
 *
 *  The duplicate window stops the SAME url being re-run; nothing stopped
 *  DISTINCT urls. One authenticated session could dispatch ~30/minute against
 *  30 hostnames indefinitely, and one audit is structurally an Opus call plus
 *  up to 28 Sonnet calls with up to 112 billed web searches, a 20-page double
 *  crawl, a 3-pass Lighthouse and a PDF render, inside a billed Actions job.
 *
 *  25/day is far above real use (this is one operator clicking a button) and far
 *  below a number that could quietly cost hundreds. A cap that never binds in
 *  normal operation is the point: it is a runaway brake, not a quota. */
export const PROSPECT_AUDIT_DAILY_CAP = 25;

/** Lookback for the daily cap. Must exceed the cap so the count can actually
 *  reach it — a lookback at or below the cap would make the limit unreachable
 *  and the brake permanently disengaged, which is exactly the kind of guard
 *  that reads as working while doing nothing. */
export const DAILY_CAP_LOOKBACK = PROSPECT_AUDIT_DAILY_CAP * 2;

/** The rolling window itself. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of `recent` were created in the 24 hours before `now`.
 *
 *  `recent` is expected to be the newest `DAILY_CAP_LOOKBACK` audits; the
 *  caller does the fetching so this stays pure and testable from either side. */
export function countAuditsInDailyWindow(recent: readonly DatedAudit[], now: Date): number {
  const dayAgo = now.getTime() - DAY_MS;
  return recent.filter((r) => Date.parse(r.created_at) >= dayAgo).length;
}

/** Whether that count trips the brake. */
export function isOverDailyCap(count: number): boolean {
  return count >= PROSPECT_AUDIT_DAILY_CAP;
}

/** The refusal, worded once so the dashboard's 429 body and the CLI's stderr
 *  say the same thing. Carries both numbers: a bare "refused" leaves the
 *  operator guessing whether they hit a limit or broke something. */
export function dailyCapMessage(count: number, cap: number = PROSPECT_AUDIT_DAILY_CAP): string {
  return `${count} audits have run in the last 24 hours (cap ${cap}). This is a runaway brake — if the run is genuinely needed, raise PROSPECT_AUDIT_DAILY_CAP.`;
}
