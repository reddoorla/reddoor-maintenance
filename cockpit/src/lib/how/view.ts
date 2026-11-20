import {
  cockpitModelFromSnapshot,
  type CockpitSnapshot,
} from "../../../../src/dashboard/snapshot-views.js";
import {
  buildNeedsYouFeed,
  type CockpitModel,
  type Tier as CardTier,
} from "../../../../src/dashboard/fleet-cockpit.js";
import { siteSlug } from "../../../../src/fleet/site-row.js";
import type { OverviewNight } from "../../../../src/fleet-daily/read.js";
import {
  LADDER_LINES,
  NIGHTLY_STEPS,
  expectedNight,
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
  /** Chapter 2: the ladder, mildest first, from the overview's own four lines, each with
   *  today's sites at that level and the 21-night line (PR 8c item 10). */
  ladder: LadderLevel[];
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

/** PR 8c item 10: the nights the ladder's line counts over: calendar nights ending on the
 *  night expected by now (the trends' window end). */
export const LEVEL_NIGHTS = 21;

/** The reason an OK site is named with: nothing on the site needs anyone (the Triage page's
 *  standard). A healthy card holds no open Triage item, so this is the claim that is true;
 *  "every check passing" is not, since a healthy card can sit beside a failing check. */
export const NO_OPEN_ITEMS = "no open items";

/** A site at a level today: its name and the reason Triage gives for it (its worst open
 *  item's title), or null when Triage has none to give. */
export type LevelSite = { name: string; reason: string | null };

export type LadderLevel = {
  tier: Tier;
  name: string;
  text: string;
  /** Today's sites at this level, by name. */
  sites: LevelSite[];
  /** The 21-night line for this level. */
  nights: string;
};

/** PR 8c item 8: how long one step takes to light. Its colour transition is this long, and the
 *  next step waits this long, so each lights after the one above it has finished. */
export const STEP_LIGHT_MS = 300;

/** PR 8c item 9: how long the lead's dot takes to run the journey once, from the form to the inbox.
 *  Under the plan's five-second ceiling for anything that moves. */
export const LEAD_DOT_MS = 3500;

/** PR 8c item 8: the step that lights next, or null. Only the first unlit step can light, and
 *  only once it has been seen in view, so a step never lights before the one above it. */
export function nextToLight(seen: readonly boolean[], lit: readonly boolean[]): number | null {
  const k = lit.findIndex((l) => !l);
  return k !== -1 && seen[k] === true ? k : null;
}

/** PR 8c item 9, round 1 D3: the lead's dot and Replay show only when motion is allowed and the
 *  journey has readable counts to run over (allTime null: the counts could not be read). Round 2
 *  addendum C': the helper reads allTime from the leads object itself, so the page cannot pass
 *  the wrong field. */
export function leadControlsShown(
  motionAndRunnable: boolean,
  leads: { allTime: unknown },
): boolean {
  return motionAndRunnable && leads.allTime !== null;
}

/** PR 8c item 9, round 1 E: the lead's chapter counts as in view at 0.6 of its own height (the
 *  rule since item 9), or when 0.6 of the viewport's height is showing, which a chapter taller
 *  than the viewport can reach (662px at 844x390, where 0.6 of its height never fits). */
export function chapterInView(
  ratio: number,
  visiblePx: number,
  sectionPx: number,
  viewportPx: number,
): boolean {
  return ratio >= 0.6 || visiblePx >= 0.6 * Math.min(sectionPx, viewportPx);
}

/** The ladder's four lines ("Broken: a visitor…"), split into name and text, mildest
 *  first. Throws if a line goes missing, so the chapter never shows three levels. */
export function ladder(): Array<Pick<LadderLevel, "tier" | "name" | "text">> {
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
    ladder: ladderWithSites(s, now),
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

/** PR 8c item 10: each maintained site, once, at its own level (its card's tier), with the
 *  reason Triage gives: the feed row's first reason, when the row is at that level. A row
 *  at another level, or with no reason, names the site alone. Ordered by name. */
export function todayAtLevels(s: CockpitSnapshot, now: Date): Record<Tier, LevelSite[]> {
  return todayFromModel(cockpitModelFromSnapshot(s, now));
}

/** The per-level sites of a built model (see todayAtLevels). */
export function todayFromModel(model: CockpitModel): Record<Tier, LevelSite[]> {
  const feed = new Map(buildNeedsYouFeed(model).map((r) => [r.slug, r]));
  const out: Record<Tier, LevelSite[]> = { ok: [], watch: [], attention: [], broken: [] };
  const levelOf: Partial<Record<CardTier, Tier>> = {
    healthy: "ok",
    watch: "watch",
    attention: "attention",
    broken: "broken",
  };
  for (const c of model.cards) {
    if (c.site.status !== "maintained") continue;
    const tier = levelOf[c.tier];
    if (tier === undefined) continue;
    const name = c.site.name;
    if (tier === "ok") {
      out.ok.push({ name, reason: NO_OPEN_ITEMS });
      continue;
    }
    // The row's approval reasons come after its item reasons, and a row at another level
    // is not this site's level: only a row at this level names one.
    const row = feed.get(siteSlug(name));
    const reason = row !== undefined && row.group === tier ? (row.reasons[0] ?? null) : null;
    out[tier].push({ name, reason });
  }
  for (const t of LADDER_ORDER)
    out[t].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

/** The key a night's tier counts are stored under (the writer's `cockpitCounts`, which keys
 *  a card by its card tier): the OK level is the card tier `healthy`. */
const NIGHT_TIER_KEY: Record<Tier, string> = {
  ok: "healthy",
  watch: "watch",
  attention: "attention",
  broken: "broken",
};

/** A night's count of sites at a level: absent is 0, present must be a count; null when the
 *  night's sites block or its tiers could not be read. */
function tierCount(c: OverviewNight["counts"], tier: Tier): number | null {
  const sites: unknown = (c as { sites?: { value?: unknown } }).sites?.value;
  if (typeof sites !== "object" || sites === null || Array.isArray(sites)) return null;
  const tiers: unknown = (sites as { tiers?: unknown }).tiers;
  if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) return null;
  const t = tiers as Record<string, unknown>;
  const key = NIGHT_TIER_KEY[tier];
  if (!(key in t)) return 0;
  const v = t[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

const dayBefore = (night: string, days: number): string =>
  new Date(Date.parse(`${night}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** PR 8c item 10: the 21-night line for a level. The window is the 21 calendar nights ending on
 *  the expected night; only nights on the newest recorded ladder version count (the trends'
 *  rule), and a night with no readable count for the level is left out, never read as 0. */
export function levelNights(nights: OverviewNight[] | null, tier: Tier, now: Date): string {
  if (nights === null) return "The nightly counts could not be read just now.";
  const byNight = new Map(nights.map((n) => [n.night, n.counts]));
  const newest = [...nights]
    .sort((a, b) => b.night.localeCompare(a.night))
    .find((n) => typeof n.counts.ladderVersion === "number");
  const version = newest?.counts.ladderVersion;
  const end = expectedNight(now);
  const counted: number[] = [];
  for (let i = 0; i < LEVEL_NIGHTS; i++) {
    const c = byNight.get(dayBefore(end, LEVEL_NIGHTS - 1 - i));
    if (c === undefined || typeof c.ladderVersion !== "number" || c.ladderVersion !== version)
      continue;
    const v = tierCount(c, tier);
    if (v !== null) counted.push(v);
  }
  const k = counted.length;
  if (k === 0) return `No nights counted yet in the last ${LEVEL_NIGHTS}.`;
  const span =
    k === LEVEL_NIGHTS
      ? `of the last ${LEVEL_NIGHTS} nights`
      : `of the ${k} nights counted in the last ${LEVEL_NIGHTS}`;
  const sat = counted.filter((v) => v > 0).length;
  if (sat === 0) return `No site sat here on any ${span}.`;
  const most = Math.max(...counted);
  return `At least one site sat here on ${sat} ${span}; the most on one night was ${most}.`;
}

function ladderWithSites(s: CockpitSnapshot, now: Date): LadderLevel[] {
  const today = todayAtLevels(s, now);
  return ladder().map((l) => ({
    ...l,
    sites: today[l.tier],
    nights: levelNights(s.nights, l.tier, now),
  }));
}
