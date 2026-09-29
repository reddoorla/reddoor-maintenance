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
 * must not drag the GitHub/dispatch layer in behind a constant.
 *
 * #907: the count itself no longer lives here. It used to be a pure filter over
 * rows the caller had fetched — and those rows only existed after a run had
 * spent its money, so N concurrent starts all read the same count and all
 * proceeded. The cap is now a reservation: one conditional INSERT in
 * `reserveProspectAudit` (src/db/prospect-audits.ts) that counts and writes a
 * `running` row in a single statement. This module keeps the numbers that
 * statement is built from, and the wording both callers refuse with.
 */

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

/** The rolling window the cap counts over. */
export const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How long a `running` row counts against the cap before it is taken to be a
 * run that crashed without finishing (#907).
 *
 * Derived from the one hard bound a production run has: the private runner's
 * "Run the audit and email the sheet" step is `timeout-minutes: 30`
 * (docs/private-runner/prospect-audit.yml), which kills a wedged Chrome and
 * the CLI with it. The pipeline itself has no overall deadline — only
 * per-call ones (`ANALYZE_TIMEOUT_MS` 10 min and `PROBE_TIMEOUT_MS` 4 min in
 * src/prospect/claude-code.ts), which is why the step backstop exists.
 *
 * The clock starts at the CLAIM, when the process that spends took the row
 * (`claimed_at`), and at creation only for a row nobody has claimed yet.
 * Judged from creation alone, a cockpit row dispatched long ago and picked up
 * recently would stop counting while its run was still spending (review of
 * #907, probe P3). An unclaimed cockpit reservation's clock covers queueing,
 * the job's setup (checkout, `pnpm install`, build, a Playwright install) and —
 * because the workflow's concurrency group is per-URL with
 * `cancel-in-progress: false` — waiting behind at most one earlier run of the
 * same URL: roughly 30 + setup + setup, about 40 minutes, before the claim
 * restarts it for the run's own 30. Two hours covers either with margin.
 *
 * Getting this wrong in either direction is bounded. Too short: a slow but
 * live run stops counting until it finishes, when its row counts again. Too
 * long: a crashed run holds its slot a while longer. Neither can make the
 * brake looser than it was before #907, when a running audit counted for
 * nothing at all.
 */
export const PROSPECT_AUDIT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** The two lower bounds the cap's count is taken over, as the ISO-8601 strings
 *  the timestamps are stored as (fixed-width UTC, so they compare as strings):
 *  a row counts when it was created at or after `windowStart` AND is either
 *  finished or was claimed (or, unclaimed, created) at or after `staleBefore`. */
export function capBounds(now: Date): { windowStart: string; staleBefore: string } {
  return {
    windowStart: new Date(now.getTime() - DAILY_CAP_WINDOW_MS).toISOString(),
    staleBefore: new Date(now.getTime() - PROSPECT_AUDIT_STALE_AFTER_MS).toISOString(),
  };
}

/** Whether a `running` row has outlived the stale window — for display. The
 *  count applies the same rule in SQL (`COALESCE(claimed_at, created_at)`),
 *  from `capBounds`. */
export function isStaleRunning(
  row: { status: string; created_at: string; claimed_at?: string | null },
  now: Date,
): boolean {
  return (
    row.status === "running" && (row.claimed_at ?? row.created_at) < capBounds(now).staleBefore
  );
}

/** The refusal, worded once so the dashboard's 429 body and the CLI's stderr
 *  say the same thing. Carries both numbers: a bare "refused" leaves the
 *  operator guessing whether they hit a limit or broke something. */
export function dailyCapMessage(count: number, cap: number = PROSPECT_AUDIT_DAILY_CAP): string {
  return `${count} audits have been started in the last 24 hours (cap ${cap}). This is a runaway brake — if the run is genuinely needed, raise PROSPECT_AUDIT_DAILY_CAP.`;
}
