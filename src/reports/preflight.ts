import { openBase, readAirtableConfig } from "./airtable/client.js";
import type { AirtableBase } from "./airtable/client.js";
import { listWebsites, siteSlug } from "./airtable/websites.js";
import type { WebsiteRow, Frequency } from "./airtable/websites.js";
import { listReportsForSite } from "./airtable/reports.js";
import type { ReportRow } from "./airtable/reports.js";
import { parseAddresses, isProbablyEmail } from "./send/orchestrate.js";
import type { ReportType } from "./types.js";

export type PreflightLevel = "fail" | "warn" | "info";

export type PreflightFinding = {
  level: PreflightLevel;
  /** Stable machine-readable check id, e.g. "recipients-missing". */
  check: string;
  message: string;
};

export type PreflightSiteResult = {
  site: string;
  findings: PreflightFinding[];
};

/** Domains whose addresses are the OPERATOR's, not a client's. A client site whose
 *  resolved To contains one of these is almost always a test-send leftover — the
 *  exact misconfiguration that would silently divert a client announcement. */
const OPERATOR_DOMAINS = ["reddoorla.com", "tuckerlemos.com"];

const KNOWN_FREQS: ReadonlySet<string> = new Set(["Monthly", "Quarterly", "Yearly", "None", ""]);

/** Anchors older than this (with a schedule set) mean the next `report --due` run
 *  drafts a surprise back-dated report — worth an eyeball before any send day. */
const STALE_ANCHOR_DAYS = 396; // ~13 months

function domainOf(addr: string): string {
  return addr.slice(addr.lastIndexOf("@") + 1).toLowerCase();
}

function isOperatorSite(site: WebsiteRow): boolean {
  try {
    const host = new URL(site.url).hostname.toLowerCase();
    return OPERATOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function lastSentForType(reports: ReportRow[], type: ReportType): string | null {
  const sent = reports
    .filter((r) => r.reportType === type && r.sentAt !== null)
    .map((r) => r.sentAt!)
    .sort();
  return sent[sent.length - 1] ?? null;
}

function checkFrequency(
  site: WebsiteRow,
  which: "maintenance" | "testing",
  findings: PreflightFinding[],
  now: Date,
): void {
  const raw = which === "maintenance" ? site.maintenanceFreq : site.testingFreq;
  const freq = (typeof raw === "string" ? raw.trim() : raw) as Frequency | "";
  if (!KNOWN_FREQS.has(freq ?? "")) {
    findings.push({
      level: "fail",
      check: "frequency-unrecognized",
      message: `${which} frequency '${String(raw)}' is not Monthly/Quarterly/Yearly/None — the scheduler will skip this site; fix the Airtable value`,
    });
    return;
  }
  if (freq === "None" || freq === "" || freq == null) return;
  const anchor = which === "maintenance" ? site.maintenanceDay : site.testingDay;
  if (anchor) {
    const ageDays = (now.getTime() - new Date(anchor).getTime()) / 86_400_000;
    if (ageDays > STALE_ANCHOR_DAYS) {
      findings.push({
        level: "warn",
        check: "anchor-stale",
        message: `${which} day anchor is ${anchor} (>13 months old) — expect a back-dated overdue draft from \`report --due\` unless a newer Sent-at exists; consider resetting the anchor`,
      });
    }
  }
}

/**
 * Pure per-site preflight: every check that, left unfixed, makes a report send fail,
 * go to the wrong inbox, or surprise the operator. Read-only over data already
 * fetched; no Airtable handle, no network — trivially testable.
 *
 * Mirrors the send-time validation in {@link ../send/orchestrate.js} (recipients,
 * header image) so problems surface BEFORE draft/approve instead of exploding at
 * `report --send-ready`, and adds the checks send time cannot do: operator-address
 * leftovers, To-override shadowing, pending-draft races, schedule hygiene.
 */
export function preflightSite(
  site: WebsiteRow,
  reports: ReportRow[],
  type: ReportType,
  now: Date,
): PreflightSiteResult {
  const findings: PreflightFinding[] = [];

  // --- Recipients: same resolution order as the send path (To override, else contact).
  const explicitTo = parseAddresses(site.reportRecipientsTo);
  const fallbackTo = parseAddresses(site.pointOfContact);
  const to = explicitTo ?? fallbackTo ?? [];
  if (to.length === 0) {
    findings.push({
      level: "fail",
      check: "recipients-missing",
      message:
        "no recipients — Report recipients (To) and point of contact are both empty; the send will throw",
    });
  }
  for (const addr of to) {
    if (!isProbablyEmail(addr)) {
      findings.push({
        level: "fail",
        check: "recipients-malformed",
        message: `recipient '${addr}' is malformed — use bare addresses only in Report recipients (To) / point of contact`,
      });
    }
  }
  const cc = parseAddresses(site.reportRecipientsCc) ?? [];
  for (const addr of cc) {
    if (!isProbablyEmail(addr)) {
      findings.push({
        level: "fail",
        check: "recipients-malformed",
        message: `CC '${addr}' is malformed — fix Report recipients (CC)`,
      });
    }
  }
  if (!isOperatorSite(site)) {
    const operatorAddrs = to.filter((a) => OPERATOR_DOMAINS.includes(domainOf(a)));
    if (operatorAddrs.length > 0) {
      findings.push({
        level: "warn",
        check: "recipient-operator-address",
        message: `resolved To includes operator address(es) ${operatorAddrs.join(", ")} on a client site — probably a test-send leftover; the client will NOT receive this report`,
      });
    }
  }
  if (explicitTo && fallbackTo && explicitTo.join(",") !== fallbackTo.join(",")) {
    findings.push({
      level: "warn",
      check: "to-override-shadows-contact",
      message: `Report recipients (To) [${explicitTo.join(", ")}] overrides point of contact [${fallbackTo.join(", ")}] — confirm the override is intentional`,
    });
  }

  // --- Send-time hard requirements, surfaced early.
  if (!site.headerImage) {
    findings.push({
      level: "fail",
      check: "header-image-missing",
      message: "no Header image on the Websites row — the send will throw",
    });
  }
  if (type === "Announcement") {
    const scores = [site.pScore, site.rScore, site.bpScore, site.seoScore];
    if (scores.some((s) => s === null)) {
      findings.push({
        level: "warn",
        check: "scores-missing",
        message:
          "Websites row is missing Lighthouse scores — `announce` will skip this site (skipped-no-scores); run `audit lighthouse --write-airtable` first",
      });
    }
    if (site.status !== "maintenance") {
      findings.push({
        level: "info",
        check: "status-not-maintenance",
        message: `status is '${site.status ?? "(blank)"}' — \`announce --all\` only drafts for maintenance sites`,
      });
    }
  }

  // --- Pending-draft races: an unsent draft either supersedes or is superseded by the
  // new report (single-queue tier rule) — the operator should decide, not discover.
  const pending = reports.filter((r) => r.draftReady && r.sentAt === null);
  if (pending.length > 0) {
    const summary = pending
      .map(
        (r) =>
          `${r.reportType} ${r.period ?? "(no period)"}${r.approvedToSend ? " [APPROVED]" : ""}`,
      )
      .join(", ");
    findings.push({
      level: "warn",
      check: "pending-drafts",
      message: `${pending.length} unsent draft(s) queued: ${summary} — resolve before sending so the client doesn't get the wrong report first`,
    });
  }

  // --- Schedule hygiene.
  checkFrequency(site, "maintenance", findings, now);
  checkFrequency(site, "testing", findings, now);
  if (type === "Announcement") {
    const anySent = lastSentForType(reports, "Maintenance") ?? lastSentForType(reports, "Testing");
    if (!site.maintenanceDay && !site.testingDay && !anySent) {
      findings.push({
        level: "info",
        check: "anchor-missing",
        message:
          "no maintenance/testing day anchors and nothing ever sent — set both anchors to the announcement send date (the Sonder playbook) so recurrence starts from the announcement",
      });
    }
  }

  return { site: site.name, findings };
}

/**
 * Fleet-level column-rename heuristics. Airtable renames don't error — the mapper
 * in websites.ts just reads null forever (its own header comment admits this). A
 * load-bearing column that is empty on EVERY selected site is far more likely a
 * rename than 10 coincidences; say so.
 */
export function preflightFleet(sites: WebsiteRow[]): PreflightFinding[] {
  if (sites.length < 3) return []; // too few rows to distinguish rename from data
  const findings: PreflightFinding[] = [];
  const allEmpty = (get: (s: WebsiteRow) => unknown, column: string): void => {
    if (sites.every((s) => get(s) === null || get(s) === "None" || get(s) === "")) {
      findings.push({
        level: "warn",
        check: "column-possibly-renamed",
        message: `'${column}' is empty on all ${sites.length} selected sites — if that column was renamed in Airtable the code reads null silently; verify the column name`,
      });
    }
  };
  allEmpty((s) => s.pointOfContact, "point of contact");
  allEmpty((s) => s.maintenanceFreq, "maintenence freq");
  allEmpty((s) => s.headerImage, "Header image");

  // Two DIFFERENT sites resolving to the same primary contact is usually a
  // copy-paste error on one of them — the wrong client gets the other site's report.
  const byContact = new Map<string, string[]>();
  for (const s of sites) {
    const to = parseAddresses(s.reportRecipientsTo) ?? parseAddresses(s.pointOfContact) ?? [];
    for (const addr of to) {
      const key = addr.toLowerCase();
      byContact.set(key, [...(byContact.get(key) ?? []), s.name]);
    }
  }
  for (const [addr, names] of byContact) {
    if (names.length > 1 && !OPERATOR_DOMAINS.includes(domainOf(addr))) {
      findings.push({
        level: "warn",
        check: "duplicate-contact",
        message: `${names.join(" and ")} resolve to the same recipient (${addr}) — verify this isn't a copy-paste error on one of the rows`,
      });
    }
  }
  return findings;
}

export type PreflightDeps = {
  /** Airtable handle. Defaults to opening the live base from credentials. */
  base?: AirtableBase;
  /** Slug of a single site (matched via siteSlug). Mutually exclusive with `all`. */
  site?: string;
  /** All maintenance-status sites. */
  all?: boolean;
  type?: ReportType;
  now?: Date;
};

export type PreflightResult = {
  results: PreflightSiteResult[];
  fleet: PreflightFinding[];
};

/**
 * Read-only rollout preflight over the live Airtable base. Fetches Websites (+ each
 * selected site's Reports) and runs {@link preflightSite} per site plus
 * {@link preflightFleet} across the selection. NEVER writes and NEVER sends.
 */
export async function preflight(deps?: PreflightDeps): Promise<PreflightResult> {
  const base = deps?.base ?? openBase(readAirtableConfig());
  const type: ReportType = deps?.type ?? "Announcement";
  const now = deps?.now ?? new Date();

  const websites = await listWebsites(base);
  const selected = deps?.site
    ? websites.filter((w) => siteSlug(w.name) === siteSlug(deps.site!))
    : websites.filter((w) => w.status === "maintenance");

  const results: PreflightSiteResult[] = [];
  for (const site of selected) {
    const reports = await listReportsForSite(base, site.id);
    results.push(preflightSite(site, reports, type, now));
  }
  return { results, fleet: deps?.site ? [] : preflightFleet(selected) };
}
