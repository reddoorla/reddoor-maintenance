/**
 * P1-78a: the shape of one `fleet_daily.counts` row (workspace
 * plans/2026-10-26-cockpit-for-the-team/plan.md, PR 1). Every count is a
 * cumulative total as of the write, so trends take deltas between consecutive
 * rows and no window can be got wrong. A field the writer could not read is
 * `null` with a reason beside it, never `0`.
 */

/** How many nights the overview reads (`readOverviewNights`), newest first: 30 nights
 *  for its windows, the one before them that their first delta is taken from, and
 *  tonight's row when it is already written (before 6am Pacific). The first screen
 *  leaves tonight's row out, so 32 keeps its 30-night windows whole (review round 4,
 *  M1). Here, not in read.ts, so the cockpit's page code can say "at least 32" without
 *  importing the database reader. */
export const OVERVIEW_NIGHTS = 32;

/** The reason a traffic half carries when the row holds it but its value is not a valid reading
 *  (P1-87 PR 7a, review round 1). Shared with the cockpit, which words it as malformed. */
export const MALFORMED_HALF = "malformed reading";

/** A value the writer may fail to read: null, and why, rather than a fake 0. */
export type Measured<T> = { value: T; reason?: undefined } | { value: null; reason: string };

/** One conducted nightly, as the conductor's own `NIGHTLY` line recorded it. */
export type StepResult =
  /** It ran and finished; `conclusion` is GitHub's (`success`, `failure`, …). */
  | { outcome: "completed"; runId: number; conclusion: string }
  /** The conductor stopped waiting (`still … after N min`). The next night's
   *  write fills in the conclusion on this row. */
  | { outcome: "running"; runId: number; conclusion: null }
  /** The 12-hour guard found the conductor had already dispatched it. */
  | { outcome: "skipped"; runId: number | null; conclusion: null }
  /** The dispatch itself failed, so no run exists. Recorded, never dropped. */
  | { outcome: "failed"; runId: null; conclusion: "dispatch-failed"; error: string };

export type ConductorRun = {
  id: number;
  attempt: number;
  event: string;
  /** When the run was created. A re-run keeps it, so it names the night. */
  createdAt: string;
  /** When this attempt started: a stamp at or after it is tonight's reading. */
  startedAt: string;
  conclusion: string | null;
};

/** One site's deps reading for the night, and the first night each key was seen
 *  in the unbroken run of readings that ends here. */
export type DepsSite = {
  name: string;
  /** `name@installed-major` per package a major behind; null = no reading tonight. */
  packages: string[] | null;
  /** When the list was written (`site_health.deps_behind_packages_at`). */
  at: string | null;
  /** Why `packages` is null. */
  reason?: string;
  /** key → the night it was first seen. Carried through a null night. */
  firstSeen: Record<string, string>;
};

export type FleetDailyCounts = {
  /** The shape of this JSON. */
  schema: 1;
  /** 0 until the severity ladder ships (P1-78b), then 1. */
  ladderVersion: number;
  /** The full conductor run that named this night. */
  run: ConductorRun;
  steps: Record<string, StepResult | null>;
  /** `--only` runs merged into this night, oldest first. */
  merges: Array<{ runId: number; startedAt: string; steps: string[] }>;
  /** Sites per tier and setup, from the cockpit model. */
  sites: Measured<{
    cards: number;
    tiers: Record<string, number>;
    preLaunch: number;
    setup: number;
  }>;
  /** Open alarm items by the key's prefix (`vuln`, `renovate`, `url-unresolved`, …). */
  signals: Measured<Record<string, number>>;
  /** Per site_health stamp column: maintained sites stamped since the run started.
   *  A column whose step was still running at the write is null with a reason. */
  coverage: Measured<Record<string, Measured<number>>>;
  deps: Measured<{ sites: Record<string, DepsSite>; behind: number }>;
  /** Submissions by status, all time, and how many the client was told about. */
  leads: Measured<{
    new: number;
    read: number;
    archived: number;
    spamAuto: number;
    spam: number;
    notified: number;
  }>;
  /** `spam_screenouts`, all time: honeypot and too-fast only, never `marked_spam`. */
  screenouts: Measured<{ honeypot: number; tooFast: number }>;
  /** Reports sent, all time, less the `test send` rows. */
  reportsSent: Measured<number>;
  /** `fleet_events` by type: a running total, `since` the first row's base. */
  events: Measured<Record<string, number>>;
  /** First-parent merges on reddoor-maintenance `main`: a running total. */
  prsMerged: Measured<number>;
  /** GA4 engaged visits and Search Console clicks and impressions (P1-87, PR 6). */
  traffic: Measured<TrafficCounts>;
};

/** A window of calendar dates (`YYYY-MM-DD`, Pacific), both ends inclusive. */
export type TrafficWindow = { startDate: string; endDate: string };

/** One site's traffic for the night: each half is its own reading, or null with why. */
export type TrafficSite = {
  siteId: string;
  visits: Measured<{ current: number; previous: number }>;
  search: Measured<{ clicks: number; impressions: number }>;
};

/** The `traffic` block of a `fleet_daily` row (P1-87, PR 6). Each half is unmeasured
 *  as a whole, with a reason, when no site could be read; a site that could not be read
 *  is left out of the totals, never counted as 0. */
export type TrafficCounts = {
  visits: Measured<{
    current: number;
    previous: number;
    currentWindow: TrafficWindow;
    previousWindow: TrafficWindow;
    /** Sites whose GA read returned. */
    sitesRead: number;
    /** Sites with a GA4 property recorded. */
    sitesWithProperty: number;
    /** 60 days, oldest first, every date present; a day no read site reported is 0. */
    daily: { date: string; visits: number }[];
  }>;
  search: Measured<{
    clicks: number;
    impressions: number;
    window: TrafficWindow;
    /** Sites whose Search Console read returned. */
    sitesRead: number;
    /** Sites with a Search Console property, or a URL to resolve one from. */
    sitesWithProperty: number;
    /** 28 days, oldest first, every date present; a day no read site reported is 0. */
    daily: { date: string; clicks: number; impressions: number }[];
  }>;
  /** Every maintained site, by site id. */
  sites: TrafficSite[];
};
