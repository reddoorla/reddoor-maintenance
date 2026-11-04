import type { WebsiteRow } from "../../fleet/site-row.js";
import type { ReportRow } from "../report-fields.js";
import type { RenderedReportEmail } from "./render-email.js";
import type { ResendClient, ResendSendInput } from "./resend.js";
import type { TestSendInput } from "../../db/test-sends.js";
import { REPORT_FROM_ADDRESS, isProbablyEmail } from "./addresses.js";

/**
 * `report --test-send <reportId|slug>` (P1-33(c)): email the operator, and only
 * the operator, the exact email a report row would send, with `[TEST] ` on the
 * subject, and log the send in `report_test_sends`.
 *
 * It renders through `renderReportFromRow`, the same function `sendOne` uses,
 * so the [TEST] email is the client's email and not an approximation of it.
 * (`selftest email` is not: it rebuilds from the roster with today's data.)
 *
 * What it never does, each pinned by a test:
 * - address anyone but `operatorEmail()`: the row's and the site's recipients
 *   are never read, and there is no CC;
 * - stamp the report: no `sent_at`, no approval, no write to `reports` at all
 *   (the deps below have no way to make one).
 */
export type TestSendDeps = {
  getReport: (id: string) => Promise<ReportRow | null>;
  getSiteBySlug: (slug: string) => Promise<WebsiteRow | null>;
  getSite: (id: string) => Promise<WebsiteRow | null>;
  listReportsForSite: (siteId: string) => Promise<ReportRow[]>;
  loadHeaderPlate: (siteId: string) => Promise<Uint8Array | null>;
  render: (site: WebsiteRow, report: ReportRow, plate: Uint8Array) => Promise<RenderedReportEmail>;
  client: ResendClient;
  log: (row: TestSendInput) => Promise<void>;
  operator: () => string;
  newId: () => string;
  now: () => Date;
};

export const TEST_SUBJECT_PREFIX = "[TEST] ";

/** The Resend payload for a test send. PURE, and the whole of the recipient
 *  rule: `to` is the operator alone, never a CC, never a reply-to that would
 *  route a reply into the shared inbox. */
export function testSendPayload(
  rendered: RenderedReportEmail,
  operator: string,
  sendId: string,
): ResendSendInput {
  return {
    from: REPORT_FROM_ADDRESS,
    to: [operator],
    subject: `${TEST_SUBJECT_PREFIX}${rendered.subject}`,
    html: rendered.html,
    attachments: rendered.attachments,
    // Per send, not per report: two test sends of one row are two emails.
    idempotencyKey: `report-test-send:${sendId}`,
  };
}

export type TestSendResult = {
  sendId: string;
  report: ReportRow;
  site: WebsiteRow;
  to: string;
  subject: string;
  messageId: string;
};

function refuse(message: string, exitCode = 1): never {
  throw Object.assign(new Error(message), { exitCode });
}

/** A report id resolves to that row. Otherwise the ref is a site slug, which
 *  resolves to the site's newest unsent, unwithdrawn report: the draft the
 *  operator is about to be asked to approve. */
async function resolve(
  deps: TestSendDeps,
  ref: string,
): Promise<{ report: ReportRow; site: WebsiteRow }> {
  const byId = await deps.getReport(ref);
  if (byId) {
    const site = await deps.getSite(byId.siteId);
    if (!site) refuse(`Report ${ref} names site ${byId.siteId}, which has no row`);
    return { report: byId, site };
  }
  const site = await deps.getSiteBySlug(ref);
  if (!site) refuse(`No report id or site slug matched "${ref}"`, 2);
  const reports = await deps.listReportsForSite(site.id);
  const pending = reports.find((r) => r.sentAt === null && r.withdrawnAt === null);
  if (!pending) {
    const latest = reports[0];
    refuse(
      `Site ${ref} has no unsent report` +
        (latest ? `; pass a report id to test-send a sent one (newest: ${latest.id})` : ""),
    );
  }
  return { report: pending, site };
}

export async function testSendReport(deps: TestSendDeps, ref: string): Promise<TestSendResult> {
  const to = deps.operator();
  if (!isProbablyEmail(to)) refuse(`operatorEmail() is not an address: ${JSON.stringify(to)}`, 2);

  const { report, site } = await resolve(deps, ref);
  const plate = await deps.loadHeaderPlate(site.id);
  if (!plate)
    refuse(`Site '${site.name}' has no header plate in Turso; the real send would refuse too`);

  const rendered = await deps.render(site, report, plate);
  const sendId = deps.newId();
  const payload = testSendPayload(rendered, to, sendId);
  const { messageId } = await deps.client.send(payload);
  const sentAt = deps.now();
  try {
    await deps.log({
      id: sendId,
      reportId: report.id,
      siteId: site.id,
      subject: payload.subject,
      sentTo: to,
      resendMessageId: messageId,
      sentAt,
    });
  } catch (e) {
    // The email is out and unlogged: say exactly which, so the row can be written
    // by hand rather than the send repeated.
    refuse(
      `[TEST] email SENT (message ${messageId}, send ${sendId}, report ${report.id}, ` +
        `${sentAt.toISOString()}) but the report_test_sends row failed: ${(e as Error).message}`,
    );
  }
  return { sendId, report, site, to, subject: payload.subject, messageId };
}

export function formatTestSendResult(r: TestSendResult): string {
  return (
    `REPORT_TEST_SEND send=${r.sendId} report=${r.report.id} site=${r.site.name} ` +
    `to=${r.to} message=${r.messageId}\n` +
    `subject: ${r.subject}\n` +
    `Verdict, once read: reddoor-maint report --test-verdict ${r.sendId} clean|"<what was wrong>"`
  );
}
