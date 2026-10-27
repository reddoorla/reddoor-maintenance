// src/alerts/production-signals.ts
//
// P1-78c: the production signals the nightly audits already store, read by the alarms
// for the first time (workspace briefs/2026-10-26-p1-78c-production-signals.md). Each
// collector is PURE (`now` injected) and reads only persisted verdicts, so it is safe on
// the cockpit's request path. A verdict counts only beside a fresh stamp: a null or
// unparseable stamp vouches for nothing, and a stale one no longer claims the present.
//
// Where each lands is the plan's ladder table (`levelOf` in ladder.ts places the kinds):
//   Broken    — uptime, domain, cert-expiring, function-health, cms, render, form
//   Attention — cert, links, titles, a11y, deps-far
//   Watch     — smoke, deps, search-console
// Broken and Attention collectors are registered in the cockpit's list AND the digest's
// `collectAttention` (only the digest writes digest_state, so an item the digest lacks
// never ages). Watch collectors are the cockpit's only.
//
// Two are built but NOT registered yet: the live form test and smoke. Both pass on
// known-good sites, but every failure on 2026-10-26 was false (Sonder's cookie
// dialog #1736, Vida's slow fill #1737, smoke's build-only spec #1777); the operator
// chose to wire each once its probe is fixed (workspace
// decisions/2026-10-27-0131-p1-78c-form-and-smoke-wiring.md).
import type { AttentionItem } from "./attention.js";
import { siteSlug, type WebsiteRow } from "../fleet/site-row.js";
import type { DepsSite } from "../fleet-daily/types.js";
import { searchConsoleFreshDays } from "../fleet/search-console-evidence.js";
import { searchConsoleOptedOut } from "../fleet/opt-outs.js";
import { TRIAGE_PATH } from "../dashboard/home-path.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A nightly verdict older than this no longer claims the present (the nightly cadence,
 *  with a weekend of runner flakes tolerated, as GitHub signals and the url probe). */
export const PRODUCTION_STALE_DAYS = 3;
/** Accessibility runs weekly (`fleet-a11y.yml`, Sunday night), so its verdict holds 8 days. */
export const A11Y_STALE_DAYS = 8;
/** A certificate this close to expiry (or past it) is Broken; within 30 days, Attention. */
export const CERT_BROKEN_DAYS = 7;
export const CERT_ATTENTION_DAYS = 30;
/** A package a major behind for longer than this many calendar days is Attention. */
export const DEPS_FAR_DAYS = 90;

/** The kinds only the cockpit collects (Watch: no mail, no age needed). Only the digest
 *  writes `digest_state`, so their keys never reach the snapshot, and a diff against it
 *  would read them NEW, flagged today, on every load. The cockpit leaves them standing
 *  and undated instead (review round 1). */
export const COCKPIT_ONLY_PREFIXES = ["deps:", "search-console:", "smoke:"] as const;

export function isCockpitOnly(it: Pick<AttentionItem, "key">): boolean {
  return COCKPIT_ONLY_PREFIXES.some((p) => it.key.startsWith(p));
}

/** A cockpit-only item as the cockpit shows it: standing, with no first-flagged date. */
export function undated(it: AttentionItem): AttentionItem {
  if (!isCockpitOnly(it)) return it;
  const { firstFlaggedAt: _f, ...rest } = it;
  return { ...rest, status: "standing" };
}

/** Is a stamp current? Null or unparseable is not; a future stamp is. */
export function freshWithin(stamp: string | null, days: number, now: Date): boolean {
  if (stamp === null) return false;
  const ageMs = now.getTime() - Date.parse(stamp);
  return Number.isFinite(ageMs) && ageMs <= days * MS_PER_DAY;
}

function dashboardUrl(baseUrl: string, siteName: string): string {
  const root = baseUrl.replace(/\/$/, "");
  const slug = siteSlug(siteName);
  return slug ? `${root}/s/${slug}` : `${root}${TRIAGE_PATH}`;
}

/** Only a maintained site has visitors to protect; a launching site's audits are pre-launch
 *  noise and a hosted-only site is not audited. */
function maintained(sites: WebsiteRow[]): WebsiteRow[] {
  return sites.filter((s) => s.status === "maintained");
}

function item(
  s: WebsiteRow,
  baseUrl: string,
  kind: AttentionItem["kind"],
  prefix: string,
  title: string,
  severity: AttentionItem["severity"] = "warning",
  metric = 1,
): AttentionItem {
  return {
    key: `${prefix}:${s.id}`,
    kind,
    siteName: s.name,
    title,
    url: dashboardUrl(baseUrl, s.name),
    severity,
    metric,
  };
}

/** The plan's "site down" row: a fresh uptime fail (every sampled route must answer 2xx/3xx).
 *  One dead sitemap page fails it as surely as a dead homepage, and the row stores no URL, so
 *  the title says what was observed, never "site down". A run that sampled no route stores
 *  null, so it never fires. Stamped by the browser audit. */
export function collectUptimeAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter(
      (s) =>
        s.reachableOk === "fail" && freshWithin(s.browserCheckedAt, PRODUCTION_STALE_DAYS, now),
    )
    .map((s) =>
      item(s, baseUrl, "uptime", "uptime", "a sampled page did not answer 2xx or 3xx", "critical"),
    );
}

/** A certificate item's metric: it rises as expiry nears (the cockpit sorts a higher metric
 *  first, and the digest reads a rise as WORSE), so it is the days used of the 30-day window,
 *  not the days left (review round 5). */
export function certUrgency(days: number): number {
  return CERT_ATTENTION_DAYS + 1 - days;
}

/** The domain audit's certificate verdict. A fresh run that stored no certificate days did
 *  not resolve or found no usable TLS: the domain is dead. Otherwise the days left decide:
 *  7 or fewer (or expired) is Broken, 8 to 30 is Attention. */
export function collectDomainAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of maintained(sites)) {
    if (!freshWithin(s.domainCheckedAt, PRODUCTION_STALE_DAYS, now)) continue;
    const stored = s.certDaysRemaining;
    // The audit counted the days when it ran; a stamp up to 3 days old has used some.
    const days =
      stored === null
        ? null
        : stored -
          Math.max(0, Math.floor((now.getTime() - Date.parse(s.domainCheckedAt!)) / MS_PER_DAY));
    if (days === null) {
      items.push(
        item(
          s,
          baseUrl,
          "domain",
          "domain",
          "domain does not resolve, or has no usable TLS certificate",
          "critical",
        ),
      );
    } else if (days <= CERT_BROKEN_DAYS) {
      const when = days < 0 ? "expired" : `expires in ${days} day${days === 1 ? "" : "s"}`;
      items.push(
        item(
          s,
          baseUrl,
          "cert",
          "cert-expiring",
          `TLS certificate ${when}`,
          "critical",
          certUrgency(days),
        ),
      );
    } else if (days <= CERT_ATTENTION_DAYS) {
      items.push(
        item(
          s,
          baseUrl,
          "cert",
          "cert",
          `TLS certificate expires in ${days} days`,
          "warning",
          certUrgency(days),
        ),
      );
    }
  }
  return items;
}

/** A server function erroring (`/health` failed), or the CMS it reads unreachable. Forms run
 *  through these functions. A self-skipped run writes nothing, so the stamp ages. */
export function collectFunctionHealthAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of maintained(sites)) {
    if (!freshWithin(s.functionHealthCheckedAt, PRODUCTION_STALE_DAYS, now)) continue;
    // The site template's /health answers ok:false exactly when Prismic errored, and the
    // function itself ran (recipes/health-endpoint/template.ts), so a CMS failure is one
    // fault: the cms: item names it, and function-health: would blame the wrong thing
    // (review round 5).
    if (s.functionHealth === "fail" && s.cmsReachable !== "fail")
      items.push(
        item(
          s,
          baseUrl,
          "function-health",
          "function-health",
          "a server function is erroring (/health failed)",
          "critical",
        ),
      );
    if (s.cmsReachable === "fail")
      items.push(
        item(s, baseUrl, "cms", "cms", "the CMS is unreachable from the site", "critical"),
      );
  }
  return items;
}

/** Pages fail to render: a fresh desktop (cross-browser) or mobile fail from the browser
 *  audit. Proven on 2026-10-26: 16 sites pass, and 1836dig's fail is real. */
export function collectRenderAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter(
      (s) =>
        (s.crossbrowserOk === false || s.mobileOk === false) &&
        freshWithin(s.browserCheckedAt, PRODUCTION_STALE_DAYS, now),
    )
    .map((s) => {
      const where = [
        s.crossbrowserOk === false ? "desktop" : null,
        s.mobileOk === false ? "mobile" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      return item(s, baseUrl, "render", "render", `pages fail to render on ${where}`, "critical");
    });
}

/** The live form test fails. A null verdict with a fresh stamp is a site with no form. */
export function collectFormTestAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter(
      (s) => s.formE2eOk === "fail" && freshWithin(s.formE2eCheckedAt, PRODUCTION_STALE_DAYS, now),
    )
    .map((s) =>
      item(
        s,
        baseUrl,
        "form",
        "form",
        "the live form test fails: a visitor may not reach you",
        "critical",
      ),
    );
}

/** Broken links: a fresh links fail that names at least one broken link. A run that checked
 *  no link stores null, and a fail with no broken link named proves nothing. */
export function collectLinkAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter(
      (s) =>
        s.linksOk === false &&
        (s.brokenLinks ?? 0) > 0 &&
        freshWithin(s.browserCheckedAt, PRODUCTION_STALE_DAYS, now),
    )
    .map((s) => {
      const n = s.brokenLinks!;
      return item(
        s,
        baseUrl,
        "links",
        "links",
        `${n} broken link${n === 1 ? "" : "s"}`,
        "warning",
        n,
      );
    });
}

/** Titles or meta descriptions missing (or titles duplicated), fresh from the browser audit. */
export function collectTitleMetaAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter(
      (s) =>
        s.titleMetaOk === "fail" && freshWithin(s.browserCheckedAt, PRODUCTION_STALE_DAYS, now),
    )
    .map((s) =>
      item(
        s,
        baseUrl,
        "titles",
        "titles",
        "page titles or meta descriptions missing or duplicated",
      ),
    );
}

/** Accessibility findings from a complete weekly run: every route scanned, stamped within
 *  8 days. A run with either count unknown, or fewer scanned than total, is not measured. A
 *  skip the site declared (an absent fixture, the placeholder Prismic repo) is out of both
 *  counts (`a11yAudit`'s stored `routes`), and those are the only skips the audit makes today.
 *  The count is every entry of the artifact's list: axe violations, plus client errors,
 *  missing fixture routes and rules axe could not measure, so the title says "findings". */
export function collectA11yAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter(
      (s) =>
        (s.a11yViolations ?? 0) > 0 &&
        s.a11yRoutesTotal !== null &&
        s.a11yRoutesScanned !== null &&
        s.a11yRoutesScanned >= s.a11yRoutesTotal &&
        freshWithin(s.a11yCheckedAt, A11Y_STALE_DAYS, now),
    )
    .map((s) => {
      const n = s.a11yViolations!;
      return item(
        s,
        baseUrl,
        "a11y",
        "a11y",
        `${n} accessibility finding${n === 1 ? "" : "s"}`,
        "warning",
        n,
      );
    });
}

/** The latest `fleet_daily` row's dependency readings: its night, and per site id the
 *  packages behind with each one's first night (`readLatestDeps`). */
export type LatestDeps = { night: string; sites: Record<string, DepsSite> };

/** Whole calendar days from one `YYYY-MM-DD` night to another. */
function nightsBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * Dependencies behind, from `fleet_daily`'s latest row. Each package (`name@installed-major`)
 * ages from the first night of its unbroken run of readings (the writer resets it when a
 * reading drops the key, and carries it through a night with no reading). A package behind
 * for more than 90 calendar days makes the site Attention (`deps-far:`); otherwise a site
 * with any package behind is Watch (`deps:`). A night with no reading uses the run carried
 * through it. The list must be fresh (written within 3 days).
 */
export function collectDepsAlerts(
  sites: WebsiteRow[],
  deps: LatestDeps | null,
  baseUrl: string,
  now: Date = new Date(),
): { far: AttentionItem[]; behind: AttentionItem[] } {
  const far: AttentionItem[] = [];
  const behind: AttentionItem[] = [];
  if (deps === null) return { far, behind };
  for (const s of maintained(sites)) {
    const d = deps.sites[s.id];
    if (!d || !freshWithin(d.at, PRODUCTION_STALE_DAYS, now)) continue;
    const packages = d.packages ?? Object.keys(d.firstSeen);
    if (packages.length === 0) continue;
    const old = packages.filter((k) => {
      const first = d.firstSeen[k];
      return first !== undefined && nightsBetween(first, deps.night) > DEPS_FAR_DAYS;
    });
    if (old.length > 0) {
      far.push(
        item(
          s,
          baseUrl,
          "deps",
          "deps-far",
          // The others behind are named too, so clearing the old one is not mistaken for
          // clearing the site (review round 2).
          `${old.length} package${old.length === 1 ? "" : "s"} a major behind for over ${DEPS_FAR_DAYS} days: ${old.join(", ")}` +
            (packages.length > old.length
              ? `; ${packages.length} packages a major behind in all`
              : ""),
          "warning",
          old.length,
        ),
      );
    } else {
      behind.push(
        item(
          s,
          baseUrl,
          "deps",
          "deps",
          `${packages.length} package${packages.length === 1 ? "" : "s"} a major behind`,
          "warning",
          packages.length,
        ),
      );
    }
  }
  return { far, behind };
}

/** Smoke fails: the site's own smoke suite, run on a LOCAL build, so Watch. An unmeasured
 *  run writes nothing, so a stale stamp is skipped. */
export function collectSmokeAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter((s) => s.smokeOk === "fail" && freshWithin(s.lastSmokeAt, PRODUCTION_STALE_DAYS, now))
    .map((s) =>
      item(s, baseUrl, "smoke", "smoke", "the site's own smoke tests fail on a local build"),
    );
}

/** The Search Console lookup soft-failed (the API errored, so nothing is known). Written when a
 *  report drafts, so it is fresh for the site's report cadence plus grace, the window the
 *  evidence reader uses; Watch, monitor health. */
export function collectSearchConsoleAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  return maintained(sites)
    .filter(
      (s) =>
        s.searchConsoleOutcome === "soft-fail" &&
        // An opted-out site's lookup no longer runs, so its last soft-fail would stay
        // fresh for a whole cadence; the opt-out wins, as in searchConsoleEvidence.
        !searchConsoleOptedOut(s) &&
        freshWithin(s.searchConsoleCheckedAt, searchConsoleFreshDays(s), now),
    )
    .map((s) =>
      item(s, baseUrl, "search-console", "search-console", "the Search Console lookup is failing"),
    );
}
