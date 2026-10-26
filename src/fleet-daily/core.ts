/**
 * P1-78a: the pure half of the nightly `fleet_daily` writer. The IO (GitHub, the
 * job log, Turso) is `scripts/fleet-daily.mts`; every decision about what to
 * write is here, so each is a unit test over fixture text and rows.
 */
import type { DepsSite, FleetDailyCounts, Measured, StepResult } from "./types.js";

export type ConductorSummary = {
  dispatched: number;
  completed: number;
  waitExceeded: number;
  skipped: number;
  dispatchFailed: number;
  total: number;
};

export type ConductorLog = {
  summary: ConductorSummary | null;
  steps: Record<string, StepResult>;
};

const SUMMARY =
  /NIGHTLY_CONDUCTOR_SUMMARY dispatched=(\d+) completed=(\d+) wait_exceeded=(\d+) skipped=(\d+) dispatch_failed=(\d+) total=(\d+)/;

/**
 * Read the conductor job's log (`scripts/nightly-conductor.mjs` prints one
 * `NIGHTLY <file> …` line per step and a closing summary). GitHub prefixes each
 * line with a timestamp, so the patterns are unanchored. The last line for a
 * step wins: `dispatched` is followed by its `conclusion` or `still` line.
 */
export function parseConductorLog(text: string): ConductorLog {
  const steps: Record<string, StepResult> = {};
  let summary: ConductorSummary | null = null;
  for (const line of text.split(/\r?\n/)) {
    const s = SUMMARY.exec(line);
    if (s) {
      const [dispatched, completed, waitExceeded, skipped, dispatchFailed, total] = s
        .slice(1)
        .map(Number) as [number, number, number, number, number, number];
      summary = { dispatched, completed, waitExceeded, skipped, dispatchFailed, total };
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /NIGHTLY (\S+) skipped: run (\d+)/.exec(line)))
      steps[m[1]!] = { outcome: "skipped", runId: Number(m[2]), conclusion: null };
    else if ((m = /NIGHTLY (\S+) dispatch=failed error=(.*)$/.exec(line)))
      steps[m[1]!] = {
        outcome: "failed",
        runId: null,
        conclusion: "dispatch-failed",
        error: m[2]!.trim(),
      };
    else if ((m = /NIGHTLY (\S+) run=(\d+) conclusion=(\S+)/.exec(line)))
      steps[m[1]!] = { outcome: "completed", runId: Number(m[2]), conclusion: m[3]! };
    else if ((m = /NIGHTLY (\S+) run=(\d+) still /.exec(line)))
      steps[m[1]!] = { outcome: "running", runId: Number(m[2]), conclusion: null };
    else if ((m = /NIGHTLY (\S+) dispatched run=(\d+)/.exec(line)))
      steps[m[1]!] ??= { outcome: "running", runId: Number(m[2]), conclusion: null };
  }
  return { summary, steps };
}

/** What a conductor run's log asks of the writer. */
export type RunKind =
  /** Nothing was dispatched and nothing failed: the night's second, 12-second run. */
  | { kind: "skip" }
  /** Every nightly was planned: this run names a night. */
  | { kind: "full" }
  /** An `--only` run: its steps merge into an existing night. */
  | { kind: "only" }
  /** No summary line: the log is unreadable, or the conductor died before it. */
  | { kind: "unreadable" };

export function classifyRun(log: ConductorLog, fullTotal: number): RunKind {
  const s = log.summary;
  if (s === null) return { kind: "unreadable" };
  if (s.dispatched === 0 && s.dispatchFailed === 0) return { kind: "skip" };
  if (s.total === fullTotal) return { kind: "full" };
  return { kind: "only" };
}

const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The night a full run names: the Pacific date of its start less 6 hours, so the
 *  11:07pm PT clock names its own evening and a run after midnight names the one
 *  before. */
export function nightOf(createdAtIso: string): string {
  const ms = Date.parse(createdAtIso);
  if (Number.isNaN(ms)) throw new Error(`nightOf: not a time: ${createdAtIso}`);
  return PACIFIC_DAY.format(new Date(ms - 6 * 3600_000));
}

export type StoredRow = { night: string; counts: FleetDailyCounts; writtenAt: string };

/** The newest row before `night`: the one a full write takes its deltas and its
 *  first-seen dates from. A re-run's own earlier row is never its previous. */
export function previousRow(rows: readonly StoredRow[], night: string): StoredRow | null {
  return (
    [...rows].filter((r) => r.night < night).sort((a, b) => (a.night < b.night ? 1 : -1))[0] ?? null
  );
}

/** The row an `--only` run merges into: the newest whose full run started within
 *  the 24 hours before this run. Null = there is none; the run writes nothing. */
export function mergeTarget(rows: readonly StoredRow[], onlyCreatedAt: string): StoredRow | null {
  const at = Date.parse(onlyCreatedAt);
  const inWindow = rows.filter((r) => {
    const t = Date.parse(r.counts.run.createdAt);
    return t <= at && at - t <= 24 * 3600_000;
  });
  return (
    inWindow.sort(
      (a, b) => Date.parse(b.counts.run.createdAt) - Date.parse(a.counts.run.createdAt),
    )[0] ?? null
  );
}

/** Merge an `--only` run's steps into a night, leaving every other step as it was.
 *  A step the run's guard skipped did not run, so it changes nothing. */
export function mergeOnlySteps(
  target: FleetDailyCounts,
  log: ConductorLog,
  run: { id: number; startedAt: string },
): FleetDailyCounts {
  // A step the guard skipped did not run; a dispatch that failed ran nothing either,
  // so it never overwrites a result the night already holds.
  const ran = Object.entries(log.steps).filter(
    ([f, s]) =>
      s.outcome !== "skipped" &&
      !(s.outcome === "failed" && target.steps[f] != null && target.steps[f]!.outcome !== "failed"),
  );
  return {
    ...target,
    steps: { ...target.steps, ...Object.fromEntries(ran) },
    merges: [
      ...target.merges,
      { runId: run.id, startedAt: run.startedAt, steps: ran.map(([f]) => f).sort() },
    ],
  };
}

/** A full night's steps: every planned nightly, one entry each. A step the log
 *  never named is null (with the reason in the log), never left out. */
export function fullNightSteps(
  log: ConductorLog,
  planned: readonly string[],
): Record<string, StepResult | null> {
  return Object.fromEntries(planned.map((f) => [f, log.steps[f] ?? null]));
}

/** The `running` steps on a row, whose conclusions the next night fills in. */
export function runningRunIds(counts: FleetDailyCounts): number[] {
  return Object.values(counts.steps)
    .filter((s): s is Extract<StepResult, { outcome: "running" }> => s?.outcome === "running")
    .map((s) => s.runId);
}

/** Fill in the conclusions GitHub now has for an earlier row's `running` steps. */
export function fillRunning(
  counts: FleetDailyCounts,
  concluded: ReadonlyMap<number, string>,
): FleetDailyCounts {
  const steps = Object.fromEntries(
    Object.entries(counts.steps).map(([f, s]): [string, StepResult | null] => {
      if (s?.outcome !== "running") return [f, s];
      const c = concluded.get(s.runId);
      return [f, c === undefined ? s : { outcome: "completed", runId: s.runId, conclusion: c }];
    }),
  );
  return { ...counts, steps };
}

export type DepsReading = {
  id: string;
  name: string;
  /** site_health.deps_behind_packages, raw. */
  packages: string | null;
  at: string | null;
};

/**
 * Tonight's per-site package lists, each key aged from the previous row.
 *
 * A site has a reading only when its stamp is at or after `since` (the run's
 * start): a stamp that did not advance is a night with no reading, stored as
 * null, never a copy of the old list. A reading carries each key's first-seen
 * night forward and starts a new key at `night`; a key absent from the reading
 * is dropped (the site upgraded). A null night carries every first-seen date
 * forward unchanged, neither resetting nor ending the run.
 */
export function ageDeps(
  readings: readonly DepsReading[],
  prev: Record<string, DepsSite> | null,
  night: string,
  since: string,
): { sites: Record<string, DepsSite>; behind: number } {
  const sites: Record<string, DepsSite> = {};
  let behind = 0;
  const sinceMs = Date.parse(since);
  for (const r of readings) {
    const before = prev?.[r.id]?.firstSeen ?? {};
    const fresh = r.at !== null && Date.parse(r.at) >= sinceMs;
    let packages: string[] | null = null;
    let reason: string | undefined;
    if (!fresh) reason = r.at === null ? "never read" : `not read tonight (last ${r.at})`;
    else {
      try {
        const parsed: unknown = JSON.parse(r.packages ?? "null");
        if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string"))
          packages = [...new Set(parsed as string[])].sort();
        else reason = "stored list is not a string array";
      } catch {
        reason = "stored list is not JSON";
      }
    }
    if (packages === null) {
      sites[r.id] = { name: r.name, packages: null, at: r.at, reason: reason!, firstSeen: before };
      continue;
    }
    behind += packages.length;
    sites[r.id] = {
      name: r.name,
      packages,
      at: r.at,
      firstSeen: Object.fromEntries(packages.map((k) => [k, before[k] ?? night])),
    };
  }
  return { sites, behind };
}

/** The site_health stamps each conducted step writes. */
export const STEP_STAMPS: Readonly<Record<string, readonly string[]>> = {
  "fleet-security.yml": ["security_audit_at", "deps_behind_packages_at"],
  "fleet-lighthouse.yml": [
    "lighthouse_at",
    "domain_checked_at",
    "browser_checked_at",
    "deploy_checked_at",
    "function_health_checked_at",
    "url_checked_at",
  ],
  "fleet-smoke.yml": ["last_smoke_at"],
  "fleet-form-e2e.yml": ["form_e2e_checked_at"],
  "fleet-prismic-drift.yml": ["prismic_models_checked_at"],
};

/** Coverage counts, with every column whose step was still running at the write, or
 *  was skipped by the guard, stored as null and why: no 0 can stand for a count this
 *  run could not take (the next night's run replaces those stamps first). */
export function explainCoverage(
  counts: Record<string, number>,
  steps: Record<string, StepResult | null>,
): Record<string, Measured<number>> {
  const unread = new Map<string, string>();
  for (const [file, cols] of Object.entries(STEP_STAMPS)) {
    const s = steps[file];
    // A step still running stamps after the write; a step the guard skipped ran
    // earlier than this run's start, so neither one's stamps can be counted from it.
    const why =
      s?.outcome === "running"
        ? `run ${s.runId} was still running when this row was written`
        : s?.outcome === "skipped"
          ? `skipped by the guard: run ${s.runId ?? "unknown"} ran it before this night's run began`
          : null;
    if (why !== null) for (const c of cols) unread.set(c, why);
  }
  return Object.fromEntries(
    Object.entries(counts).map(([col, n]): [string, Measured<number>] => {
      const why = unread.get(col);
      return [col, why === undefined ? { value: n } : { value: null, reason: why }];
    }),
  );
}

/** A deps reading the row could not take because the audit was still running when
 *  it was written says so, rather than looking like a site that was not read. The
 *  next night's write cannot recover it: tonight's audit replaces the stamp. */
export function explainUnread(
  deps: { sites: Record<string, DepsSite>; behind: number },
  security: StepResult | undefined,
): { sites: Record<string, DepsSite>; behind: number } {
  if (security?.outcome !== "running") return deps;
  const sites = Object.fromEntries(
    Object.entries(deps.sites).map(([id, s]) => [
      id,
      s.packages === null
        ? {
            ...s,
            reason: `fleet-security run ${security.runId} was still running when this row was written`,
          }
        : s,
    ]),
  );
  return { ...deps, sites };
}

/**
 * A running total across rows: the newest earlier row that holds a value is the
 * base, and `delta` is what happened since that row was written. With no base,
 * `firstWindowDelta` (what the source still holds) starts the total.
 */
export function runningTotal<T>(
  rows: readonly StoredRow[],
  night: string,
  pick: (c: FleetDailyCounts) => Measured<T>,
): { base: T | null; sinceIso: string | null } {
  const earlier = [...rows]
    .filter((r) => r.night < night && pick(r.counts).value !== null)
    .sort((a, b) => (a.night < b.night ? 1 : -1))[0];
  if (!earlier) return { base: null, sinceIso: null };
  return { base: pick(earlier.counts).value, sinceIso: earlier.writtenAt };
}

export function addCounts(
  base: Record<string, number> | null,
  delta: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(delta)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** The ladder version this build writes. P1-78b moves it to 1. */
export const LADDER_VERSION = 0;
