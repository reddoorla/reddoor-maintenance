// src/alerts/waiting.ts
//
// The operator's rule (2026-10-05): "anything where the action is 'just wait'
// shouldn't be a watch item until it gets to a point where it actually requires my
// intervention." An item marked `waiting` is something a scheduled job is already
// fixing. It stays visible on the site's own `/s/<slug>` page as information, and it
// leaves the cockpit's Watch tier, the Needs-you feed and the digest's asks until
// its own schedule says the wait has failed.
import type { AttentionItem } from "./attention.js";
import type { DigestSnapshot } from "./digest-state.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The weekday Renovate's lock-file maintenance runs, in UTC (0 = Sunday). Read from
 *  `reddoorla/.github` `renovate-config.json`: `lockFileMaintenance.schedule` is
 *  "before 6pm on monday" with `timezone: "Etc/UTC"`. Change it when that does. */
export const LOCKFILE_WINDOW_WEEKDAY_UTC = 1;

/** The hour (UTC) that window closes: "before 6pm". */
export const LOCKFILE_WINDOW_CLOSES_HOUR_UTC = 18;

/** Days after the window closes before a vuln still present counts as a failed wait.
 *  The lock-file PR has to pass CI and then be merged by Renovate's own next run
 *  (`platformAutomerge: false`), and the nightly security audit has to re-measure the
 *  merged tree before the counts can drop. Two nights covers both with one to spare. */
export const LOCKFILE_SETTLE_DAYS = 2;

/** Days a direct (non-transitive) vuln may wait on Renovate before it counts as a failed
 *  wait even though the auto-fix counter has not reached exhaustion. The counter only
 *  moves on a real dispatch: a held Renovate PR or a dispatch that errors leaves it
 *  unchanged, so without a clock a stuck episode could wait forever. A week is three
 *  nightly cycles plus a held PR's full Monday schedule. */
export const DIRECT_VULN_WAIT_DAYS = 7;

function dayStartMs(day: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
}

/** The close of the first lock-file window that opens after the day a vuln was first
 *  flagged. A window already open on that day does not count: the vuln may have been
 *  measured after its PR merged. Null when the day does not parse. PURE. */
export function lockfileWindowClosesAfter(firstFlaggedDay: string): Date | null {
  const start = dayStartMs(firstFlaggedDay);
  if (!Number.isFinite(start)) return null;
  const nextDay = new Date(start + MS_PER_DAY);
  const ahead = (LOCKFILE_WINDOW_WEEKDAY_UTC - nextDay.getUTCDay() + 7) % 7;
  return new Date(
    nextDay.getTime() + ahead * MS_PER_DAY + LOCKFILE_WINDOW_CLOSES_HOUR_UTC * 60 * 60 * 1000,
  );
}

/** When a transitive-only vuln first flagged on `firstFlaggedDay` stops waiting. PURE. */
export function transitiveVulnEscalatesAt(firstFlaggedDay: string): Date | null {
  const closes = lockfileWindowClosesAfter(firstFlaggedDay);
  return closes ? new Date(closes.getTime() + LOCKFILE_SETTLE_DAYS * MS_PER_DAY) : null;
}

/** When a direct vuln first flagged on `firstFlaggedDay` stops waiting. PURE. */
export function directVulnEscalatesAt(firstFlaggedDay: string): Date | null {
  const start = dayStartMs(firstFlaggedDay);
  return Number.isFinite(start) ? new Date(start + DIRECT_VULN_WAIT_DAYS * MS_PER_DAY) : null;
}

function vulnNoun(metric: number): string {
  return `${metric} critical/high ${metric === 1 ? "vuln" : "vulns"}`;
}

/**
 * Mark every item whose fix is still on its way by itself. PURE.
 *
 * `firstFlagged` is the snapshot that holds each key's `firstFlaggedAt`: the `next`
 * that `diffAttention` returns for these same items. Only vulns wait today:
 *
 *   - exhausted (Renovate tried and failed) → never waiting;
 *   - transitive-only → waiting until {@link transitiveVulnEscalatesAt}; after it, the
 *     title says which window it outlived;
 *   - direct → waiting until {@link directVulnEscalatesAt} (exhaustion, set by the
 *     collector, is the other way out); after it, the title says how long.
 *
 * Every other kind needs the operator now and is returned untouched. A vuln whose
 * first-flagged day is missing or unparseable is not waiting: missing data never mutes.
 */
export function markWaiting(
  items: readonly AttentionItem[],
  firstFlagged: DigestSnapshot,
  now: Date,
): AttentionItem[] {
  return items.map((it) => {
    if (it.kind !== "vuln" || it.autoFixExhausted === true) return it;
    const since = firstFlagged[it.key]?.firstFlaggedAt;
    if (since === undefined) return it;
    if (it.transitiveOnly === true) {
      const at = transitiveVulnEscalatesAt(since);
      if (at === null) return it;
      if (now.getTime() < at.getTime()) return { ...it, waiting: true };
      const window = new Date(at.getTime() - LOCKFILE_SETTLE_DAYS * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
      return {
        ...it,
        title: `${vulnNoun(it.metric)} — transitive-only, still present after the ${window} lockfile window`,
      };
    }
    const at = directVulnEscalatesAt(since);
    if (at === null) return it;
    if (now.getTime() < at.getTime()) return { ...it, waiting: true };
    return {
      ...it,
      title: `${vulnNoun(it.metric)} — Renovate has not fixed it since ${since}`,
    };
  });
}
