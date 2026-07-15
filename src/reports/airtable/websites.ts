import type { FieldSet } from "airtable";
import type { AirtableBase } from "./client.js";
import type { LighthouseScores, LighthouseScoreWriteback } from "../types.js";

export const WEBSITES_TABLE = "Websites";

export type Frequency = "None" | "Monthly" | "Quarterly" | "Yearly";

export type Status =
  | "in development"
  | "launch period"
  | "maintenance"
  | "hosting"
  | "probably not our problem"
  | "deprecated";

/**
 * Per-site notification routing. When present on a `maintenance` site, the form
 * notification is addressed by the value of a submission field (`field`, read from
 * `extraFields`) — e.g. route a contact form's `interest` to a different recipient
 * per option, always CC-ing a shared address. Absent (`null`) → the site keeps the
 * default single-POC behavior. Recipients live HERE (server-side Airtable config),
 * never supplied by the submitting site, so the ingest can't be turned into an open
 * relay.
 */
export type NotifyRouting = {
  /** The `extraFields` key whose value selects a route, e.g. "interest". */
  field: string;
  /** Field-value → recipient address(es). */
  routes: Record<string, string | string[]>;
  /** Recipient(s) when the value matches no route. */
  default?: string | string[];
  /** Address(es) CC'd on every routed (maintenance) send. */
  cc?: string[];
};

export type WebsiteRow = {
  id: string;
  name: string;
  url: string;
  status: Status | null;
  pointOfContact: string | null;
  maintenanceFreq: Frequency;
  testingFreq: Frequency;
  /** The literal Airtable cell values behind the coerced frequencies. `toFrequency`
   *  trims whitespace ("Monthly " reads as Monthly), then maps any still-unrecognized
   *  value ("Quaterly") to "None" with a LOUD console.warn so nothing bogus reaches a
   *  client email and the drop is never invisible. Preflight validates THESE to surface
   *  the same failure as a structured finding. Null = blank cell. */
  maintenanceFreqRaw: string | null;
  testingFreqRaw: string | null;
  /** Last manually-recorded maintenance day (used as fallback when no Reports row exists). */
  maintenanceDay: string | null;
  testingDay: string | null;
  ga4PropertyId: string | null;
  /** Operator-supplied query for the Google search-presence check (e.g. the business name).
   *  Null = no query set → the check is skipped for this site. */
  searchQuery: string | null;
  /** Explicit Search Console property for this site (`sc-domain:...` or `https://.../`).
   *  Null = auto-resolve from the SA's visible properties by host. */
  searchConsoleProperty: string | null;
  /** ISO timestamp of the last draft run where THIS site's GA/Search enrichment
   *  ERRORED (vs a legitimate "not configured" skip). Set by drafting on a soft-fail,
   *  cleared (null) on a clean enrichment, so the per-site analytics-failure signal
   *  self-heals. Null when the operator-added `Analytics soft-fail at` column is absent. */
  analyticsSoftFailAt: string | null;
  /** GitHub repo identity as `owner/repo`. Null = no git wiring → self-update ops skip
   *  (or, for local runs, fall back to the checkout's origin remote). */
  gitRepo: string | null;
  reportRecipientsTo: string | null;
  reportRecipientsCc: string | null;
  acceptedWatchConditions: string[];
  /** First attachment in the Header image field (Airtable's signed URL — fetch before expiry). */
  headerImage: { url: string; filename: string; type: string } | null;
  /** Lighthouse "current state" snapshot, kept fresh by `audit lighthouse --write-airtable`. */
  pScore: number | null;
  rScore: number | null;
  bpScore: number | null;
  seoScore: number | null;
  /** ISO timestamp set by `audit lighthouse --write-airtable` when scores were last refreshed. */
  lastLighthouseAuditAt: string | null;
  /** Last-known counts from non-lighthouse audits, written by
   *  `audit --write-airtable`. `null` = never audited (or this audit
   *  type was skipped on the last run). 0 = audited, clean. */
  a11yViolations: number | null;
  /** Declared-range drift vs the Reddoor baseline (what package.json asks for). */
  depsDrifted: number | null;
  depsMajorBehind: number | null;
  /** Real installed-version drift: deps behind the registry's latest, from the
   *  committed lockfile (`pnpm outdated`). Null = not determined this run. */
  depsOutdated: number | null;
  /** Of {@link depsOutdated}, how many are a *major* version behind the
   *  registry's latest — the "majors available on npm" signal, distinct from the
   *  baseline-drift {@link depsMajorBehind}. Null = not determined this run. */
  depsMajorOutdated: number | null;
  securityVulnsCritical: number | null;
  securityVulnsHigh: number | null;
  securityVulnsModerate: number | null;
  securityVulnsLow: number | null;
  /** Count of consecutive nightly Renovate auto-fix dispatches for the CURRENT
   *  critical/high vuln episode that have NOT yet cleared it. Owned by
   *  `renovate-dispatch`: +1 per real dispatch, reset to 0 when vulns clear.
   *  Null = field absent / never dispatched → reads as 0. At/above
   *  AUTO_FIX_EXHAUSTED_CYCLES the vuln renders as "auto-fix failed". */
  securityAutoFixAttempts: number | null;
  /** ISO timestamp the security audit last ran — gates freshness of the Security Updates auto-tick
   *  (clean counts only auto-tick when recent). */
  lastSecurityAuditAt: string | null;
  /** The known advisories behind the counts (severity-sorted, capped), so the dashboard can show
   *  WHICH packages are vulnerable, not just the totals. null = never audited / unparseable;
   *  empty array = audited clean. Written alongside the counts by the security audit. */
  securityAdvisories: SecurityAdvisory[] | null;
  /** Domain/DNS/SSL probe (the `domain` audit). `certDaysRemaining` is days until the TLS cert
   *  expires (null = unresolved or no usable cert); `domainCheckedAt` is when it last ran. */
  certDaysRemaining: number | null;
  domainCheckedAt: string | null;
  /** Netlify site id — the IDENTITY the `netlify-deploy` audit needs to query the
   *  Netlify API. Read-only input (operator-set in Airtable); null = not on Netlify
   *  (or not wired) → that audit skips. Never derived from the URL. */
  netlifyId: string | null;
  /** Latest PRODUCTION deploy health (the `netlify-deploy` audit). `deployStatus` is
   *  Netlify's deploy state lower-cased (`ready`/`error`/`building`/…), null = none / not
   *  checked; `lastDeployAt` is when it deployed; `deployLogUrl` links to the deploy/log. */
  deployStatus: string | null;
  lastDeployAt: string | null;
  deployLogUrl: string | null;
  /** When the `netlify-deploy` audit last RAN (freshness stamp for `deployStatus`). The audit
   *  already writes "Deploy checked at"; this read-back is the Plan-2 fix so `deployEvidence`
   *  (Plan 4) can gate on check time — NOT on `lastDeployAt`, which is deploy time, not check time. */
  deployCheckedAt: string | null;
  /** Function-health verdict (the `function-health` audit): the deployed `/health` function
   *  answered `ok:true` (pass) or `ok:false` (fail). Single-select `pass`/`fail`; null = never ran
   *  / unreachable (→ Plan 4 maps to unknown/amber). Kept SEPARATE from `deployStatus` so
   *  `isFailedDeployStatus` keeps meaning "the build failed". */
  functionHealth: "pass" | "fail" | null;
  /** CMS reachability (server-side), derived from the same `/health` body's `details.prismic ===
   *  "ok"`. Single-select `pass`/`fail`; null = never ran. No per-site Prismic token or identity
   *  column is ever built — this rides `/health`. */
  cmsReachable: "pass" | "fail" | null;
  /** When the `function-health` audit last ran — the freshness gate for BOTH `functionHealth` and
   *  `cmsReachable`. Null = never ran. */
  functionHealthCheckedAt: string | null;
  /** Deployed-URL browser probe (the `browser` audit): cross-engine render OK, mobile render OK,
   *  internal-links OK + broken count, and when it last ran (one timestamp gates all three). */
  crossbrowserOk: boolean | null;
  mobileOk: boolean | null;
  linksOk: boolean | null;
  brokenLinks: number | null;
  browserCheckedAt: string | null;
  /** Uptime-reachable verdict (browser audit): every sampled route returned 2xx/3xx. Single-select
   *  `pass`/`fail`; null = never ran. Point-in-time. Freshness-gated by `browserCheckedAt`. */
  reachableOk: "pass" | "fail" | null;
  /** Titles & meta verdict (browser audit, chromium): every sampled route has a non-empty `<title>`
   *  ≤ 70 chars + a non-empty meta description, and no duplicate titles across the sample.
   *  Single-select `pass`/`fail`; null = never ran. Freshness-gated by `browserCheckedAt`. */
  titleMetaOk: "pass" | "fail" | null;
  /** Per-site copy overrides (M6a). Blank → null → the DEFAULT_COPY value. */
  copyIntro: string | null;
  copyContact: string | null;
  copyFooter: string | null;
  /** Go-live timestamp, stamped when a Launch report sends (M6b). Null = not yet launched. */
  launchedAt: string | null;
  /** Optional per-site webhook (e.g. Zapier Catch Hook). When set, the ingest
   *  POSTs newsletter-formType submissions here (best-effort). Blank → null. */
  newsletterWebhook: string | null;
  /** Per-site Mailchimp (newsletter). Both must be set for the direct add;
   *  blank → skipped. The API key is `key-dc` format; dc is derived from it. */
  mailchimpApiKey: string | null;
  mailchimpAudienceId: string | null;
  /** Per-site Cloudflare Turnstile gate (Airtable checkbox). When true, a submission
   *  whose Turnstile token verifies as "fail" (forged) OR "absent" (secret configured
   *  centrally but NO token forwarded — the direct-POST-bot signature) is escalated to
   *  auto-spam regardless of content score. A present-but-expired token stays
   *  "unverifiable" and neutral (a real browser DID render the widget — fail-open).
   *  ROLLOUT PRECONDITION: only enable on a site whose DEPLOYED package forwards
   *  `_meta.turnstileToken` from EVERY form (widget rendered + `cf-turnstile-response`
   *  posted; check the site's `/health` → forms.turnstile:true). A site that never
   *  forwards tokens would silently bucket 100% of its real leads — and the form-e2e
   *  probe cannot catch that state (testMode bypasses the gate). */
  requireTurnstile: boolean;
  /** GitHub-signals sweep (slice 2a), written nightly by `github-signals --fleet`. */
  renovateFailingCis: number | null;
  defaultBranchCi: string | null; // "passing" | "failing" | "pending" | "none"
  lastCommitAt: string | null;
  githubSignalsAt: string | null;
  /** Per-site smoke-suite verdict (the `smoke` audit runs `pnpm test:smoke`).
   *  Single-select pass/fail; null = never ran. `lastSmokeAt` gates freshness. */
  smokeOk: "pass" | "fail" | null;
  lastSmokeAt: string | null;
  /** Synthetic form end-to-end verdict (the `form-e2e` audit submits the real prod
   *  contact form in test-mode). Single-select pass/fail; null = never ran OR (with
   *  a fresh `formE2eCheckedAt`) no contact form → n/a. `formE2eCheckedAt` gates
   *  freshness AND encodes the n/a-vs-never-ran distinction. */
  formE2eOk: "pass" | "fail" | null;
  formE2eCheckedAt: string | null;
  notifyRouting: NotifyRouting | null;
};

export function siteSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Blank-trim-to-null: a non-string or whitespace-only value becomes null,
 *  otherwise the trimmed string. */
function trimToNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse the Websites `Notify Routing` JSON into a NotifyRouting, defensively: a
 * non-string, blank, malformed-JSON, or wrong-shape value yields null (the site
 * then keeps default single-POC routing) — never throws. Mirrors the pipeline's
 * "a bad Airtable string degrades quietly" rule.
 */
export function parseNotifyRouting(raw: unknown): NotifyRouting | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.field !== "string" || !o.field.trim()) return null;
  if (!o.routes || typeof o.routes !== "object" || Array.isArray(o.routes)) return null;
  const routing: NotifyRouting = {
    field: o.field,
    routes: o.routes as Record<string, string | string[]>,
  };
  if (o.default !== undefined) routing.default = o.default as string | string[];
  if (Array.isArray(o.cc)) routing.cc = o.cc.filter((x): x is string => typeof x === "string");
  return routing;
}

/**
 * Active sites: actively-maintained or pre-launch. Single source of truth for
 * "is this a live site" — the operator cockpit shows these, and the fleet
 * audit/report path runs against these. A `null` status (not-yet-active) is
 * deliberately excluded.
 */
export const ACTIVE_STATUSES: ReadonlySet<Status> = new Set<Status>([
  "maintenance",
  "launch period",
]);

export function isDashboardVisible(site: WebsiteRow): boolean {
  return site.status !== null && ACTIVE_STATUSES.has(site.status);
}

/**
 * Pre-launch lifecycle stages: the site is being built/prepared, NOT yet live. A
 * Launch report (recipes/launch.ts) flips Status → "maintenance" at go-live
 * (updateLaunched), so "maintenance" is the true live state. Pre-launch sites must
 * not be audited as production (their deploy/domain/uptime/CMS audits fail because
 * nothing is live yet) nor scheduled recurring Maintenance/Testing reports.
 */
export const PRE_LAUNCH_STATUSES: ReadonlySet<Status> = new Set<Status>([
  "in development",
  "launch period",
]);

export function isPreLaunch(status: Status | null): boolean {
  return status !== null && PRE_LAUNCH_STATUSES.has(status);
}

const FREQUENCIES: readonly Frequency[] = ["None", "Monthly", "Quarterly", "Yearly"];

/** Coerce an Airtable single-select value to a known Frequency at the read boundary.
 *  Whitespace is trimmed first, so an operator's trailing-space option ("Quarterly ")
 *  still schedules instead of silently unscheduling the site. Any other non-empty,
 *  unrecognized value — a renamed / typo'd option — warns LOUDLY and falls back to
 *  "None" (its section is simply omitted) rather than flowing a bogus string downstream,
 *  which the announcement would otherwise render as "We do this undefined." into a
 *  client email. Blank/undefined is a silent "None": no schedule is intentional. */
function toFrequency(raw: unknown, context: string): Frequency {
  if (typeof raw !== "string") return "None";
  const trimmed = raw.trim();
  if ((FREQUENCIES as readonly string[]).includes(trimmed)) return trimmed as Frequency;
  if (trimmed !== "") {
    console.warn(
      `⚠ ${context}: unrecognized frequency '${raw}' — treating as None (not scheduling); fix the Airtable value`,
    );
  }
  return "None";
}

/** Coerce an Airtable tri-state single-select verdict cell (`pass`/`fail`/blank) to
 *  `"pass" | "fail" | null`. Any value other than the literal strings "pass"/"fail" — blank,
 *  an unrecognized option, a typo, wrong type — reads as null ("never ran"), never guessed. The
 *  ONE shared reader for every verdict column of this shape: `Function health`, `CMS Reachable`,
 *  `Uptime Reachable`, `Titles & Meta OK` (Plan 2), and reused (not redeclared) by Plan 3's
 *  `Smoke OK` / `Form E2E OK` read-backs. */
export function toVerdict(raw: unknown): "pass" | "fail" | null {
  return raw === "pass" || raw === "fail" ? raw : null;
}

// NOTE: every `f["..."]` key below is a load-bearing magic string that must match
// the live Airtable "Websites" column name EXACTLY — including the legacy
// misspelling `"maintenence freq"`, the mixed-case `"GA4 property ID"`, and the
// lowercase `"url"` / `"point of contact"`. A column rename in Airtable silently
// returns undefined here (→ null), which degrades quietly (GA skipped, recipients
// empty) with no error. If you rename a column, change it here too.
export function mapRow(rec: { id: string; fields: Record<string, unknown> }): WebsiteRow {
  const f = rec.fields;
  const name = String(f["Name"] ?? "");
  const attachments =
    (f["Header image"] as Array<{ url: string; filename: string; type: string }> | undefined) ?? [];
  const header = attachments[0] ?? null;
  return {
    id: rec.id,
    name,
    url: String(f["url"] ?? ""),
    status: (f["Status"] as Status | undefined) ?? null,
    pointOfContact: (f["point of contact"] as string | undefined) ?? null,
    maintenanceFreq: toFrequency(f["maintenence freq"], `${name} maintenance`),
    testingFreq: toFrequency(f["testing freq"], `${name} testing`),
    maintenanceFreqRaw: (f["maintenence freq"] as string | undefined) ?? null,
    testingFreqRaw: (f["testing freq"] as string | undefined) ?? null,
    maintenanceDay: (f["maintenance day"] as string | undefined) ?? null,
    testingDay: (f["testing day"] as string | undefined) ?? null,
    ga4PropertyId: (f["GA4 property ID"] as string | undefined) ?? null,
    searchQuery: (f["Search query"] as string | undefined) ?? null,
    searchConsoleProperty: (f["Search Console property"] as string | undefined) ?? null,
    analyticsSoftFailAt: (f["Analytics soft-fail at"] as string | undefined) ?? null,
    gitRepo: (f["Git repo"] as string | undefined) ?? null,
    reportRecipientsTo: (f["Report recipients (To)"] as string | undefined) ?? null,
    reportRecipientsCc: (f["Report recipients (CC)"] as string | undefined) ?? null,
    // Tolerate BOTH the current Multiple-Select array shape AND a delimited long-text
    // string (comma/newline separated), so the field can migrate to a plain text column
    // with no code change here. Trim + drop empties either way. The array branch also
    // validates ELEMENT types: a collaborator/attachment-shaped field passes
    // Array.isArray with OBJECT elements, and an unchecked cast would make assignTier's
    // `.trim()` throw — one misconfigured row must not 500 the whole cockpit build.
    acceptedWatchConditions: Array.isArray(f["Accepted Watch Conditions"])
      ? (f["Accepted Watch Conditions"] as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      : typeof f["Accepted Watch Conditions"] === "string"
        ? (f["Accepted Watch Conditions"] as string)
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    headerImage: header,
    pScore: (f["pScore"] as number | undefined) ?? null,
    rScore: (f["rScore"] as number | undefined) ?? null,
    bpScore: (f["bpScore"] as number | undefined) ?? null,
    seoScore: (f["seoScore"] as number | undefined) ?? null,
    lastLighthouseAuditAt: (f["Last lighthouse audit at"] as string | undefined) ?? null,
    a11yViolations: (f["A11y Violations"] as number | undefined) ?? null,
    depsDrifted: (f["Deps Drifted"] as number | undefined) ?? null,
    depsMajorBehind: (f["Deps Major Behind"] as number | undefined) ?? null,
    depsOutdated: (f["Deps Outdated"] as number | undefined) ?? null,
    depsMajorOutdated: (f["Deps Major Outdated"] as number | undefined) ?? null,
    securityVulnsCritical: (f["Security Vulns Critical"] as number | undefined) ?? null,
    securityVulnsHigh: (f["Security Vulns High"] as number | undefined) ?? null,
    securityVulnsModerate: (f["Security Vulns Moderate"] as number | undefined) ?? null,
    securityVulnsLow: (f["Security Vulns Low"] as number | undefined) ?? null,
    securityAutoFixAttempts: (f["Security Auto-Fix Attempts"] as number | undefined) ?? null,
    lastSecurityAuditAt: (f["Last security audit at"] as string | undefined) ?? null,
    securityAdvisories: parseSecurityAdvisories(f["Security advisories"]),
    certDaysRemaining: (f["Cert days remaining"] as number | undefined) ?? null,
    domainCheckedAt: (f["Domain checked at"] as string | undefined) ?? null,
    netlifyId: trimToNull(f["Netlify ID"]),
    deployStatus: (f["Deploy status"] as string | undefined) ?? null,
    lastDeployAt: (f["Last deploy at"] as string | undefined) ?? null,
    deployLogUrl: (f["Deploy log URL"] as string | undefined) ?? null,
    deployCheckedAt: (f["Deploy checked at"] as string | undefined) ?? null,
    functionHealth: toVerdict(f["Function health"]),
    cmsReachable: toVerdict(f["CMS Reachable"]),
    functionHealthCheckedAt: (f["Function health checked at"] as string | undefined) ?? null,
    crossbrowserOk:
      typeof f["Crossbrowser OK"] === "boolean" ? (f["Crossbrowser OK"] as boolean) : null,
    mobileOk: typeof f["Mobile OK"] === "boolean" ? (f["Mobile OK"] as boolean) : null,
    linksOk: typeof f["Links OK"] === "boolean" ? (f["Links OK"] as boolean) : null,
    brokenLinks: typeof f["Broken links"] === "number" ? (f["Broken links"] as number) : null,
    browserCheckedAt: (f["Browser checked at"] as string | undefined) ?? null,
    reachableOk: toVerdict(f["Uptime Reachable"]),
    titleMetaOk: toVerdict(f["Titles & Meta OK"]),
    copyIntro: trimToNull(f["Copy — Intro"]),
    copyContact: trimToNull(f["Copy — Contact"]),
    copyFooter: trimToNull(f["Copy — Footer"]),
    launchedAt: (f["Launched at"] as string | undefined) ?? null,
    newsletterWebhook: trimToNull(f["Newsletter Webhook"]),
    notifyRouting: parseNotifyRouting(f["Notify Routing"]),
    mailchimpApiKey: trimToNull(f["Mailchimp API Key"]),
    mailchimpAudienceId: trimToNull(f["Mailchimp Audience ID"]),
    // Boolean guard like crossbrowserOk, but defaults FALSE (not null) when absent: an
    // unset/unknown column must read as "not required" so the feature ships dark.
    requireTurnstile:
      typeof f["Require Turnstile"] === "boolean" ? (f["Require Turnstile"] as boolean) : false,
    renovateFailingCis: (f["Renovate Failing CIs"] as number | undefined) ?? null,
    defaultBranchCi: (f["Default Branch CI"] as string | undefined) ?? null,
    lastCommitAt: (f["Last Commit At"] as string | undefined) ?? null,
    githubSignalsAt: (f["GitHub Signals At"] as string | undefined) ?? null,
    smokeOk: toVerdict(f["Smoke OK"]),
    lastSmokeAt: (f["Last Smoke At"] as string | undefined) ?? null,
    formE2eOk: toVerdict(f["Form E2E OK"]),
    formE2eCheckedAt: (f["Form E2E checked at"] as string | undefined) ?? null,
  };
}

export async function listWebsites(base: AirtableBase): Promise<WebsiteRow[]> {
  const out: WebsiteRow[] = [];
  await base(WEBSITES_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return out;
}

export async function getWebsiteBySlug(
  base: AirtableBase,
  slug: string,
): Promise<WebsiteRow | null> {
  // Slugs are siteSlug() output: [a-z0-9] segments joined by single hyphens.
  // Reject anything else — it can't match a real row, and it keeps URL-supplied
  // input out of the filter formula below (formula-injection guard).
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;

  // Narrow the fetch to the slug-matching row server-side instead of paging the
  // whole table per request (MEDIUM-H). The formula replicates siteSlug() on
  // {Name} — lowercase → non-alnum runs to "-" → strip leading/trailing "-" —
  // verified against the live base. maxRecords caps it (slug collisions keep the
  // prior first-match-wins behavior).
  const formula = `REGEX_REPLACE(REGEX_REPLACE(LOWER({Name}),"[^a-z0-9]+","-"),"^-|-$","")=${JSON.stringify(
    slug,
  )}`;
  const rows: WebsiteRow[] = [];
  await base(WEBSITES_TABLE)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  // Confirm the match in JS too: keeps the function correct if the formula and
  // siteSlug() ever drift, and under test fakes that don't evaluate the formula.
  return rows.find((w) => siteSlug(w.name) === slug) ?? null;
}

// ── audit-field builders ─────────────────────────────────────────────────────
// One source of truth for the column-name → value mappings of each audit type.
// The per-audit `updateXxxCounts` writers delegate to these (for their other
// callers), and `updateAuditFields` merges whichever are present into ONE write —
// so the field-name magic strings live in exactly one place.

export type A11yCounts = { violations: number };
export type DepsCounts = {
  drifted: number;
  majorBehind: number;
  outdated: number | null;
  majorOutdated: number | null;
};
export type SecurityCounts = { critical: number; high: number; moderate: number; low: number };
export type Severity = "low" | "moderate" | "high" | "critical";
/** One known vulnerability behind the security counts, as persisted/rendered. */
export type SecurityAdvisory = {
  module: string;
  severity: Severity;
  title: string;
  cves: string[];
  url: string | null;
  /** GitHub Dependabot dependency scope ("runtime" | "development"), when known. Lets the
   *  dashboard flag build-time-only ("development") vulns. Omitted for advisories from the
   *  lockfile `pnpm audit` fallback, which carries no per-package graph scope. */
  scope?: "runtime" | "development";
};
export type DomainResult = { certDaysRemaining: number | null; checkedAt: string };
export type NetlifyDeployResult = {
  /** Netlify deploy state lower-cased (`ready`/`error`/`building`/…), null = none. */
  state: string | null;
  /** When the latest production deploy was published/created (ISO), null = unknown. */
  deployedAt: string | null;
  /** Link to the deploy / its build log, null = unknown. */
  logUrl: string | null;
  /** When the audit last ran. */
  checkedAt: string;
};
export type BrowserAuditFields = {
  desktopOk: boolean;
  mobileOk: boolean;
  linksOk: boolean;
  reachableOk: boolean;
  titleMetaOk: boolean;
  brokenLinks: number;
  checkedAt: string;
};
export type FunctionHealthResult = {
  /** `pass` when `/health` answered `ok:true`, else `fail`. Never null — the audit only produces a
   *  result when it ran (a self-skip carries no details, so this extractor isn't reached). */
  functionHealth: "pass" | "fail";
  /** From the same body's `prismic` sub-status (R2.2): `"ok"` → `"pass"`, `"error"` → `"fail"`.
   *  Anything else (`"skipped"` — a placeholder repo with no live Prismic — or a raw `null`, e.g.
   *  the synthetic "deployed but erroring" body) → `null`: the CMS probe never actually ran, so it
   *  must NOT red CMS reachability for a site that simply hasn't wired Prismic yet. */
  cmsReachable: "pass" | "fail" | null;
  /** When the audit ran (freshness stamp for both verdicts). */
  checkedAt: string;
};

export type SmokeResult = { ok: "pass" | "fail"; checkedAt: string };

/** `ok` null clears the single-select cell (n/a — no contact form); a fresh
 *  `checkedAt` still stamps the row so Plan 4 reads null+fresh as n/a. */
export type FormE2eResult = { ok: "pass" | "fail" | null; checkedAt: string };

function scoreFields(scores: LighthouseScoreWriteback): FieldSet {
  // A null score CLEARS the cell (→ dashboard "—"), distinguishing a metric that
  // errored this run (e.g. NO_LCP → null performance) from a real low score. This
  // intentionally overwrites a prior value: a run that couldn't measure the metric
  // shouldn't keep showing a stale number. Writing null to clear mirrors
  // updateAnalyticsHealth; the `as FieldSet` cast is needed because airtable's
  // FieldSet type omits null.
  const fields: Record<string, number | string | null> = {
    pScore: scores.performance,
    rScore: scores.accessibility,
    bpScore: scores.bestPractices,
    seoScore: scores.seo,
    "Last lighthouse audit at": new Date().toISOString(),
  };
  return fields as FieldSet;
}

function a11yFields(counts: A11yCounts): FieldSet {
  return { "A11y Violations": counts.violations };
}

function depsFields(counts: DepsCounts): FieldSet {
  const fields: FieldSet = {
    "Deps Drifted": counts.drifted,
    "Deps Major Behind": counts.majorBehind,
  };
  // Only write the outdated count when it was determined — a null (no/stale
  // lockfile this run) must not clobber a previously-good value.
  if (counts.outdated !== null) {
    fields["Deps Outdated"] = counts.outdated;
  }
  // Same null-guard for the registry-major breakdown (same source signal).
  if (counts.majorOutdated !== null) {
    fields["Deps Major Outdated"] = counts.majorOutdated;
  }
  return fields;
}

/** Critical first → low last; the persist cap and the dashboard list both lean on this. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
};
/** Cap persisted advisories so the JSON field can't blow up on a badly-neglected site. */
const MAX_PERSISTED_ADVISORIES = 25;

/** Coerce one untrusted value into a SecurityAdvisory, or null if it isn't shaped like one.
 *  Shared by the read path (`parseSecurityAdvisories`) and the write path so both validate
 *  identically. A missing module or unrecognized severity drops the entry entirely. */
export function normalizeSecurityAdvisory(raw: unknown): SecurityAdvisory | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const module = typeof e["module"] === "string" ? (e["module"] as string) : null;
  const severity = e["severity"];
  if (module === null) return null;
  if (
    severity !== "low" &&
    severity !== "moderate" &&
    severity !== "high" &&
    severity !== "critical"
  )
    return null;
  const cves = Array.isArray(e["cves"])
    ? (e["cves"] as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  const scope =
    e["scope"] === "runtime" || e["scope"] === "development"
      ? (e["scope"] as "runtime" | "development")
      : undefined;
  return {
    module,
    severity,
    title: typeof e["title"] === "string" ? (e["title"] as string) : "",
    cves,
    url: typeof e["url"] === "string" ? (e["url"] as string) : null,
    ...(scope ? { scope } : {}),
  };
}

/** Parse the `Security advisories` JSON cell. null when absent/blank/unparseable/not-an-array
 *  (treated as "never audited"); a valid array (possibly empty = audited clean) otherwise. */
export function parseSecurityAdvisories(raw: unknown): SecurityAdvisory[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.map(normalizeSecurityAdvisory).filter((a): a is SecurityAdvisory => a !== null);
}

function securityAdvisoryFields(advisories: SecurityAdvisory[]): FieldSet {
  const capped = [...advisories]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, MAX_PERSISTED_ADVISORIES);
  // Always write — an empty array ("[]") clears a stale list when a once-vulnerable site goes clean.
  return { "Security advisories": JSON.stringify(capped) };
}

function securityFields(counts: SecurityCounts): FieldSet {
  return {
    "Security Vulns Critical": counts.critical,
    "Security Vulns High": counts.high,
    "Security Vulns Moderate": counts.moderate,
    "Security Vulns Low": counts.low,
    // Stamp freshness alongside the counts so the Security Updates auto-tick can require a recent
    // audit (a clean count from months ago must not silently keep ticking the box).
    "Last security audit at": new Date().toISOString(),
  };
}

function domainFields(result: DomainResult): FieldSet {
  const fields: FieldSet = { "Domain checked at": result.checkedAt };
  // Write the cert days UNCONDITIONALLY: a null (unresolved / no usable cert) must CLEAR any
  // previously-good value. Leaving a stale number in place — next to a freshly-stamped "Domain
  // checked at" — false-passes the Domain/DNS/SSL auto-tick (domainEvidence reads the stale
  // non-null value as a current pass) for a site that's actually down. null clears the cell in
  // Airtable; FieldSet's type doesn't model null, hence the cast through a widened record.
  (fields as Record<string, number | null>)["Cert days remaining"] = result.certDaysRemaining;
  return fields;
}

function netlifyDeployFields(result: NetlifyDeployResult): FieldSet {
  // Write all three deploy fields UNCONDITIONALLY (null clears the cell): a null state /
  // deployedAt / logUrl this run means "couldn't read it" and must not leave a STALE value
  // sitting next to a fresh "Deploy checked at" — the dashboard would otherwise render a green
  // "ready" badge for a site whose latest deploy actually errored. FieldSet's type doesn't model
  // null, hence the cast through a widened record (same approach as domainFields).
  const fields: Record<string, string | null> = {
    "Deploy status": result.state,
    "Last deploy at": result.deployedAt,
    "Deploy log URL": result.logUrl,
    "Deploy checked at": result.checkedAt,
  };
  return fields as FieldSet;
}

function browserFields(r: BrowserAuditFields): FieldSet {
  return {
    "Crossbrowser OK": r.desktopOk,
    "Mobile OK": r.mobileOk,
    "Links OK": r.linksOk,
    "Broken links": r.brokenLinks,
    "Browser checked at": r.checkedAt,
    // NEW tri-state single-select verdicts (empty = never ran). The browser audit only produces a
    // BrowserAuditFields when it actually ran (hasBrowserResult guards on checkedAt), so each verdict
    // is always a concrete boolean here — serialize true→"pass", false→"fail". The existing boolean
    // columns above are deliberately NOT retrofitted (out of scope).
    "Uptime Reachable": r.reachableOk ? "pass" : "fail",
    "Titles & Meta OK": r.titleMetaOk ? "pass" : "fail",
  };
}

function functionHealthFields(r: FunctionHealthResult): FieldSet {
  // "CMS Reachable" is written UNCONDITIONALLY (null clears the cell): the audit only supplies a
  // result when it ran, but `cmsReachable` itself can legitimately be null this run (R2.2 — the CMS
  // probe never actually happened, e.g. a placeholder repo with no live Prismic). Clearing rather
  // than leaving a stale pass/fail sitting next to a freshly-stamped checked-at is what keeps a
  // placeholder site from showing a stale CMS verdict. FieldSet's type doesn't model null, hence the
  // cast through a widened record (same approach as domainFields/netlifyDeployFields).
  // "Function health" is never null — the audit only writes when it ran, so it's always a concrete
  // pass/fail. Written SEPARATELY from "Deploy status" so the Netlify build state keeps its own
  // meaning.
  const fields: Record<string, string | null> = {
    "Function health": r.functionHealth,
    "CMS Reachable": r.cmsReachable,
    "Function health checked at": r.checkedAt,
  };
  return fields as FieldSet;
}

function smokeFields(r: SmokeResult): FieldSet {
  // The verdict is stored as the literal single-select option ("pass"/"fail"), so
  // no boolean→string coercion is needed. A skip never reaches here (it produces no
  // SmokeResult), so this column is only ever written with a concrete verdict.
  return { "Smoke OK": r.ok, "Last Smoke At": r.checkedAt };
}

function formE2eFields(r: FormE2eResult): FieldSet {
  // `ok` is already the single-select value ("pass"/"fail") or null. Writing null
  // CLEARS the cell (→ n/a, distinguished from "never ran" by the fresh checked-at
  // stamped alongside). FieldSet's type omits null, hence the widened-record cast
  // (same approach as domainFields / netlifyDeployFields).
  const fields: Record<string, string | null> = {
    "Form E2E OK": r.ok,
    "Form E2E checked at": r.checkedAt,
  };
  return fields as FieldSet;
}

/**
 * Write the four Lighthouse scores + a refreshed-at timestamp onto a Websites row.
 * Called by `audit lighthouse --write-airtable` after a successful audit run, so
 * the operator never has to paste numbers manually before drafting a report.
 */
export async function updateScores(
  base: AirtableBase,
  recordId: string,
  scores: LighthouseScores,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: scoreFields(scores) }]);
}

/**
 * Record (or clear) the per-site GA/Search enrichment health on the `Analytics
 * soft-fail at` column. `at` is an ISO timestamp when the site's last draft had a
 * GA/Search soft-failure, or `null` to clear it after a clean enrichment. The
 * caller (drafting) swallows errors: this column is operator-added, so until it
 * exists Airtable throws UNKNOWN_FIELD_NAME — which must not break a draft.
 */
export async function updateAnalyticsHealth(
  base: AirtableBase,
  recordId: string,
  at: string | null,
): Promise<void> {
  const fields: Record<string, string | null> = { "Analytics soft-fail at": at };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: fields as FieldSet }]);
}

/** Persist a11y violation count. */
export async function updateA11yCounts(
  base: AirtableBase,
  recordId: string,
  counts: A11yCounts,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: a11yFields(counts) }]);
}

/** Persist deps drift counts (declared-range drift + real outdated installs). */
export async function updateDepsCounts(
  base: AirtableBase,
  recordId: string,
  counts: DepsCounts,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: depsFields(counts) }]);
}

/** Persist security vulnerability counts by severity. */
export async function updateSecurityCounts(
  base: AirtableBase,
  recordId: string,
  counts: SecurityCounts,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: securityFields(counts) }]);
}

/** Persist a site's auto-fix attempt counter. Its own one-field writer so the
 *  nightly Renovate dispatch can update it without touching the audit's counts. */
export async function updateAutoFixAttempts(
  base: AirtableBase,
  recordId: string,
  attempts: number,
): Promise<void> {
  await base(WEBSITES_TABLE).update([
    { id: recordId, fields: { "Security Auto-Fix Attempts": attempts } },
  ]);
}

/**
 * Persist the code-computed next-due dates (date-only `YYYY-MM-DD`, or `null` to
 * clear) for the maintenance + testing schedules. Owned by the nightly `--due` sweep
 * so the "next" dates shown in Airtable come from the SAME logic as the scheduler
 * (`nextDueDate`) — no Airtable-side formula or automation. Best-effort at the call
 * site: the `Next … at` columns are operator-added, so until they exist Airtable
 * throws UNKNOWN_FIELD_NAME, which must not break the nightly draft run.
 */
export async function updateNextDueDates(
  base: AirtableBase,
  recordId: string,
  dates: { maintenanceAt: string | null; testingAt: string | null },
): Promise<void> {
  const fields: Record<string, string | null> = {
    "Next maintenance at": dates.maintenanceAt,
    "Next testing at": dates.testingAt,
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: fields as FieldSet }]);
}

/** Generic single-field writer for the dashboard site-details editor. The caller
 *  (setSiteDetail) restricts `column` to the EDITABLE_SITE_FIELDS allowlist, so this
 *  never writes an arbitrary column from request input. */
export async function updateSiteField(
  base: AirtableBase,
  recordId: string,
  column: string,
  value: string,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: { [column]: value } }]);
}

/**
 * Persist all of a single audit run's results to one Websites row in ONE atomic
 * `update()` — instead of up to four sequential updates on the same id (which left
 * a row half-written on a mid-sequence failure and quadrupled the request volume).
 * Pass only the audit slices that produced real values; each present slice is merged
 * via the SAME field mappings the per-audit writers use. Omit a slice (or pass
 * undefined) to leave those columns untouched. Returns the merged FieldSet so the
 * caller can enumerate what was written.
 */
export async function updateAuditFields(
  base: AirtableBase,
  recordId: string,
  audits: {
    scores?: LighthouseScoreWriteback;
    a11y?: A11yCounts;
    deps?: DepsCounts;
    security?: SecurityCounts;
    securityAdvisories?: SecurityAdvisory[];
    domain?: DomainResult;
    browser?: BrowserAuditFields;
    netlifyDeploy?: NetlifyDeployResult;
    functionHealth?: FunctionHealthResult;
    smoke?: SmokeResult;
    formE2e?: FormE2eResult;
  },
): Promise<FieldSet> {
  const fields: FieldSet = {};
  if (audits.scores) Object.assign(fields, scoreFields(audits.scores));
  if (audits.a11y) Object.assign(fields, a11yFields(audits.a11y));
  if (audits.deps) Object.assign(fields, depsFields(audits.deps));
  if (audits.security) Object.assign(fields, securityFields(audits.security));
  // Separate slice (not folded into `security`) so the advisory list and the counts can be
  // written independently, but in practice the security audit supplies both together.
  if (audits.securityAdvisories)
    Object.assign(fields, securityAdvisoryFields(audits.securityAdvisories));
  if (audits.domain) Object.assign(fields, domainFields(audits.domain));
  if (audits.browser) Object.assign(fields, browserFields(audits.browser));
  if (audits.netlifyDeploy) Object.assign(fields, netlifyDeployFields(audits.netlifyDeploy));
  if (audits.functionHealth) Object.assign(fields, functionHealthFields(audits.functionHealth));
  if (audits.smoke) Object.assign(fields, smokeFields(audits.smoke));
  if (audits.formE2e) Object.assign(fields, formE2eFields(audits.formE2e));
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
  return fields;
}

/** Persist the GitHub-signals sweep onto a Websites row (slice 2a). A null
 *  `lastCommitAt` is OMITTED so a not-determined-this-run value never clobbers a
 *  previously-good timestamp (mirrors updateDepsCounts' outdated handling). */
export async function updateGitHubSignals(
  base: AirtableBase,
  recordId: string,
  signals: {
    renovateFailingCis: number;
    ciState: string;
    lastCommitAt: string | null;
    sweptAt: string;
  },
): Promise<void> {
  const fields: FieldSet = {
    "Renovate Failing CIs": signals.renovateFailingCis,
    "Default Branch CI": signals.ciState,
    "GitHub Signals At": signals.sweptAt,
  };
  if (signals.lastCommitAt !== null) {
    fields["Last Commit At"] = signals.lastCommitAt;
  }
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}

/** Mark a site launched: flip Status → maintenance + stamp Launched at (M6b).
 *  The first code that writes Status. Called after a Launch report sends. */
export async function updateLaunched(
  base: AirtableBase,
  recordId: string,
  at: string,
): Promise<void> {
  const fields: FieldSet = { Status: "maintenance", "Launched at": at };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}
