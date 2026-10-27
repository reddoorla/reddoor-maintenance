import type { CockpitSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import { cockpitModelFromSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import type { CockpitModel, SiteCard, Tier } from "../../../../src/dashboard/fleet-cockpit.js";
import {
  buildNeedsYouFeed,
  isFailedDeployStatus,
  isReadyDeployStatus,
} from "../../../../src/dashboard/fleet-cockpit.js";
import { daysFlagged, levelOf } from "../../../../src/alerts/ladder.js";
import { freshWithin, PRODUCTION_STALE_DAYS } from "../../../../src/alerts/production-signals.js";
import { urlProbeFresh } from "../../../../src/alerts/digest-collectors.js";
import { relativeTimeFromNow } from "../../../../src/dashboard/relative-time.js";
import {
  NIGHTLY_CRON,
  SEND_CRON,
  pacificTimeOfCron,
} from "../../../../src/dashboard/nightly-schedule.js";
import { DEFAULT_COPY } from "../../../../src/reports/copy.js";
import { isPendingApproval, type ReportRow } from "../../../../src/reports/report-row.js";
import { nextDueDate } from "../../../../src/reports/due.js";
import type { SubmissionRow } from "../../../../src/reports/submission-row.js";
import type { WebsiteRow } from "../../../../src/fleet/site-row.js";
import { siteSlug } from "../../../../src/fleet/site-row.js";
import type { OverviewNight } from "../../../../src/fleet-daily/read.js";
import type { StepResult } from "../../../../src/fleet-daily/types.js";
import { TRIAGE_PATH } from "../../../../src/dashboard/home-path.js";

/**
 * P1-78g: the overview at `/` as render-ready data (workspace
 * plans/2026-10-26-cockpit-for-the-team/plan.md, "The overview at `/`"). It reads
 * the snapshot every page reads, plus its `fleet_daily` nights, and nothing else:
 * no GitHub call, and no count typed into the page. Every number it shows has a
 * line in `howWeCount`, and a number nothing measured yet reads "not yet
 * collected", never 0.
 */

export const NOT_YET = "not yet collected";

/** How many nights a window may span: "over the last K nights", K up to this. */
export const WINDOW_NIGHTS = 30;

/** A submission kept as real: a lead or signup the client sees. */
const ACCEPTED = new Set(["new", "read", "archived"]);

/** August's "test send via Claude" reports went out but were never a client's report. */
export function isTestSend(r: Pick<ReportRow, "approvedBy">): boolean {
  return (r.approvedBy ?? "").toLowerCase().includes("test send");
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const count = (n: number, one: string, many: string): string => `${n} ${plural(n, one, many)}`;

// ---- section 1: the one-line status ----

export type BrokenRow = { siteName: string; url: string; reasons: string; age: string | null };

export type StatusView = {
  /** "17 sites in our care. All live. 2 need attention this week." */
  line: string;
  cls: "ok" | "broken" | "attention" | "watch";
  broken: BrokenRow[];
  link: string;
};

function ageOf(since: string | undefined | null, now: Date): string | null {
  if (!since) return null;
  const days = daysFlagged(since, now);
  return days === 0 ? "since today" : `for ${count(days, "day", "days")}`;
}

function statusView(model: CockpitModel, live: LiveRow[], now: Date): StatusView {
  const feed = buildNeedsYouFeed(model);
  const cardless = (model.cardless ?? []).filter((i) => i.waiting !== true);
  const cardlessAt = (l: string) =>
    cardless.filter((i) => (i.level ?? levelOf(i, undefined, now)) === l);
  const broken: BrokenRow[] = [
    ...feed
      .filter((i) => i.group === "broken")
      .map((i) => ({
        siteName: i.siteName,
        url: i.url,
        reasons: i.reasons.join(" · "),
        age: ageOf(i.since, now),
      })),
    ...cardlessAt("broken").map((i) => ({
      siteName: i.siteName || "The fleet",
      url: TRIAGE_PATH,
      reasons: i.title,
      age: ageOf(i.firstFlaggedAt, now),
    })),
  ];
  const attention =
    feed.filter((i) => i.group === "attention").length + cardlessAt("attention").length;
  const watch = feed.filter((i) => i.group === "watch").length;
  const approval = feed.filter((i) => i.group === "approval").length;

  const inCare = model.cards.filter((c) => c.site.status === "maintained").length;
  const down = live.filter((r) => r.live.ok === false).length;
  const unknown = live.filter((r) => r.live.ok === null).length;
  const parts = [`${count(inCare, "site", "sites")} in our care.`];
  if (down === 0 && unknown === 0) parts.push(inCare === 1 ? "It is live." : "All live.");
  else {
    if (down > 0) parts.push(`${down} not live.`);
    if (unknown > 0)
      parts.push(`${down > 0 ? "" : "The rest live; "}${unknown} not checked lately.`);
  }
  const levels = [
    broken.length > 0 ? `${broken.length} broken.` : null,
    attention > 0
      ? `${attention} ${plural(attention, "needs", "need")} attention this week.`
      : null,
    watch > 0 ? `${watch} to watch.` : null,
    approval > 0 ? `${count(approval, "report waits", "reports wait")} for your yes.` : null,
  ].filter((s): s is string => s !== null);
  parts.push(...(levels.length > 0 ? levels : ["Nothing needs attention."]));
  const cls =
    broken.length > 0 ? "broken" : attention > 0 ? "attention" : watch > 0 ? "watch" : "ok";
  return { line: parts.join(" "), cls, broken, link: TRIAGE_PATH };
}

// ---- section 2: is every site live? ----

export type Cell = { ok: boolean | null; text: string };

export type LiveRow = {
  siteName: string;
  url: string;
  live: Cell;
  domain: Cell;
  deploy: Cell;
  forms: Cell;
  lastLead: string;
  level: { tier: Tier; text: string };
};

const TIER_TEXT: Record<Tier, string> = {
  broken: "Broken",
  attention: "Attention",
  watch: "Watch",
  healthy: "OK",
  "pre-launch": "Launching",
};

/** Live = the address resolves (the URL probe) AND its pages answer (the browser
 *  audit's uptime check). Either fresh fail is named; anything stale is unknown. */
export function liveCell(site: WebsiteRow, now: Date): Cell {
  const urlFresh = urlProbeFresh(site.urlCheckedAt, now);
  const pagesFresh = freshWithin(site.browserCheckedAt, PRODUCTION_STALE_DAYS, now);
  const failed = [
    urlFresh && site.urlResolves === "fail"
      ? `address not answering${site.urlStatus ? ` (${site.urlStatus})` : ""}`
      : null,
    pagesFresh && site.reachableOk === "fail" ? "a page not answering" : null,
  ].filter((s): s is string => s !== null);
  if (failed.length > 0) {
    const text = failed.join(", ");
    return { ok: false, text: text[0]!.toUpperCase() + text.slice(1) };
  }
  if (urlFresh && site.urlResolves === "pass" && pagesFresh && site.reachableOk === "pass")
    return { ok: true, text: "Live" };
  return { ok: null, text: "Not checked lately" };
}

function domainCell(site: WebsiteRow, now: Date): Cell {
  const d = site.certDaysRemaining;
  if (!freshWithin(site.domainCheckedAt, PRODUCTION_STALE_DAYS, now) || d === null)
    return { ok: null, text: "Not checked lately" };
  if (d < 0) return { ok: false, text: "Certificate expired" };
  return { ok: d > 30, text: `${count(d, "day", "days")} left` };
}

function deployCell(site: WebsiteRow, now: Date): Cell {
  if (site.deployStatus === null) return { ok: null, text: "No deploy recorded" };
  if (isFailedDeployStatus(site.deployStatus)) return { ok: false, text: "Latest deploy failed" };
  if (isReadyDeployStatus(site.deployStatus))
    return { ok: true, text: `Published ${relativeTimeFromNow(site.lastDeployAt, now)}` };
  return { ok: null, text: `In progress (${site.deployStatus})` };
}

/** The nightly live form test. A verdict counts only beside a fresh stamp: a stale
 *  pass is "not tested lately", never "working". */
export function formsCell(site: WebsiteRow, now: Date): Cell {
  if (!freshWithin(site.formE2eCheckedAt, PRODUCTION_STALE_DAYS, now))
    return { ok: null, text: "Not tested lately" };
  if (site.formE2eOk === "fail") return { ok: false, text: "Test failed" };
  if (site.formE2eOk === "pass") return { ok: true, text: "Test passed" };
  return { ok: null, text: "No form to test" };
}

function liveRows(model: CockpitModel, subs: SubmissionRow[] | null, now: Date): LiveRow[] {
  const lastReal = new Map<string, string>();
  for (const r of subs ?? []) {
    if (!ACCEPTED.has(r.status) || r.submittedAt === null) continue;
    const prev = lastReal.get(r.siteId);
    if (prev === undefined || r.submittedAt > prev) lastReal.set(r.siteId, r.submittedAt);
  }
  return model.cards
    .filter((c) => c.site.status === "maintained")
    .sort((a, b) => a.site.name.localeCompare(b.site.name))
    .map((c: SiteCard) => {
      const at = lastReal.get(c.site.id);
      return {
        siteName: c.site.name,
        url: `/s/${siteSlug(c.site.name)}`,
        live: liveCell(c.site, now),
        domain: domainCell(c.site, now),
        deploy: deployCell(c.site, now),
        forms: formsCell(c.site, now),
        lastLead:
          subs === null
            ? "not readable"
            : at === undefined
              ? "none yet"
              : `last real one ${relativeTimeFromNow(at, now)}`,
        level: { tier: c.tier, text: TIER_TEXT[c.tier] },
      };
    });
}

// ---- section 3: leads ----

export type LeadCounts = {
  submissions: number;
  accepted: number;
  notified: number;
  screened: number;
  byHand: number;
};

export type LeadsView = {
  /** Null when the submissions read failed. */
  allTime: LeadCounts | null;
  thisMonth: LeadCounts | null;
  /** Since this, all time: the oldest submission's date. */
  since: string | null;
  /** All time, from the newest `fleet_daily` night; this month, from the snapshot's
   *  screen-out buckets. Their own line, never added to `screened`. */
  stoppedAllTime: string;
  stoppedThisMonth: string;
  /** Every site with a submission, biggest first: per-site counts beside the total. */
  perSite: Array<{ siteName: string } & LeadCounts>;
};

function tally(rows: SubmissionRow[]): LeadCounts {
  const n: LeadCounts = { submissions: 0, accepted: 0, notified: 0, screened: 0, byHand: 0 };
  for (const r of rows) {
    n.submissions++;
    if (ACCEPTED.has(r.status)) {
      n.accepted++;
      if (r.notifyStatus === "sent") n.notified++;
    } else if (r.status === "spam_auto") n.screened++;
    else if (r.status === "spam") n.byHand++;
  }
  return n;
}

/** The first of this UTC month, `YYYY-MM-01`. */
const monthStart = (now: Date): string => `${now.toISOString().slice(0, 7)}-01`;

function leadsView(s: CockpitSnapshot, siteName: (id: string) => string, now: Date): LeadsView {
  const subs = s.submissions;
  const month = monthStart(now);
  const latestScreen = newestMeasured(s.nights, (c) => c.screenouts);
  const monthBuckets = (s.screenOuts ?? []).filter((b) => b.date >= month);
  const bySite = new Map<string, SubmissionRow[]>();
  for (const r of subs ?? []) bySite.set(r.siteId, [...(bySite.get(r.siteId) ?? []), r]);
  const dates = (subs ?? [])
    .map((r) => r.submittedAt)
    .filter((d): d is string => d !== null)
    .sort();
  return {
    allTime: subs === null ? null : tally(subs),
    thisMonth: subs === null ? null : tally(subs.filter((r) => (r.submittedAt ?? "") >= month)),
    since: dates[0]?.slice(0, 10) ?? null,
    stoppedAllTime:
      latestScreen === null
        ? NOT_YET
        : String(latestScreen.value.honeypot + latestScreen.value.tooFast),
    stoppedThisMonth:
      s.screenOuts === null
        ? "not readable"
        : String(monthBuckets.reduce((t, b) => t + b.honeypot + b.tooFast, 0)),
    perSite: [...bySite]
      .map(([id, rows]) => ({ siteName: siteName(id), ...tally(rows) }))
      .sort((a, b) => b.submissions - a.submissions || a.siteName.localeCompare(b.siteName)),
  };
}

// ---- section 4: client reports ----

/** The nightly job that proves each check a Maintenance report carries. Keyed by
 *  the report's own check names (`DEFAULT_COPY.maintenanceChecks`). */
export const CHECK_PROOF: Record<string, string> = {
  "Deploy & Function Health":
    "Step 5 reads the latest production deploy and calls the site's server functions.",
  "CMS Checked":
    "Step 5 checks the CMS answers; step 2 checks its content models match the site's code.",
  "Domain, DNS & SSL": "Step 5 resolves the domain and reads the certificate's days left.",
  "Google Indexed": "Step 8 asks Google Search Console when it drafts the report.",
  "Security Updates": "Step 4 lists known vulnerabilities; automatic updates fix them.",
  "Uptime Checked": "Step 5 checks the address resolves and its pages answer.",
};

export type ReportsView = {
  checks: Array<{ name: string; proof: string }>;
  /** Fleet medians over maintained sites with a score. */
  lighthouse: Array<{ label: string; median: string }>;
  /** Null when the reports read failed. */
  sent: { real: number; approvedFirst: number; aroundGate: number; testSends: number } | null;
  perSite: Array<{ siteName: string; nextDue: string; waiting: number }>;
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

function reportsView(model: CockpitModel, reports: ReportRow[] | null, now: Date): ReportsView {
  const maintained = model.cards.map((c) => c.site).filter((s) => s.status === "maintained");
  const scores: Array<[string, (s: WebsiteRow) => number | null]> = [
    ["Performance", (s) => s.pScore],
    ["Accessibility", (s) => s.rScore],
    ["Best practices", (s) => s.bpScore],
    ["SEO", (s) => s.seoScore],
  ];
  const sentRows = (reports ?? []).filter((r) => r.sentAt !== null);
  const real = sentRows.filter((r) => !isTestSend(r));
  const approvedFirst = real.filter((r) => r.approvedAt !== null && r.approvedAt <= r.sentAt!);
  return {
    checks: DEFAULT_COPY.maintenanceChecks.map((name) => {
      const proof = CHECK_PROOF[name];
      if (proof === undefined) throw new Error(`overview: no nightly proof for "${name}"`);
      return { name, proof };
    }),
    lighthouse: scores.map(([label, get]) => {
      const m = median(maintained.map(get).filter((v): v is number => v !== null));
      return { label, median: m === null ? NOT_YET : String(m) };
    }),
    sent:
      reports === null
        ? null
        : {
            real: real.length,
            approvedFirst: approvedFirst.length,
            aroundGate: real.length - approvedFirst.length,
            testSends: sentRows.length - real.length,
          },
    perSite: [...maintained]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((site) => {
        const due = (["Maintenance", "Testing"] as const)
          .map((type) => ({ type, at: nextDueDate(site, reports ?? [], type, now) }))
          .filter((d): d is { type: "Maintenance" | "Testing"; at: Date } => d.at !== null)
          .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
        return {
          siteName: site.name,
          nextDue: due ? `${due.type}, ${SHORT_DATE.format(due.at)}` : "none scheduled",
          waiting: (reports ?? []).filter((r) => r.siteId === site.id && isPendingApproval(r))
            .length,
        };
      }),
  };
}

// ---- fleet_daily helpers ----

type Counts = OverviewNight["counts"];
type MeasuredOf<T> = { value: T; reason?: undefined } | { value: null; reason: string };

/** The newest night whose `pick` was measured, with its value. */
function newestMeasured<T>(
  nights: OverviewNight[] | null,
  pick: (c: Counts) => MeasuredOf<T> | undefined,
): { night: string; value: T } | null {
  for (const n of nights ?? []) {
    const m = pick(n.counts);
    if (m && m.value !== null) return { night: n.night, value: m.value };
  }
  return null;
}

const DAY_MS = 86_400_000;
const nightsBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** A running total's growth over the last K nights, K up to `WINDOW_NIGHTS`: the
 *  newest measured night less the oldest measured one inside the window. One night
 *  alone has nothing to subtract, so it is "not yet collected", never 0. */
export function windowed(
  nights: OverviewNight[] | null,
  pick: (c: Counts) => number | null | undefined,
): { value: number; nights: number } | null {
  const measured = (nights ?? [])
    .map((n) => ({ night: n.night, v: pick(n.counts) }))
    .filter((x): x is { night: string; v: number } => typeof x.v === "number");
  const newest = measured[0];
  if (newest === undefined) return null;
  const base = measured
    .filter((x) => x.night < newest.night && nightsBetween(x.night, newest.night) <= WINDOW_NIGHTS)
    .at(-1);
  if (base === undefined) return null;
  return { value: newest.v - base.v, nights: nightsBetween(base.night, newest.night) };
}

const overNights = (w: { value: number; nights: number } | null, unit: string): string =>
  w === null ? NOT_YET : `${w.value} ${unit} over the last ${count(w.nights, "night", "nights")}`;

// ---- section 5: what runs every night ----

type StampField = keyof Pick<
  WebsiteRow,
  | "prismicModelsCheckedAt"
  | "lastSecurityAuditAt"
  | "lastLighthouseAuditAt"
  | "domainCheckedAt"
  | "browserCheckedAt"
  | "deployCheckedAt"
  | "functionHealthCheckedAt"
  | "urlCheckedAt"
  | "lastSmokeAt"
  | "formE2eCheckedAt"
>;

/** The conductor's eight steps, in its order (`scripts/nightly-conductor.mjs`
 *  NIGHTLIES; a test holds the two in step). `coverage` names the `fleet_daily`
 *  coverage columns a step stamps; `stamps`, the site row's own stamps. */
export const NIGHTLY_STEPS: ReadonlyArray<{
  file: string;
  label: string;
  coverage: readonly string[];
  stamps: readonly StampField[];
}> = [
  {
    file: "fleet-db-backup.yml",
    label: "Backup, with a restore rehearsal",
    coverage: [],
    stamps: [],
  },
  {
    file: "fleet-prismic-drift.yml",
    label: "Prismic check (the CMS's content models match the code)",
    coverage: ["prismic_models_checked_at"],
    stamps: ["prismicModelsCheckedAt"],
  },
  { file: "fleet-prismic-sync.yml", label: "Prismic sync", coverage: [], stamps: [] },
  {
    file: "fleet-security.yml",
    label: "Security (known vulnerabilities, and packages behind)",
    coverage: ["security_audit_at", "deps_behind_packages_at"],
    stamps: ["lastSecurityAuditAt"],
  },
  {
    file: "fleet-lighthouse.yml",
    label: "Lighthouse, domain, browsers, deploy, functions and the URL probe",
    coverage: [
      "lighthouse_at",
      "domain_checked_at",
      "browser_checked_at",
      "deploy_checked_at",
      "function_health_checked_at",
      "url_checked_at",
    ],
    stamps: [
      "lastLighthouseAuditAt",
      "domainCheckedAt",
      "browserCheckedAt",
      "deployCheckedAt",
      "functionHealthCheckedAt",
      "urlCheckedAt",
    ],
  },
  {
    file: "fleet-smoke.yml",
    label: "Smoke (the site's own tests on a fresh build)",
    coverage: ["last_smoke_at"],
    stamps: ["lastSmokeAt"],
  },
  {
    file: "fleet-form-e2e.yml",
    label: "The live form test",
    coverage: ["form_e2e_checked_at"],
    stamps: ["formE2eCheckedAt"],
  },
  { file: "daily-reports.yml", label: "Report drafts", coverage: [], stamps: [] },
];

export type StepView = { label: string; outcome: string; lastFinished: string; sites: string };

export type NightlyView = {
  startsAt: string;
  sendsAt: string;
  steps: StepView[];
  /** "17 sites, 11 checks on each", from the newest night's coverage. */
  scale: string;
  /** "N of M runs green over the last K nights". */
  reliability: string;
};

const PACIFIC_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function pacificStamp(iso: string): string {
  const parts = PACIFIC_STAMP.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase()} PT`;
}

function outcomeText(r: StepResult | null | undefined): string {
  if (r === undefined || r === null) return "not recorded";
  if (r.outcome === "completed") return r.conclusion === "success" ? "green" : r.conclusion;
  if (r.outcome === "running") return "still running at the write";
  if (r.outcome === "skipped") return "already run that night";
  return "could not start";
}

const isGreen = (r: StepResult | null | undefined): boolean =>
  r?.outcome === "completed" && r.conclusion === "success";
const finished = (r: StepResult | null | undefined): boolean =>
  r?.outcome === "completed" || r?.outcome === "failed";

function nightlyView(s: CockpitSnapshot, now: Date): NightlyView {
  const nights = s.nights ?? [];
  const newest = nights[0];
  const coverage = newestMeasured(s.nights, (c) => c.coverage);
  const covered = (col: string): number | null => {
    const m = coverage?.value[col];
    return m && m.value !== null ? m.value : null;
  };
  const maintained = (s.sites ?? []).filter((x) => x.status === "maintained");
  const steps = NIGHTLY_STEPS.map((step) => {
    const stamps = maintained
      .flatMap((site) => step.stamps.map((f) => site[f]))
      .filter((v): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)))
      .sort();
    const sites = step.coverage.map(covered).filter((v): v is number => v !== null);
    return {
      label: step.label,
      outcome: newest ? outcomeText(newest.counts.steps[step.file]) : NOT_YET,
      lastFinished: stamps.length > 0 ? pacificStamp(stamps.at(-1)!) : "—",
      sites:
        step.coverage.length === 0
          ? "the whole fleet at once"
          : sites.length === 0
            ? NOT_YET
            : count(Math.max(...sites), "site", "sites"),
    };
  });
  const values = Object.values(coverage?.value ?? {})
    .map((m) => m.value)
    .filter((v): v is number => v !== null);
  const scale =
    values.length === 0
      ? NOT_YET
      : `${count(Math.max(...values), "site", "sites")}, ${count(
          values.filter((v) => v > 0).length,
          "check",
          "checks",
        )} on each`;
  const window = nights.filter(
    (n) => newest !== undefined && nightsBetween(n.night, newest.night) < WINDOW_NIGHTS,
  );
  const results = window.flatMap((n) => Object.values(n.counts.steps)).filter(finished);
  return {
    startsAt: pacificTimeOfCron(NIGHTLY_CRON, now),
    sendsAt: pacificTimeOfCron(SEND_CRON, now),
    steps,
    scale,
    reliability:
      window.length === 0
        ? NOT_YET
        : `${results.filter(isGreen).length} of ${count(results.length, "run", "runs")} green over the last ${count(window.length, "night", "nights")}`,
  };
}

// ---- section 6: upkeep ----

export type UpkeepView = {
  automerged: string;
  vulnsCleared: string;
  open: Array<{ siteName: string; text: string }>;
  depsBehind: string;
};

function upkeepView(model: CockpitModel, s: CockpitSnapshot): UpkeepView {
  // A vulnerability inside its wait never reaches a card (markWaiting), so a site
  // holding critical or high ones with no vuln item on its card is waiting on the
  // fix that is already scheduled.
  const open = model.cards
    .filter((c) => c.site.status === "maintained")
    .map((c) => ({
      card: c,
      n: (c.site.securityVulnsCritical ?? 0) + (c.site.securityVulnsHigh ?? 0),
      item: c.items.find((i) => i.kind === "vuln"),
    }))
    .filter((x) => x.n > 0)
    .sort((a, b) => a.card.site.name.localeCompare(b.card.site.name));
  const deps = newestMeasured(s.nights, (c) => c.deps);
  return {
    automerged: overNights(
      windowed(s.nights, (c) => c.events.value?.["pr_automerged"] ?? null),
      "merged",
    ),
    vulnsCleared: overNights(
      windowed(s.nights, (c) => c.events.value?.["vuln_cleared"] ?? null),
      "cleared",
    ),
    open: open.map(({ card, n, item }) => ({
      siteName: card.site.name,
      text: `${count(n, "critical or high vulnerability", "critical or high vulnerabilities")}: ${
        item === undefined
          ? "waiting on the automatic fix already scheduled (a direct one waits 4 days; one deeper in the tree waits for the Monday lockfile window)"
          : item.autoFixExhausted === true
            ? "the automatic fix gave up, so we fix it by hand"
            : "past its wait, so it needs us this week"
      }`,
    })),
    depsBehind: deps === null ? NOT_YET : count(deps.value.behind, "package", "packages"),
  };
}

// ---- the page ----

export type OverviewView = {
  status: StatusView;
  live: LiveRow[];
  leads: LeadsView;
  reports: ReportsView;
  nightly: NightlyView;
  upkeep: UpkeepView;
  /** Section 7: PRs merged in the stack's own repo. */
  prsMerged: string;
  /** How many `fleet_daily` nights the page has, for "over the last K nights". */
  nightsCollected: number;
};

/** The overview from the snapshot. Pure: every number is a test against fixture rows. */
export function overviewFromSnapshot(s: CockpitSnapshot, now: Date): OverviewView {
  const model = cockpitModelFromSnapshot(s, now);
  const names = new Map((s.sites ?? []).map((x) => [x.id, x.name]));
  const live = liveRows(model, s.submissions, now);
  return {
    status: statusView(model, live, now),
    live,
    leads: leadsView(s, (id) => names.get(id) ?? "A site no longer listed", now),
    reports: reportsView(model, s.reports, now),
    nightly: nightlyView(s, now),
    upkeep: upkeepView(model, s),
    prsMerged: overNights(
      windowed(s.nights, (c) => c.prsMerged.value),
      "merged",
    ),
    nightsCollected: s.nights?.length ?? 0,
  };
}

/** The ladder, in four lines (section 6). */
export const LADDER_LINES: readonly string[] = [
  "Broken: a visitor or a client is affected now, such as a form that fails or a site that does not answer.",
  "Attention: fix this week. Nobody outside is affected yet, but someone will be if it waits.",
  "Watch: we keep an eye on it. Nothing to do yet.",
  "OK: every check passed.",
];

/** The page's own "How we count": one line for every number it shows. */
export const HOW_WE_COUNT: ReadonlyArray<{ term: string; text: string }> = [
  {
    term: "Sites in our care",
    text: "Sites on a maintenance plan. Sites still launching are not counted until they go live.",
  },
  {
    term: "Broken, attention, watch",
    text: "Each site's worst open item on the ladder below, the same as the Triage page. A report waiting for your yes is counted on its own.",
  },
  {
    term: "Live",
    text: 'The address resolves (the URL probe) and its pages answer (the uptime check). A result more than 3 days old reads "not checked lately".',
  },
  {
    term: "Domain",
    text: "Days left on the site's security certificate, from the nightly domain check.",
  },
  { term: "Deploy", text: "The latest production deploy (the site's newest published version)." },
  {
    term: "Forms",
    text: 'The nightly live form test sends a real test entry through the form. A result more than 3 days old reads "not tested lately", never "passed". "Last real one" is the newest submission accepted as real.',
  },
  {
    term: "Submissions",
    text: "Everything a site's forms received and stored. This month counts from the 1st, by the UTC date it arrived.",
  },
  {
    term: "Accepted as real",
    text: "Leads and signups kept as real: new, read or archived.",
  },
  { term: "Client notified", text: "Of those, how many the client was emailed about." },
  { term: "Screened as spam", text: "Caught automatically after it arrived." },
  { term: "Marked spam by hand", text: "Marked spam by one of us." },
  {
    term: "Stopped before storage",
    text: "Bots stopped by the hidden field and the timing check, never stored. All time is from the last nightly count; it is never added to the spam counts above.",
  },
  {
    term: "Reports sent",
    text: 'Client reports that went out, less the August test sends (approved by "test send via Claude"). Approved first means approved before it went; around the gate is the rest.',
  },
  {
    term: "Lighthouse",
    text: "The middle score of our sites on a maintenance plan, from Google's Lighthouse audit, out of 100.",
  },
  {
    term: "Next report due",
    text: "The earlier of the next Maintenance and Testing report, from each site's schedule. Waiting is drafts ready for your yes.",
  },
  {
    term: "Times",
    text: "Worked out from the schedule the nightly runs on, in Pacific time, so they move with daylight saving.",
  },
  {
    term: "Steps",
    text: "Each step's result on the newest night, the last time it stamped a site, and how many sites it reached that night.",
  },
  {
    term: "Scale",
    text: "The most sites any check reached on the newest night, and how many kinds of check reached at least one.",
  },
  {
    term: "Runs green",
    text: "Of the steps that finished on each night we have counted (up to 30), how many came back green.",
  },
  {
    term: "Updates merged automatically",
    text: 'Dependency updates merged without us, counted each night. A window needs two nights to subtract, so one night reads "not yet collected".',
  },
  {
    term: "Vulnerabilities cleared",
    text: "Vulnerabilities that went away, counted the same way.",
  },
  {
    term: "Open now",
    text: "Critical and high vulnerabilities on each site, and what is already fixing them.",
  },
  {
    term: "Dependencies behind",
    text: "Packages a major version behind, added up across sites, from the newest nightly count.",
  },
  {
    term: "PRs merged",
    text: "Changes merged into the maintenance stack itself, counted each night.",
  },
];
