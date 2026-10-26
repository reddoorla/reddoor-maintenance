import type { WebsiteRow } from "../fleet/site-row.js";
import { analyticsOptedOut, searchConsoleOptedOut } from "../fleet/opt-outs.js";
import { headerImageFindings, recipientFindings } from "../reports/preflight.js";
import { gtagLoaderIds, type PropertyRead, type TagProbe } from "../audits/analytics.js";
import { siteHostnames } from "../client/site-host.js";
import { isCalendarDate } from "../dashboard/site-details.js";
import { addMonths, MONTHS } from "../reports/due.js";
import { isPreLaunch } from "../fleet/site-row.js";

/**
 * Is this site ready to launch?
 *
 * Williamson Construction and Williamson Homes went live on 2026-10-13 with no
 * Analytics, no Search Console, no contact and no schedule. `launch` checked
 * none of those, and every one of them fails late and quietly: GA does not
 * backfill, a report with no property drafts with a blank analytics section,
 * and a launch email with no recipient drafts fine and can never be approved.
 * This is the list `docs/runbooks/site-launch.md` walks, run against the row
 * and the live site.
 *
 * Each step reads `ok`, `missing` or `unverified`, and the difference between
 * the last two is the point. `missing` is a fact about the site: the row is
 * blank, the page does not load the tag, the API refused the property.
 * `unverified` is a fact about this run: no credentials here, no browser, the
 * API did not answer. Neither is `ok`, so both stop a launch until the step is
 * fixed or named in `--allow-missing`.
 */

export const LAUNCH_CHECK_STEPS = [
  "url",
  "contact",
  "schedule",
  "header-image",
  "ga-property",
  "ga-tag",
  "privacy",
  "search-console",
] as const;

export type LaunchCheckStep = (typeof LAUNCH_CHECK_STEPS)[number];
export type LaunchCheckState = "ok" | "missing" | "unverified";
export type LaunchCheckLine = { step: LaunchCheckStep; state: LaunchCheckState; detail: string };

/** A fetched page: the status after redirects, the url it ended on, and the body. */
export type FetchedPage = { status: number; url: string; body: string };

/** The web streams of a GA4 property, as the Admin API lists them. */
export type StreamRead =
  | { ok: true; measurementIds: string[] }
  | { ok: false; kind: "denied" | "unavailable" | "credentials"; error: string };

/** What a Search Console lookup for one subject resolved. */
export type SearchRead =
  | { ok: true; propertyFound: boolean; property: string | null }
  | { ok: false; kind: "denied" | "unavailable" | "credentials"; error: string };

/** The IO the check needs. Every default is real; the tests inject all of it. */
export type LaunchCheckDeps = {
  /** The GA/Search Console impersonation subjects, or null when this
   *  environment has no credentials. */
  subjects: () => string[] | null;
  /** The GA4 Data API read for one property AS ONE SUBJECT, with no failover. */
  readProperty: (propertyId: string, subject: string, hostnames: string[]) => Promise<PropertyRead>;
  /** The property's web-stream measurement IDs, from the GA4 Admin API. */
  readStreams: (propertyId: string, subjects: string[]) => Promise<StreamRead>;
  /** Drive the url in a browser and report which gtag loaders arrived. Null
   *  when no browser can run here. */
  probeTag: ((url: string) => Promise<TagProbe>) | null;
  /** GET a url, following redirects. Throws when nothing answered. */
  fetchPage: (url: string) => Promise<FetchedPage>;
  /** The clock the schedule's staleness is read against. Defaults to now. */
  now?: () => Date;
  /** The Search Console lookup `fetchSearch` runs, AS ONE SUBJECT. */
  readSearch: (row: WebsiteRow, subject: string) => Promise<SearchRead>;
};

const line = (step: LaunchCheckStep, state: LaunchCheckState, detail: string): LaunchCheckLine => ({
  step,
  state,
  detail,
});

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** An API's error message, without the full stop it usually ends on, so the
 *  remedy that follows it reads as one sentence. */
function trimStop(s: string): string {
  return s.trim().replace(/\.+$/, "");
}

const is2xx = (status: number): boolean => status >= 200 && status < 300;

/** The row's url as an https origin, or null when it is not https. */
function httpsOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Why a fetched page is not the site's own, or null when it is. Redirects are
 * followed, so without this a row url that 301s to a parking page, an old host
 * or plain http would be judged by whatever answered at the end of the chain.
 * An empty `url` means the fetch reported none, and is read as the request.
 */
function offSite(row: WebsiteRow, page: FetchedPage, requested: string): string | null {
  const final = page.url || requested;
  let u: URL;
  try {
    u = new URL(final);
  } catch {
    return `it ended on ${JSON.stringify(final)}, which is not a url`;
  }
  if (u.protocol !== "https:") return `it redirected to ${final}, which is not https`;
  if (!siteHostnames(hostOf(row.url)).includes(u.hostname.toLowerCase())) {
    return `it redirected to ${final}, off the site's own hosts`;
  }
  return null;
}

function checkUrl(row: WebsiteRow, home: FetchedPage | Error | null): LaunchCheckLine {
  if (!row.url) return line("url", "missing", "the row has no url");
  if (httpsOrigin(row.url) === null) {
    return line(
      "url",
      "missing",
      `the row's url ${JSON.stringify(row.url)} is not https://. Every audit, the report and the GA hostname filter read this url; record the https:// address the site serves.`,
    );
  }
  if (home instanceof Error)
    return line("url", "unverified", `GET ${row.url} failed: ${home.message}`);
  if (home === null) return line("url", "unverified", `GET ${row.url} did not run`);
  const away = offSite(row, home, row.url);
  if (away !== null) return line("url", "missing", `GET ${row.url}: ${away}`);
  const landed = home.url ? hostOf(home.url).toLowerCase() : "";
  if (landed !== "" && landed !== hostOf(row.url).toLowerCase()) {
    return line(
      "url",
      "missing",
      `${row.url} redirects to ${home.url}. Record the host the site lands on, which the report, the GA filter and the Search Console check all read.`,
    );
  }
  if (!is2xx(home.status)) return line("url", "missing", `GET ${row.url} answered ${home.status}`);
  return line("url", "ok", `${row.url} answers ${home.status}`);
}

function checkContact(row: WebsiteRow): LaunchCheckLine {
  const findings = recipientFindings(row);
  if (findings.length > 0) {
    return line("contact", "missing", findings.map((f) => `${f.check}: ${f.message}`).join("; "));
  }
  const to = row.reportRecipientsTo?.trim() ? "report_recipients_to" : "point_of_contact";
  return line("contact", "ok", `the go-live email resolves its To from ${to}`);
}

const FREQUENCIES = new Set(["None", ...Object.keys(MONTHS)]);
const cycleMonths = (freq: string): number | undefined => MONTHS[freq as keyof typeof MONTHS];

/** The same staleness line preflight's `anchor-stale` draws (~13 months). */
const STALE_ANCHOR_DAYS = 396;
const DAY_MS = 86_400_000;

/** Why a schedule anchor day is unusable, or null.
 *
 *  Before launch (#1375; a row with no status counts, #1450, even one that has
 *  sent reports, whose `--allow-missing schedule` is the way past) the anchor
 *  schedules the site's FIRST report, so it is
 *  judged by that report: not a `YYYY-MM-DD` calendar date (the dashboard
 *  stores nothing else), or a first report, one cycle on from the anchor as
 *  `nextDueDate` counts it, that has already fallen due and so drafts
 *  back-dated and overdue.
 *
 *  On any other status the anchor is history: a live site's next report counts
 *  from its last send, so a first due date long past is normal (Data Dynamiq,
 *  Quarterly from 2026-07-05, last sent 2026-10-09). There the check stays the
 *  loose one: not a date to `Date.parse`, or more than ~13 months old.
 *
 *  Either way, a first report (anchor plus one cycle) more than 396 days ahead
 *  is refused: a year typo that would hold it for decades. The bound is on that
 *  report, not on the anchor, so a Yearly anchor cannot put it two years out
 *  (#1375 item 3), yet may sit about a month ahead. */
function dayProblem(
  field: string,
  value: string,
  months: number,
  now: Date,
  preLaunch: boolean,
): string | null {
  const day = value.trim();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let at: number;
  if (preLaunch) {
    if (!isCalendarDate(day)) return `${field} ${JSON.stringify(day)} is not a date`;
    at = Date.parse(`${day}T00:00:00Z`);
  } else {
    at = Date.parse(day);
    if (!Number.isFinite(at)) return `${field} ${JSON.stringify(day)} is not a date`;
    if (now.getTime() - at > STALE_ANCHOR_DAYS * DAY_MS) {
      return `${field} ${day} is more than 13 months old, so the first report drafts back-dated and overdue. Set the day the cycle counts from.`;
    }
  }
  const firstDue = addMonths(new Date(at), months).getTime();
  // A live row's lenient parse can land past year 9999 ("275760"), where
  // toISOString writes a six-digit year ("+275760-02-01") or, once one more
  // cycle leaves Date's range, throws on NaN. Either is ahead.
  if (!(firstDue < LAST_FOUR_DIGIT_YEAR_END)) {
    return `${field} ${day} puts the first report past the year 9999, more than 13 months ahead.`;
  }
  const due = new Date(firstDue).toISOString().slice(0, 10);
  if (preLaunch && firstDue < today) {
    return `${field} ${day} puts the first report on ${due}, which has passed, so it drafts back-dated and overdue. Set the day the cycle counts from.`;
  }
  if (firstDue - today > MAX_AHEAD_DAYS * DAY_MS) {
    return `${field} ${day} puts the first report on ${due}, more than 13 months ahead.`;
  }
  return null;
}

/** The furthest ahead the first report an anchor schedules may fall due: the
 *  same ~13 months as the staleness line, so a Yearly anchor may sit about a
 *  month ahead (the operator, 2026-10-26, on #1746). */
const MAX_AHEAD_DAYS = STALE_ANCHOR_DAYS;

/** The first instant toISOString writes with a six-digit year. */
const LAST_FOUR_DIGIT_YEAR_END = Date.UTC(10000, 0, 1);

function checkSchedule(row: WebsiteRow, now: Date): LaunchCheckLine {
  const raw = row.maintenanceFreqRaw?.trim() ?? "";
  if (raw === "") {
    return line(
      "schedule",
      "missing",
      "maintenance_freq is blank. Set Monthly, Quarterly or Yearly, or None for a site with no recurring reports.",
    );
  }
  if (!FREQUENCIES.has(raw)) {
    return line(
      "schedule",
      "missing",
      `maintenance_freq ${JSON.stringify(raw)} is not a frequency`,
    );
  }
  if (raw === "None")
    return line("schedule", "ok", "maintenance_freq is None: no recurring reports");
  if (!row.maintenanceDay?.trim()) {
    return line(
      "schedule",
      "missing",
      `maintenance_freq is ${raw} but maintenance_day is blank, so the first Maintenance report falls due the day the site turns maintained. Set the day the cycle counts from.`,
    );
  }
  // No status is judged as before launch too: the scheduler drafts a null row
  // like a live one (`nextDueDate`), so its first report must not have passed
  // (#1450, the operator's answer on 2026-10-20).
  const preLaunch = row.status === null || isPreLaunch(row.status);
  const badDay = dayProblem(
    "maintenance_day",
    row.maintenanceDay,
    cycleMonths(raw)!,
    now,
    preLaunch,
  );
  if (badDay) return line("schedule", "missing", badDay);
  const testing = row.testingFreqRaw?.trim() ?? "";
  if (testing !== "" && testing !== "None") {
    // Before launch an unknown testing_freq has no cycle to judge testing_day
    // by, and the scheduler would read it as None. A live row keeps main's
    // behaviour and does not check it here.
    const testingMonths = cycleMonths(testing);
    if (preLaunch && testingMonths === undefined) {
      return line(
        "schedule",
        "missing",
        `testing_freq ${JSON.stringify(testing)} is not a frequency, so no Testing report is ever scheduled. Set Monthly, Quarterly, Yearly or None.`,
      );
    }
    if (!row.testingDay?.trim()) {
      return line(
        "schedule",
        "missing",
        `testing_freq is ${testing} but testing_day is blank, so the first Testing report falls due the day the site turns maintained. Set the day it counts from, or testing_freq None.`,
      );
    }
    const badTesting = dayProblem(
      "testing_day",
      row.testingDay,
      testingMonths ?? 0,
      now,
      preLaunch,
    );
    if (badTesting) return line("schedule", "missing", badTesting);
  }
  return line("schedule", "ok", `${raw}, counted from ${row.maintenanceDay}`);
}

function checkHeaderImage(row: WebsiteRow): LaunchCheckLine {
  const findings = headerImageFindings(row);
  if (findings.length > 0) {
    return line(
      "header-image",
      "missing",
      `${findings.map((f) => f.message).join("; ")}. Run \`reddoor-maint header-image <site> --write-back\`.`,
    );
  }
  return line("header-image", "ok", row.headerImage?.filename ?? "present");
}

/** The numeric property ID, or a missing line saying what is wrong with it. */
function propertyIdOf(row: WebsiteRow): string | LaunchCheckLine {
  const id = row.ga4PropertyId?.trim() ?? "";
  if (id === "") {
    return line("ga-property", "missing", "the row has no ga4_property_id");
  }
  if (!/^\d+$/.test(id)) {
    return line(
      "ga-property",
      "missing",
      `ga4_property_id ${JSON.stringify(id)} is not a numeric property ID${/^G-/i.test(id) ? " (it is a G- measurement ID, which belongs in the site's code)" : ""}`,
    );
  }
  return id;
}

async function checkGaProperty(
  row: WebsiteRow,
  deps: LaunchCheckDeps,
  subjects: string[] | null,
): Promise<LaunchCheckLine> {
  if (analyticsOptedOut(row)) return line("ga-property", "ok", "the row accepts `no analytics`");
  const id = propertyIdOf(row);
  if (typeof id !== "string") return id;
  if (subjects === null) {
    return line(
      "ga-property",
      "unverified",
      `property ${id}: no GA credentials here (GA_SUBJECT unset)`,
    );
  }
  const hostnames = siteHostnames(hostOf(row.url));
  if (hostnames.length === 0) {
    return line(
      "ga-property",
      "unverified",
      `property ${id}: the row's url has no host to filter by`,
    );
  }
  const answered: string[] = [];
  const unsure: string[] = [];
  for (const subject of subjects) {
    let read: PropertyRead;
    try {
      read = await deps.readProperty(id, subject, hostnames);
    } catch (e) {
      read = { ok: false, kind: "unavailable", error: errorText(e) };
    }
    if (read.ok) {
      answered.push(subject);
      continue;
    }
    if (read.kind === "denied") {
      return line(
        "ga-property",
        "missing",
        `the GA4 Data API refused property ${id} for ${subject}: ${trimStop(read.error)}. Grant ${subject} Viewer on the property: every GA_SUBJECT subject must read it, or the failover list does not cover this site.`,
      );
    }
    unsure.push(`${subject}: ${read.kind}, ${read.error}`);
  }
  if (unsure.length > 0) {
    return line(
      "ga-property",
      "unverified",
      `property ${id} did not answer for ${unsure.join("; ")}`,
    );
  }
  return line(
    "ga-property",
    "ok",
    `property ${id} answers the Data API for ${answered.join(", ")}`,
  );
}

/** The bare host a Search Console property or a url names, the comparison
 *  `bareHost` in reports/search/client.ts makes. Not imported from there: that
 *  module loads google-auth-library at import time. */
function searchHost(s: string): string {
  return s
    .trim()
    .replace(/^sc-domain:/i, "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]!
    .replace(/^www\./i, "")
    .toLowerCase();
}

/**
 * Does a Search Console property cover the site's url? A Domain property
 * (`sc-domain:example.com`) covers the domain and every subdomain. A URL-prefix
 * property records only its own scheme and host, so `https://example.com/`
 * collects nothing for a site served at `https://www.example.com/`.
 */
function propertyCovers(property: string, url: string): boolean {
  const host = hostOf(url).toLowerCase();
  if (host === "") return false;
  if (/^sc-domain:/i.test(property)) {
    const domain = searchHost(property);
    return host === domain || host.endsWith(`.${domain}`);
  }
  try {
    const p = new URL(property);
    const u = new URL(url);
    return p.protocol === u.protocol && p.hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function checkGaTag(
  row: WebsiteRow,
  deps: LaunchCheckDeps,
  subjects: string[] | null,
  home: FetchedPage | Error | null,
): Promise<LaunchCheckLine> {
  if (analyticsOptedOut(row)) return line("ga-tag", "ok", "the row accepts `no analytics`");
  const id = propertyIdOf(row);
  if (typeof id !== "string") {
    return line("ga-tag", "missing", "no GA4 property on the row, so no stream to look for");
  }
  if (httpsOrigin(row.url) === null) {
    return line(
      "ga-tag",
      "unverified",
      "the row's url is not https://, so the live page was not probed",
    );
  }
  if (subjects === null) {
    return line("ga-tag", "unverified", "no GA credentials here to read the property's streams");
  }
  let streams: StreamRead;
  try {
    streams = await deps.readStreams(id, subjects);
  } catch (e) {
    streams = { ok: false, kind: "unavailable", error: errorText(e) };
  }
  if (!streams.ok) {
    return line(
      "ga-tag",
      streams.kind === "denied" ? "missing" : "unverified",
      `the GA4 Admin API did not list property ${id}'s streams: ${streams.error}`,
    );
  }
  const expected = streams.measurementIds;
  if (expected.length === 0) {
    return line("ga-tag", "missing", `property ${id} has no web stream`);
  }
  const want = expected.join(" or ");

  let probe: TagProbe | null = null;
  let probeError: string | null = null;
  if (deps.probeTag) {
    try {
      probe = await deps.probeTag(row.url);
    } catch (e) {
      probeError = errorText(e);
    }
  }
  const htmlIds = home instanceof Error || home === null ? [] : gtagLoaderIds(home.body);

  if (probe !== null) {
    const loaded = probe.loadedIds.filter((i) => expected.includes(i));
    if (loaded.length > 0) {
      return line(
        "ga-tag",
        "ok",
        `${row.url} loads ${[...new Set(loaded)].join(", ")} (property ${id}'s stream)`,
      );
    }
    const refused = (probe.failed ?? []).filter((f) => expected.includes(f.id));
    if (refused.length > 0) {
      return line(
        "ga-tag",
        "missing",
        `${row.url} requests ${want} but it did not arrive: ${refused.map((f) => f.reason).join("; ")}. A CSP refusal means the GA hosts are not in kit.csp.`,
      );
    }
    if (probe.loadedIds.length > 0) {
      return line(
        "ga-tag",
        "missing",
        `${row.url} loads ${[...new Set(probe.loadedIds)].join(", ")}, not property ${id}'s stream ${want}`,
      );
    }
    if (htmlIds.some((i) => expected.includes(i))) {
      return line(
        "ga-tag",
        "unverified",
        `the served HTML names ${want}, but no loader arrived in the browser probe`,
      );
    }
    return line("ga-tag", "missing", `${row.url} loads no gtag loader; expected ${want}`);
  }
  const why = probeError ? `the browser probe failed (${probeError})` : "no browser here";
  if (htmlIds.some((i) => expected.includes(i))) {
    return line("ga-tag", "unverified", `the served HTML names ${want}, but ${why} to see it load`);
  }
  return line(
    "ga-tag",
    "unverified",
    `${why}, and the tag is injected from JS, so a plain GET cannot see it`,
  );
}

/** An `href` attribute's value, quoted or not: a minifier strips the quotes. */
const HREF = /(?<![\w-])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const BASE = /<base\b[^>]*?(?<![\w-])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

const hrefValue = (m: RegExpMatchArray): string => m[1] ?? m[2] ?? m[3] ?? "";

/** Does the page link to the site's OWN /privacy? A relative href resolves as
 *  the browser resolves it: against the page's `<base href>`, itself against
 *  the url the page was served from. An absolute link counts only on the
 *  site's hosts: a reCAPTCHA notice links to Google's /privacy, which is not
 *  this site's policy. */
function linksToOwnPrivacy(row: WebsiteRow, html: string, servedFrom: string): boolean {
  const hosts = siteHostnames(hostOf(row.url));
  let base = servedFrom;
  const baseTag = html.match(BASE);
  if (baseTag) {
    try {
      base = new URL(hrefValue(baseTag), servedFrom).href;
    } catch {
      // An unparseable <base> is ignored, as a browser ignores it.
    }
  }
  for (const m of html.matchAll(HREF)) {
    let u: URL;
    try {
      u = new URL(hrefValue(m), base);
    } catch {
      continue;
    }
    if (!hosts.includes(u.hostname.toLowerCase())) continue;
    if (/^\/privacy\/?$/i.test(u.pathname)) return true;
  }
  return false;
}

async function checkPrivacy(
  row: WebsiteRow,
  deps: LaunchCheckDeps,
  home: FetchedPage | Error | null,
): Promise<LaunchCheckLine> {
  const origin = httpsOrigin(row.url);
  if (origin === null) {
    return line(
      "privacy",
      "unverified",
      "the row's url is not https://, so /privacy was not fetched",
    );
  }
  let page: FetchedPage;
  try {
    page = await deps.fetchPage(`${origin}/privacy`);
  } catch (e) {
    return line("privacy", "unverified", `GET ${origin}/privacy failed: ${errorText(e)}`);
  }
  const away = offSite(row, page, `${origin}/privacy`);
  if (away !== null) return line("privacy", "missing", `GET ${origin}/privacy: ${away}`);
  if (page.url && !/^\/privacy\/?$/i.test(new URL(page.url).pathname)) {
    return line("privacy", "missing", `GET ${origin}/privacy redirected to ${page.url}`);
  }
  if (!is2xx(page.status)) {
    return line("privacy", "missing", `${origin}/privacy answered ${page.status}`);
  }
  if (home instanceof Error || home === null || offSite(row, home, row.url) !== null) {
    return line(
      "privacy",
      "unverified",
      `${origin}/privacy answers, but the home page was not read for the link`,
    );
  }
  if (!linksToOwnPrivacy(row, home.body, home.url || row.url)) {
    return line(
      "privacy",
      "missing",
      `${origin}/privacy answers, but the home page does not link to it`,
    );
  }
  return line(
    "privacy",
    "ok",
    `${origin}/privacy answers ${page.status} and the home page links to it`,
  );
}

async function checkSearchConsole(
  row: WebsiteRow,
  deps: LaunchCheckDeps,
  subjects: string[] | null,
): Promise<LaunchCheckLine> {
  if (searchConsoleOptedOut(row)) {
    return line("search-console", "ok", "the row accepts `no search console`");
  }
  const recorded = row.searchConsoleProperty?.trim() ?? "";
  if (recorded === "") {
    return line("search-console", "missing", "the row has no search_console_property");
  }
  if (!propertyCovers(recorded, row.url)) {
    return line(
      "search-console",
      "missing",
      `search_console_property ${recorded} is not for ${hostOf(row.url) || row.url}`,
    );
  }
  if (subjects === null) {
    return line("search-console", "unverified", `${recorded}: no Search Console credentials here`);
  }
  const unsure: string[] = [];
  for (const subject of subjects) {
    let read: SearchRead;
    try {
      read = await deps.readSearch({ ...row, searchConsoleProperty: recorded }, subject);
    } catch (e) {
      read = { ok: false, kind: "unavailable", error: errorText(e) };
    }
    if (read.ok && read.propertyFound) continue;
    if (read.ok || read.kind === "denied") {
      return line(
        "search-console",
        "missing",
        `${subject} cannot read ${recorded}${read.ok ? "" : `: ${trimStop(read.error)}`}. Verify the property and add ${subject} as a user.`,
      );
    }
    unsure.push(`${subject}: ${read.kind}, ${read.error}`);
  }
  if (unsure.length > 0) {
    return line(
      "search-console",
      "unverified",
      `${recorded} did not answer for ${unsure.join("; ")}`,
    );
  }
  return line("search-console", "ok", `${recorded} answers for ${subjects.join(", ")}`);
}

/** Run every step against the row and the live site. Never throws for a
 *  step: an error inside one is that step's `unverified`. */
export async function launchCheck(
  row: WebsiteRow,
  deps: LaunchCheckDeps,
): Promise<LaunchCheckLine[]> {
  const subjects = (() => {
    const s = deps.subjects();
    return s === null || s.length === 0 ? null : s;
  })();
  let home: FetchedPage | Error | null = null;
  if (httpsOrigin(row.url) !== null) {
    try {
      home = await deps.fetchPage(row.url);
    } catch (e) {
      home = e instanceof Error ? e : new Error(String(e));
    }
  }
  return [
    checkUrl(row, home),
    checkContact(row),
    checkSchedule(row, deps.now?.() ?? new Date()),
    checkHeaderImage(row),
    await checkGaProperty(row, deps, subjects),
    await checkGaTag(row, deps, subjects, home),
    await checkPrivacy(row, deps, home),
    await checkSearchConsole(row, deps, subjects),
  ];
}

/** The lines that stop a launch: every one that is not `ok`, less the steps
 *  the operator named in `--allow-missing`. */
export function blockingLines(
  lines: readonly LaunchCheckLine[],
  allowMissing: ReadonlySet<LaunchCheckStep>,
): LaunchCheckLine[] {
  return lines.filter((l) => l.state !== "ok" && !allowMissing.has(l.step));
}

/** Parse `--allow-missing` values (repeatable, comma-separated). An unknown
 *  step name is an error, never ignored: a typo would otherwise allow nothing
 *  and read as though it allowed something. */
export function parseAllowMissing(
  values: string | readonly string[] | undefined,
): { ok: true; steps: Set<LaunchCheckStep> } | { ok: false; error: string } {
  const raw = values === undefined ? [] : typeof values === "string" ? [values] : values;
  const steps = new Set<LaunchCheckStep>();
  for (const part of raw.flatMap((v) => String(v).split(","))) {
    const name = part.trim();
    if (name === "") continue;
    if (!(LAUNCH_CHECK_STEPS as readonly string[]).includes(name)) {
      return {
        ok: false,
        error: `--allow-missing ${JSON.stringify(name)} is not a launch-check step (${LAUNCH_CHECK_STEPS.join(", ")})`,
      };
    }
    steps.add(name as LaunchCheckStep);
  }
  return { ok: true, steps };
}

/** One line per step, then a machine-readable summary the PM pass can grep. */
export function formatLaunchCheck(
  site: string,
  lines: readonly LaunchCheckLine[],
  allowMissing: ReadonlySet<LaunchCheckStep> = new Set(),
): string {
  const body = lines.map((l) => {
    const allowed = l.state !== "ok" && allowMissing.has(l.step) ? " (allowed)" : "";
    return `${l.step.padEnd(15)} ${l.state.padEnd(10)} ${l.detail}${allowed}`;
  });
  const count = (s: LaunchCheckState) => lines.filter((l) => l.state === s).length;
  const ready = blockingLines(lines, allowMissing).length === 0;
  return [
    `[${site}] launch-check — ${ready ? "READY" : "NOT READY"}`,
    ...body,
    `LAUNCH_CHECK_SUMMARY site=${site} ready=${ready} ok=${count("ok")} missing=${count("missing")} unverified=${count("unverified")}`,
  ].join("\n");
}
