/** Anything not exactly generateToken()-shaped is a probe, not a report. */
export function isValidToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(s);
}

/** "complete" when every pipeline stage succeeded; "partial" when any stage
 *  failed or was deliberately skipped (StageResult's `ok: false` covers
 *  both — the pipeline doesn't distinguish them at this layer). The report
 *  itself already degrades each failed section to "not measured"; this is
 *  what lets a future dashboard tell complete from partial without
 *  deserializing the whole result_json. */
export type FinishedProspectAuditStatus = "complete" | "partial";

/** #907. `running` is a reservation: the row the daily cap counts, written
 *  before a run spends anything and finished in place when it ends. It has no
 *  report behind it yet — `result_json` holds a `{}` placeholder — so nothing
 *  that serves a report may serve it (see `getProspectAuditByToken`). A
 *  `running` row older than `PROSPECT_AUDIT_STALE_AFTER_MS` is a run that
 *  never finished; the cap stops counting it and the /audits list says so. */
export type ProspectAuditStatus = FinishedProspectAuditStatus | "running" | "failed";

/** P1-16. `failed` is a run that threw after a paid stage had started: the
 *  money is spent, so its slot stays held for the full 24h window
 *  (`failProspectAudit`), but there is no report behind it — `result_json`
 *  still holds the `{}` placeholder. Terminal: nothing finishes or claims it.
 *
 *  The statuses with no report behind them, which every reader that serves,
 *  links to or parses a report excludes. A deny-list, so a report carrying
 *  any other status, however old, is never hidden. */
export const NO_REPORT_STATUSES = [
  "running",
  "failed",
] as const satisfies readonly ProspectAuditStatus[];

/** Whether a row's status says there is no report behind its token. */
export function hasNoReport(status: string): boolean {
  return (NO_REPORT_STATUSES as readonly string[]).includes(status);
}
