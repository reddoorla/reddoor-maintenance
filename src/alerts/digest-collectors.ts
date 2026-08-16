// src/alerts/digest-collectors.ts
import type { AttentionItem } from "./attention.js";
import {
  allActionableVulnsTransitive,
  siteSlug,
  ACTIVE_STATUSES,
  isPreLaunch,
  type WebsiteRow,
} from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import { approveBlockers } from "../reports/preflight.js";

/** Build the same `/s/<slug>` dashboard link the M3 ready-section uses, trailing-slash-safe.
 *  An empty Name slugs to "" and `/s/` is a dead link — fall back to the fleet homepage,
 *  exactly like the ready-section does. */
function dashboardUrl(baseUrl: string, siteName: string): string {
  const root = baseUrl.replace(/\/$/, "");
  const slug = siteSlug(siteName);
  return slug ? `${root}/s/${slug}` : root;
}

/**
 * A GitHub-signals sweep older than this (or never run) is no longer trustworthy:
 * a repo whose nightly probe THREW stops being re-swept, so its persisted
 * `Default Branch CI` / `Renovate Failing CIs` freeze at their last value forever
 * — a phantom 🔴 that can never clear. 3 days ≈ 3× the daily sweep interval, so a
 * single missed/flaky run doesn't drop a real signal. The CI/Renovate collectors
 * (only) skip a site whose `githubSignalsAt` is staler than this. Vuln/Lighthouse/
 * delivery signals come from other sweeps and are unaffected.
 */
const GITHUB_SIGNALS_STALE_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when a site's GitHub-signals sweep is too old (or never ran) to trust the
 *  persisted CI/Renovate fields. A null `githubSignalsAt` (never swept) is stale —
 *  there's no sweep to vouch for the values. A future timestamp (now - swept < 0)
 *  is fresh. `now` is injected so the gate is testable. */
function gitHubSignalsStale(swept: string | null, now: Date): boolean {
  if (swept === null) return true;
  const ageMs = now.getTime() - Date.parse(swept);
  if (!Number.isFinite(ageMs)) return true; // unparseable timestamp → don't trust it
  return ageMs > GITHUB_SIGNALS_STALE_DAYS * MS_PER_DAY;
}

/** Renovate auto-fix dispatches for one vuln episode before it's "exhausted" (manual fix needed). */
const AUTO_FIX_EXHAUSTED_CYCLES = 3;

/**
 * One attention item per site carrying current critical+high vulns (medium/low omitted
 * per the locked threshold). PURE: takes already-fetched Websites rows. `metric` is the
 * critical+high count (so a rising count diffs as WORSE); `severity` is `critical` when
 * any critical exists, else `warning`. Null counts (never audited) read as 0 → skipped.
 * Once `securityAutoFixAttempts` reaches AUTO_FIX_EXHAUSTED_CYCLES the item is flagged
 * `autoFixExhausted` (forced-critical, escalated title) — Renovate tried and couldn't fix it.
 * EXCEPT when the persisted advisories prove every critical/high vuln is TRANSITIVE: then
 * nightly dispatches were green no-ops (no direct dep to bump — the fix rides the weekly
 * lockfile window), "auto-fix failed" would be a lie, and a stale pre-fix counter must not
 * escalate (Sonder said "auto-fix failed (5×)" on exactly this, 2026-08-10). Those sites get
 * an honest transitive-only title, keep count-based severity, and stay out of the digest
 * email (amber cockpit Watch still shows them). Unknown relationship data never mutes.
 *
 * Emission is UNCONDITIONAL — every surface applies its own policy on top:
 *   - digest email: includes a vuln only when `autoFixExhausted` (the operator hears
 *     about a vuln only after Renovate tried and failed; before that the fleet is
 *     still self-patching) — runDigest filters
 *   - cockpit: non-exhausted vuln → amber Watch; exhausted → hard break (assignTier),
 *     and only an exhausted vuln pierces the pre-launch mute (piercesPreLaunchMute)
 */
export function collectVulnAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const critical = s.securityVulnsCritical ?? 0;
    const high = s.securityVulnsHigh ?? 0;
    const metric = critical + high;
    if (metric <= 0) continue;
    const attempts = s.securityAutoFixAttempts ?? 0;
    const transitiveOnly = allActionableVulnsTransitive(s.securityAdvisories);
    const exhausted = !transitiveOnly && attempts >= AUTO_FIX_EXHAUSTED_CYCLES;
    const noun = metric === 1 ? "vuln" : "vulns";
    items.push({
      key: `vuln:${s.id}`,
      kind: "vuln",
      siteName: s.name,
      title: exhausted
        ? `${metric} critical/high ${noun} — auto-fix failed (${attempts}×)`
        : transitiveOnly
          ? `${metric} critical/high ${noun} — transitive-only, fix rides the weekly lockfile window`
          : `${metric} critical/high ${noun}`,
      url: dashboardUrl(baseUrl, s.name),
      severity: exhausted || critical > 0 ? "critical" : "warning",
      metric,
      ...(exhausted ? { autoFixExhausted: true } : {}),
    });
  }
  return items;
}

/** Absolute floor below which a Lighthouse category is "Needs attention" (Tucker's call). */
const LIGHTHOUSE_FLOOR = 75;

/** The four Lighthouse categories, each mapped to its WebsiteRow score field, URL slug,
 *  and the human label rendered in the digest title. Order is the operator's reading order. */
const LIGHTHOUSE_CATEGORIES: ReadonlyArray<{
  field: "pScore" | "rScore" | "bpScore" | "seoScore";
  slug: string;
  label: string;
}> = [
  { field: "pScore", slug: "performance", label: "Performance" },
  { field: "rScore", slug: "accessibility", label: "Accessibility" },
  { field: "bpScore", slug: "best-practices", label: "Best Practices" },
  { field: "seoScore", slug: "seo", label: "SEO" },
];

/**
 * One attention item per Lighthouse category below the absolute floor (75) for each site.
 * PURE: takes already-fetched Websites rows. Categories are Performance/Accessibility/
 * Best-Practices/SEO. A null score (never audited) or a score >= 75 is skipped. The
 * `metric` is the DEFICIT (`100 - score`): a lower score → higher metric, so a category
 * that drops further diffs as WORSE and one that first crosses below 75 diffs as NEW —
 * which is how `diffAttention`'s "WORSE on increase" rule reads an inverted score. `key`
 * is `lighthouse:<siteId>:<categorySlug>`, so the four categories stay distinct per site.
 */
export function collectLighthouseAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    for (const cat of LIGHTHOUSE_CATEGORIES) {
      const score = s[cat.field];
      if (score === null || score >= LIGHTHOUSE_FLOOR) continue;
      items.push({
        key: `lighthouse:${s.id}:${cat.slug}`,
        kind: "lighthouse",
        siteName: s.name,
        title: `Lighthouse ${cat.label} ${score} (below ${LIGHTHOUSE_FLOOR})`,
        url: dashboardUrl(baseUrl, s.name),
        severity: "warning",
        metric: 100 - score,
      });
    }
  }
  return items;
}

/**
 * One attention item per report whose `deliveryStatus` is a failure (`bounced` or
 * `complained` — `delivered`/`pending` are ignored). PURE: takes already-fetched
 * Reports rows + a record-id→site map. A complaint ranks above a bounce (locked
 * threshold), so `severity` is `critical` for complained / `warning` for bounced.
 * `metric` is 1 (a binary event). Orphans (siteId not in the map) are skipped, as
 * the M3 ready-section does, so the digest never renders a broken link. The diff
 * key is the report RECORD id, so two failures on one site stay distinct.
 */
/**
 * One attention item per unsent draft whose send is ALREADY known to fail
 * (approveBlockers: recipients / header image / report scores). An APPROVED one
 * is critical — the next 09:23 UTC run will go red on it; a pending one is a
 * warning — approving it just schedules that failure. Keyed `preflight:<reportId>`.
 * PURE; same predicate the approve gate and the dashboard chip use.
 */
export function collectPreflightBlocked(
  reports: ReportRow[],
  sitesById: Map<string, WebsiteRow>,
  baseUrl: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of reports) {
    if (!r.draftReady || r.sentAt !== null) continue;
    // The approved state rides the KEY so a pending→approved escalation with
    // unchanged blockers re-news as a fresh critical instead of diffing
    // "standing" against its old warning self.
    const state = r.approvedToSend ? "approved" : "pending";
    const site = sitesById.get(r.siteId);
    if (!site) {
      // A dangling/empty Site link is itself a send blocker (sendApprovedReports
      // fails with "Site row not found") — surface it; the empty-slug
      // dashboardUrl fallback yields the fleet root, not a broken /s/ link.
      items.push({
        key: `preflight:${r.id}:${state}`,
        kind: "preflight",
        siteName: "(unlinked site)",
        title: r.approvedToSend
          ? `Approved ${r.reportType} will fail at send — site-not-found`
          : `${r.reportType} draft can't be approved — site-not-found`,
        url: dashboardUrl(baseUrl, ""),
        severity: r.approvedToSend ? "critical" : "warning",
        metric: 1,
      });
      continue;
    }
    const fails = approveBlockers(site, r).filter((f) => f.level === "fail");
    if (fails.length === 0) continue;
    const first = fails[0]!;
    const more = fails.length > 1 ? ` (+${fails.length - 1} more)` : "";
    items.push({
      key: `preflight:${r.id}:${state}`,
      kind: "preflight",
      siteName: site.name,
      title: r.approvedToSend
        ? `Approved ${r.reportType} will fail at send — ${first.check}${more}`
        : `${r.reportType} draft can't be approved — ${first.check}${more}`,
      url: dashboardUrl(baseUrl, site.name),
      severity: r.approvedToSend ? "critical" : "warning",
      metric: fails.length,
    });
  }
  return items;
}

export function collectDeliveryFailures(
  reports: ReportRow[],
  sitesById: Map<string, WebsiteRow>,
  baseUrl: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of reports) {
    if (r.deliveryStatus !== "bounced" && r.deliveryStatus !== "complained") continue;
    const site = sitesById.get(r.siteId);
    if (!site) continue; // orphan → skip rather than render a broken link
    const complained = r.deliveryStatus === "complained";
    items.push({
      key: `delivery:${r.id}`,
      kind: "delivery",
      siteName: site.name,
      title: complained ? "Spam complaint on a sent report" : "A sent report bounced",
      url: dashboardUrl(baseUrl, site.name),
      severity: complained ? "critical" : "warning",
      metric: 1,
    });
  }
  return items;
}

/**
 * One attention item per site carrying failing Renovate PRs, read from the
 * slice-2a-persisted `renovateFailingCis` field (the nightly github-signals sweep
 * populates it). PURE. Keyed `renovate:<siteId>` so the digest and the cockpit
 * share one diff key. `metric` is the count (a rising count diffs WORSE); severity
 * `warning`. Null/0 → skipped. A site whose `githubSignalsAt` is >3 days stale (or
 * null) is ALSO skipped — a repo that stopped being swept must not show a phantom
 * count forever (`now` injected, defaults to wall-clock).
 */
export function collectRenovateAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    if (gitHubSignalsStale(s.githubSignalsAt, now)) continue;
    const n = s.renovateFailingCis ?? 0;
    if (n <= 0) continue;
    items.push({
      key: `renovate:${s.id}`,
      kind: "renovate",
      siteName: s.name,
      title: `${n} Renovate ${n === 1 ? "PR" : "PRs"} failing CI`,
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: n,
    });
  }
  return items;
}

/**
 * One attention item per site whose persisted default-branch CI rollup is
 * `failing` (slice 2a). PURE. `metric` 1 (binary); severity `warning`. Any other
 * state (passing/pending/none) or null is skipped. A site whose `githubSignalsAt`
 * is >3 days stale (or null) is ALSO skipped — a repo that stopped being swept must
 * not show a phantom 🔴 forever (`now` injected, defaults to wall-clock).
 */
export function collectCiAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    if (gitHubSignalsStale(s.githubSignalsAt, now)) continue;
    if (s.defaultBranchCi !== "failing") continue;
    items.push({
      key: `ci:${s.id}`,
      kind: "ci",
      siteName: s.name,
      title: "Default-branch CI failing",
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: 1,
    });
  }
  return items;
}

/**
 * A soft-fail older than this is no longer a trustworthy CURRENT signal. Drafting
 * self-clears `analyticsSoftFailAt` on the next clean enrichment, so a non-null
 * value normally means "errored on the most recent draft and hasn't recovered" —
 * but a site that stopped being drafted (freq→None, deprecated) would otherwise
 * show a phantom forever. 45 days covers a monthly cadence + margin; older drops.
 */
const ANALYTICS_SOFT_FAIL_STALE_DAYS = 45;

/**
 * One attention item per site whose last draft's GA/Search enrichment ERRORED, read
 * from the `analyticsSoftFailAt` timestamp (drafting sets it on a soft-fail, clears
 * it on a clean enrichment). PURE. Keyed `analytics:<siteId>` so the digest and the
 * cockpit share one diff key; `metric` 1 (binary), severity `warning`. A null
 * timestamp (clean, or the operator-added `Analytics soft-fail at` column absent) is
 * skipped, as is one staler than {@link ANALYTICS_SOFT_FAIL_STALE_DAYS}. On a
 * FLEET-WIDE subject outage many sites surface this at once — that breadth IS the
 * signal here; the report cron additionally emails a single concise fleet-wide alert
 * (see `assessAnalyticsAlert`). `now` injected, defaults to wall-clock.
 */
/** A function-health sweep older than this can't confirm the CURRENT widget state.
 *  The sweep is nightly, so 3 days (mirrors GITHUB_SIGNALS_STALE_DAYS) tolerates a
 *  weekend of runner flakes without letting a months-old verdict drive an alarm. */
const TURNSTILE_WIDGET_STALE_DAYS = 3;

/**
 * One CRITICAL attention item per site with `Require Turnstile` ON whose deployed
 * `/health` reports the Turnstile widget NOT configured (`turnstileWidget === "fail"`,
 * fresh per {@link TURNSTILE_WIDGET_STALE_DAYS}). That combination silently buckets
 * 100% of the site's real leads (token-less submissions escalate to spam_auto with
 * notify skipped) and the form-e2e probe cannot see it — testMode bypasses the gate —
 * so the operator's inbox just goes quiet. PURE. Keyed `turnstile:<siteId>`. Because
 * this is an AttentionItem it rides assignTier's items short-circuit, which sits ABOVE
 * the accepted-watch mute loop — an accept key can never silence it. A null verdict or
 * a stale sweep is NOT alarmed here; assignTier raises those as an acceptable
 * "can't verify" watch instead. `now` injected, defaults to wall-clock.
 */
export function collectTurnstileGuardrailAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    if (!s.requireTurnstile || s.turnstileWidget !== "fail") continue;
    const at = s.functionHealthCheckedAt;
    if (at !== null) {
      const ageMs = now.getTime() - Date.parse(at);
      // Parseable and beyond the window → stale, downgraded to assignTier's watch.
      // Unparseable (NaN) keeps the item — never silently drop a real failure.
      if (Number.isFinite(ageMs) && ageMs > TURNSTILE_WIDGET_STALE_DAYS * MS_PER_DAY) continue;
    }
    items.push({
      key: `turnstile:${s.id}`,
      kind: "turnstile",
      siteName: s.name,
      title:
        "Require Turnstile is ON but /health reports no widget — real leads are being auto-bucketed",
      url: dashboardUrl(baseUrl, s.name),
      severity: "critical",
      metric: 1,
    });
  }
  return items;
}

/** Bounced lead notifications inside the window before a site alarms. One bounce can
 *  be a transient greylist/full-mailbox blip; a repeat says the point-of-contact
 *  address itself is bad (the Espada mode: apm@ bounced 4 of 8 with nothing alarming). */
export const NOTIFY_BOUNCE_THRESHOLD = 2;

/** Window (days) the bounce count covers. Two weeks: long enough that a low-volume
 *  site's second bounce still lands in the same window as its first, short enough
 *  that a long-fixed address doesn't alarm forever (bounced rows never self-clear —
 *  the alarm ages out as bounced submissions leave the window). */
export const NOTIFY_BOUNCE_WINDOW_DAYS = 14;

/**
 * One CRITICAL attention item per site with >= {@link NOTIFY_BOUNCE_THRESHOLD} bounced
 * lead notifications in the last {@link NOTIFY_BOUNCE_WINDOW_DAYS} days — leads are
 * being captured but silently never reach the client, which is worse than no form at
 * all (notifyStatus "sent" only means Resend accepted the email; the resend-webhook
 * flips it to "bounced" when Resend later reports the failure, 2026-07-16). PURE:
 * takes the pre-fetched per-site counts (`countNotifyBouncedBySite`, keyed by the
 * Websites record id). Keyed `notify-bounce:<siteId>` so the digest and the cockpit
 * share one diff key; `metric` is the bounce count (a rising count diffs WORSE).
 * A site absent from the map (or below threshold) is skipped, as is a count for a
 * site id not in `sites` (orphan → never render a broken link).
 */
export function collectNotifyBounceAlerts(
  sites: WebsiteRow[],
  bouncedBySite: ReadonlyMap<string, number>,
  baseUrl: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const n = bouncedBySite.get(s.id) ?? 0;
    if (n < NOTIFY_BOUNCE_THRESHOLD) continue;
    items.push({
      key: `notify-bounce:${s.id}`,
      kind: "notify-bounce",
      siteName: s.name,
      title: `${n} lead notifications bounced (${NOTIFY_BOUNCE_WINDOW_DAYS}d) — check the point-of-contact address`,
      url: dashboardUrl(baseUrl, s.name),
      severity: "critical",
      metric: n,
    });
  }
  return items;
}

export function collectAnalyticsFailures(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const at = s.analyticsSoftFailAt;
    if (at === null) continue;
    const ageMs = now.getTime() - Date.parse(at);
    // Unparseable timestamp (NaN) → keep the item (don't silently drop a real failure
    // on a parse glitch); only a parseable, beyond-window age is skipped as stale.
    if (Number.isFinite(ageMs) && ageMs > ANALYTICS_SOFT_FAIL_STALE_DAYS * MS_PER_DAY) continue;
    items.push({
      key: `analytics:${s.id}`,
      kind: "analytics",
      siteName: s.name,
      title: "GA/Search enrichment failing (analytics blank)",
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: 1,
    });
  }
  return items;
}

/** How current a `fail` / `unknown` must be to still CLAIM the fleet's present
 *  state. The sweep is nightly, so 3 days (mirrors GITHUB_SIGNALS_STALE_DAYS)
 *  tolerates a weekend of runner flakes without letting a months-old finding drive
 *  a "models diverge right now" alarm. Past it the finding does not vanish — it
 *  converts to the staleness item below, which claims nothing about the models. */
const PRISMIC_DRIFT_STALE_DAYS = 3;

/** How long a `pass` may go unrefreshed before it is treated as unverified.
 *
 *  Deliberately LONGER than the currency window, and the asymmetry is the point.
 *  An old `fail` stops being reported as CURRENT drift at 3 days because it may
 *  already be fixed. An old `pass` is a green claim nobody has re-established, and
 *  escalating that at 3 days would light up the WHOLE fleet after a long weekend of
 *  runner flakes — the noise that gets a real alarm muted. A week is the interval
 *  over which a silently-dead nightly actually matters. */
const PRISMIC_STALE_PASS_DAYS = 7;

/**
 * True when the nightly `prismic-models --fleet airtable` sweep is EXPECTED to
 * cover this site. Mirrors the Airtable inventory's own filter (src/inventory/
 * airtable.ts): live `maintenance` sites (active, not pre-launch) that carry a
 * `url` AND a Name that yields a slug. Deliberately duplicated rather than
 * imported — the inventory builds `Site` objects and needs a workdir; this is a
 * pure predicate over a row — but the two must stay in step: widen the inventory
 * and widen this. That is no longer left to memory: every shape of row is put
 * through BOTH implementations by tests/alerts/prismic-sweep-scope.test.ts, which
 * goes red the moment they diverge.
 *
 * THE SLUG CLAUSE IS NOT COSMETIC, and it was the first drift this pair produced.
 * The inventory drops an empty-slug row (`siteSlug(name) === ""`) with a warning,
 * because such a row can neither form a checkout path nor be matched back to its
 * Websites row on write-back — and `writeSweepToAirtable` joins by that same slug,
 * so even a verdict computed for it could never land. Without this clause a live
 * site named in a script with no `[a-z0-9]` (or with an empty Name) was covered
 * here and swept nowhere: the permanent, un-ackable morning email this predicate
 * exists to prevent, produced by the predicate itself.
 *
 * Only the STALENESS escalation consults it. A `fail`/`unknown` is a verdict some
 * run actually established and is reported wherever it came from; the staleness
 * item is an alarm invented FROM AN ABSENCE, and an absence is only wrong where a
 * sweep was owed. A deprecated site that left the inventory would otherwise carry
 * a frozen `pass` into the digest every morning forever — un-ackable (attention
 * items sit above the accepted-watch mute) and unfixable except by hand-clearing
 * an Airtable cell.
 */
function prismicSweepCovers(s: WebsiteRow): boolean {
  return (
    s.status !== null &&
    ACTIVE_STATUSES.has(s.status) &&
    !isPreLaunch(s.status) &&
    s.url.length > 0 &&
    siteSlug(s.name).length > 0
  );
}

/**
 * One item per site whose nightly Prismic model verdict needs a human, from the
 * `prismic-models --fleet --write-airtable` sweep. PURE (`now` injected).
 *
 * The verdict is THREE-valued plus blank, and each state gets its own key so the
 * digest's snapshot diff (keyed on `key`) can never let one condition stand in for
 * another — a site sliding from drift to "couldn't check" re-news as NEW rather
 * than diffing "standing" against the drift it replaced (both carry `metric` 1):
 *
 *   - `fail`, fresh    → `prismic-drift:<siteId>`   — repo and Prismic diverge.
 *   - `unknown`, fresh → `prismic-unknown:<siteId>` — the check RAN AND COULD NOT
 *     ANSWER (unreadable checkout, dead write token, unreachable Prismic). Its own
 *     wording, because reporting a dead token as "models diverge" sends the
 *     operator to fix a model when the job is to fix a secret.
 *   - any verdict nobody has re-established → `prismic-stale:<siteId>` — a `pass`
 *     older than {@link PRISMIC_STALE_PASS_DAYS} (or undateable), or a `fail` /
 *     `unknown` older than {@link PRISMIC_DRIFT_STALE_DAYS}. A stale verdict is
 *     never silence: dropping it would make "nobody could evaluate this" read
 *     exactly like "this is fine", which is the failure this whole column exists
 *     to close. Gated by {@link prismicSweepCovers}.
 *   - blank (never swept, or not a Prismic site) → nothing, at any age. There is
 *     no claim to un-verify.
 *
 * A `pass` inside its window is the ONLY silent verdict. At most one item per site
 * — the Airtable cell holds one state at a time.
 *
 * `warning`, not `critical`: on the cockpit ANY item already tiers the site 🔴, so
 * severity buys only (a) piercing the pre-launch mute and (b) sorting first in the
 * needs-you feed. `critical` is reserved for the guardrails that are actively
 * losing leads or breaking a live page (Turnstile, notify-bounce, delivery); a
 * model that drifted — or a check that could not run — is neither, and piercing
 * the pre-launch mute would alarm on exactly the sites the sweep excludes by
 * design.
 */
/**
 * Is an operator's acceptance of a known divergence still in force?
 *
 * Every uncertain answer is `false` — an absent, blank or unparseable cell leaves
 * the alarm ringing. The asymmetry is the point: a mistyped date costing one noisy
 * item is recoverable, and a mistyped date silently muting a live finding is the
 * exact failure this column was built to close. The boundary belongs to the alarm
 * too: an ack "until 09:00" has nothing left to say at 09:00.
 */
export function prismicAckIsLive(ackUntil: string | null, now: Date): boolean {
  if (ackUntil === null || ackUntil.trim() === "") return false;
  const until = Date.parse(ackUntil);
  if (!Number.isFinite(until)) return false;
  return until > now.getTime();
}

export function collectPrismicDriftAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const verdict = s.prismicModels;
    if (verdict === null) continue;

    const at = s.prismicModelsCheckedAt;
    // +Infinity when there is no timestamp, NaN when it won't parse — both mean
    // "the age of this answer is unknowable", which the two verdict families read
    // in OPPOSITE directions on purpose (see `unverified`).
    const ageMs = at === null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(at);
    const ageKnown = Number.isFinite(ageMs);
    const windowDays = verdict === "pass" ? PRISMIC_STALE_PASS_DAYS : PRISMIC_DRIFT_STALE_DAYS;
    // An undateable `pass` is unverified — a green claim nobody can date is not a
    // green claim. An undateable `fail`/`unknown` is NOT downgraded: never silently
    // drop a real finding over a parse glitch.
    const unverified = ageKnown ? ageMs > windowDays * MS_PER_DAY : verdict === "pass";

    if (unverified) {
      if (!prismicSweepCovers(s)) continue;
      items.push({
        key: `prismic-stale:${s.id}`,
        kind: "prismic-drift",
        siteName: s.name,
        title: `Prismic model check has not run recently — the last verdict ("${verdict}") is unverified`,
        url: dashboardUrl(baseUrl, s.name),
        severity: "warning",
        metric: 1,
      });
      continue;
    }

    if (verdict === "pass") continue;

    const first = s.prismicModelsDrift
      ?.split("\n")
      .find((l) => l.trim() !== "")
      ?.trim();
    if (verdict === "unknown") {
      items.push({
        key: `prismic-unknown:${s.id}`,
        kind: "prismic-drift",
        siteName: s.name,
        title: first
          ? `Prismic model check could not run — ${first}`
          : "Prismic model check could not run",
        url: dashboardUrl(baseUrl, s.name),
        severity: "warning",
        metric: 1,
      });
      continue;
    }

    // The operator has reviewed THIS divergence and accepted it until a date they
    // set — see `WebsiteRow.prismicAckUntil`. Reached only on `fail`: the `unknown`
    // and staleness branches above have already returned, so an ack can never mute
    // "the check could not run" or "nobody has re-established this".
    if (prismicAckIsLive(s.prismicAckUntil, now)) continue;

    items.push({
      key: `prismic-drift:${s.id}`,
      kind: "prismic-drift",
      siteName: s.name,
      title: first
        ? `Prismic models diverge from the repo — ${first}`
        : "Prismic models diverge from the repo",
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: 1,
    });
  }
  return items;
}
