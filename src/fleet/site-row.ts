/**
 * The fleet's site-row model and its pure, vendor-neutral coercers.
 *
 * `WebsiteRow` is what BOTH readers return — `mapRow` over an Airtable record
 * (`src/reports/airtable/websites.ts`) and `rowFromJoined` over Turso
 * (`src/db/fleet-state.ts`) — and the coercers below are the ONE truth each of
 * them applies to a raw cell/column. They lived in the Airtable module until
 * #539 Phase 6 step 1 (#646) moved them here: they run on every Turso lead read,
 * so they could not stay in the directory Phase 6 deletes. Nothing here touches
 * a store; the doc comments still name Airtable columns because that is where
 * each value was first defined, and the Turso columns carry the same raw values.
 *
 * `src/reports/airtable/websites.ts` re-exports every name, so existing imports
 * resolve unchanged.
 */
import { CANONICAL_STATUSES, type Status } from "./site-status.js";

export type Frequency = "None" | "Monthly" | "Quarterly" | "Yearly";

/** The canonical lifecycle vocabulary lives in ./site-status.ts (the Airtable
 *  write-direction mapping, `toAirtableStatus`, stays in the Airtable module).
 *  Re-exported here because every consumer already imports `Status` alongside
 *  `WebsiteRow`. */
export type { Status };

/**
 * Per-site notification routing. When present on a `maintained` site, the form
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
  /** Canonical lifecycle status (see ./site-status.ts). Canonicalized at the read
   *  boundary, so an old-vocabulary Airtable cell and a new one read identically.
   *  A present-but-unrecognized cell survives VERBATIM (blind-cast) rather than
   *  becoming null — `isUnrecognizedStatus` flags it, and null would make
   *  due.ts/preflight.ts treat the row as eligible-by-default. */
  status: Status | null;
  /** The literal Airtable Status cell behind `status` — same pattern as
   *  `maintenanceFreqRaw`. The dashboard status editor round-trips THIS, so its
   *  dropdown offers and preselects the values Airtable actually holds while the
   *  two vocabularies coexist. Null = blank cell. */
  statusRaw: string | null;
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
  /** Lighthouse "current state" snapshot, kept fresh by `audit lighthouse --write-back`. */
  pScore: number | null;
  rScore: number | null;
  bpScore: number | null;
  seoScore: number | null;
  /** ISO timestamp set by `audit lighthouse --write-back` when scores were last refreshed. */
  lastLighthouseAuditAt: string | null;
  /** Last-known counts from non-lighthouse audits, written by
   *  `audit --write-back`. `null` = never audited (or this audit
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
  /** Does the deployed site's Turnstile widget actually work? Single-select `pass`/`fail`;
   *  null = **unverified**, which is the normal state — see below. Freshness gated by
   *  `formE2eCheckedAt`, the clock of the audit that writes it. Powers the cockpit Require-Turnstile guardrail: a site with
   *  `requireTurnstile` ON but no working widget silently buckets 100% of its real leads.
   *
   *  One of the two `"fail"` arms is derived from `/health` (the other is a browser seeing
   *  110200 on the live hostname), whose `forms.turnstile` is a truthiness check
   *  on `PUBLIC_TURNSTILE_SITE_KEY` that never contacts Cloudflare (see
   *  audits/function-health-airtable.ts for the incident). No key IS proof the widget can't
   *  work; a key is NOT proof that it can — a sitekey whose widget is full at Cloudflare's
   *  10-hostname cap sets the var and still mints no token. So a `"pass"` here has to be
   *  earned by a real browser rendering the real widget (form-e2e), and until it is, null
   *  keeps the site in the cockpit's amber "can't verify" watch rather than claiming health
   *  nobody measured. */
  turnstileWidget: "pass" | "fail" | null;
  /** When the `function-health` audit last ran — the freshness gate for `functionHealth`,
   *  `cmsReachable`, and `turnstileWidget`. Null = never ran. */
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
  /**
   * Nightly Prismic model drift sweep (`prismic-models --fleet --write-back`).
   *
   * FOUR-VALUED, unlike every other verdict column in this table, and the extra
   * state is the point:
   *
   *   - `pass`    — the repo and its Prismic repository were compared and agree.
   *   - `fail`    — they were compared and DIVERGE (a model to create/update, or
   *                 one that exists only in Prismic). A finding for a human.
   *   - `unknown` — THE CHECK ITSELF FAILED. Unreadable checkout, broken config,
   *                 missing/expired token, unreadable remote. Nothing at all was
   *                 established about this site's models.
   *   - `null`    — no verdict to hold: the sweep has never run for this site, or
   *                 it ran and found no Prismic config at all (a repo that simply
   *                 is not a Prismic site). `prismicModelsCheckedAt` separates
   *                 those two — fresh timestamp, blank verdict = "checked, and
   *                 there is nothing here to check".
   *
   * `unknown` exists because the alternatives are both wrong in the dangerous
   * direction. Writing `pass` for a site nobody could read is a green tick over
   * an outage; writing NOTHING (the obvious "leave the last known value alone")
   * leaves yesterday's `pass` standing for a site that has been failing every
   * night since — and nothing ages a stale `pass` out, because the digest's
   * freshness gate only ever examines failures. Both make "I could not read this
   * site" indistinguishable from "this site is fine", in the record the cockpit
   * and the digest read.
   *
   * OPERATOR PRECONDITION: `Prismic Models` is a single select whose options are
   * `pass`, `fail`, `unknown`. Until the three columns exist the sweep's writes
   * fail with UNKNOWN_FIELD_NAME and are collected as soft failures — the feature
   * ships dark rather than reddening the nightly.
   */
  prismicModels: PrismicModelsVerdict | null;
  /** When the sweep last ran for this site — written on EVERY outcome, including
   *  `unknown` and blank, so the age of the row is the age of the answer. */
  prismicModelsCheckedAt: string | null;
  /** What the sweep found, verbatim: the drift report for a `fail`, the reason
   *  nothing could be established for an `unknown`, the skip reason for a blank,
   *  and null for a `pass` (which clears yesterday's finding). */
  prismicModelsDrift: string | null;
  /**
   * An expiry the operator sets to accept a KNOWN, EXPECTED `fail` — most often
   * "I am modelling in Prismic on a branch that has not landed, so Prismic is
   * legitimately ahead of `main`". While this timestamp is in the future the
   * drift item is not raised.
   *
   * It expires on purpose, and nothing renews it automatically. A permanent ack
   * would reproduce this column's own failure mode one step later: once the
   * branch lands, the same acked cell would swallow real drift and "nobody is
   * looking at this" would render as "this is fine". An expiry means the worst
   * case is a silence that ends by itself.
   *
   * Narrow by construction — it mutes only `fail`, the finding the operator
   * actually reviewed. `unknown` (the check could not run) and a verdict too old
   * to be current are never muted by it; see `collectPrismicDriftAlerts`.
   *
   * OPERATOR PRECONDITION: `Prismic Ack Until` is a dateTime column. Until it
   * exists this reads null and nothing is acked, which is the safe direction.
   */
  prismicAckUntil: string | null;
  notifyRouting: NotifyRouting | null;
  /** The RAW `Notify Routing` cell, verbatim. Same reason `statusRaw` exists: the
   *  dashboard editor round-trips this JSON, and re-serializing the PARSED object
   *  would drop any key the parser ignores and reformat what the operator typed —
   *  a silent rewrite of a cell they only opened to look at. */
  notifyRoutingRaw: string | null;
  /** Read-back of the code-owned next-due dates (date-only, written by the
   *  nightly `writeNextDueDates`). These exist so the writer can DIFF the
   *  freshly-computed dates against what the row already holds and skip the
   *  ~31 no-op writes a night the fleet was paying for (#539 Phase 3). Null =
   *  cell blank or the operator-added `Next … at` column absent. */
  nextMaintenanceAt: string | null;
  nextTestingAt: string | null;
};

export function siteSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Blank-trim-to-null: a non-string or whitespace-only value becomes null,
 *  otherwise the trimmed string. */
export function trimToNull(raw: unknown): string | null {
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
export const ACTIVE_STATUSES: ReadonlySet<Status> = new Set<Status>(["maintained", "launching"]);

export function isDashboardVisible(site: WebsiteRow): boolean {
  return site.status !== null && ACTIVE_STATUSES.has(site.status);
}

/**
 * Pre-launch lifecycle stages: the site is being built/prepared, NOT yet live. A
 * Launch report (recipes/launch.ts) flips Status → "maintained" at go-live
 * (updateLaunched), so "maintained" is the true live state. Pre-launch sites must
 * not be audited as production (their deploy/domain/uptime/CMS audits fail because
 * nothing is live yet) nor scheduled recurring Maintenance/Testing reports.
 *
 * NOTE `launching` is deliberately in BOTH this set and ACTIVE_STATUSES — a
 * launching site is cockpit-visible but not production-audited. That dual
 * membership predates the vocabulary rename and was re-approved as-is with it.
 */
export const PRE_LAUNCH_STATUSES: ReadonlySet<Status> = new Set<Status>(["building", "launching"]);

export function isPreLaunch(status: Status | null): boolean {
  return status !== null && PRE_LAUNCH_STATUSES.has(status);
}

/** Every Status value the code recognizes — the canonical vocabulary, since both
 *  read seams canonicalize. Typed ReadonlySet<string> so a blind-cast typo'd cell
 *  can be probed without a cast. */
export const KNOWN_STATUSES: ReadonlySet<string> = new Set<Status>(CANONICAL_STATUSES);

/** Terminal, out-of-fleet lifecycle states: kept in Airtable for the record,
 *  excluded from every fleet op (sweeps, reports, audits, cockpit tiers) exactly
 *  as before, but surfaced on the cockpit as an archived lane so a row can never
 *  silently vanish. Airtable's `legacy` AND `deprecated` both canonicalize to the
 *  single `archived` — an approved merge; the two were always treated alike. */
export const ARCHIVED_STATUSES: ReadonlySet<Status> = new Set<Status>(["archived"]);

export function isArchivedStatus(status: Status | null): boolean {
  return status !== null && ARCHIVED_STATUSES.has(status);
}

/** True when the Status cell holds a value outside the code's union (typo /
 *  renamed option / stray whitespace). mapRow deliberately does NOT null these —
 *  due.ts/preflight.ts treat a null status as eligible-by-default, so nulling a
 *  typo would ACTIVATE the row. The cockpit surfaces these as watch rows instead. */
export function isUnrecognizedStatus(status: Status | null): boolean {
  return status !== null && !KNOWN_STATUSES.has(status);
}

const FREQUENCIES: readonly Frequency[] = ["None", "Monthly", "Quarterly", "Yearly"];

/** Coerce an Airtable single-select value to a known Frequency at the read boundary.
 *  Whitespace is trimmed first, so an operator's trailing-space option ("Quarterly ")
 *  still schedules instead of silently unscheduling the site. Any other non-empty,
 *  unrecognized value — a renamed / typo'd option — warns LOUDLY and falls back to
 *  "None" (its section is simply omitted) rather than flowing a bogus string downstream,
 *  which the announcement would otherwise render as "We do this undefined." into a
 *  client email. Blank/undefined is a silent "None": no schedule is intentional. */
export function toFrequency(raw: unknown, context: string): Frequency {
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

/** The `Prismic Models` cell — see {@link WebsiteRow.prismicModels} for why it
 *  carries a third state that no other verdict column in this table has. */
export type PrismicModelsVerdict = "pass" | "fail" | "unknown";

/**
 * Read the `Prismic Models` cell. Deliberately NOT {@link toVerdict}.
 *
 * `toVerdict` maps anything that is not literally `pass`/`fail` to null — which
 * for this column would read `unknown` ("the check ran and failed") back as null
 * ("the check never ran"), silently, on the way to the cockpit. That is the
 * pipeline's governing failure ("I could not read X" wearing the face of "X does
 * not exist") reintroduced by a shared helper that predates the third state.
 *
 * Everything else — blank, a typo, an option somebody added by hand, the wrong
 * type — still reads as null. A verdict is never guessed.
 */
export function toPrismicModelsVerdict(raw: unknown): PrismicModelsVerdict | null {
  return raw === "pass" || raw === "fail" || raw === "unknown" ? raw : null;
}

// ── security advisories (the persisted vulnerability detail) ─────────────────

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
  /** GitHub Dependabot dependency-graph relationship, when known. "transitive" means no
   *  direct-dep bump can fix it — Renovate's vuln alerts have no fix vehicle until the weekly
   *  lockfile-maintenance window. Omitted when GitHub reports "unknown" or for the
   *  `pnpm audit` fallback. Drives {@link allActionableVulnsTransitive}. */
  relationship?: "direct" | "transitive";
};

/** Critical first → low last; the persist cap and the dashboard list both lean on this. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
};

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
  const relationship =
    e["relationship"] === "direct" || e["relationship"] === "transitive"
      ? (e["relationship"] as "direct" | "transitive")
      : undefined;
  return {
    module,
    severity,
    title: typeof e["title"] === "string" ? (e["title"] as string) : "",
    cves,
    url: typeof e["url"] === "string" ? (e["url"] as string) : null,
    ...(scope ? { scope } : {}),
    ...(relationship ? { relationship } : {}),
  };
}

/**
 * True iff the persisted advisory detail proves EVERY actionable (critical/high) vuln is a
 * TRANSITIVE dependency — i.e. Renovate's vulnerability alerts have no direct-dep bump to
 * open, and the fix rides the weekly lockfile-maintenance window instead. Deliberately
 * conservative: `null` detail (never audited / `pnpm audit` fallback), an advisory missing
 * its `relationship` (unknown / pre-existing JSON), or a counts-vs-detail mismatch (no
 * critical/high advisory in the list) all return false — missing data must never mute the
 * auto-fix-failed escalation. Consumed by the attempts counter (don't count a known no-op
 * dispatch as a failed fix attempt) and the digest (say "transitive-only", not
 * "auto-fix failed"). The persist cap keeps advisories sorted critical-first, so
 * critical/high entries are never the ones capped away.
 */
export function allActionableVulnsTransitive(advisories: SecurityAdvisory[] | null): boolean {
  if (!advisories) return false;
  const actionable = advisories.filter((a) => a.severity === "critical" || a.severity === "high");
  if (actionable.length === 0) return false;
  return actionable.every((a) => a.relationship === "transitive");
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
