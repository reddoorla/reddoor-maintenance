/**
 * P1-78a: one `fleet_daily` write, for one completed `fleet-nightly` conductor
 * run. `scripts/fleet-daily.mts` supplies the real GitHub and Turso; tests supply
 * fixtures. What the conductor's log says decides everything:
 *
 * - nothing dispatched and nothing failed (the night's 12-second second run):
 *   write nothing;
 * - every nightly planned: write the night's row, replacing a re-run's;
 * - an `--only` run: merge its steps into the newest night whose full run started
 *   within the previous 24 hours, or write nothing.
 */
import type { Db } from "../db/client.js";
import type { CockpitModel } from "../dashboard/fleet-cockpit.js";
import {
  addCounts,
  ageDeps,
  classifyRun,
  explainCoverage,
  explainUnread,
  fillRunning,
  fullNightSteps,
  LADDER_VERSION,
  mergeOnlySteps,
  mergeTarget,
  nightOf,
  parseConductorLog,
  previousRow,
  runningRunIds,
  runningTotal,
  type ConductorLog,
  type StoredRow,
} from "./core.js";
import {
  measure,
  readCoverage,
  readDepsReadings,
  readEventsSince,
  readLeads,
  readRecentRows,
  readRow,
  readReportsSent,
  readScreenouts,
  upsertRow,
} from "./read.js";
import type { ConductorRun, FleetDailyCounts, Measured } from "./types.js";

export type GitHubReads = {
  /** The conductor job's log text, for this attempt. */
  conductorLog: (runId: number, attempt: number) => Promise<string>;
  /** A run's conclusion, or null while it is still going. */
  runConclusion: (runId: number) => Promise<string | null>;
  /** First-parent merges on `main` after `sinceIso`, up to `untilIso`. */
  mergesSince: (sinceIso: string, untilIso: string) => Promise<number>;
};

export type WriteInputs = {
  db: Db;
  github: GitHubReads;
  run: ConductorRun & { headBranch: string };
  /** The conductor's NIGHTLIES, in order. */
  planned: readonly string[];
  /** The cockpit model as of now; a throw is recorded as a null block. */
  cockpit: () => Promise<CockpitModel>;
  now: Date;
  log?: (line: string) => void;
};

export type WriteOutcome =
  | { action: "none"; why: string }
  | { action: "wrote"; night: string }
  | { action: "merged"; night: string };

/** Count the cockpit's own verdicts: sites per tier, open items by key prefix. */
export function cockpitCounts(model: CockpitModel): {
  sites: NonNullable<FleetDailyCounts["sites"]["value"]>;
  signals: Record<string, number>;
} {
  const tiers: Record<string, number> = {};
  const signals: Record<string, number> = {};
  for (const c of model.cards) {
    tiers[c.tier] = (tiers[c.tier] ?? 0) + 1;
    for (const it of c.items) {
      const k = it.key.split(":")[0]!;
      signals[k] = (signals[k] ?? 0) + 1;
    }
  }
  for (const it of model.cardless ?? []) {
    const k = it.key.split(":")[0]!;
    signals[k] = (signals[k] ?? 0) + 1;
  }
  return {
    sites: {
      cards: model.cards.length,
      tiers,
      preLaunch: model.summary.preLaunch,
      setup: model.cards.filter((c) => (c.setup ?? []).length > 0).length,
    },
    signals,
  };
}

const THIRTY_DAYS_MS = 30 * 24 * 3600_000;

/** Merge a run's dispatched steps into an existing night. When that night is the
 *  newest, what the merged steps stamped is re-read, counting any stamp since its own
 *  full run began: the coverage, and the package lists when the deps audit ran. A
 *  site whose re-read failed keeps the night's reading, and a read that fails
 *  outright keeps the night's block: a merge never trades a stored value for a null.
 *  An older night takes the steps only: a later night's stamps are not its own. */
async function mergeInto(
  i: WriteInputs,
  rows: readonly StoredRow[],
  target: StoredRow,
  log: ConductorLog,
  say: (line: string) => void,
): Promise<WriteOutcome> {
  let counts = mergeOnlySteps(target.counts, log, { id: i.run.id, startedAt: i.run.startedAt });
  const since = target.counts.run.startedAt;
  const keep = <T>(fresh: Measured<T>, stored: Measured<T>): Measured<T> =>
    fresh.value === null ? stored : fresh;
  if (rows.some((r) => r.night > target.night)) {
    await upsertRow(i.db, { ...target, counts });
    say(`FLEET_DAILY merged run=${i.run.id} steps into older night=${target.night}`);
    return { action: "merged", night: target.night };
  }
  const steps = counts.steps;
  counts = {
    ...counts,
    coverage: keep(
      await measure("coverage", async () =>
        explainCoverage(await readCoverage(i.db, since), steps),
      ),
      target.counts.coverage,
    ),
  };
  if (log.steps["fleet-security.yml"]?.outcome === "completed") {
    const prevDeps = runningTotal(rows, target.night, (c) => c.deps).base;
    counts = {
      ...counts,
      deps: keep(
        await measure("deps", async () =>
          ageDeps(await readDepsReadings(i.db), prevDeps?.sites ?? null, target.night, since),
        ),
        target.counts.deps,
      ),
    };
  }
  await upsertRow(i.db, { ...target, counts });
  say(`FLEET_DAILY merged run=${i.run.id} into night=${target.night}`);
  return { action: "merged", night: target.night };
}

export async function writeFleetDaily(i: WriteInputs): Promise<WriteOutcome> {
  const say = i.log ?? (() => {});
  if (i.run.headBranch !== "main")
    return { action: "none", why: `conductor ran on ${i.run.headBranch}, not main` };
  const text = await i.github.conductorLog(i.run.id, i.run.attempt);
  const log = parseConductorLog(text);
  const kind = classifyRun(log, i.planned.length);
  if (kind.kind === "unreadable")
    throw new Error(
      `run ${i.run.id}: no NIGHTLY_CONDUCTOR_SUMMARY line in the conductor's log, so what it dispatched is unknown`,
    );
  if (kind.kind === "skip")
    return { action: "none", why: "the conductor dispatched nothing (the guard's skip run)" };

  const rows = await readRecentRows(i.db);
  const nowIso = i.now.toISOString();

  // A full plan over a night already written merges what it ran, never replaces it,
  // when its guard skipped any step (the 12:19am fallback dispatching a step the
  // clock's dispatch failed on, or "Re-run failed jobs"), or when a later night exists
  // ("Re-run all jobs" days later): replacing would re-count windows the later rows
  // already hold, and stamp the old night with a later night's state.
  if (kind.kind === "full") {
    const night = nightOf(i.run.createdAt);
    // Read directly: a night older than the recent rows is still the same night.
    const same = await readRow(i.db, night);
    if (same && (log.summary!.skipped > 0 || rows.some((r) => r.night > night)))
      return mergeInto(i, rows, same, log, say);
  }

  if (kind.kind === "only") {
    const target = mergeTarget(rows, i.run.createdAt);
    if (!target)
      return {
        action: "none",
        why: `--only run ${i.run.id}: no night's full run started in the 24 hours before it`,
      };
    return mergeInto(i, rows, target, log, say);
  }

  const night = nightOf(i.run.createdAt);
  const prev = previousRow(rows, night);

  // The previous night's `running` steps: fill in what GitHub now knows.
  if (prev) {
    const concluded = new Map<number, string>();
    for (const id of runningRunIds(prev.counts)) {
      try {
        const c = await i.github.runConclusion(id);
        if (c !== null) concluded.set(id, c);
      } catch (e) {
        say(`FLEET_DAILY could not read run ${id}: ${(e as Error).message}`);
      }
    }
    if (concluded.size > 0) {
      await upsertRow(i.db, { ...prev, counts: fillRunning(prev.counts, concluded) });
      say(`FLEET_DAILY filled ${concluded.size} conclusion(s) on night=${prev.night}`);
    }
  }

  const model = await measure("cockpit", i.cockpit);
  const fromModel = model.value === null ? null : cockpitCounts(model.value);
  const nullBlock = { value: null, reason: model.reason ?? "" } as const;

  const events = await (async (): Promise<Measured<Record<string, number>>> => {
    const { base, sinceIso } = runningTotal(rows, night, (c) => c.events);
    return measure("fleet_events", async () =>
      addCounts(base, await readEventsSince(i.db, sinceIso, nowIso)),
    );
  })();

  const prsMerged = await (async (): Promise<Measured<number>> => {
    const { base, sinceIso } = runningTotal(rows, night, (c) => c.prsMerged);
    const since = sinceIso ?? new Date(i.now.getTime() - THIRTY_DAYS_MS).toISOString();
    return measure(
      "GitHub merges",
      async () => (base ?? 0) + (await i.github.mergesSince(since, nowIso)),
    );
  })();

  const counts: FleetDailyCounts = {
    schema: 1,
    ladderVersion: LADDER_VERSION,
    run: {
      id: i.run.id,
      attempt: i.run.attempt,
      event: i.run.event,
      createdAt: i.run.createdAt,
      startedAt: i.run.startedAt,
      conclusion: i.run.conclusion,
    },
    steps: fullNightSteps(log, i.planned),
    merges: [],
    sites: fromModel ? { value: fromModel.sites } : nullBlock,
    signals: fromModel ? { value: fromModel.signals } : nullBlock,
    coverage: await measure("coverage", async () =>
      explainCoverage(await readCoverage(i.db, i.run.startedAt), fullNightSteps(log, i.planned)),
    ),
    deps: await measure("deps", async () =>
      explainUnread(
        ageDeps(
          await readDepsReadings(i.db),
          runningTotal(rows, night, (c) => c.deps).base?.sites ?? null,
          night,
          i.run.startedAt,
        ),
        log.steps["fleet-security.yml"],
      ),
    ),
    leads: await measure("leads", () => readLeads(i.db)),
    screenouts: await measure("screenouts", () => readScreenouts(i.db)),
    reportsSent: await measure("reports", () => readReportsSent(i.db)),
    events,
    prsMerged,
  };
  const row: StoredRow = { night, counts, writtenAt: nowIso };
  await upsertRow(i.db, row);
  say(`FLEET_DAILY wrote night=${night} run=${i.run.id}`);
  return { action: "wrote", night };
}
