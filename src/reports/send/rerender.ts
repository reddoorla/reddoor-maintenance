import type { WebsiteRow } from "../airtable/websites.js";
import type { ReportRow } from "../airtable/reports.js";

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
 * IO is injected so the decision logic is testable without sharp, Airtable or a
 * database; the CLI binds the real implementations.
 */
export type RerenderDeps = {
  getReport: (reportId: string) => Promise<ReportRow | null>;
  getSite: (siteId: string) => Promise<WebsiteRow | null>;
  /** The clean header plate from Turso (design D5), or null when unstored. */
  loadHeaderPlate: (siteId: string) => Promise<Uint8Array | null>;
  /** Fallback: the site's Airtable header attachment. */
  fetchAirtableHeader: (url: string) => Promise<Uint8Array>;
  render: (
    site: WebsiteRow,
    report: ReportRow,
    headerPlate: Uint8Array,
  ) => Promise<{ html: string }>;
  store: (reportId: string, html: string) => Promise<void>;
};

export type RerenderResult =
  | { status: "rendered"; reportId: string; bytes: number; headerSource: "turso" | "airtable" }
  /** Already sent: its stored body is the record of what the client received. */
  | { status: "already-sent"; reportId: string }
  | { status: "no-header"; reportId: string }
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

  // Turso first: the bytes are already local, and the Airtable attachment URL is
  // signed and expiring, so fetching it when we hold the same image is pure
  // latency plus a dependency on a URL that may already be dead.
  const stored = await deps.loadHeaderPlate(site.id);
  let plate: Uint8Array;
  let headerSource: "turso" | "airtable";
  if (stored) {
    plate = stored;
    headerSource = "turso";
  } else if (site.headerImage) {
    plate = await deps.fetchAirtableHeader(site.headerImage.url);
    headerSource = "airtable";
  } else {
    // Named, not rendered around: a report with no header is already blocked at
    // approve, and a preview that quietly omitted it would disagree with both
    // the email and that block.
    return { status: "no-header", reportId };
  }

  const { html } = await deps.render(site, report, plate);
  await deps.store(reportId, html);
  return { status: "rendered", reportId, bytes: html.length, headerSource };
}

/** One line per run, machine-greppable, emitted for every outcome — an absent
 *  line means the job never ran, never that it ran and did nothing. */
export function formatRerenderResult(r: RerenderResult): string {
  const suffix = r.status === "rendered" ? ` bytes=${r.bytes} header=${r.headerSource}` : "";
  return `REPORT_RERENDER report=${r.reportId} status=${r.status}${suffix}`;
}
