import type { CockpitSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import { NIGHTLY_CRON, nextDailyFiring } from "../../../../src/dashboard/nightly-schedule.js";
import type { StepResult } from "../../../../src/fleet-daily/types.js";
import type { WebsiteRow } from "../../../../src/fleet/site-row.js";
import type { OverviewNight } from "../../../../src/fleet-daily/read.js";

/**
 * P1-87 PR 5a: the nightly audit bar, the first screen's "The nightly audit" section
 * (plan `/home/user/pr5-plan.md`, "The model"). Pure: no Svelte, and no import of
 * `view.ts`, which imports this file. The step list and `outcomeText` come in as
 * arguments, so the one-way import holds.
 *
 * The bar answers one question: where is tonight's run? Once its night is recorded
 * the bar shows the record. Before that it shows what the sites' stamps prove
 * finished since the run started, which is "finished", never "succeeded".
 */

/** fleet-nightly.yml's `timeout-minutes` (300): the conductor job's own cap. Past it
 *  with no row, the run is not recorded; the test reads the file to hold this. */
export const RUN_WINDOW_MINUTES = 300;

const DAY_MS = 86_400_000;
const ZONE = "America/Los_Angeles";

export type CycleState = "done" | "problem" | "running" | "waiting" | "none";

export type CycleStep = {
  file: string;
  short: string;
  state: CycleState;
  /** Pacific clock time with no date, "11:15pm", or null when there is none. */
  time: string | null;
  /** The words a screen reader hears after the name, e.g. "ran to the end, 11:15pm PT". */
  words: string;
};

/** The part of a step the bar reads: its name, and the site stamps it leaves. */
export type CycleStepSpec = {
  file: string;
  short: string;
  stamps: readonly (keyof WebsiteRow)[];
  /** The `fleet_daily` coverage columns the step stamps; the first one says how many
   *  sites the step reaches (see `needFor`). */
  coverage?: readonly string[];
};

export type CycleView = {
  mode: "recorded" | "running" | "unrecorded";
  /** One line above the bar. */
  line: string;
  /** Always eight, in NIGHTLY_STEPS order. */
  steps: CycleStep[];
  /** "CMS sync or Security" while running, else null. */
  runningLabel: string | null;
  next: { startIso: string; startsAt: string };
  /** 0..1 along the wait to the next start, or null while running. */
  marker: number | null;
  /** When the page should re-read every 2 minutes: [fromIso, untilIso). */
  refresh: { fromIso: string; untilIso: string };
  /** The instant from which this view is wrong, so the page re-reads it at once and
   *  every 2 minutes until a fresh one replaces it: the window's end while running,
   *  the next start otherwise (P1-87 PR 5a, decision 5). */
  staleAfterIso: string;
  /** The instant the view was made for, and the end of the run's window: the page
   *  moves the marker with its own clock from these (decision 2). */
  nowIso: string;
  windowEndIso: string;
};

// Pacific clock formatters. Copies of the shapes in view.ts, which cannot be
// imported here without a cycle.
const PT_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const PT_DAY = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" });
const PT_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const part = (f: Intl.DateTimeFormat, d: Date, type: string): string =>
  f.formatToParts(d).find((p) => p.type === type)?.value ?? "";

/** "11:15pm": the Pacific clock time of an instant, no date. */
const clockOf = (d: Date): string =>
  `${part(PT_CLOCK, d, "hour")}:${part(PT_CLOCK, d, "minute")}${part(PT_CLOCK, d, "dayPeriod").toLowerCase()}`;

/** "2026-10-26": the Pacific calendar date of an instant. */
const pacificDate = (d: Date): string =>
  `${part(PT_DATE, d, "year")}-${part(PT_DATE, d, "month")}-${part(PT_DATE, d, "day")}`;

/** "Oct 26": the Pacific calendar day of an instant. */
const dayOf = (d: Date): string => PT_DAY.format(d);

/** A step's stamps on the maintained sites within [since, until]: the newest of them,
 *  and how many distinct sites carry one. A stamp in the future is never a stamp of
 *  this run, so `until` is the clock or the window's end, whichever is first. */
function stampsIn(
  sites: readonly WebsiteRow[],
  fields: readonly (keyof WebsiteRow)[],
  since: number,
  until: number,
): { newest: number | null; sites: number } {
  let newest: number | null = null;
  let carrying = 0;
  for (const site of sites) {
    let carries = false;
    for (const field of fields) {
      const v = site[field];
      if (typeof v !== "string") continue;
      const ms = Date.parse(v);
      if (!Number.isFinite(ms) || ms < since || ms > until) continue;
      carries = true;
      if (newest === null || ms > newest) newest = ms;
    }
    if (carries) carrying++;
  }
  return { newest, sites: carrying };
}

/** How many maintained sites must carry a step's stamp before it counts as finished
 *  mid-run: one when the step's newest measured coverage is exactly one site, else two,
 *  and never more than the maintained sites there are (a fleet of one can still show
 *  progress). A single-site re-test by hand therefore never moves the bar on a fleet of
 *  two or more. */
function needFor(step: CycleStepSpec, nights: OverviewNight[] | null, maintained: number): number {
  const col = step.coverage?.[0];
  let want = 2;
  if (col !== undefined) {
    for (const n of nights ?? []) {
      const m = n.counts.coverage?.value?.[col];
      if (m && m.value !== null) {
        want = m.value === 1 ? 1 : 2;
        break;
      }
    }
  }
  return Math.min(want, Math.max(1, maintained));
}

/** "in 11 hours", "in 40 minutes", "in 1 minute", "starting now": the time left to
 *  the next start, whole hours above one hour, else whole minutes. */
export function untilWords(nextIso: string, nowMs: number): string {
  const diff = Date.parse(nextIso) - nowMs;
  if (diff <= 0) return "starting now";
  if (diff > 60 * 60_000) {
    const h = Math.floor(diff / (60 * 60_000));
    return `in ${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const m = Math.max(1, Math.floor(diff / 60_000));
  return `in ${m} ${m === 1 ? "minute" : "minutes"}`;
}

/** 0..1 along the wait from the window's end (`lastEndIso`) to the next start, held
 *  at 0 before the window ends and at 1 once the next start has come. */
export function markerAt(view: Pick<CycleView, "next">, lastEndIso: string, nowMs: number): number {
  const from = Date.parse(lastEndIso);
  const to = Date.parse(view.next.startIso);
  return Math.min(1, Math.max(0, (nowMs - from) / (to - from)));
}

/**
 * The nightly audit bar for `now`. `steps` is NIGHTLY_STEPS (its order is the run's),
 * and `outcomeText` is view.ts's `outcomeText`, the words a recorded result gets.
 */
/** Tonight's run, as the last start at or before `now`. The conductor's start is a daily UTC
 *  cron (the cron is UTC, so a day is exactly 24 hours). */
function lastStartOf(now: Date, nextStart: Date): number {
  const nowMs = now.getTime();
  return nextStart.getTime() === nowMs ? nowMs : nextStart.getTime() - DAY_MS;
}

/** The Pacific calendar date of the night the bar shows at `now` (the night its run was
 *  started on): the row the bar reads for this run. */
export function runNightOf(now: Date): string {
  const nextStart = nextDailyFiring(NIGHTLY_CRON, now);
  return pacificDate(new Date(lastStartOf(now, nextStart)));
}

export function cycleView(
  s: CockpitSnapshot,
  now: Date,
  steps: readonly CycleStepSpec[],
  outcomeText: (r: StepResult | null | undefined) => string,
): CycleView {
  const nowMs = now.getTime();
  const nextStart = nextDailyFiring(NIGHTLY_CRON, now);
  const lastStartMs = lastStartOf(now, nextStart);
  const lastStart = new Date(lastStartMs);
  const windowEndMs = lastStartMs + RUN_WINDOW_MINUTES * 60_000;
  const runNight = pacificDate(lastStart);
  const row = s.nights?.find(
    (n) => n.night === runNight && Object.values(n.counts.steps).some((r) => r != null),
  );
  const mode: CycleView["mode"] =
    row !== undefined
      ? "recorded"
      : s.nights !== null && nowMs < windowEndMs
        ? "running"
        : "unrecorded";
  const maintained = (s.sites ?? []).filter((x) => x.status === "maintained");
  const startsAt = `${clockOf(nextStart)} PT`;
  const next = { startIso: nextStart.toISOString(), startsAt };
  const windowEndIso = new Date(windowEndMs).toISOString();

  let built: CycleStep[];
  let runningLabel: string | null = null;
  let line: string;

  if (mode === "recorded") {
    const startedMs = row!.counts.run ? Date.parse(row!.counts.run.startedAt) : NaN;
    // A recorded step's time is a stamp from this run's own window, never a later one.
    const runEnd = Math.min(startedMs + RUN_WINDOW_MINUTES * 60_000, nowMs);
    built = steps.map((step) => {
      const r = row!.counts.steps[step.file];
      const ranToEnd = r?.outcome === "completed" && r.conclusion === "success";
      const problem =
        (r?.outcome === "completed" && r.conclusion !== "success") || r?.outcome === "failed";
      const state: CycleState = ranToEnd ? "done" : problem ? "problem" : "none";
      // The time is the step's own stamp from this run, when it has one.
      const stampMs =
        (state === "done" || state === "problem") && Number.isFinite(startedMs)
          ? stampsIn(maintained, step.stamps, startedMs, runEnd).newest
          : null;
      const time = stampMs === null ? null : clockOf(new Date(stampMs));
      return {
        file: step.file,
        short: step.short,
        state,
        time,
        words: `${outcomeText(r)}${time === null ? "" : `, ${time} PT`}`,
      };
    });
    const done = built.filter((x) => x.state === "done").length;
    line = `Night of ${dayOf(new Date(`${runNight}T12:00:00Z`))}: ${done} of ${steps.length} steps ran to the end · next run starts ${startsAt}`;
  } else {
    // Tonight's stamps: from the run's start to the clock (or the window's end), on
    // enough maintained sites for the step to count as finished (see needFor).
    const tonightEnd = Math.min(windowEndMs, nowMs);
    const tonight = steps.map((step) => {
      const hit = stampsIn(maintained, step.stamps, lastStartMs, tonightEnd);
      return hit.newest !== null && hit.sites >= needFor(step, s.nights, maintained.length)
        ? hit.newest
        : null;
    });
    // k: the last step with a stamp tonight, so the steps 0..k have finished.
    let k = -1;
    tonight.forEach((t, i) => {
      if (t !== null) k = i;
    });
    const finishedWords = (time: string | null) =>
      time === null ? "finished" : `finished at ${time} PT`;
    const finished = (i: number): CycleStep => {
      const time = tonight[i] === null ? null : clockOf(new Date(tonight[i]!));
      return {
        file: steps[i]!.file,
        short: steps[i]!.short,
        state: "done",
        time,
        words: finishedWords(time),
      };
    };
    if (mode === "running") {
      // The span running now: from the step after k up to the first step that stamps
      // (a step that stamps nothing, Backup, CMS sync or Report drafts, never runs
      // alone at the end of a run's stamps).
      const spanStart = k + 1;
      let spanEnd = spanStart;
      while (spanEnd < steps.length - 1 && steps[spanEnd]!.stamps.length === 0) spanEnd++;
      const span = steps.slice(spanStart, spanEnd + 1);
      runningLabel = span.map((x) => x.short).join(" or ");
      built = steps.map((step, i) => {
        if (i <= k) return finished(i);
        if (i <= spanEnd) {
          return {
            file: step.file,
            short: step.short,
            state: "running",
            time: null,
            words: span.length === 1 ? "running now" : "running now, or the step beside it",
          };
        }
        return {
          file: step.file,
          short: step.short,
          state: "waiting",
          time: null,
          words: "not started yet",
        };
      });
      line = `Running since ${clockOf(lastStart)} PT · now on ${runningLabel}`;
    } else {
      built = steps.map((step, i) =>
        i <= k
          ? finished(i)
          : {
              file: step.file,
              short: step.short,
              state: "none",
              time: null,
              words: "not recorded",
            },
      );
      line =
        s.nights === null
          ? `The nightly record could not be read · next run starts ${startsAt}`
          : `The run that started ${dayOf(lastStart)}, ${clockOf(lastStart)} PT has not been recorded · next run starts ${startsAt}`;
    }
  }

  // The page re-reads while the run may still be writing its record; after that,
  // at the start of the next run's window.
  const refresh =
    mode !== "recorded" && nowMs < windowEndMs
      ? { fromIso: now.toISOString(), untilIso: windowEndIso }
      : {
          fromIso: next.startIso,
          untilIso: new Date(nextStart.getTime() + RUN_WINDOW_MINUTES * 60_000).toISOString(),
        };

  return {
    mode,
    line,
    steps: built,
    runningLabel,
    next,
    marker: mode === "running" ? null : markerAt({ next }, windowEndIso, nowMs),
    refresh,
    staleAfterIso: mode === "running" ? windowEndIso : next.startIso,
    nowIso: now.toISOString(),
    windowEndIso,
  };
}
