import type { CockpitSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import {
  LADDER_LINES,
  NIGHTLY_STEPS,
  overviewFromSnapshot,
  type StepView,
  type LeadsView,
  type NightlyView,
  type ReportsView,
} from "../overview/view.js";

/**
 * P1-87: "How this works", the overview's explanations told as a story in five
 * chapters (workspace plans/2026-11-16-p1-87-overview-reorg/plan.md, list item 5).
 * Every number comes from the overview's own model over the same snapshot, so the
 * two pages can never disagree; this file only picks what each chapter shows.
 */

export type Tier = "ok" | "watch" | "attention" | "broken";

export type HowView = {
  /** Chapter 1: the nightly's times, its steps in run order (each with its two-word
   *  name for the diagram), and how it has gone. */
  nightly: Omit<NightlyView, "steps"> & { steps: Array<StepView & { n: number; short: string }> };
  /** Chapter 2: the ladder, mildest first, from the overview's own four lines. */
  ladder: Array<{ tier: Tier; name: string; text: string }>;
  /** Chapter 2: what fixed itself. */
  upkeep: { automerged: string; vulnsCleared: string };
  /** Chapter 3: a lead's journey, from the same counts as the overview's Leads. */
  leads: LeadsView;
  /** Chapter 4: the checks a report carries, its scores and how many went out. */
  reports: Pick<ReportsView, "checks" | "lighthouse" | "lighthouseAsOf" | "sent">;
  /** Chapter 5: PRs merged into the stack. */
  prsMerged: string;
  /** How we count: the nights the nightly has written counts for, in words (null when
   *  they could not be read). Shown beside the steps, not on the overview (review round 2, E). */
  nightsCollected: string | null;
};

const LADDER_ORDER: readonly Tier[] = ["ok", "watch", "attention", "broken"];

/** The ladder's four lines ("Broken: a visitor…"), split into name and text, mildest
 *  first. Throws if a line goes missing, so the chapter never shows three levels. */
export function ladder(): HowView["ladder"] {
  return LADDER_ORDER.map((tier) => {
    const line = LADDER_LINES.find((l) => l.toLowerCase().startsWith(`${tier}:`));
    if (line === undefined) throw new Error(`how: no ladder line for ${tier}`);
    const cut = line.indexOf(": ");
    const rest = line.slice(cut + 2);
    return { tier, name: line.slice(0, cut), text: rest.charAt(0).toUpperCase() + rest.slice(1) };
  });
}

export function howFromSnapshot(s: CockpitSnapshot, now: Date): HowView {
  const o = overviewFromSnapshot(s, now);
  return {
    // The overview's steps are NIGHTLY_STEPS in order, so index i is step i.
    nightly: {
      ...o.nightly,
      steps: o.nightly.steps.map((step, i) => ({
        ...step,
        n: i + 1,
        short: NIGHTLY_STEPS[i]!.short,
      })),
    },
    ladder: ladder(),
    upkeep: { automerged: o.upkeep.automerged, vulnsCleared: o.upkeep.vulnsCleared },
    leads: o.leads,
    reports: {
      checks: o.reports.checks,
      lighthouse: o.reports.lighthouse,
      lighthouseAsOf: o.reports.lighthouseAsOf,
      sent: o.reports.sent,
    },
    prsMerged: o.prsMerged,
    nightsCollected: o.nightsCollected,
  };
}
