import type { FieldSet } from "airtable";
import type { AirtableBase } from "./client.js";
import type { LighthouseScores, LighthouseScoreWriteback } from "../types.js";
import { canonicalizeStatus, toAirtableStatus } from "./site-status.js";
import { skipsAirtableShadow } from "../../fleet/site-id.js";
import {
  siteSlug,
  trimToNull,
  parseNotifyRouting,
  toFrequency,
  toVerdict,
  toPrismicModelsVerdict,
  SEVERITY_RANK,
  parseSecurityAdvisories,
  type WebsiteRow,
  type PrismicModelsVerdict,
  type SecurityAdvisory,
} from "../../fleet/site-row.js";

// The site-row model and its pure coercers live in src/fleet/site-row.ts since
// #539 Phase 6 step 1 (#646) — they run on Turso reads too. Re-exported so every
// existing import from this module resolves unchanged.
export {
  siteSlug,
  trimToNull,
  parseNotifyRouting,
  ACTIVE_STATUSES,
  isDashboardVisible,
  PRE_LAUNCH_STATUSES,
  isPreLaunch,
  KNOWN_STATUSES,
  ARCHIVED_STATUSES,
  isArchivedStatus,
  isUnrecognizedStatus,
  toFrequency,
  toVerdict,
  toPrismicModelsVerdict,
  SEVERITY_RANK,
  normalizeSecurityAdvisory,
  allActionableVulnsTransitive,
  parseSecurityAdvisories,
  type Frequency,
  type Status,
  type NotifyRouting,
  type WebsiteRow,
  type PrismicModelsVerdict,
  type Severity,
  type SecurityAdvisory,
} from "../../fleet/site-row.js";

export const WEBSITES_TABLE = "Websites";

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
  // LAST, not first: Airtable's uploadAttachment APPENDS, so the newest file is the
  // tail. Reading [0] served the OLDEST forever whenever a field held more than one —
  // which is how a pre-clean-plate header reached a live announcement (#574/#577).
  // The prune keeps these fields at a single entry, so this is normally the same
  // element; preferring the tail means a field that stacks again still serves the
  // CURRENT header instead of silently reverting to the first one ever uploaded.
  const header = attachments.at(-1) ?? null;
  return {
    id: rec.id,
    name,
    url: String(f["url"] ?? ""),
    status: canonicalizeStatus(f["Status"]),
    statusRaw: (f["Status"] as string | undefined) ?? null,
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
    turnstileWidget: toVerdict(f["Turnstile widget"]),
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
    notifyRoutingRaw: trimToNull(f["Notify Routing"]),
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
    prismicModels: toPrismicModelsVerdict(f["Prismic Models"]),
    prismicModelsCheckedAt: (f["Prismic Models Checked At"] as string | undefined) ?? null,
    prismicModelsDrift: (f["Prismic Models Drift"] as string | undefined) ?? null,
    prismicAckUntil: (f["Prismic Ack Until"] as string | undefined) ?? null,
    nextMaintenanceAt: (f["Next maintenance at"] as string | undefined) ?? null,
    nextTestingAt: (f["Next testing at"] as string | undefined) ?? null,
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
  /** From the same body's `forms.turnstile` boolean: `true` → `"pass"`, `false` → `"fail"`.
   *  A missing/null `forms` block (older site package, or the synthetic "deployed but
   *  erroring" body) → `null` — the widget state is simply unknown, not a failure. */
  turnstileWidget: "pass" | "fail" | null;
  /** When the audit ran (freshness stamp for all three verdicts). */
  checkedAt: string;
};

export type SmokeResult = { ok: "pass" | "fail"; checkedAt: string };

/** `ok` null clears the single-select cell (n/a — no contact form); a fresh
 *  `checkedAt` still stamps the row so Plan 4 reads null+fresh as n/a. */
export type FormE2eResult = {
  /** Absent = no FORM verdict this run; the column and its stamp are left alone. */
  ok?: "pass" | "fail" | null;
  checkedAt: string;
  /** The `Turnstile widget` verdict, owned by this audit since #689 — see
   *  `formE2eFields`. Absent = no opinion this run (preserve); null = looked and
   *  could not tell (clear). */
  turnstileWidget?: "pass" | "fail" | null;
};

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

/** Cap persisted advisories so the JSON field can't blow up on a badly-neglected site. */
const MAX_PERSISTED_ADVISORIES = 25;

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
    // "Turnstile widget" is NOT written here any more. /health only knows whether
    // PUBLIC_TURNSTILE_SITE_KEY is a non-empty string — it never contacts
    // Cloudflare — so this audit cannot tell a working widget from one whose
    // hostname is not on the allowlist (#689). The column is owned by `form-e2e`,
    // which drives a real browser at the real widget and can. Writing it from
    // both would also be unreachable by the red alarm: this sweep runs at 08:00,
    // the digest reads at 09:23, form-e2e writes at 10:15 — a browser verdict
    // would be cleared by this null every morning before the alarm ever saw it.
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
  const fields: Record<string, string | null> = {};
  // The FORM verdict and its stamp move together, and only when this run produced
  // one. A run with no form verdict (the testMode-undeclared skip) writes neither,
  // which preserves both — refreshing the stamp while preserving a stale verdict
  // would present months-old evidence as fresh to auto-tick's `formsEvidence`.
  if (r.ok !== undefined) {
    fields["Form E2E OK"] = r.ok;
    fields["Form E2E checked at"] = r.checkedAt;
  }
  // The Turnstile verdict rides this audit because it is the only one that opens
  // a browser on the live form, where the site's REAL widget renders (the probe
  // never swaps the sitekey). Written only when this run had an opinion: the key
  // is ABSENT on a run that could not look, which preserves the prior verdict,
  // and an explicit null is the distinct "looked, could not tell" that clears it.
  if (r.turnstileWidget !== undefined) fields["Turnstile widget"] = r.turnstileWidget;
  return fields as FieldSet;
}

// ————————————————————————— Websites writers (the Airtable shadow) —————————————————————————
//
// Every writer below addresses a Websites row by SITE id, and every one opens with
// `skipsAirtableShadow` (#646 step 3). Sites created since the Turso-native
// `ensure-site` carry `site_<ULID>` ids that Airtable has never held, so a write
// for one is skipped on purpose — with an `AIRTABLE_SHADOW skipped=non-rec-id` line — instead of
// 404ing. The FieldSet-returning writers still RETURN their payload when they
// skip: callers feed it to the authoritative Turso write, which must not depend on
// the shadow. tests/reports/airtable/shadow-skip-site-ids.test.ts fails for any
// exported `update*` writer that is not covered.

/**
 * Write the four Lighthouse scores + a refreshed-at timestamp onto a Websites row.
 * Called by `audit lighthouse --write-back` after a successful audit run, so
 * the operator never has to paste numbers manually before drafting a report.
 */
export async function updateScores(
  base: AirtableBase,
  recordId: string,
  scores: LighthouseScores,
): Promise<void> {
  if (skipsAirtableShadow("updateScores", recordId)) return;
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: scoreFields(scores) }]);
}

/** The `Analytics soft-fail at` FieldSet, as a pure function of the stamp (#782).
 *  Drafting mirrors THIS into Turso first — the authoritative store — and only
 *  then shadows it to Airtable, so the two writes carry one payload and the
 *  shadow's field gap cannot cost the real write. `at` is an ISO timestamp when
 *  the site's last draft had a GA/Search soft-failure, `null` after a clean
 *  enrichment (the signal self-heals). */
export function analyticsHealthFields(at: string | null): FieldSet {
  const fields: Record<string, string | null> = { "Analytics soft-fail at": at };
  return fields as FieldSet;
}

/**
 * Record (or clear) the per-site GA/Search enrichment health on the `Analytics
 * soft-fail at` column. The caller (drafting) swallows errors: this column is
 * operator-added and — checked against the base on 2026-09-15 — has never
 * existed there, so Airtable throws UNKNOWN_FIELD_NAME on every call. That is
 * why drafting writes Turso BEFORE this (#782): Turso is authoritative and the
 * Airtable layer is the shadow Phase 6 (#646) deletes.
 */
export async function updateAnalyticsHealth(
  base: AirtableBase,
  recordId: string,
  at: string | null,
): Promise<FieldSet> {
  const fields = analyticsHealthFields(at);
  if (!skipsAirtableShadow("updateAnalyticsHealth", recordId)) {
    await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
  }
  // Same contract as updateNextDueDates/updateAuditFields: the #539 Turso mirror
  // consumes the returned FieldSet, so the two writes cannot diverge.
  return fields;
}

/** Persist a11y violation count. */
export async function updateA11yCounts(
  base: AirtableBase,
  recordId: string,
  counts: A11yCounts,
): Promise<void> {
  if (skipsAirtableShadow("updateA11yCounts", recordId)) return;
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: a11yFields(counts) }]);
}

/** Persist deps drift counts (declared-range drift + real outdated installs). */
export async function updateDepsCounts(
  base: AirtableBase,
  recordId: string,
  counts: DepsCounts,
): Promise<void> {
  if (skipsAirtableShadow("updateDepsCounts", recordId)) return;
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: depsFields(counts) }]);
}

/** Persist security vulnerability counts by severity. */
export async function updateSecurityCounts(
  base: AirtableBase,
  recordId: string,
  counts: SecurityCounts,
): Promise<void> {
  if (skipsAirtableShadow("updateSecurityCounts", recordId)) return;
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: securityFields(counts) }]);
}

/** Persist a site's auto-fix attempt counter. Its own one-field writer so the
 *  nightly Renovate dispatch can update it without touching the audit's counts. */
export async function updateAutoFixAttempts(
  base: AirtableBase,
  recordId: string,
  attempts: number,
): Promise<FieldSet> {
  const fields: FieldSet = { "Security Auto-Fix Attempts": attempts };
  if (!skipsAirtableShadow("updateAutoFixAttempts", recordId)) {
    await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
  }
  // Returned for the #539 Turso mirror — see updateNextDueDates.
  return fields;
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
): Promise<FieldSet> {
  const fields: Record<string, string | null> = {
    "Next maintenance at": dates.maintenanceAt,
    "Next testing at": dates.testingAt,
  };
  if (!skipsAirtableShadow("updateNextDueDates", recordId)) {
    await base(WEBSITES_TABLE).update([{ id: recordId, fields: fields as FieldSet }]);
  }
  // Same contract as updateAuditFields/updateGitHubSignals: the Phase 3 Turso
  // mirror consumes the returned FieldSet, so the two writes cannot diverge.
  return fields as FieldSet;
}

/** The cell shapes the site editor can write. Airtable rejects a string written
 *  to a checkbox or a multi-select, so `Require Turnstile` (boolean) and
 *  `Accepted Watch Conditions` (string[]) travel as themselves rather than being
 *  stringified at the boundary and coerced back later. */
export type AirtableCellValue = string | boolean | string[];

/** Generic single-field writer for the dashboard site-details editor. The caller
 *  (setSiteDetail) restricts `column` to the EDITABLE_SITE_FIELDS allowlist, so this
 *  never writes an arbitrary column from request input. */
export async function updateSiteField(
  base: AirtableBase,
  recordId: string,
  column: string,
  value: AirtableCellValue,
): Promise<void> {
  if (skipsAirtableShadow("updateSiteField", recordId)) return;
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: { [column]: value } }]);
}

/** The multi-column shadow for `ensure-site`'s fill-blanks / `--name` path on a
 *  pre-existing `rec` site (#646 step 3): ONE update, so a resumed bootstrap that
 *  fills `url` and retitles `Name` cannot leave the shadow half-written. Turso is
 *  the store that decides what to write; this only repeats it. */
export async function updateSiteFields(
  base: AirtableBase,
  recordId: string,
  fields: Record<string, string>,
): Promise<void> {
  if (skipsAirtableShadow("updateSiteFields", recordId)) return;
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: fields as FieldSet }]);
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
  if (!skipsAirtableShadow("updateAuditFields", recordId)) {
    await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
  }
  return fields;
}

/** Persist the GitHub-signals sweep onto a Websites row (slice 2a). A null
 *  `lastCommitAt` is OMITTED so a not-determined-this-run value never clobbers a
 *  previously-good timestamp (mirrors updateDepsCounts' outdated handling).
 *  Returns the FieldSet it wrote — the Phase 3 Turso mirror consumes the same
 *  payload, so the two writes cannot diverge (updateAuditFields' contract). */
export async function updateGitHubSignals(
  base: AirtableBase,
  recordId: string,
  signals: {
    renovateFailingCis: number;
    ciState: string;
    lastCommitAt: string | null;
    sweptAt: string;
  },
): Promise<FieldSet> {
  const fields: FieldSet = {
    "Renovate Failing CIs": signals.renovateFailingCis,
    "Default Branch CI": signals.ciState,
    "GitHub Signals At": signals.sweptAt,
  };
  if (signals.lastCommitAt !== null) {
    fields["Last Commit At"] = signals.lastCommitAt;
  }
  if (!skipsAirtableShadow("updateGitHubSignals", recordId)) {
    await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
  }
  return fields;
}

/** One site's Prismic model verdict, as the sweep hands it to the record.
 *
 *  `verdict: null` is a REQUEST TO BLANK the cell, not "leave it alone" — see
 *  {@link updatePrismicModels}. There is no way to express "leave it alone" here
 *  on purpose. */
export type PrismicModelsWriteback = {
  verdict: PrismicModelsVerdict | null;
  checkedAt: string;
  /** The finding, the failure reason, or the skip reason — whichever this
   *  verdict has. `null` clears the column. */
  detail: string | null;
};

/** Airtable's long-text cells hold ~100k characters and the sweep's report runs
 *  long on a badly drifted site (an empty Prismic repository sorts every local
 *  model into `toCreate`, with a line per field). Half the cell is the budget;
 *  the rest is headroom for whatever renders it. */
const MAX_PRISMIC_DETAIL_CHARS = 50_000;

/**
 * Shorten a detail that will not fit, and SAY SO — with the original length, so
 * nobody mistakes the remainder for the whole. Same reasoning as the PR comment's
 * truncation notice: a report that was shortened without saying it was shortened
 * is a report that looks complete and is not.
 *
 * The cut is by code unit, so it can land between the halves of an astral
 * character; a lone surrogate is not valid text and can make Airtable reject the
 * write, losing the entire finding to a cosmetic detail.
 */
function truncatePrismicDetail(detail: string): string {
  if (detail.length <= MAX_PRISMIC_DETAIL_CHARS) return detail;
  const notice =
    `\n…[truncated: this report is ${detail.length} characters and only the first` +
    ` ${MAX_PRISMIC_DETAIL_CHARS} are kept here. Run \`reddoor-maint prismic-models\` in the` +
    ` site — dry is the default — for the whole thing.]`;
  let head = detail.slice(0, MAX_PRISMIC_DETAIL_CHARS - notice.length);
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + notice;
}

/**
 * Persist one site's Prismic model verdict.
 *
 * ALL THREE COLUMNS, ALWAYS, in one update — including when the verdict is
 * `unknown` or blank. That is the whole design: the alternative ("only write a
 * verdict when we have one") leaves the PREVIOUS verdict standing for a site
 * whose check has since started failing, and a stale `pass` is never aged out by
 * anything — the digest's freshness gate only examines failures. So the record
 * always says what the last run actually established, and `checkedAt` always
 * says when. See {@link WebsiteRow.prismicModels} for the four states.
 *
 * Best-effort AT THE CALL SITE: `Prismic Models*` are operator-added columns, so
 * until they exist Airtable throws UNKNOWN_FIELD_NAME. The nightly sweep must
 * survive that and collect it — same contract as `updateNextDueDates`.
 *
 * Takes a non-null `AirtableBase`, like every other writer here: whether to write
 * at all is the caller's decision, and this repo keeps "do no writes" separate
 * from "do no IO" one layer up.
 */
export async function updatePrismicModels(
  base: AirtableBase,
  recordId: string,
  models: PrismicModelsWriteback,
): Promise<FieldSet> {
  const fields: Record<string, string | null> = {
    "Prismic Models": models.verdict,
    "Prismic Models Checked At": models.checkedAt,
    "Prismic Models Drift": models.detail === null ? null : truncatePrismicDetail(models.detail),
  };
  if (!skipsAirtableShadow("updatePrismicModels", recordId)) {
    await base(WEBSITES_TABLE).update([{ id: recordId, fields: fields as FieldSet }]);
  }
  // Returned for the #539 Turso mirror — see updateNextDueDates.
  return fields as FieldSet;
}

/** Mark a site launched: flip Status → maintained + stamp Launched at (M6b).
 *  The first code that writes Status. Called after a Launch report sends.
 *  Routed through `toAirtableStatus`, so it still writes Airtable's "maintenance"
 *  option until the stage-2 switch flips. */
export async function updateLaunched(
  base: AirtableBase,
  recordId: string,
  at: string,
): Promise<FieldSet> {
  const fields: FieldSet = { Status: toAirtableStatus("maintained"), "Launched at": at };
  if (!skipsAirtableShadow("updateLaunched", recordId)) {
    await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
  }
  // Returned for the #539 Turso mirror. BOTH columns travel together on purpose:
  // mirroring them as two UPDATEs would open a window where Turso says a site is
  // maintained but never launched.
  return fields;
}
