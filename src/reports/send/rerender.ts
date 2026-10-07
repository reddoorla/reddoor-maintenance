import type { WebsiteRow } from "../../fleet/site-row.js";
import type { ReportRow } from "../report-fields.js";
import type { AutoTickSignals, EvidenceRecord } from "../auto-tick.js";
import { retickEvidence, type SearchColumns } from "../retick.js";
import { searchEnrolled } from "../search-enrolled.js";
import { siteLighthouseScores } from "../draft.js";
import type { LighthouseScores } from "../types.js";

/**
 * Refresh a report's stored HTML body on demand (#539 Phase 4 report review).
 *
 * The console's preview serves `reports.rendered_html`, which is written once at
 * draft time — so commentary edited afterwards does not appear. This regenerates
 * it through `renderReportFromRow`, the same path `sendOne` uses, so the preview
 * is what the client will actually receive rather than an approximation of it.
 *
 * It runs as a batch job (Actions), not in a Netlify function, and that is a
 * deliberate constraint rather than an accident: rendering needs sharp, a native
 * module no function currently bundles, and the alternative — approximating the
 * header geometry to avoid sharp — trades away exactly the fidelity a preview
 * exists to provide.
 *
 * IO is injected so the decision logic is testable without sharp or a
 * database; the CLI binds the real implementations.
 */
export type RerenderDeps = {
  getReport: (reportId: string) => Promise<ReportRow | null>;
  getSite: (siteId: string) => Promise<WebsiteRow | null>;
  /** The clean header plate from Turso (design D5), or null when unstored. */
  loadHeaderPlate: (siteId: string) => Promise<Uint8Array | null>;
  render: (
    site: WebsiteRow,
    report: ReportRow,
    headerPlate: Uint8Array,
  ) => Promise<{ html: string }>;
  store: (reportId: string, html: string) => Promise<void>;
  storeEvidence: (
    reportId: string,
    checklist: Record<string, boolean>,
    autoEvidence: Record<string, EvidenceRecord>,
    search: SearchColumns | null,
  ) => Promise<boolean>;
  /** Conditional on the row still being unsent and unapproved, like `storeEvidence`. */
  storeScores: (reportId: string, scores: LighthouseScores) => Promise<boolean>;
  /** The draft's own Search Console fetch over the report's period (`fetchSearch`).
   *  Called only for an unapproved report on a search-enrolled site. */
  measureSearch?: (
    site: WebsiteRow,
    periodStart: Date,
    periodEnd: Date,
  ) => Promise<AutoTickSignals["search"]>;
  now: () => Date;
};

/** Whether this refresh re-measured Google Indexed: `measured` (a query ran),
 *  `unavailable` (soft-fail or no credentials), `skipped` (locked, not enrolled,
 *  no period, or no fetch wired). */
export type SearchStatus = "measured" | "unavailable" | "skipped";

export type EvidenceStatus = "reticked" | "unchanged" | "locked" | "not-written";

/** Whether this refresh took the site row's current Lighthouse scores (P1-34):
 *  `refreshed` (written and rendered), `unchanged` (already equal), `locked`
 *  (approved), `site-missing` (a site score is null, stored ones kept),
 *  `not-written` (the conditional write matched nothing). */
export type ScoresStatus = "refreshed" | "unchanged" | "locked" | "site-missing" | "not-written";

export type RerenderResult =
  | {
      status: "rendered";
      reportId: string;
      bytes: number;
      headerSource: "turso";
      evidence: EvidenceStatus;
      search: SearchStatus;
      scores: ScoresStatus;
      scoresChange: string | null;
    }
  /** Already sent: its stored body is the record of what the client received. */
  | { status: "already-sent"; reportId: string }
  | {
      status: "no-header";
      reportId: string;
      evidence: EvidenceStatus;
      search: SearchStatus;
      scores: ScoresStatus;
      scoresChange: string | null;
    }
  | { status: "not-found"; reportId: string };

export async function rerenderReport(
  deps: RerenderDeps,
  reportId: string,
): Promise<RerenderResult> {
  const report = await deps.getReport(reportId);
  if (!report) return { status: "not-found", reportId };

  // Refuse a sent report BEFORE doing any work. Its stored body is the record of
  // what the client actually received; regenerating it would overwrite that with
  // something nobody was sent — and today's row would not even reproduce it,
  // since commentary and scores have moved on since.
  if (report.sentAt !== null) return { status: "already-sent", reportId };

  const site = await deps.getSite(report.siteId);
  if (!site) return { status: "not-found", reportId };

  const signal = await measureSearch(deps, site, report);
  const searchStatus: SearchStatus =
    signal === undefined
      ? "skipped"
      : signal.softFailed || signal.notConfigured
        ? "unavailable"
        : "measured";

  let current = report;
  let evidence: EvidenceStatus;
  const retick = retickEvidence(site, report, deps.now(), signal);
  if (retick.status === "reticked") {
    const written = await deps.storeEvidence(
      reportId,
      retick.checklist,
      retick.autoEvidence,
      retick.search,
    );
    if (written) {
      current = {
        ...report,
        checklist: retick.checklist,
        autoEvidence: retick.autoEvidence,
        ...(retick.search ?? {}),
      };
      evidence = "reticked";
    } else {
      evidence = "not-written";
    }
  } else {
    evidence = retick.status;
  }

  const refresh = await refreshScores(deps, reportId, site, current);
  current = refresh.report;
  const { scores, scoresChange } = refresh;

  const plate = await deps.loadHeaderPlate(site.id);
  // Named, not rendered around: a report with no header is already blocked at
  // approve, and a preview that quietly omitted it would disagree with both
  // the email and that block.
  if (!plate) {
    return { status: "no-header", reportId, evidence, search: searchStatus, scores, scoresChange };
  }

  const { html } = await deps.render(site, current, plate);
  await deps.store(reportId, html);
  return {
    status: "rendered",
    reportId,
    bytes: html.length,
    headerSource: "turso",
    evidence,
    search: searchStatus,
    scores,
    scoresChange,
  };
}

const SCORE_LABELS: Array<[keyof LighthouseScores, string]> = [
  ["performance", "p"],
  ["accessibility", "a"],
  ["bestPractices", "bp"],
  ["seo", "seo"],
];

/** An unsent, unapproved report takes the site row's current scores, the same
 *  read the draft makes. An approved one keeps what was approved. */
async function refreshScores(
  deps: RerenderDeps,
  reportId: string,
  site: WebsiteRow,
  report: ReportRow,
): Promise<{ report: ReportRow; scores: ScoresStatus; scoresChange: string | null }> {
  const unchanged = { report, scoresChange: null };
  if (report.approvedToSend) return { ...unchanged, scores: "locked" };
  const live = siteLighthouseScores(site);
  if (!live) return { ...unchanged, scores: "site-missing" };
  const stored = report.lighthouse;
  const change = SCORE_LABELS.filter(([k]) => stored?.[k] !== live[k])
    .map(([k, label]) => `${label}:${stored?.[k] ?? "none"}→${live[k]}`)
    .join(",");
  if (!change) return { ...unchanged, scores: "unchanged" };
  if (!(await deps.storeScores(reportId, live))) return { ...unchanged, scores: "not-written" };
  return { report: { ...report, lighthouse: live }, scores: "refreshed", scoresChange: change };
}

/** Google Indexed is measured only where the draft would measure it: an unapproved
 *  report (a sent one never reaches here), a search-enrolled site, and the
 *  report's own period. `fetchSearch` never throws; a soft-fail comes back flagged. */
async function measureSearch(
  deps: RerenderDeps,
  site: WebsiteRow,
  report: ReportRow,
): Promise<AutoTickSignals["search"] | undefined> {
  if (!deps.measureSearch || report.sentAt !== null || report.approvedToSend) return undefined;
  if (!searchEnrolled(site)) return undefined;
  if (!report.periodStart || !report.periodEnd) return undefined;
  return deps.measureSearch(site, new Date(report.periodStart), new Date(report.periodEnd));
}

/** One line per run, machine-greppable, emitted for every outcome — an absent
 *  line means the job never ran, never that it ran and did nothing. */
export function formatRerenderResult(r: RerenderResult): string {
  const suffix =
    r.status === "rendered"
      ? ` bytes=${r.bytes} header=${r.headerSource} evidence=${r.evidence} search=${r.search}${scoresSuffix(r)}`
      : r.status === "no-header"
        ? ` evidence=${r.evidence} search=${r.search}${scoresSuffix(r)}`
        : "";
  return `REPORT_RERENDER report=${r.reportId} status=${r.status}${suffix}`;
}

function scoresSuffix(r: { scores: ScoresStatus; scoresChange: string | null }): string {
  return ` scores=${r.scores}${r.scoresChange ? ` scores_change=${r.scoresChange}` : ""}`;
}
