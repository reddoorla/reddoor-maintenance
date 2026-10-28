import type { CockpitSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import {
  cockpitModelFromSnapshot,
  storedStatus,
} from "../../../../src/dashboard/snapshot-views.js";
import type { CockpitModel, SiteCard, Tier } from "../../../../src/dashboard/fleet-cockpit.js";
import {
  buildNeedsYouFeed,
  isFailedDeployStatus,
  isReadyDeployStatus,
  itemLevel,
} from "../../../../src/dashboard/fleet-cockpit.js";
import type { AttentionItem } from "../../../../src/alerts/attention.js";
import {
  DIRECT_VULN_WAIT_DAYS,
  LOCKFILE_SETTLE_DAYS,
  directVulnEscalatesAt,
  markWaiting,
  transitiveVulnEscalatesAt,
} from "../../../../src/alerts/waiting.js";
import { daysFlagged, levelOf } from "../../../../src/alerts/ladder.js";
import {
  CERT_ATTENTION_DAYS,
  CERT_BROKEN_DAYS,
  certDaysNow,
  freshWithin,
  PRODUCTION_STALE_DAYS,
} from "../../../../src/alerts/production-signals.js";
import { collectVulnAlerts, urlProbeFresh } from "../../../../src/alerts/digest-collectors.js";
import { diffAttention } from "../../../../src/alerts/digest-state.js";
import {
  NIGHTLY_CRON,
  SEND_CRON,
  pacificTimeOfCron,
} from "../../../../src/dashboard/nightly-schedule.js";
import { DEFAULT_COPY } from "../../../../src/reports/copy.js";
import { isPendingApproval, type ReportRow } from "../../../../src/reports/report-row.js";
import { nextDueDate } from "../../../../src/reports/due.js";
import type { SubmissionRow } from "../../../../src/reports/submission-row.js";
import { isLeadFormType } from "../../../../src/forms/types.js";
import type { WebsiteRow } from "../../../../src/fleet/site-row.js";
import { siteSlug } from "../../../../src/fleet/site-row.js";
import type { OverviewNight } from "../../../../src/fleet-daily/read.js";
import type { StepResult } from "../../../../src/fleet-daily/types.js";
import { TRIAGE_PATH } from "../../../../src/dashboard/home-path.js";
import { NETLIFY_SITE_NOT_FOUND } from "../../../../src/fleet/roster-url-probe.js";
import { OVERVIEW_NIGHTS } from "../../../../src/fleet-daily/types.js";

/**
 * P1-78g: the overview at `/` as render-ready data (workspace
 * plans/2026-10-26-cockpit-for-the-team/plan.md, "The overview at `/`"). It reads
 * the snapshot every page reads, plus its `fleet_daily` nights, and nothing else:
 * no GitHub call, and no count typed into the page. Every number it shows has a
 * line in `HOW_WE_COUNT`, and a number nothing measured yet reads "not yet
 * collected", never 0.
 */

export const NOT_YET = "not yet collected";

/** A read that failed when the snapshot was taken: never 0, never "not yet". */
export const UNREADABLE = "not readable";

/** How many nights a window may span: "over the last K nights", K up to this. */
export const WINDOW_NIGHTS = 30;

/** A form's kind in words, for the headline's biggest site. */
const FORM_KIND: Record<string, string> = {
  contact: "a contact form",
  inquiry: "an inquiry form",
  newsletter: "a newsletter signup",
  rsvp: "an RSVP form",
  reserve: "a reservation form",
};

/** A submission kept as real: a lead or signup the client sees. */
const ACCEPTED = new Set(["new", "read", "archived"]);

/** August's "test send via Claude" reports went out but were never a client's report. */
export function isTestSend(r: Pick<ReportRow, "approvedBy">): boolean {
  return (r.approvedBy ?? "").toLowerCase().includes("test send");
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const count = (n: number, one: string, many: string): string => `${n} ${plural(n, one, many)}`;

/** How long ago, in words: "5 hours ago", "1 week ago". Its own, not the fleet card's
 *  "5h ago", so a client-adjacent page never shows a unit as a letter (review round 4,
 *  O11); null for a missing or unparseable stamp. */
export function agoInWords(iso: string | null, now: Date): string | null {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return "just now";
  if (hours < 1) return `${count(minutes, "minute", "minutes")} ago`;
  if (days < 1) return `${count(hours, "hour", "hours")} ago`;
  if (days < 7) return `${count(days, "day", "days")} ago`;
  if (days < 30) return `${count(Math.floor(days / 7), "week", "weeks")} ago`;
  if (days < 365) return `${count(Math.floor(days / 30), "month", "months")} ago`;
  return `${count(Math.floor(days / 365), "year", "years")} ago`;
}

const PACIFIC_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "Oct 27, 11:40pm PT". */
export function pacificStamp(iso: string): string {
  const parts = PACIFIC_STAMP.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase()} PT`;
}

const PACIFIC_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});

/** "Nov 2", the Pacific calendar day of an instant. */
const pacificDay = (d: Date): string => PACIFIC_DAY.format(d);

// ---- section 1: the one-line status ----

export type BrokenRow = {
  key: string;
  siteName: string;
  url: string;
  reasons: string;
  age: string | null;
};

/** One sentence of the status line. A count links to its group on the Triage page
 *  (an anchor there, not a filter: /triage has none). `term` is its How-we-count line. */
export type StatusPart = { text: string; term: string; href?: string };

export type StatusView = {
  /** "17 sites in our care. All live at the last check, Oct 26, 11:30pm PT. …" */
  line: string;
  parts: StatusPart[];
  cls: "ok" | "broken" | "attention" | "watch";
  broken: BrokenRow[];
  counts: {
    broken: number;
    fleetBroken: number;
    attention: number;
    fleetAttention: number;
    watch: number;
    approval: number;
  };
};

function ageOf(since: string | undefined | null, now: Date): string | null {
  if (!since) return null;
  const days = daysFlagged(since, now);
  // The site's age, from its oldest open Broken item, said beside its name so it is
  // never read as the last reason's (review rounds 6 and 7, R6-2, R7-3).
  return days === 0 ? "first flagged today" : `first flagged ${count(days, "day", "days")} ago`;
}

/** A Broken item in plain words, for section 1. The triage titles are the operator's
 *  ("a sampled page did not answer 2xx or 3xx"); a kind with no line here keeps it. */
const BROKEN_IN_PLAIN_WORDS: Partial<Record<AttentionItem["kind"], string>> = {
  uptime: "a page on the site did not answer at the last check",
  url: "the site's address does not answer",
  domain: "the domain does not answer, or has no working security certificate",
  cert: "its security certificate runs out within 7 days",
  deploy: "the latest deploy failed",
  "function-health": "a server function (the code behind forms and similar) is failing",
  cms: "the site cannot reach its CMS, where its content is edited",
  render: "pages fail to show in a browser",
  form: "the contact form failed its nightly test",
  deadletter: "leads are stuck and have not reached the client",
  "notify-bounce": "lead emails to the client are bouncing",
  turnstile: "the form's spam check is turning people away",
};

/** One item's words. Two kinds say what the site's own reading says, so section 1
 *  never contradicts the site's cells: an expired certificate is "expired", and a
 *  failed deploy read too long ago is dated as an old reading, since the deploy
 *  collector has no freshness gate of its own (review round 5, R5-1, R5-4). */
function plainWords(it: AttentionItem, site: WebsiteRow | undefined, now: Date): string {
  if (it.kind === "cert" && site?.domainCheckedAt) {
    const d = certDaysNow(site.certDaysRemaining, site.domainCheckedAt, now);
    if (d !== null && d < 0) return "its security certificate has expired";
  }
  if (
    it.kind === "deploy" &&
    site &&
    !freshWithin(site.deployCheckedAt, PRODUCTION_STALE_DAYS, now)
  )
    // One clause, no semicolon: reasons are joined with "; " (review round 6, R6-2).
    return `the latest deploy had failed when last checked (${site.deployCheckedAt ? pacificStamp(site.deployCheckedAt) : "date not recorded"}, no check since)`;
  return BROKEN_IN_PLAIN_WORDS[it.kind] ?? it.title;
}

function plainReasons(
  items: readonly AttentionItem[],
  site: WebsiteRow | undefined,
  now: Date,
): string | null {
  const words = [...new Set(items.map((it) => plainWords(it, site, now)))];
  return words.length > 0 ? words.join("; ") : null;
}

function statusView(
  model: CockpitModel,
  live: LiveRow[],
  reportsRead: boolean,
  now: Date,
): StatusView {
  const feed = buildNeedsYouFeed(model);
  const cards = new Map(model.cards.map((c) => [c.site.name, c]));
  const cardless = (model.cardless ?? []).filter((i) => i.waiting !== true);
  const cardlessAt = (l: string) =>
    cardless.filter((i) => (i.level ?? levelOf(i, undefined, now)) === l);
  const broken: BrokenRow[] = [
    ...feed
      .filter((i) => i.group === "broken")
      .map((i) => ({
        key: i.slug || i.siteName,
        siteName: i.siteName,
        url: i.url,
        reasons:
          plainReasons(
            (cards.get(i.siteName)?.items ?? []).filter((it) => itemLevel(it) === "broken"),
            cards.get(i.siteName)?.site,
            now,
          ) ?? i.reasons.join(" · "),
        age: ageOf(i.since, now),
      })),
    ...cardlessAt("broken").map((i) => ({
      key: i.key,
      siteName: i.siteName || "The fleet",
      url: `${TRIAGE_PATH}#cardless`,
      reasons: plainReasons([i], undefined, now) ?? i.title,
      age: ageOf(i.firstFlaggedAt, now),
    })),
  ];
  // Sites, never mixed with fleet-wide items: those are counted on their own.
  const brokenSites = feed.filter((i) => i.group === "broken").length;
  const fleetBroken = cardlessAt("broken").length;
  const attention = feed.filter((i) => i.group === "attention").length;
  const fleetAttention = cardlessAt("attention").length;
  const watch = feed.filter((i) => i.group === "watch").length;
  // Every draft waiting for a yes on a site in our care, however many on one site
  // and whatever else that site carries (the feed's approval group holds only sites
  // with nothing worse). Counted over the same sites as the per-site table below,
  // so the count and the table's "Waiting" agree (review round 3, C3).
  const inCareNames = new Set(
    model.cards.filter((c) => c.site.status === "maintained").map((c) => c.site.name),
  );
  const approval = model.pending.filter((p) => inCareNames.has(p.siteName)).length;

  const inCare = inCareNames.size;
  const down = live.filter((r) => r.live.ok === false).length;
  const unsampled = live.filter((r) => r.live.unsampled).length;
  const unknown = live.filter((r) => r.live.ok === null && !r.live.unsampled).length;
  const up = live.filter((r) => r.live.ok === true);
  const oldest = up
    .map((r) => r.live.atIso)
    .filter((t): t is string => t !== null)
    .sort()[0];
  const asOf = oldest === undefined ? "" : ` at the last check, ${pacificStamp(oldest)}`;
  const parts: StatusPart[] = [
    { text: `${count(inCare, "site", "sites")} in our care.`, term: "Sites in our care" },
  ];
  if (live.length > 0) {
    if (down === 0 && unknown === 0 && unsampled === 0)
      parts.push({ text: `${inCare === 1 ? "It was live" : "All live"}${asOf}.`, term: "Live" });
    else {
      if (down > 0) parts.push({ text: `${down} not live at the last check.`, term: "Live" });
      if (unknown > 0) parts.push({ text: `${unknown} not checked lately.`, term: "Live" });
      if (unsampled > 0)
        parts.push({
          text: `${count(unsampled, "answers at its address, but no page was", "answer at their address, but no page was")} sampled.`,
          term: "Live",
        });
      if (up.length > 0) parts.push({ text: `${up.length} live${asOf}.`, term: "Live" });
    }
  }
  // Each count links to its group on the Triage page, and only to a group that is
  // there for this data: the feed's groups are the Triage page's ids, and the
  // fleet-wide lane is `#cardless` whenever it holds an item.
  const approvalThere = feed.some((i) => i.group === "approval" && inCareNames.has(i.siteName));
  const toGroup = (g: string) => `${TRIAGE_PATH}#${g}`;
  const levels: StatusPart[] = [];
  const LEVEL = "Broken, attention, watch";
  if (brokenSites > 0)
    levels.push({
      text: `${count(brokenSites, "site", "sites")} broken.`,
      term: LEVEL,
      href: toGroup("broken"),
    });
  if (fleetBroken > 0)
    levels.push({
      text: `${count(fleetBroken, "item not tied to one site is", "items not tied to one site are")} broken.`,
      term: LEVEL,
      href: toGroup("cardless"),
    });
  if (attention > 0)
    levels.push({
      text: `${count(attention, "site needs", "sites need")} attention this week.`,
      term: LEVEL,
      href: toGroup("attention"),
    });
  if (fleetAttention > 0)
    levels.push({
      text: `${count(fleetAttention, "item not tied to one site needs", "items not tied to one site need")} attention too.`,
      term: LEVEL,
      href: toGroup("cardless"),
    });
  if (watch > 0)
    levels.push({
      text: `${count(watch, "site", "sites")} to watch.`,
      term: LEVEL,
      href: toGroup("watch"),
    });
  if (approval > 0)
    levels.push({
      text: `${count(approval, "report waits", "reports wait")} for your yes.`,
      term: "Waiting for your yes",
      // The Triage page has an approval group only for sites with nothing worse;
      // otherwise the drafts sit in this page's own per-site table.
      href: approvalThere ? toGroup("approval") : "#ov-reports",
    });
  // A failed reports read is no drafts waiting: say it, and never "Nothing needs
  // attention" without it (review round 5, R5-3).
  if (!reportsRead)
    levels.push({
      text: `Reports waiting for your yes: ${UNREADABLE}.`,
      term: "Waiting for your yes",
      href: "#ov-reports",
    });
  parts.push(...(levels.length > 0 ? levels : [{ text: "Nothing needs attention.", term: LEVEL }]));
  const cls =
    brokenSites + fleetBroken > 0
      ? "broken"
      : attention + fleetAttention > 0
        ? "attention"
        : watch > 0
          ? "watch"
          : "ok";
  return {
    line: parts.map((p) => p.text).join(" "),
    parts,
    cls,
    broken,
    counts: { broken: brokenSites, fleetBroken, attention, fleetAttention, watch, approval },
  };
}

// ---- section 2: is every site live? ----

export type Cell = { ok: boolean | null; text: string };

/** The Live cell also says when it was read: the older of its two checks.
 *  `unsampled`: the address answers and the browser check ran, but it sampled no
 *  page, so whether pages answer is unmeasured (src/audits/browser.ts). */
export type LiveCell = Cell & { at: string | null; atIso: string | null; unsampled: boolean };

export type LiveRow = {
  siteId: string;
  siteName: string;
  url: string;
  live: LiveCell;
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

const olderOf = (stamps: Array<string | null>): string | null =>
  stamps
    .filter((t): t is string => t !== null && Number.isFinite(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;

/** Live = the address resolves (the URL probe) AND its pages answer (the browser
 *  audit's uptime check). Either fresh fail is named; anything stale is unknown. */
export function liveCell(site: WebsiteRow, now: Date): LiveCell {
  const urlFresh = urlProbeFresh(site.urlCheckedAt, now);
  const pagesFresh = freshWithin(site.browserCheckedAt, PRODUCTION_STALE_DAYS, now);
  const stamped = (atIso: string | null) => ({
    atIso,
    at: atIso === null ? null : pacificStamp(atIso),
    unsampled: false,
  });
  const failed = [
    urlFresh && site.urlResolves === "fail"
      ? `address not answering${site.urlStatus ? ` (${urlStatusText(site.urlStatus)})` : ""}`
      : null,
    pagesFresh && site.reachableOk === "fail" ? "a page not answering" : null,
  ].filter((s): s is string => s !== null);
  if (failed.length > 0) {
    const text = failed.join(", ");
    return {
      ok: false,
      text: text[0]!.toUpperCase() + text.slice(1),
      ...stamped(
        olderOf([
          urlFresh && site.urlResolves === "fail" ? site.urlCheckedAt : null,
          pagesFresh && site.reachableOk === "fail" ? site.browserCheckedAt : null,
        ]),
      ),
    };
  }
  if (urlFresh && site.urlResolves === "pass" && pagesFresh && site.reachableOk === "pass")
    return {
      ok: true,
      text: "Live",
      ...stamped(olderOf([site.urlCheckedAt, site.browserCheckedAt])),
    };
  if (urlFresh && site.urlResolves === "pass" && pagesFresh && site.reachableOk === null)
    return {
      ok: null,
      text: "Address answers; no page sampled",
      ...stamped(olderOf([site.urlCheckedAt, site.browserCheckedAt])),
      unsampled: true,
    };
  return { ok: null, text: "Not checked lately", at: null, atIso: null, unsampled: false };
}

/** Network error codes the URL probe stores (`error: <code>`), in plain words. */
const NETWORK_ERROR_TEXT: Record<string, string> = {
  ENOTFOUND: "no such address",
  EAI_AGAIN: "the address could not be looked up",
  ECONNREFUSED: "the server refused the connection",
  ECONNRESET: "the connection was cut off",
  ETIMEDOUT: "it took too long to answer",
  UND_ERR_CONNECT_TIMEOUT: "it took too long to answer",
  CERT_HAS_EXPIRED: "its security certificate has expired",
};

/** The URL probe's stored status (src/fleet/roster-url-probe.ts) in plain words: an
 *  HTTP code with what it means, a known network error by name, and an unknown one
 *  glossed as a network error with its code kept. */
export function urlStatusText(status: string): string {
  if (status === NETLIFY_SITE_NOT_FOUND) return "our host serves no site there";
  if (/^\d{3}$/.test(status)) {
    const n = Number(status);
    if (n === 404) return "page not found, 404";
    if (n >= 500) return `server error ${n}`;
    return `it answered ${n}`;
  }
  const err = /^error:\s*(.+)$/.exec(status);
  if (err) return NETWORK_ERROR_TEXT[err[1]!] ?? `a network error, code ${err[1]}`;
  return status;
}

/** The certificate's days left, by the ladder's own sum (`certDaysNow`, which
 *  `collectDomainAlerts` uses): counted down from the check, and a fresh check that
 *  stored no days is a domain that does not answer, which the ladder calls Broken
 *  (review round 4, C1). */
export function domainCell(site: WebsiteRow, now: Date): Cell {
  if (!freshWithin(site.domainCheckedAt, PRODUCTION_STALE_DAYS, now))
    return { ok: null, text: "Not checked lately" };
  const d = certDaysNow(site.certDaysRemaining, site.domainCheckedAt!, now);
  if (d === null) return { ok: false, text: "Domain does not answer, or no working certificate" };
  if (d < 0) return { ok: false, text: "Certificate expired" };
  return { ok: d > CERT_ATTENTION_DAYS, text: `${count(d, "day", "days")} left` };
}

/** The latest production deploy, as the nightly deploy check last read it. A reading
 *  older than the freshness window is unknown, never a green "published". */
export function deployCell(site: WebsiteRow, now: Date): Cell {
  if (!freshWithin(site.deployCheckedAt, PRODUCTION_STALE_DAYS, now))
    return { ok: null, text: "Not checked lately" };
  if (site.deployStatus === null) return { ok: null, text: "No deploy recorded" };
  if (isFailedDeployStatus(site.deployStatus)) return { ok: false, text: "Latest deploy failed" };
  if (isReadyDeployStatus(site.deployStatus))
    return {
      ok: true,
      text: `Published ${agoInWords(site.lastDeployAt, now) ?? "(date not recorded)"}`,
    };
  return { ok: null, text: "A deploy was in progress" };
}

export const FORM_TEST_FAILED =
  "Test failed, but the test itself is being fixed, so this is not yet a verdict";

/** The nightly live form test. A verdict counts only beside a fresh stamp: a stale
 *  pass is "not tested lately", never "working". */
export function formsCell(site: WebsiteRow, now: Date): Cell {
  if (!freshWithin(site.formE2eCheckedAt, PRODUCTION_STALE_DAYS, now))
    return { ok: null, text: "Not tested lately" };
  // Not a verdict yet: the test's failures on 10-26 were all false, so it does not
  // place a site on the ladder until it is fixed (src/dashboard/fleet-cockpit.ts,
  // collectFormTestAlerts is not registered). Shown in the unknown style, and said.
  if (site.formE2eOk === "fail") return { ok: null, text: FORM_TEST_FAILED };
  if (site.formE2eOk === "pass") return { ok: true, text: "Test passed" };
  return { ok: null, text: "No result (no form, or the test skipped it)" };
}

function liveRows(
  model: CockpitModel,
  subs: SubmissionRow[] | null,
  status: (r: SubmissionRow) => string,
  now: Date,
): LiveRow[] {
  const lastReal = new Map<string, SubmissionRow>();
  for (const r of subs ?? []) {
    if (!ACCEPTED.has(status(r)) || r.submittedAt === null) continue;
    const prev = lastReal.get(r.siteId);
    if (prev === undefined || Date.parse(r.submittedAt) > Date.parse(prev.submittedAt!))
      lastReal.set(r.siteId, r);
  }
  return model.cards
    .filter((c) => c.site.status === "maintained")
    .sort((a, b) => a.site.name.localeCompare(b.site.name))
    .map((c: SiteCard) => {
      const last = lastReal.get(c.site.id);
      return {
        siteId: c.site.id,
        siteName: c.site.name,
        url: `/s/${siteSlug(c.site.name)}`,
        live: liveCell(c.site, now),
        domain: domainCell(c.site, now),
        deploy: deployCell(c.site, now),
        forms: formsCell(c.site, now),
        lastLead:
          subs === null
            ? `last lead ${UNREADABLE}`
            : last === undefined
              ? "no real lead yet"
              : // An RSVP or a signup is a real submission, not a lead.
                `last real ${isLeadFormType(last.formType) ? "lead" : "submission"} ${agoInWords(last.submittedAt, now)}`,
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
  /** Since this, all time: the oldest submission's Pacific date, "Jun 15, 2026". */
  since: string | null;
  /** The site with the most submissions and its share of the total, so the headline
   *  never hides that one site (an RSVP site, today) holds much of it. Null with
   *  fewer than two sites. */
  biggest: {
    siteName: string;
    submissions: number;
    share: number;
    /** Its most used form, in words ("an RSVP form"). */
    formKind: string;
    /** How many of the accepted are from it. */
    accepted: number;
  } | null;
  /** All time, from the newest `fleet_daily` night; this month, from the snapshot's
   *  screen-out buckets. Their own line, never added to `screened`. */
  stoppedAllTime: string;
  /** The night the all-time figure was counted, "Oct 26"; null with no count. */
  stoppedAsOf: string | null;
  stoppedThisMonth: string;
  /** Every site with a submission, biggest first: per-site counts beside the total. */
  perSite: Array<{ siteId: string; siteName: string } & LeadCounts>;
};

/** `status` is the stored value: one the code does not know is no kind of lead. */
function tally(rows: SubmissionRow[], status: (r: SubmissionRow) => string): LeadCounts {
  const n: LeadCounts = { submissions: 0, accepted: 0, notified: 0, screened: 0, byHand: 0 };
  for (const r of rows) {
    n.submissions++;
    const st = status(r);
    if (ACCEPTED.has(st)) {
      n.accepted++;
      if (r.notifyStatus === "sent") n.notified++;
    } else if (st === "spam_auto") n.screened++;
    else if (st === "spam") n.byHand++;
  }
  return n;
}

const PACIFIC_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function pacificParts(t: number): Record<string, number> {
  return Object.fromEntries(
    PACIFIC_PARTS.formatToParts(new Date(t))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
}

/** The start of this Pacific calendar month: the instant, and its day `YYYY-MM-01`
 *  for the screen-out buckets, which are kept by day. */
export function pacificMonthStart(now: Date): { at: number; day: string } {
  const { year, month } = pacificParts(now.getTime());
  const day = `${year}-${String(month).padStart(2, "0")}-01`;
  // Midnight Pacific is 07:00 or 08:00 UTC, by daylight saving on the 1st.
  for (const h of [7, 8]) {
    const at = Date.UTC(year!, month! - 1, 1, h);
    const p = pacificParts(at);
    if (p.day === 1 && p.hour === 0) return { at, day };
  }
  throw new Error(`pacificMonthStart: no Pacific midnight on ${day}`);
}

const LONG_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function leadsView(
  s: CockpitSnapshot,
  siteName: (id: string) => string,
  status: (r: SubmissionRow) => string,
  now: Date,
): LeadsView {
  const subs = s.submissions;
  const month = pacificMonthStart(now);
  const latestScreen = newestMeasured(s.nights, (c) => c.screenouts);
  const monthBuckets = (s.screenOuts ?? []).filter((b) => b.date >= month.day);
  const bySite = new Map<string, SubmissionRow[]>();
  for (const r of subs ?? []) bySite.set(r.siteId, [...(bySite.get(r.siteId) ?? []), r]);
  const oldest = (subs ?? [])
    .map((r) => (r.submittedAt === null ? Number.NaN : Date.parse(r.submittedAt)))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)[0];
  const perSite = [...bySite]
    .map(([id, rows]) => ({ siteId: id, siteName: siteName(id), ...tally(rows, status) }))
    .sort((a, b) => b.submissions - a.submissions || a.siteName.localeCompare(b.siteName));
  const total = subs?.length ?? 0;
  const top = perSite[0];
  const topKind = (() => {
    const kinds = new Map<string, number>();
    for (const r of bySite.get(top?.siteId ?? "") ?? [])
      kinds.set(r.formType, (kinds.get(r.formType) ?? 0) + 1);
    const [kind] = [...kinds].sort((a, b) => b[1] - a[1])[0] ?? [];
    return kind === undefined ? "its forms" : (FORM_KIND[kind] ?? `its ${kind} form`);
  })();
  return {
    allTime: subs === null ? null : tally(subs, status),
    thisMonth:
      subs === null
        ? null
        : tally(
            subs.filter((r) => r.submittedAt !== null && Date.parse(r.submittedAt) >= month.at),
            status,
          ),
    since: oldest === undefined ? null : LONG_DAY.format(new Date(oldest)),
    biggest:
      top === undefined || perSite.length < 2
        ? null
        : {
            siteName: top.siteName,
            submissions: top.submissions,
            share: Math.round((100 * top.submissions) / total),
            formKind: topKind,
            accepted: top.accepted,
          },
    stoppedAllTime:
      s.nights === null
        ? UNREADABLE
        : latestScreen === null
          ? NOT_YET
          : String(latestScreen.value.honeypot + latestScreen.value.tooFast),
    stoppedAsOf: latestScreen === null ? null : nightLabel(latestScreen.night),
    stoppedThisMonth:
      s.screenOuts === null
        ? UNREADABLE
        : String(monthBuckets.reduce((t, b) => t + b.honeypot + b.tooFast, 0)),
    perSite,
  };
}

// ---- section 4: client reports ----

/** The step's number in the nightly, counted from `NIGHTLY_STEPS`, so a reordered
 *  nightly renumbers every proof below instead of leaving a typed "Step 5" behind. */
export function stepNumber(file: string): number {
  const i = NIGHTLY_STEPS.findIndex((s) => s.file === file);
  if (i < 0) throw new Error(`overview: no nightly step ${file}`);
  return i + 1;
}

const LIGHTHOUSE_STEP = "fleet-lighthouse.yml";

/** The nightly job that proves each check a Maintenance report carries. Keyed by
 *  the report's own check names (`DEFAULT_COPY.maintenanceChecks`); each names its
 *  steps by file, and `n` turns a file into its number. */
export const CHECK_PROOF: Record<string, (n: (file: string) => number) => string> = {
  "Deploy & Function Health": (n) =>
    `Step ${n(LIGHTHOUSE_STEP)} reads the latest production deploy and calls the site's server functions.`,
  "CMS Checked": (n) =>
    `Step ${n(LIGHTHOUSE_STEP)} checks the CMS answers; step ${n("fleet-prismic-drift.yml")} checks its content models match the site's code.`,
  "Domain, DNS & SSL": (n) =>
    `Step ${n(LIGHTHOUSE_STEP)} resolves the domain and reads the security certificate's days left.`,
  "Google Indexed": (n) =>
    `Step ${n("daily-reports.yml")} asks Google Search Console (Google's report on which pages it has indexed) when it drafts the report.`,
  "Security Updates": (n) =>
    `Step ${n("fleet-security.yml")} lists known vulnerabilities. Automatic updates open the fixes, and one that waits too long comes to us.`,
  "Uptime Checked": (n) =>
    `Step ${n(LIGHTHOUSE_STEP)} checks, once a night, that the address resolves and its pages answer. It is not a minute-by-minute monitor.`,
};

export type ReportsView = {
  checks: Array<{ name: string; proof: string }>;
  /** Four separate medians over maintained sites with a score, one per category. */
  lighthouse: Array<{ label: string; median: string }>;
  /** The oldest Lighthouse audit behind the medians, "Oct 20"; null with none dated. */
  lighthouseAsOf: string | null;
  /** Null when the reports read failed. */
  sent: { real: number; approvedFirst: number; aroundGate: number; testSends: number } | null;
  /** `waiting` is a count as text: "not readable" when the reports read failed. */
  perSite: Array<{ siteId: string; siteName: string; nextDue: string; waiting: string }>;
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
  // Compared as instants: "…:00Z" and "…:00.000Z" are one moment but not one string.
  const approvedFirst = real.filter(
    (r) => r.approvedAt !== null && Date.parse(r.approvedAt) <= Date.parse(r.sentAt!),
  );
  return {
    checks: DEFAULT_COPY.maintenanceChecks.map((name) => {
      const proof = CHECK_PROOF[name];
      if (proof === undefined) throw new Error(`overview: no nightly proof for "${name}"`);
      return { name, proof: proof(stepNumber) };
    }),
    lighthouse: scores.map(([label, get]) => {
      const m = median(maintained.map(get).filter((v): v is number => v !== null));
      return { label, median: m === null ? NOT_YET : String(m) };
    }),
    lighthouseAsOf: (() => {
      const scored = maintained.filter((x) => scores.some(([, get]) => get(x) !== null));
      const oldest = olderOf(scored.map((x) => x.lastLighthouseAuditAt));
      return oldest === null ? null : pacificDay(new Date(oldest));
    })(),
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
        // With no reports read, nothing is known: never a schedule worked out from none.
        if (reports === null)
          return { siteId: site.id, siteName: site.name, nextDue: UNREADABLE, waiting: UNREADABLE };
        const due = (["Maintenance", "Testing"] as const)
          .map((type) => ({ type, at: nextDueDate(site, reports, type, now) }))
          .filter((d): d is { type: "Maintenance" | "Testing"; at: Date } => d.at !== null)
          .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
        return {
          siteId: site.id,
          siteName: site.name,
          nextDue: due ? `${due.type}, ${SHORT_DATE.format(due.at)}` : "none scheduled",
          waiting: String(
            reports.filter((r) => r.siteId === site.id && isPendingApproval(r)).length,
          ),
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
 *  alone has nothing to subtract, so it is "not yet collected", never 0. K counts
 *  calendar nights, as every "the last K nights" on the page does. */
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

/** The newest night whose row should be written by now, as the writer dates its rows
 *  (`nightOf`, src/fleet-daily/core.ts), read on the Pacific clock: the night that started yesterday evening,
 *  Pacific time, from 6am the morning after it. Before 6am, the night before that,
 *  so a run still going is never counted as missing. */
export function expectedNight(now: Date): string {
  // By the Pacific clock, not 24 fixed hours: a day the clock changes is 23 or 25
  // hours long, and 6am is 6am on it too (review round 5, R5-6).
  const p = pacificParts(now.getTime());
  const today = Date.UTC(p.year!, p.month! - 1, p.day!);
  return new Date(today - (p.hour! < 6 ? 2 : 1) * DAY_MS).toISOString().slice(0, 10);
}

/** How many nights after `night` up to the expected one have no count: 0 when
 *  `night` is the expected night (or later). */
function nightsSince(night: string, now: Date): number {
  return Math.max(0, nightsBetween(night, expectedNight(now)));
}

/** A window as the page says it; a failed read of the nights is "not readable".
 *  When the newest count is older than the night expected by now, the window is
 *  dated by its newest night and the nights since are said, so a nightly that
 *  stops writing never reads as "the last K nights" (review round 3, C1). */
function overNights(
  nights: OverviewNight[] | null,
  pick: (c: Counts) => number | null | undefined,
  now: Date,
): string {
  if (nights === null) return UNREADABLE;
  const measured = nights.filter((n) => typeof pick(n.counts) === "number");
  const newest = measured[0];
  if (newest === undefined) return NOT_YET;
  const lag = nightsSince(newest.night, now);
  const since = lag > 0 ? `; no count in the ${count(lag, "night", "nights")} since` : "";
  const w = windowed(nights, pick);
  if (w === null)
    // One night has nothing to subtract: say when counting started (review round 3, O4).
    return measured.length === 1
      ? `counting started on the night of ${nightLabel(newest.night)}; the first figure comes after a second night${since}`
      : NOT_YET;
  return lag > 0
    ? w.nights === 1
      ? `${w.value} over the night of ${nightLabel(newest.night)}${since}`
      : `${w.value} over the ${w.nights} nights to the night of ${nightLabel(newest.night)}${since}`
    : `${w.value} over the last ${w.nights === 1 ? "night" : `${w.nights} nights`}`;
}

/** A running total of one event type. A type missing from a measured total did not
 *  happen yet: 0, not unmeasured. */
const eventTotal =
  (type: string) =>
  (c: Counts): number | null =>
    c.events.value === null ? null : (c.events.value[type] ?? 0);

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
 *  coverage columns a step stamps; `stamps`, the site row's own stamps. A step that
 *  stamps no site says what it reaches in `reach` instead. */
export const NIGHTLY_STEPS: ReadonlyArray<{
  file: string;
  label: string;
  coverage: readonly string[];
  stamps: readonly StampField[];
  reach?: string;
}> = [
  {
    file: "fleet-db-backup.yml",
    label: "Backup, with a restore rehearsal (the copy is restored to prove it works)",
    coverage: [],
    stamps: [],
    reach: "the whole database, every site's records in one copy",
  },
  {
    file: "fleet-prismic-drift.yml",
    label: "Prismic (the CMS, where content is edited) check: its content models match the code",
    coverage: ["prismic_models_checked_at"],
    stamps: ["prismicModelsCheckedAt"],
  },
  {
    file: "fleet-prismic-sync.yml",
    label: "Prismic (the CMS) sync: a change made there comes back to the site's code for review",
    coverage: [],
    stamps: [],
    reach: "sites on Prismic, with a pull request only where something changed",
  },
  {
    file: "fleet-security.yml",
    label: "Security (known vulnerabilities, and packages behind)",
    coverage: ["security_audit_at", "deps_behind_packages_at"],
    stamps: ["lastSecurityAuditAt"],
  },
  {
    file: "fleet-lighthouse.yml",
    label:
      "Site checks: Lighthouse (Google's speed and quality audit), the domain and certificate, browsers (each site opened in a real browser), the deploy, server functions, and the URL probe (does the address answer)",
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
  {
    file: "daily-reports.yml",
    label: "Report drafts",
    coverage: [],
    stamps: [],
    reach: "sites with a report due",
  },
];

export type StepView = { label: string; outcome: string; lastFinished: string; sites: string };

export type NightlyView = {
  /** Which night the step results are from: "Night of Oct 26", or "Newest night"
   *  with none, so a nightly that stops writing never reads green forever. */
  nightOf: string;
  startsAt: string;
  sendsAt: string;
  steps: StepView[];
  /** "11 kinds of check ran on the night of Oct 26, reaching up to 17 sites". */
  scale: string;
  /** "N of M nightly steps ran to the end over the last K nights". */
  reliability: string;
};

/** GitHub's conclusions, in plain words. */
const CONCLUSION_TEXT: Record<string, string> = {
  // Only that the job ran to the end: what it found is in the tables (round 4, O1).
  success: "ran to the end",
  failure: "failed",
  cancelled: "cancelled",
  timed_out: "ran out of time",
  skipped: "skipped",
  action_required: "waiting for a person to approve it",
  neutral: "finished with no verdict",
  stale: "too old to count",
  startup_failure: "could not start",
};

export function outcomeText(r: StepResult | null | undefined): string {
  if (r === undefined || r === null) return "not recorded";
  if (r.outcome === "completed") return CONCLUSION_TEXT[r.conclusion] ?? "did not succeed";
  if (r.outcome === "running") return "still running when the night was written";
  if (r.outcome === "skipped") return "already run that night";
  return "could not start";
}

/** A `fleet_daily` night ("2026-10-26", the night that starts that evening in
 *  Pacific time) as the page says it: "Oct 26". */
export const nightLabel = (night: string): string => pacificDay(new Date(`${night}T12:00:00Z`));

const ranToEnd = (r: StepResult | null | undefined): boolean =>
  r?.outcome === "completed" && r.conclusion === "success";
const finished = (r: StepResult | null | undefined): boolean =>
  r?.outcome === "completed" || r?.outcome === "failed";

function nightlyView(s: CockpitSnapshot, now: Date): NightlyView {
  const unread = s.nights === null;
  const nights = s.nights ?? [];
  const newest = nights[0];
  // Coverage from the newest night that measured it, said with that night's date:
  // an older night's reach is never passed off as the newest night's.
  const coverage = newestMeasured(s.nights, (c) => c.coverage);
  const coverageNight =
    coverage === null
      ? ""
      : coverage.night === newest?.night
        ? " that night"
        : ` on the night of ${nightLabel(coverage.night)}`;
  const covered = (col: string): number | null => {
    const m = coverage?.value[col];
    return m && m.value !== null ? m.value : null;
  };
  const maintained = (s.sites ?? []).filter((x) => x.status === "maintained");
  const steps = NIGHTLY_STEPS.map((step) => {
    const stamps = maintained
      .flatMap((site) => step.stamps.map((f) => site[f]))
      .filter((v): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    // A step that stamps no site: the newest night it finished in, and how.
    const lastRun = nights.find((n) => finished(n.counts.steps[step.file]));
    const sites = step.coverage.map(covered).filter((v): v is number => v !== null);
    return {
      label: step.label,
      outcome: unread ? UNREADABLE : newest ? outcomeText(newest.counts.steps[step.file]) : NOT_YET,
      lastFinished:
        stamps.length > 0
          ? pacificStamp(stamps.at(-1)!)
          : step.stamps.length > 0
            ? "no site stamped yet"
            : unread
              ? UNREADABLE
              : lastRun === undefined
                ? NOT_YET
                : `${lastRun.counts.run?.startedAt ? `in the run that started ${pacificStamp(lastRun.counts.run.startedAt)}` : `on the night of ${nightLabel(lastRun.night)}`} (${outcomeText(lastRun.counts.steps[step.file])})`,
      sites:
        step.reach ??
        (unread
          ? UNREADABLE
          : sites.length === 0
            ? NOT_YET
            : `${count(Math.max(...sites), "site", "sites")}${coverageNight}`),
    };
  });
  const values = Object.values(coverage?.value ?? {})
    .map((m) => m.value)
    .filter((v): v is number => v !== null);
  const ran = values.filter((v) => v > 0);
  const scale = unread
    ? UNREADABLE
    : ran.length === 0
      ? NOT_YET
      : `${count(ran.length, "kind of check", "kinds of check")} ran on the night of ${nightLabel(coverage!.night)}, reaching up to ${count(Math.max(...ran), "site", "sites")}`;
  // One idea of a recorded night: a row with at least one step result. A row with
  // none (no block, or every step null) is a night not recorded, like a missing one,
  // and the lag, the "none since" night and the empty case all come from the newest
  // recorded night, never the newest row (review rounds 6 and 7, R6-1, R7-1, R7-2).
  const recorded = nights.filter((n) => Object.values(n.counts.steps).some((r) => r != null));
  const newestRecorded = recorded[0];
  // The window ends at the night expected by now, or the newest recorded night if
  // later: nights not recorded after it count as such (round 3, C1).
  const lag = newestRecorded === undefined ? 0 : nightsSince(newestRecorded.night, now);
  const end =
    newestRecorded === undefined ? undefined : lag > 0 ? expectedNight(now) : newestRecorded.night;
  const window = recorded.filter(
    (n) => end !== undefined && nightsBetween(n.night, end) < WINDOW_NIGHTS,
  );
  const results = window.flatMap((n) => Object.values(n.counts.steps)).filter(finished);
  // A night written while every step was still running holds no result yet: said on
  // its own, never counted as measured (review round 7, R7-4).
  const stillRunning = window.filter((n) => !Object.values(n.counts.steps).some(finished)).length;
  // Calendar nights, the window's end back to the oldest recorded one; any not
  // recorded are said.
  const span = window.length === 0 ? 0 : nightsBetween(window.at(-1)!.night, end!) + 1;
  const missing = span - window.length;
  const newestSaid =
    lag > 0 && newestRecorded !== undefined
      ? `, none since the night of ${nightLabel(newestRecorded.night)}`
      : "";
  const notes = [
    ...(missing > 0 ? [`${count(missing, "night", "nights")} not recorded${newestSaid}`] : []),
    ...(stillRunning > 0 && results.length > 0
      ? [`${count(stillRunning, "night", "nights")} still running when written`]
      : []),
  ];
  return {
    nightOf: newest === undefined ? "Newest night" : `Night of ${nightLabel(newest.night)}`,
    startsAt: pacificTimeOfCron(NIGHTLY_CRON, now),
    sendsAt: pacificTimeOfCron(SEND_CRON, now),
    steps,
    scale,
    reliability: unread
      ? UNREADABLE
      : newest === undefined
        ? NOT_YET
        : newestRecorded === undefined
          ? // Rows, but none with a step result: new only while the newest row is fresh.
            nightsSince(newest.night, now) > 0
            ? `no night has recorded how its steps went; the nightly last wrote on the night of ${nightLabel(newest.night)}, and nothing since`
            : NOT_YET
          : window.length === 0
            ? `no night recorded in the last ${WINDOW_NIGHTS}; the newest recorded was the night of ${nightLabel(newestRecorded.night)}`
            : `${
                // Steps written while still running: none had finished, never "0 of 0"
                // (review round 5, R5-5).
                results.length === 0
                  ? "no nightly step had finished"
                  : `${results.filter(ranToEnd).length} of ${count(results.length, "nightly step", "nightly steps")} ran to the end`
              } ${span === 1 ? "on the 1 night counted so far" : `over the last ${span} nights`}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`,
  };
}

// ---- section 6: upkeep ----

export type UpkeepView = {
  automerged: string;
  vulnsCleared: string;
  open: Array<{ siteId: string; siteName: string; text: string }>;
  depsBehind: string;
};

/** What is fixing a site's open vulnerabilities, from the item itself: the one wait
 *  rule that applies (markWaiting, src/alerts/waiting.ts) and its date, or that the
 *  wait is over. Plain words; the How-we-count line glosses the two rules. */
function openText(item: AttentionItem | undefined, waiting: boolean, n: number, now: Date): string {
  const it = n === 1 ? "it is" : "they are";
  if (item === undefined)
    return `no alert is open for ${n === 1 ? "it" : "them"}, so see the site's own page`;
  if (item.autoFixExhausted === true)
    return `the automatic update tried and gave up, so ${it} ours to fix by hand`;
  const since = item.firstFlaggedAt;
  const at =
    since === undefined
      ? null
      : item.transitiveOnly === true
        ? transitiveVulnEscalatesAt(since)
        : directVulnEscalatesAt(since);
  // A claim about our wait, never a promise that the update will clear it.
  const then = `if ${n === 1 ? "it is" : "they are"} still open then, ${n === 1 ? "it comes" : "they come"} to us`;
  if (waiting && at !== null)
    return item.transitiveOnly === true
      ? `${n === 1 ? "it sits" : "they sit"} deeper in the site's packages, so ${n === 1 ? "it waits" : "they wait"} for Monday's weekly package refresh and ${count(LOCKFILE_SETTLE_DAYS, "day", "days")} after it, until ${pacificDay(at)}; ${then}`
      : `we are waiting until ${pacificDay(at)} for an automatic update to fix ${n === 1 ? "it" : "them"}; ${then}`;
  // Not held, yet inside its wait: the digest's first sighting could not be read, and
  // missing data never mutes (markWaiting), so it is ours to look at.
  if (at === null || now.getTime() < at.getTime())
    return `we could not confirm when ${n === 1 ? "it was" : "they were"} first seen, so ${it} ours to look at this week`;
  const them = n === 1 ? "it" : "them";
  return item.transitiveOnly === true
    ? `Monday's weekly package refresh did not clear ${them} by ${pacificDay(at)}, so ${it} ours to fix this week`
    : `the automatic update did not clear ${them} by ${pacificDay(at)}, so ${it} ours to fix this week`;
}

/** A vulnerability `markWaiting` holds never reaches the card, so it is rebuilt here
 *  through the model's own steps for that one item (the collector, the digest's
 *  first sighting, markWaiting), never a second copy of the rule. Undefined when it
 *  is not held. */
function heldVuln(site: WebsiteRow, s: CockpitSnapshot, now: Date): AttentionItem | undefined {
  const raw = collectVulnAlerts([site], s.baseUrl);
  const { next } = diffAttention(raw, s.digest, now.toISOString().slice(0, 10));
  const [it] = markWaiting(raw, next, now, Object.keys(s.digest).length > 0);
  const firstFlaggedAt = it === undefined ? undefined : next[it.key]?.firstFlaggedAt;
  return it?.waiting === true && firstFlaggedAt !== undefined
    ? { ...it, firstFlaggedAt }
    : undefined;
}

/** A site whose security check is stale or missing: what it last read, if anything. */
function staleText(site: WebsiteRow, n: number): string {
  const at = site.lastSecurityAuditAt;
  const when = at !== null && Number.isFinite(Date.parse(at)) ? pacificDay(new Date(at)) : null;
  if (when === null || (site.securityVulnsCritical === null && site.securityVulnsHigh === null))
    return "has no security check on record, so we cannot say what is open now";
  const had =
    n === 0
      ? "no critical or high vulnerability"
      : count(n, "critical or high vulnerability", "critical or high vulnerabilities");
  return `had ${had} at the last security check, ${when}; not checked lately, so we cannot say what is open now`;
}

function upkeepView(model: CockpitModel, s: CockpitSnapshot, now: Date): UpkeepView {
  const open = model.cards
    .filter((c) => c.site.status === "maintained")
    .map((c) => {
      // Freshness first (review round 4, C2): a count from an audit older than the
      // freshness window, or none at all, is not "none open", whatever it reads.
      const critical = c.site.securityVulnsCritical;
      const high = c.site.securityVulnsHigh;
      const fresh =
        freshWithin(c.site.lastSecurityAuditAt, PRODUCTION_STALE_DAYS, now) &&
        (critical !== null || high !== null);
      const onCard = c.items.find((i) => i.kind === "vuln");
      const held = onCard === undefined ? heldVuln(c.site, s, now) : undefined;
      return {
        card: c,
        fresh,
        n: (critical ?? 0) + (high ?? 0),
        item: onCard ?? held,
        waiting: onCard === undefined && held !== undefined,
      };
    })
    .filter((x) => !x.fresh || x.n > 0)
    .sort((a, b) => a.card.site.name.localeCompare(b.card.site.name));
  const deps = newestMeasured(s.nights, (c) => c.deps);
  return {
    automerged: overNights(s.nights, eventTotal("pr_automerged"), now),
    vulnsCleared: overNights(s.nights, eventTotal("vuln_cleared"), now),
    open: open.map(({ card, n, item, waiting, fresh }) => ({
      siteId: card.site.id,
      siteName: card.site.name,
      // Read after the site's name: "Delta has 2 critical or high vulnerabilities; …".
      text: fresh
        ? `has ${count(n, "critical or high vulnerability", "critical or high vulnerabilities")}; ${openText(item, waiting, n, now)}`
        : staleText(card.site, n),
    })),
    depsBehind:
      s.nights === null
        ? UNREADABLE
        : deps === null
          ? NOT_YET
          : `${deps.value.behind}, added up across the ${count(deps.value.sitesRead, "site", "sites")} read on the night of ${nightLabel(deps.night)} (one package behind on three sites counts three times)`,
  };
}

// ---- section 8: trends ----

/** How many `fleet_daily` nights the charts wait for; until then the section says
 *  how many it has collected. */
export const TREND_NIGHTS = 14;

/** One night on a chart: its value, or null and why. Never 0 for a night with no count. */
export type TrendPoint = {
  value: number | null;
  note: string | null;
  /** Counted on an earlier ladder version: shaded as a break, never drawn. */
  earlier: boolean;
};

export type TrendSeries = {
  name: string;
  /** Columns rather than a line: a night's own count, not a level carried over. */
  bars: boolean;
  /** Drawn in the Broken colour, the one series red is for. */
  broken: boolean;
  points: TrendPoint[];
};

export type TrendChart = {
  title: string;
  /** Its line in How we count. */
  term: string;
  /** Each night of the window, oldest first, as the page says it: "Oct 26". */
  nights: string[];
  series: TrendSeries[];
  /** The axis: 0 to a round number at or above the highest value. */
  low: number;
  high: number;
  /** For screen readers, and anyone not reading the marks. */
  summary: string;
  /** Said under the chart: the earlier-ladder break, or what the chart stands in for. */
  note: string | null;
};

export type TrendsView = {
  /** "Collecting: 3 of 14 nights", or the span the charts cover. */
  status: string;
  charts: TrendChart[] | null;
};

const NO_COUNT = "no count that night";
const UNREAD_NIGHT = "could not be read that night";
const NO_BASE = "no count the night before, so nothing to subtract";
const UNREAD_BASE = "the night before could not be read, so nothing to subtract";
const EARLIER = "sorted into levels by earlier rules";
const NO_VERSION = "the nightly did not record which ladder rules it used";

const shiftNight = (night: string, days: number): string =>
  new Date(Date.parse(`${night}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The smallest of 1, 2, 5, 10, 20, 50, … at or above `n`. */
function roundUp(n: number): number {
  if (!Number.isFinite(n)) return 1;
  for (let step = 1; ; step *= 10) for (const m of [1, 2, 5]) if (m * step >= n) return m * step;
}

/** A count as stored, or null: a field missing or malformed in a hand-written or
 *  older row reads as unread, never as a number (review round 1). */
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

type Reading = { value: number } | { value: null; note: string };
const point = (r: Reading, earlier = false): TrendPoint => ({
  value: r.value,
  note: r.value === null ? r.note : null,
  earlier,
});

/** Section 8 from the `fleet_daily` nights (newest first, as the reader returns them).
 *  Every night of the window is a slot: a night with no row, or a count that could
 *  not be read, is a gap with its reason, never 0. A running total's night is its
 *  rise over the calendar night before, so a gap also gaps the night after it. The
 *  level chart reads only nights counted on the newest night's ladder version; the
 *  others are marked as a break, never joined to its lines. */
export function trendsFromDaily(nights: OverviewNight[] | null, now: Date): TrendsView {
  if (nights === null) return { status: UNREADABLE, charts: null };
  if (nights.length < TREND_NIGHTS)
    return {
      status: `Collecting: ${nights.length} of ${TREND_NIGHTS} nights; the charts start once all ${TREND_NIGHTS} are in`,
      charts: null,
    };
  const sorted = [...nights].sort((a, b) => b.night.localeCompare(a.night));
  const byNight = new Map(sorted.map((n) => [n.night, n.counts]));
  const newest = sorted[0]!.night;
  const expected = expectedNight(now);
  // To the night expected by now, so a nightly that stops shows as gaps at the end.
  const end = newest > expected ? newest : expected;
  const span = Math.min(WINDOW_NIGHTS, nightsBetween(sorted.at(-1)!.night, end) + 1);
  const days = Array.from({ length: span }, (_, i) => shiftNight(end, i - span + 1));
  // The newest night that records its ladder version names the current one.
  const ladder = sorted.find((n) => typeof n.counts.ladderVersion === "number")?.counts
    .ladderVersion;

  const unread: TrendPoint = point({ value: null, note: UNREAD_NIGHT });
  const noCount: TrendPoint = point({ value: null, note: NO_COUNT });
  /** A count read off one night's own row; `levels` reads only the current ladder. */
  const own = (read: (c: Counts) => unknown, levels = false) =>
    days.map((d) => {
      const c = byNight.get(d);
      if (c === undefined) return noCount;
      if (levels && typeof c.ladderVersion !== "number")
        return point({ value: null, note: NO_VERSION });
      if (levels && c.ladderVersion !== ladder) return point({ value: null, note: EARLIER }, true);
      const v = finite(read(c));
      return v === null ? unread : point({ value: v });
    });
  /** A running total's rise over the calendar night before. A fall is not a night's
   *  count of anything (a lead later marked spam leaves the sent-on total), so it is
   *  a gap that says so, never a column below the axis (review round 1). */
  const rise = (read: (c: Counts) => unknown, fell: string) =>
    days.map((d) => {
      const c = byNight.get(d);
      if (c === undefined) return noCount;
      const v = finite(read(c));
      if (v === null) return unread;
      const p = byNight.get(shiftNight(d, -1));
      if (p === undefined) return point({ value: null, note: NO_BASE });
      const base = finite(read(p));
      if (base === null) return point({ value: null, note: UNREAD_BASE });
      return point(v < base ? { value: null, note: fell } : { value: v - base });
    });

  const tier = (t: Tier) => (c: Counts) =>
    c.sites.value === null ? null : (c.sites.value.tiers?.[t] ?? (c.sites.value.tiers ? 0 : null));
  // Every check's sites that night; unread if any one check's count is.
  const checks = (c: Counts): number | null => {
    if (c.coverage.value === null) return null;
    const all = Object.values(c.coverage.value).map((m) => finite(m?.value));
    return all.some((v) => v === null) ? null : all.reduce<number>((a, v) => a + v!, 0);
  };
  const sentOn = (c: Counts) => (c.leads.value === null ? null : c.leads.value.notified);
  const cleared = (c: Counts) =>
    c.events.value === null ? null : (c.events.value["vuln_cleared"] ?? 0);
  const vulnOpen = (c: Counts) =>
    c.signals.value === null ? null : (c.signals.value["vuln"] ?? 0);

  const series = (name: string, points: TrendPoint[], bars = false, broken = false) => ({
    name,
    bars,
    broken,
    points,
  });
  const labels = days.map(nightLabel);
  const make = (title: string, s: TrendSeries[], note: string | null = null): TrendChart => {
    const vals = s
      .flatMap((x) => x.points.map((p) => p.value))
      .filter((v): v is number => v !== null);
    const said = s.map((x) => {
      const drawn = x.points.flatMap((p) => (p.value === null ? [] : [p.value]));
      if (drawn.length === 0) return `${x.name}: no night drawn`;
      const at = x.points.map((p) => p.value !== null).lastIndexOf(true);
      const lo = Math.min(...drawn);
      const hi = Math.max(...drawn);
      const over = count(drawn.length, "night drawn", "nights drawn");
      return `${x.name}: ${lo === hi ? `${lo} on each of the ${over}` : `from ${lo} to ${hi} over the ${over}`}, ${x.points[at]!.value} on ${labels[at]}`;
    });
    const gaps = days.filter((_, i) => s.every((x) => x.points[i]!.value === null)).length;
    const earlier = s.some((x) => x.points.some((p) => p.earlier));
    return {
      title,
      term: "Trends",
      nights: labels,
      series: s,
      low: 0,
      high: roundUp(Math.max(1, ...vals)),
      summary: `${said.join(". ")}. ${gaps === 0 ? "Every night is drawn" : `${count(gaps, "night has", "nights have")} no point; the table gives why`}.`,
      note: earlier
        ? "On the shaded nights, sites were sorted into levels by earlier rules, so those nights are left out rather than compared."
        : note,
    };
  };

  const lag = nightsBetween(newest, end);
  const missing = days.filter((d) => !byNight.has(d)).length;
  return {
    status: `The ${span} nights from ${nightLabel(days[0]!)} to ${nightLabel(end)}${missing > 0 ? `, ${missing} with no count` : ""}${lag > 0 ? `; none counted since ${nightLabel(newest)}` : ""}`,
    charts: [
      make("Broken and Attention sites, each night", [
        series("Broken", own(tier("broken"), true), false, true),
        series("Attention", own(tier("attention"), true)),
      ]),
      make("Site checks run, each night", [series("Site checks", own(checks), true)]),
      make("Submissions sent on to clients, each night", [
        series(
          "Sent on",
          rise(
            sentOn,
            "fewer than the night before: one sent on was later marked spam, so not drawn",
          ),
          true,
        ),
      ]),
      make(
        "Vulnerabilities: sites with an alert open, and sites cleared",
        [
          series("Sites cleared", rise(cleared, "lower than the night before, so not drawn"), true),
          series("Sites with an alert open", own(vulnOpen)),
        ],
        "The nightly does not count new vulnerabilities found, so the line shows sites with a vulnerability alert still open; the columns are sites cleared that night.",
      ),
    ],
  };
}

/** Where a chart's marks go, in its own viewBox units: pure, so the page only draws. */
export type TrendGeometry = {
  width: number;
  height: number;
  /** The y of the axis's low and high ends. */
  baseline: number;
  top: number;
  /** The y of 0, where columns stand. */
  zero: number;
  plotLeft: number;
  plotRight: number;
  /** Each unbroken run of a line series: a gap or an earlier night ends it. */
  lines: Array<{
    series: number;
    broken: boolean;
    d: string;
    points: Array<{ x: number; y: number; value: number }>;
  }>;
  /** A night alone between gaps, and each line's newest point: a dot. */
  dots: Array<{ series: number; broken: boolean; x: number; y: number }>;
  /** A column per night with a value; a 0 is a low column, so it never reads as a gap. */
  bars: Array<{ series: number; x: number; height: number; d: string }>;
  /** Shaded bands over the nights of an earlier ladder version: the break. */
  earlier: Array<{ x: number; width: number }>;
  /** A rule at each edge of a band inside the plot, so the break shows where the band's
   *  shade is faint against the page (review round 1). */
  breaks: number[];
  /** One per night: its slot and what its hover target says. */
  slots: Array<{ left: number; width: number; x: number; title: string }>;
};

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The least height a column is drawn at, so a night of 0 shows as a low mark and
 *  only a night with no value is empty (review round 1). */
export const MIN_COLUMN = 2;

/** A column from the zero line up to `top`: rounded at the data end, square at the base. */
function column(left: number, w: number, zero: number, top: number): string {
  const r = Math.min(4, w / 2, zero - top);
  const right = r1(left + w);
  return `M${left},${zero}V${r1(top + r)}Q${left},${top} ${r1(left + r)},${top}H${r1(right - r)}Q${right},${top} ${right},${r1(top + r)}V${zero}Z`;
}

export function trendGeometry(chart: TrendChart, width = 320, height = 132): TrendGeometry {
  const plotLeft = 30;
  const plotRight = width - 6;
  const top = 8;
  const baseline = height - 22;
  const first = chart.series[0]!.points;
  const n = first.length;
  const slot = (plotRight - plotLeft) / n;
  const xAt = (i: number) => r1(plotLeft + (i + 0.5) * slot);
  const range = chart.high - chart.low || 1;
  const yAt = (v: number) => r1(baseline - ((v - chart.low) / range) * (baseline - top));
  const zero = yAt(0);
  const lines: TrendGeometry["lines"] = [];
  const dots: TrendGeometry["dots"] = [];
  const bars: TrendGeometry["bars"] = [];
  const barW = r1(Math.max(1, Math.min(24, slot - 2)));
  // The last series first, so the first (Broken, on the level chart) is drawn on top
  // where two lines meet (review round 1).
  [...chart.series.entries()].reverse().forEach(([si, s]) => {
    if (s.bars) {
      s.points.forEach((p, i) => {
        if (p.value === null) return;
        const top = r1(Math.min(yAt(p.value), zero - MIN_COLUMN));
        bars.push({
          series: si,
          x: xAt(i),
          height: r1(zero - top),
          d: column(r1(xAt(i) - barW / 2), barW, zero, top),
        });
      });
      return;
    }
    let run: Array<{ x: number; y: number; value: number }> = [];
    const close = () => {
      if (run.length === 1) dots.push({ series: si, broken: s.broken, x: run[0]!.x, y: run[0]!.y });
      else if (run.length > 1) {
        const d = run.map((p, k) => `${k === 0 ? "M" : "L"}${p.x},${p.y}`).join("");
        lines.push({ series: si, broken: s.broken, d, points: run });
        const end = run.at(-1)!;
        dots.push({ series: si, broken: s.broken, x: end.x, y: end.y });
      }
      run = [];
    };
    s.points.forEach((p, i) => {
      if (p.value === null) close();
      else run.push({ x: xAt(i), y: yAt(p.value), value: p.value });
    });
    close();
  });
  const leftOf = (i: number) => r1(plotLeft + i * slot);
  const earlier: TrendGeometry["earlier"] = [];
  for (let i = 0; i < n; i++) {
    if (!first[i]!.earlier) continue;
    let j = i;
    while (j + 1 < n && first[j + 1]!.earlier) j++;
    earlier.push({ x: leftOf(i), width: leftOf(j + 1) - leftOf(i) });
    i = j;
  }
  const breaks = earlier
    .flatMap((e) => [e.x, r1(e.x + e.width)])
    .filter((x) => x > plotLeft && x < r1(plotRight));
  const say = (q: TrendPoint) => (q.value === null ? q.note! : String(q.value));
  const slots = first.map((p, i) => ({
    left: leftOf(i),
    width: leftOf(i + 1) - leftOf(i),
    x: xAt(i),
    // One reason said once when no series has a value that night.
    title: `${chart.nights[i]}: ${
      chart.series.length === 1 ||
      chart.series.every((s) => s.points[i]!.value === null && s.points[i]!.note === p.note)
        ? say(p)
        : chart.series.map((s) => `${s.name} ${say(s.points[i]!)}`).join("; ")
    }`,
  }));
  return {
    width,
    height,
    baseline,
    top,
    zero,
    plotLeft,
    plotRight,
    lines,
    dots,
    bars,
    earlier,
    breaks,
    slots,
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
  /** Section 8: the charts from `fleet_daily`, or how many nights are collected. */
  trends: TrendsView;
  /** How many `fleet_daily` nights the page has, in words ("1 night", "at least 31
   *  nights" once the reader's cap is reached); null when they could not be read. */
  nightsCollected: string | null;
};

/** The overview from the snapshot. Pure: every number is a test against fixture rows. */
export function overviewFromSnapshot(s: CockpitSnapshot, now: Date): OverviewView {
  const model = cockpitModelFromSnapshot(s, now);
  const names = new Map((s.sites ?? []).map((x) => [x.id, x.name]));
  const status = (r: SubmissionRow) => storedStatus(s, r);
  const live = liveRows(model, s.submissions, status, now);
  return {
    status: statusView(model, live, s.reports !== null, now),
    live,
    leads: leadsView(s, (id) => names.get(id) ?? "A site no longer listed", status, now),
    reports: reportsView(model, s.reports, now),
    nightly: nightlyView(s, now),
    upkeep: upkeepView(model, s, now),
    prsMerged: overNights(s.nights, (c) => c.prsMerged.value, now),
    trends: trendsFromDaily(s.nights, now),
    // The reader takes the newest OVERVIEW_NIGHTS rows, so a full read is a floor.
    nightsCollected:
      s.nights === null
        ? null
        : s.nights.length >= OVERVIEW_NIGHTS
          ? `at least ${OVERVIEW_NIGHTS} nights`
          : count(s.nights.length, "night", "nights"),
  };
}

/** The ladder, in four lines (section 6). */
export const LADDER_LINES: readonly string[] = [
  "Broken: a visitor or a client is affected now, such as a site that does not answer, or leads not reaching the client.",
  "Attention: fix this week. Nobody outside is affected yet, but someone will be if it waits.",
  "Watch: we keep an eye on it. Nothing to do yet.",
  'OK: nothing for us to act on at the last checks. A vulnerability waiting on an automatic update is listed under Open now, and a cell that reads "not checked lately" says what we could not confirm.',
];

const STALE = `A result more than ${count(PRODUCTION_STALE_DAYS, "day", "days")} old`;

/** The page's own "How we count": one line for every number it shows. The page marks
 *  each number's label with `data-term`, and a test holds the two sets equal. */
export const HOW_WE_COUNT: ReadonlyArray<{ term: string; text: string }> = [
  {
    term: "Sites in our care",
    text: "Sites on a maintenance plan. Sites still launching are not counted until they go live.",
  },
  {
    term: "Broken, attention, watch",
    text: "How many sites sit at each level of the ladder (explained in Upkeep below), by each site's worst open item; each count opens that group on the Triage page. These are the Triage page's counts, so they include any row it lists that is not among the sites in our care (a site whose plan status is misspelt, say). A Broken one is named with how long ago its oldest open Broken item was first flagged. Items not tied to one site are counted on their own, and open the Triage page's list of them.",
  },
  {
    term: "Waiting for your yes",
    text: "Every report draft ready for your approval on a site in our care, however many one site has: the same drafts as the Waiting column in Client reports. The count opens the Triage page's approval group when there is one. A site that also has something worse shows its drafts under that level instead, so when every draft is on such a site the count opens the table in Client reports below.",
  },
  {
    term: "Live",
    text: `The address resolves (the URL probe) and its pages answer (the browser check, which opens pages on the site). The time beside it is the older of the two checks; in the status line, the oldest across our sites. ${STALE} reads "not checked lately". "No page sampled" means the address answers and the browser check ran but found no page to try, so whether pages answer is not measured.`,
  },
  {
    term: "Certificate",
    text: `Days left on the site's security certificate (the padlock), from the nightly domain check: the days it counted, less the whole days since it ran. Not the domain registration. ${CERT_ATTENTION_DAYS} days or fewer is shown in bold and puts the site at Attention; ${CERT_BROKEN_DAYS} or fewer is Broken. Certificates renew on their own around then, so the count should climb back within days. At Attention we confirm it renews; we act only if it does not. If it keeps falling, renewal has failed. "Domain does not answer, or no working certificate" means a fresh check found no address or no working certificate: Broken.`,
  },
  {
    term: "Deploy",
    text: `The latest production deploy (the newest version published to the live site), from the nightly deploy check. ${STALE} reads "not checked lately".`,
  },
  {
    term: "Forms",
    text: `The nightly live form test sends a real test entry through the form. ${STALE} reads "not tested lately", never "passed". The test itself is being fixed: until it is, a failure is shown but is not a verdict, and it does not change the site's level. "No result" means the test gave no verdict: the site has no form, or the test skipped it. "Last real lead" is the newest submission accepted as real; for an RSVP or signup form it says "submission", since those are not leads.`,
  },
  {
    term: "Level",
    text: "The site's place on the ladder, explained in Upkeep below.",
  },
  {
    term: "Submissions",
    text: "Everything a site's forms received and stored. This month counts from the 1st, Pacific time.",
  },
  {
    term: "Biggest share",
    text: "The site with the most submissions, and its part of the total. One site can hold far more than the rest (an RSVP form, say), so every site's own count sits in the table.",
  },
  {
    term: "Accepted as real",
    text: "Leads, signups and RSVPs kept as real: new, read or archived. Only contact, inquiry and reservation forms bring leads; a newsletter signup or an RSVP is not one.",
  },
  { term: "Client notified", text: "Of those, how many the client was emailed about." },
  { term: "Screened as spam", text: "Caught automatically after it arrived." },
  { term: "Marked spam by hand", text: "Marked spam by one of us." },
  {
    term: "Stopped before storage",
    text: "Submissions stopped by the hidden field and the timing check, never stored. All time is from the newest nightly count, dated beside it; it is never added to the spam counts above. This month is kept in whole days by UTC time, not Pacific, so it starts at 4 or 5pm Pacific on the last day of the month before.",
  },
  {
    term: "Per site",
    text: "The same counts for each site, all time, the biggest first.",
  },
  {
    term: "Reports sent",
    text: 'Reports that went out to clients, less every test send (one whose approval is marked "test send", as the August ones were). Approved first means one of us said yes before it went; the rest went without that yes.',
  },
  {
    term: "Checks per report",
    text: "The checks a Maintenance report lists, from the report's own wording, each with the nightly step that proves it.",
  },
  {
    term: "Lighthouse",
    text: "Google's Lighthouse audit scores each site out of 100 in four areas. Each figure is the middle score for that area across our sites on a maintenance plan (half score higher, half lower), worked out for each area on its own. The date is the oldest audit behind them.",
  },
  {
    term: "Next report due",
    text: "The earlier of the next Maintenance and Testing report, from each site's schedule.",
  },
  {
    term: "Times",
    text: "Worked out from the schedule the nightly runs on, in Pacific time, so they move with daylight saving.",
  },
  {
    term: "Steps",
    text: "Each step's result on the night named, when it last finished, and how many sites it reached. A step that runs to the end can still find problems; what it found is in the tables above. Last finished is the last time it stamped a site; for a step that stamps none, the nightly run it last finished in, with its result. Reached is the most sites one of its checks stamped, dated by the night it was counted; the backup, the Prismic sync and the report drafts keep no count of sites, so they say what they reach instead.",
  },
  {
    term: "Scale",
    text: "How many kinds of check ran on the night named (each stamps the sites it reached), and the most sites any one of them reached.",
  },
  {
    term: "Runs completed",
    text: `Of the nightly steps that finished on the nights we have counted within the last ${WINDOW_NIGHTS}, how many ran to the end. A step that runs to the end can still find problems; what it found is in the tables above. "The last K nights" counts calendar nights back from the newest, here and in every window below; a night with no count, or a row with no step result, is said as not recorded, and a night written while every step was still running is said as such. Last night's count is expected from 6am Pacific: when the newest count is older than that, this line counts the nights since as not recorded, and each window is dated by the night it ends on.`,
  },
  {
    term: "Dependency updates merged",
    text: "Dependency updates opened by Renovate, our update bot, and merged, whether it merged one itself or one of us did, counted each night. A window needs two nights to subtract, so with one night it says when counting started.",
  },
  {
    term: "Sites cleared of vulnerabilities",
    text: "Counted once each time a site goes from one or more critical or high vulnerabilities to none, however many it cleared; counted the same way, over the nights.",
  },
  {
    term: "Open now",
    text: `Critical and high vulnerabilities on each site, and what is fixing them. One in a package the site uses directly waits up to ${count(DIRECT_VULN_WAIT_DAYS, "day", "days")} for an automatic update; one deeper in the packages waits for Monday's weekly package refresh, plus ${count(LOCKFILE_SETTLE_DAYS, "day", "days")}. After its date, it comes to us. A count from a security check more than ${count(PRODUCTION_STALE_DAYS, "day", "days")} old reads "not checked lately".`,
  },
  {
    term: "Major-version upgrades waiting",
    text: "Packages a major version behind (a release that may need changes to adopt), added up across the sites whose packages were read that night, from the newest nightly count, dated beside it: one package behind on three sites counts three times.",
  },
  {
    term: "PRs merged",
    text: "PRs (pull requests: proposed code changes) merged into the maintenance stack (the code that runs these checks and sends the reports), counted each night.",
  },
  {
    term: "Trends",
    text: `Drawn from the nightly counts once there are ${TREND_NIGHTS} nights of them; until then the section says how many it has. Each chart covers up to the last ${WINDOW_NIGHTS} calendar nights, to the night expected by now. A night with no count, or a count that could not be read, is a gap, never a zero, and the table under each chart says why; a column at the axis is a real 0. Broken and Attention are the sites at each level that night. The rules that sort sites into levels have changed twice (the ladder in October, then the live-site checks), so a night sorted by earlier rules is shaded and left out rather than compared, and a night that did not record its rules is a gap. Site checks run adds up, for each kind of check, the sites it checked that night: five checks on seven sites count 35. Sent on is the night's rise in submissions (leads, signups and RSVPs together) the client was emailed about; a night with fewer than the night before, because one sent on was later marked spam, is a gap. Sites cleared is the night's rise in sites going from one or more critical or high vulnerabilities to none. The nightly does not count new vulnerabilities found, so the line shows sites whose vulnerability alert was on the Triage page that night (one waiting for an automatic update is not). A night's rise needs the night before it too, so the night after a gap is a gap as well.`,
  },
  {
    term: "Nights counted",
    text: `How many nights the nightly has written its counts for; the page reads the newest ${OVERVIEW_NIGHTS}, so past that it says "at least". The counts over a window (dependency updates merged, sites cleared, PRs merged) need two nights to subtract; the rest read one night.`,
  },
];
