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
  /** Fleet-homepage VISIBILITY flag (the per-site token gate was retired
   *  2026-06-10 — the dashboard is operator-only, gated by DASHBOARD_PASSWORD).
   *  A non-null value opts the site into the `/` fleet view; `null` hides it.
   *  Any truthy marker works; the value is no longer a secret. */
  dashboardToken: string | null;
};

export function siteSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
    dashboardToken: (() => {
      const raw = f["Dashboard Token"];
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    })(),
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
  const fields: FieldSet = {
    pScore: scores.performance,
    rScore: scores.accessibility,
    bpScore: scores.bestPractices,
    seoScore: scores.seo,
    "Last lighthouse audit at": new Date().toISOString(),
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}

/** Persist a11y violation count. */
export async function updateA11yCounts(
  base: AirtableBase,
  recordId: string,
  counts: { violations: number },
): Promise<void> {
  const fields: FieldSet = {
    "A11y Violations": counts.violations,
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}

/** Persist deps drift counts (declared-range drift + real outdated installs). */
export async function updateDepsCounts(
  base: AirtableBase,
  recordId: string,
  counts: { drifted: number; majorBehind: number; outdated: number | null },
): Promise<void> {
  const fields: FieldSet = {
    "Deps Drifted": counts.drifted,
    "Deps Major Behind": counts.majorBehind,
  };
  // Only write the outdated count when it was determined — a null (no/stale
  // lockfile this run) must not clobber a previously-good value.
  if (counts.outdated !== null) {
    fields["Deps Outdated"] = counts.outdated;
  }
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}

/** Persist security vulnerability counts by severity. */
export async function updateSecurityCounts(
  base: AirtableBase,
  recordId: string,
  counts: { critical: number; high: number; moderate: number; low: number },
): Promise<void> {
  const fields: FieldSet = {
    "Security Vulns Critical": counts.critical,
    "Security Vulns High": counts.high,
    "Security Vulns Moderate": counts.moderate,
    "Security Vulns Low": counts.low,
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}
