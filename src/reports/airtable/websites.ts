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
  depsDrifted: number | null;
  depsMajorBehind: number | null;
  securityVulnsCritical: number | null;
  securityVulnsHigh: number | null;
  securityVulnsModerate: number | null;
  securityVulnsLow: number | null;
  /** Shared-link gate for the per-site dashboard at /s/<slug>?t=<token>.
   *  Operator generates and pastes into the "Dashboard Token" Airtable field;
   *  rotated by replacing the value. `null` means the site has no dashboard
   *  link yet — the function returns 403 with a clear setup message. */
  dashboardToken: string | null;
};

export function siteSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

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
  const all = await listWebsites(base);
  return all.find((w) => siteSlug(w.name) === slug) ?? null;
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
