/**
 * The operator inbox for INTERNAL fleet mail — the daily digest, the fleet
 * analytics-failure alert, selftest sends, and the pre-launch lead guard.
 *
 * Deliberately the monitored personal inbox, never `info@reddoorla.com`: that
 * alias is the client-facing shared inbox other staff read and reply to clients
 * from. Internal mail landing there is both noise for them and a silent miss for
 * the operator.
 *
 * This exists because the fallback used to be spelled out at each call site, and
 * they disagreed: the lead guard already used the personal inbox while the
 * digest, the analytics alert, and selftest all used `info@`. On 2026-08-17 the
 * scheduled daily-reports run failed before its digest step, a recovery run of
 * `report --digest` went out from a laptop where OPERATOR_EMAIL was unset, and
 * the fleet digest landed in the client inbox — where a colleague found it and
 * forwarded it on. `OPERATOR_EMAIL` was set as a GitHub Actions repo variable
 * and nowhere else, so CI was correct and every local run was not.
 *
 * One definition, so a missing env var degrades to a watched inbox everywhere.
 */
export const OPERATOR_FALLBACK = "tucker@reddoorla.com";

/** `OPERATOR_EMAIL` when set and non-blank, else {@link OPERATOR_FALLBACK}.
 *  Read at CALL time, not module load, so a process that sets the variable late
 *  (and the tests) see the current value. */
export function operatorEmail(): string {
  return process.env.OPERATOR_EMAIL?.trim() || OPERATOR_FALLBACK;
}
