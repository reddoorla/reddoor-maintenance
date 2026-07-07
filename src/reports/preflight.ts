import { openBase, readAirtableConfig } from "./airtable/client.js";
import type { AirtableBase } from "./airtable/client.js";
import { listWebsites, siteSlug } from "./airtable/websites.js";
import type { WebsiteRow } from "./airtable/websites.js";
import { listAllReports } from "./airtable/reports.js";
import type { ReportRow } from "./airtable/reports.js";
import { parseAddresses, isProbablyEmail } from "./send/orchestrate.js";
import { ELIGIBLE_STATUSES, reportPeriodKey } from "./due.js";
import type { ReportType } from "./types.js";
import { gatingHealth } from "./checklist.js";

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

/** Anchors older than this, WHEN the anchor is actually the schedule's base date
 *  (no newer Sent-at — see nextDueDate's `lastSent ?? fallback`), mean the next
 *  `report --due` run drafts a surprise back-dated report. */
const STALE_ANCHOR_DAYS = 396; // ~13 months

function domainOf(addr: string): string {
  const at = addr.lastIndexOf("@");
  return at === -1 ? "" : addr.slice(at + 1).toLowerCase();
}

function isOperatorSite(site: WebsiteRow): boolean {
  if (!site.url) return false;
  try {
    // Airtable `url` cells aren't guaranteed a scheme; retry with one before giving up.
    const host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(site.url) ? site.url : `https://${site.url}`,
    ).hostname.toLowerCase();
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
  reports: ReportRow[],
  findings: PreflightFinding[],
  now: Date,
): void {
  // Validate the RAW Airtable cell, not the coerced Frequency: toFrequency maps any
  // unrecognized value (typo, trailing space, renamed option) to "None", so by the
  // time WebsiteRow is built the damage is invisible — the site just silently drops
  // off the schedule. This is the loud version.
  const raw = which === "maintenance" ? site.maintenanceFreqRaw : site.testingFreqRaw;
  const coerced = which === "maintenance" ? site.maintenanceFreq : site.testingFreq;
  if (raw !== null && raw !== "" && coerced === "None" && raw.trim() !== "None") {
    findings.push({
      level: "fail",
      check: "frequency-unrecognized",
      message: `${which} frequency cell is '${raw}' — not an exact Monthly/Quarterly/Yearly/None, so the scheduler silently treats it as None and the site drops off the calendar; fix the Airtable value`,
    });
    return;
  }
  if (coerced === "None") return;

  const anchor = which === "maintenance" ? site.maintenanceDay : site.testingDay;
  if (!anchor) return;
  // nextDueDate uses `lastSent ?? anchor`: once anything has been sent, the anchor
  // is inert and an old one is normal on every healthy mature site — only warn when
  // the anchor is genuinely the base date the scheduler would use.
  const type: ReportType = which === "maintenance" ? "Maintenance" : "Testing";
  const lastSent = lastSentForType(reports, type);
  if (lastSent && new Date(lastSent).getTime() >= new Date(anchor).getTime()) return;
  const ageDays = (now.getTime() - new Date(anchor).getTime()) / 86_400_000;
  if (ageDays > STALE_ANCHOR_DAYS) {
    findings.push({
      level: "warn",
      check: "anchor-stale",
      message: `${which} day anchor is ${anchor} (>13 months old) and nothing newer has been sent — \`report --due\` will draft a back-dated overdue report; reset the anchor or clear the schedule`,
    });
  }
}

/**
 * Pure per-site preflight: every check that, left unfixed, makes a report send fail,
 * go to the wrong inbox, or surprise the operator. Read-only over data already
 * fetched; no Airtable handle, no network — trivially testable.
 *
 * Mirrors the send/draft-time validation (recipients + header image in
 * send/orchestrate.ts, Websites-row scores in draft.ts) so problems surface BEFORE
 * draft/approve instead of exploding at `report --send-ready`, and adds the checks
 * send time cannot do: operator-address leftovers, To-override shadowing,
 * pending-draft races, schedule hygiene against the RAW Airtable values.
 */
export function preflightSite(
  site: WebsiteRow,
  reports: ReportRow[],
  type: ReportType,
  now: Date,
): PreflightSiteResult {
  const findings: PreflightFinding[] = [];

  // A site that isn't on the checked calendar never drafts, so its send
  // requirements (recipients / header image / scores) can't hurt anyone —
  // checking them anyway would drown the fleet run in fails for legacy hosting
  // rows. Frequency hygiene and pending-draft checks still run: a typo'd cell
  // is exactly HOW a site falls off the calendar, and an already-drafted report
  // can still be approved + sent regardless of schedule.
  const scheduledForType =
    type === "Announcement"
      ? true
      : type === "Maintenance"
        ? site.maintenanceFreq !== "None"
        : site.testingFreq !== "None";
  if (!scheduledForType) {
    findings.push({
      level: "info",
      check: "not-scheduled",
      message: `no ${type} schedule (frequency is None/blank) — send-requirement checks skipped; schedule + pending-draft checks still apply`,
    });
  }

  // --- Recipients: same resolution order as the send path (To override, else contact).
  const explicitTo = parseAddresses(site.reportRecipientsTo);
  const fallbackTo = parseAddresses(site.pointOfContact);
  const to = scheduledForType ? (explicitTo ?? fallbackTo ?? []) : [];
  if (scheduledForType && to.length === 0) {
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
  const cc = scheduledForType ? (parseAddresses(site.reportRecipientsCc) ?? []) : [];
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
      const allOperator = operatorAddrs.length === to.length;
      findings.push({
        level: "warn",
        check: "recipient-operator-address",
        message: allOperator
          ? `resolved To is ONLY operator address(es) ${operatorAddrs.join(", ")} — probably a test-send leftover; the client will NOT receive this report`
          : `resolved To includes operator address(es) ${operatorAddrs.join(", ")} alongside the client's — confirm that's intentional (the ops inbox is already CC'd on every send)`,
      });
    }
  }
  if (scheduledForType && explicitTo && fallbackTo) {
    const a = [...explicitTo]
      .map((x) => x.toLowerCase())
      .sort()
      .join(",");
    const b = [...fallbackTo]
      .map((x) => x.toLowerCase())
      .sort()
      .join(",");
    if (a !== b) {
      findings.push({
        level: "info",
        check: "to-override-shadows-contact",
        message: `Report recipients (To) [${explicitTo.join(", ")}] overrides point of contact [${fallbackTo.join(", ")}] — the contact won't receive this unless also listed`,
      });
    }
  }

  // --- Hard requirements of the draft/send paths, surfaced early.
  if (scheduledForType && !site.headerImage) {
    findings.push({
      level: "fail",
      check: "header-image-missing",
      message: "no Header image on the Websites row — the send will throw",
    });
  } else if (scheduledForType && site.headerImage && !site.headerImage.type.startsWith("image/")) {
    findings.push({
      level: "fail",
      check: "header-image-not-image",
      message: `Header image attachment is '${site.headerImage.type}' (${site.headerImage.filename}) — not a decodable image; the send throws in prepareHeaderImage`,
    });
  }
  const scores = [site.pScore, site.rScore, site.bpScore, site.seoScore];
  if (scheduledForType && scores.some((s) => s === null)) {
    if (type === "Announcement") {
      // announce() skips score-less sites (skipped-no-scores) rather than throwing.
      findings.push({
        level: "warn",
        check: "scores-missing",
        message:
          "Websites row is missing Lighthouse scores — `announce` will skip this site; run `audit lighthouse --write-airtable` first",
      });
    } else {
      // report <site> / report --due HARD-THROW here (scoresFromWebsite in draft.ts).
      findings.push({
        level: "fail",
        check: "scores-missing",
        message:
          "Websites row is missing Lighthouse scores — drafting will throw (scoresFromWebsite); run `audit lighthouse --write-airtable` first",
      });
    }
  }
  if (type === "Announcement" && site.status !== "maintenance") {
    findings.push({
      level: "info",
      check: "status-not-maintenance",
      message: `status is '${site.status ?? "(blank)"}' — \`announce --all\` only drafts for maintenance sites`,
    });
  }

  // --- Pending drafts. For an Announcement these always race (the queue tier rule
  // supersedes or blocks). For Maintenance/Testing, the CURRENT cycle's own draft
  // sitting ready on send day IS the payload — that's the steady state, not a
  // problem — so only genuinely stale/foreign drafts get the warn.
  const pending = reports.filter((r) => r.draftReady && r.sentAt === null);
  if (pending.length > 0) {
    const currentPeriod = reportPeriodKey(now);
    const isExpectedPayload = (r: ReportRow): boolean =>
      type !== "Announcement" && r.reportType === type && r.period === currentPeriod;
    const expected = pending.filter(isExpectedPayload);
    const stale = pending.filter((r) => !isExpectedPayload(r));
    if (expected.length > 0) {
      findings.push({
        level: "info",
        check: "pending-drafts",
        message: `current-cycle ${type} draft is queued${expected[0]!.approvedToSend ? " and approved" : " (awaiting approval)"} — this is the report \`--send-ready\` will deliver`,
      });
    }
    if (stale.length > 0) {
      const summary = stale
        .map(
          (r) =>
            `${r.reportType} ${r.period ?? "(no period)"}${r.approvedToSend ? " [APPROVED]" : ""}`,
        )
        .join(", ");
      findings.push({
        level: "warn",
        check: "pending-drafts",
        message: `${stale.length} unsent draft(s) queued: ${summary} — resolve before sending so the client doesn't get the wrong report first`,
      });
    }
  }

  // --- Schedule hygiene (validates the RAW Airtable frequency cells).
  checkFrequency(site, "maintenance", reports, findings, now);
  checkFrequency(site, "testing", reports, findings, now);
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
 * Fleet-level heuristics that need the whole selection. Airtable column renames
 * don't error — the mapper reads null forever (its own header comment admits this).
 * A load-bearing column empty on EVERY selected site is far more likely a rename
 * than N coincidences; say so. Likewise two different sites resolving to one
 * recipient is worth one eyeball (it can be legitimate — same owner, two sites).
 */
export function preflightFleet(sites: WebsiteRow[]): PreflightFinding[] {
  if (sites.length < 3) return []; // too few rows to distinguish rename from data
  const findings: PreflightFinding[] = [];
  const allEmpty = (get: (s: WebsiteRow) => unknown, column: string): void => {
    if (sites.every((s) => get(s) === null || get(s) === "")) {
      findings.push({
        level: "warn",
        check: "column-possibly-renamed",
        message: `'${column}' is empty on all ${sites.length} selected sites — if that column was renamed in Airtable the code reads null silently; verify the column name`,
      });
    }
  };
  allEmpty((s) => s.pointOfContact, "point of contact");
  allEmpty((s) => s.maintenanceFreqRaw, "maintenence freq");
  allEmpty((s) => s.headerImage, "Header image");

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
        level: "info",
        check: "duplicate-contact",
        message: `${names.join(" and ")} resolve to the same recipient (${addr}) — fine if one person owns both; otherwise a copy-paste error on one row`,
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
  /** Fleet mode: for Announcement, maintenance-status sites (announce's own filter);
   *  for Maintenance/Testing, everything `report --due` schedules — ELIGIBLE_STATUSES
   *  plus null-status rows (due.ts treats null as active for legacy rows). */
  all?: boolean;
  type?: ReportType;
  now?: Date;
};

export type PreflightResult = {
  results: PreflightSiteResult[];
  fleet: PreflightFinding[];
};

/**
 * Read-only rollout preflight over the live Airtable base. One Websites fetch, one
 * Reports fetch (the --due path does the same for the same rate-limit reason), then
 * {@link preflightSite} per selected site plus {@link preflightFleet} across the
 * selection. NEVER writes and NEVER sends.
 */
export async function preflight(deps?: PreflightDeps): Promise<PreflightResult> {
  const base = deps?.base ?? openBase(readAirtableConfig());
  const type: ReportType = deps?.type ?? "Announcement";
  const now = deps?.now ?? new Date();

  const websites = await listWebsites(base);
  const selected = deps?.site
    ? websites.filter((w) => siteSlug(w.name) === siteSlug(deps.site!))
    : type === "Announcement"
      ? websites.filter((w) => w.status === "maintenance")
      : websites.filter((w) => w.status === null || ELIGIBLE_STATUSES.has(w.status));

  const allReports = selected.length > 0 ? await listAllReports(base) : [];
  const results = selected.map((site) =>
    preflightSite(
      site,
      allReports.filter((r) => r.siteId === site.id),
      type,
      now,
    ),
  );
  return { results, fleet: deps?.site ? [] : preflightFleet(selected) };
}

/**
 * Health-gate blockers for one report: every GATING field whose evidence is not `pass`/`n/a`
 * (i.e. `fail`, `unknown`, or absent) becomes a fail-level finding, keyed `health-gate`. PURE.
 * Folded into {@link approveBlockers} so health failures ride the existing send-blocked reason +
 * 409 + dashboard chip (the second gate — no third gate is added).
 *
 * NOTE: override suppression is added in Phase 10 (a guard at the top of this function). Until
 * then a health-red report always blocks approve/send.
 */
export function healthBlockers(report: ReportRow): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const { field, status } of gatingHealth({
    reportType: report.reportType,
    autoEvidence: report.autoEvidence ?? {},
  })) {
    if (status === "pass" || status === "n/a") continue;
    const note = report.autoEvidence?.[field]?.note ?? "no signal yet";
    findings.push({
      level: "fail",
      check: "health-gate",
      message:
        status === "fail"
          ? `${field}: failing — ${note}`
          : `${field}: not yet green (${status}) — ${note}`,
    });
  }
  return findings;
}

/**
 * The send-blocking subset for ONE report, at approve time: exactly the
 * conditions that make `sendOne` throw (no recipients, malformed To/CC, no
 * header image, no report-level Lighthouse scores) plus the wrong-inbox warn
 * (operator address resolved as a client's To). PURE — the approve gate, the
 * dashboard's pending-row chip, and the digest collector all call this one
 * function so "approvable" can't drift from "sendable".
 *
 * Deliberately narrower than {@link preflightSite}: schedule hygiene and
 * pending-draft races are fleet/site concerns — blocking THIS report's approval
 * on them would be over-gating.
 */
export function approveBlockers(site: WebsiteRow, report: ReportRow): PreflightFinding[] {
  const findings: PreflightFinding[] = [];

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
        message: `recipient '${addr}' is malformed — fix Report recipients (To) / point of contact in Airtable`,
      });
    }
  }
  for (const addr of parseAddresses(site.reportRecipientsCc) ?? []) {
    if (!isProbablyEmail(addr)) {
      findings.push({
        level: "fail",
        check: "recipients-malformed",
        message: `CC '${addr}' is malformed — fix Report recipients (CC) in Airtable`,
      });
    }
  }
  if (!site.headerImage) {
    findings.push({
      level: "fail",
      check: "header-image-missing",
      message: "no Header image on the Websites row — the send will throw",
    });
  } else if (!site.headerImage.type.startsWith("image/")) {
    findings.push({
      level: "fail",
      check: "header-image-not-image",
      message: `Header image attachment is '${site.headerImage.type}' (${site.headerImage.filename}) — not a decodable image; the send throws in prepareHeaderImage`,
    });
  }
  // sendOne throws on a null report.lighthouse (one blank/non-numeric cell nulls
  // all four) — the REPORT's snapshot, not the Websites-row scores.
  if (report.lighthouse === null) {
    findings.push({
      level: "fail",
      check: "report-scores-missing",
      message:
        "the Reports row has no Lighthouse scores (one blank/non-numeric cell nulls all four) — the send will throw",
    });
  }
  if (!isOperatorSite(site)) {
    const operatorAddrs = to.filter((a) => OPERATOR_DOMAINS.includes(domainOf(a)));
    if (operatorAddrs.length > 0 && operatorAddrs.length === to.length) {
      findings.push({
        level: "warn",
        check: "recipient-operator-address",
        message: `resolved To is ONLY operator address(es) ${operatorAddrs.join(", ")} — the client will NOT receive this report`,
      });
    }
  }
  findings.push(...healthBlockers(report));
  return findings;
}

/** Convenience: just the fail-level blockers, formatted for gate messages. */
export function formatBlockers(findings: PreflightFinding[]): string[] {
  return findings.filter((f) => f.level === "fail").map((f) => `${f.check}: ${f.message}`);
}
