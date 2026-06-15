import type { FieldSet } from "airtable";
import type { AirtableBase } from "./client.js";
import type { LighthouseScores } from "../types.js";

export const WEBSITES_TABLE = "Websites";

export type Frequency = "None" | "Monthly" | "Quarterly" | "Yearly";

export type Status =
  | "in development"
  | "launch period"
  | "maintenance"
  | "hosting"
  | "probably not our problem"
  | "deprecated";

export type WebsiteRow = {
  id: string;
  name: string;
  url: string;
  status: Status | null;
  pointOfContact: string | null;
  maintenanceFreq: Frequency;
  testingFreq: Frequency;
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
  /** GitHub repo identity as `owner/repo`. Null = no git wiring → self-update ops skip
   *  (or, for local runs, fall back to the checkout's origin remote). */
  gitRepo: string | null;
  reportRecipientsTo: string | null;
  reportRecipientsCc: string | null;
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
  securityVulnsCritical: number | null;
  securityVulnsHigh: number | null;
  securityVulnsModerate: number | null;
  securityVulnsLow: number | null;
  /** Per-site copy overrides (M6a). Blank → null → the DEFAULT_COPY value. */
  copyIntro: string | null;
  copyContact: string | null;
  copyFooter: string | null;
  /** Go-live timestamp, stamped when a Launch report sends (M6b). Null = not yet launched. */
  launchedAt: string | null;
  /** GitHub-signals sweep (slice 2a), written nightly by `github-signals --fleet`. */
  renovateFailingCis: number | null;
  defaultBranchCi: string | null; // "passing" | "failing" | "pending" | "none"
  lastCommitAt: string | null;
  githubSignalsAt: string | null;
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

/** Sites shown on the operator dashboard cockpit: actively-maintained or pre-launch. */
export function isDashboardVisible(site: WebsiteRow): boolean {
  return site.status === "maintenance" || site.status === "launch period";
}

// NOTE: every `f["..."]` key below is a load-bearing magic string that must match
// the live Airtable "Websites" column name EXACTLY — including the legacy
// misspelling `"maintenence freq"`, the mixed-case `"GA4 property ID"`, and the
// lowercase `"url"` / `"point of contact"`. A column rename in Airtable silently
// returns undefined here (→ null), which degrades quietly (GA skipped, recipients
// empty) with no error. If you rename a column, change it here too.
export function mapRow(rec: { id: string; fields: Record<string, unknown> }): WebsiteRow {
  const f = rec.fields;
  const attachments =
    (f["Header image"] as Array<{ url: string; filename: string; type: string }> | undefined) ?? [];
  const header = attachments[0] ?? null;
  return {
    id: rec.id,
    name: String(f["Name"] ?? ""),
    url: String(f["url"] ?? ""),
    status: (f["Status"] as Status | undefined) ?? null,
    pointOfContact: (f["point of contact"] as string | undefined) ?? null,
    maintenanceFreq: ((f["maintenence freq"] as string | undefined) ?? "None") as Frequency,
    testingFreq: ((f["testing freq"] as string | undefined) ?? "None") as Frequency,
    maintenanceDay: (f["maintenance day"] as string | undefined) ?? null,
    testingDay: (f["testing day"] as string | undefined) ?? null,
    ga4PropertyId: (f["GA4 property ID"] as string | undefined) ?? null,
    searchQuery: (f["Search query"] as string | undefined) ?? null,
    searchConsoleProperty: (f["Search Console property"] as string | undefined) ?? null,
    gitRepo: (f["Git repo"] as string | undefined) ?? null,
    reportRecipientsTo: (f["Report recipients (To)"] as string | undefined) ?? null,
    reportRecipientsCc: (f["Report recipients (CC)"] as string | undefined) ?? null,
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
    securityVulnsCritical: (f["Security Vulns Critical"] as number | undefined) ?? null,
    securityVulnsHigh: (f["Security Vulns High"] as number | undefined) ?? null,
    securityVulnsModerate: (f["Security Vulns Moderate"] as number | undefined) ?? null,
    securityVulnsLow: (f["Security Vulns Low"] as number | undefined) ?? null,
    copyIntro: trimToNull(f["Copy — Intro"]),
    copyContact: trimToNull(f["Copy — Contact"]),
    copyFooter: trimToNull(f["Copy — Footer"]),
    launchedAt: (f["Launched at"] as string | undefined) ?? null,
    renovateFailingCis: (f["Renovate Failing CIs"] as number | undefined) ?? null,
    defaultBranchCi: (f["Default Branch CI"] as string | undefined) ?? null,
    lastCommitAt: (f["Last Commit At"] as string | undefined) ?? null,
    githubSignalsAt: (f["GitHub Signals At"] as string | undefined) ?? null,
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
export type DepsCounts = { drifted: number; majorBehind: number; outdated: number | null };
export type SecurityCounts = { critical: number; high: number; moderate: number; low: number };

function scoreFields(scores: LighthouseScores): FieldSet {
  return {
    pScore: scores.performance,
    rScore: scores.accessibility,
    bpScore: scores.bestPractices,
    seoScore: scores.seo,
    "Last lighthouse audit at": new Date().toISOString(),
  };
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
  return fields;
}

function securityFields(counts: SecurityCounts): FieldSet {
  return {
    "Security Vulns Critical": counts.critical,
    "Security Vulns High": counts.high,
    "Security Vulns Moderate": counts.moderate,
    "Security Vulns Low": counts.low,
  };
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
    scores?: LighthouseScores;
    a11y?: A11yCounts;
    deps?: DepsCounts;
    security?: SecurityCounts;
  },
): Promise<FieldSet> {
  const fields: FieldSet = {};
  if (audits.scores) Object.assign(fields, scoreFields(audits.scores));
  if (audits.a11y) Object.assign(fields, a11yFields(audits.a11y));
  if (audits.deps) Object.assign(fields, depsFields(audits.deps));
  if (audits.security) Object.assign(fields, securityFields(audits.security));
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
