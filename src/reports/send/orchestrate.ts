import { openBase, readAirtableConfig } from "../airtable/client.js";
import { listSendableReports, stampSent } from "../airtable/reports.js";
import { listWebsites, siteSlug } from "../airtable/websites.js";
import type { WebsiteRow } from "../airtable/websites.js";
import type { ReportRow } from "../airtable/reports.js";
import { fetchAttachmentBytes } from "../airtable/attachments.js";
import { renderReportHtml } from "../render.js";
import { defaultResendClient, type ResendClient } from "./resend.js";

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
const REPLY_TO = "info@reddoorla.com";

export type OrchestrateOptions = {
  resend?: ResendClient;
};

export async function sendApprovedReports(
  options: OrchestrateOptions = {},
): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const client = options.resend ?? defaultResendClient();

  const sendable = await listSendableReports(base);
  if (sendable.length === 0) return { output: "No reports ready to send.", code: 0 };

  const websites = await listWebsites(base);
  const sites = new Map(websites.map((w) => [w.id, w]));

  const lines: string[] = [];
  let anyFailed = false;
  for (const report of sendable) {
    const site = sites.get(report.siteId);
    if (!site) {
      lines.push(`✗ ${report.reportId} — Site row not found for id=${report.siteId}`);
      anyFailed = true;
      continue;
    }
    try {
      const messageId = await sendOne(client, base, site, report);
      lines.push(`✓ sent: ${report.reportId} (${messageId})`);
    } catch (e) {
      lines.push(`✗ ${report.reportId} — ${(e as Error).message}`);
      anyFailed = true;
    }
  }
  return { output: lines.join("\n"), code: anyFailed ? 1 : 0 };
}

async function sendOne(
  client: ResendClient,
  base: ReturnType<typeof openBase>,
  site: WebsiteRow,
  report: ReportRow,
): Promise<string> {
  if (!site.headerImage) {
    throw new Error(`Site '${site.name}' has no Header image set on the Websites row`);
  }
  if (!report.lighthouse) {
    throw new Error(`Report ${report.reportId} has no Lighthouse scores`);
  }

  const { bytes, contentType } = await fetchAttachmentBytes(site.headerImage.url);

  const slug = siteSlug(site.name);
  const cidName = `${slug}-header`;
  const { html } = await renderReportHtml({
    siteName: site.name,
    siteUrl: site.url,
    reportType: report.reportType,
    completedOn: report.completedOn ? new Date(report.completedOn) : new Date(),
    lighthouse: report.lighthouse,
    gaUsersCurrent: report.gaUsersCurrent ?? 0,
    gaUsersPrevious: report.gaUsersPrevious ?? 0,
    lastTestedDate: report.lastTestedDate ? new Date(report.lastTestedDate) : null,
    commentary: report.commentary,
    headerImageCid: cidName,
  });

  const subject = report.subjectOverride ?? `${site.name} ${report.reportType} Report`;
  const explicitTo = parseAddresses(site.reportRecipientsTo);
  const fallbackTo = site.pointOfContact ? [site.pointOfContact] : [];
  const to = explicitTo ?? fallbackTo;
  if (to.length === 0) {
    throw new Error(
      `Site '${site.name}' has no recipients (Report recipients (To) AND point of contact are both empty)`,
    );
  }
  const cc = parseAddresses(site.reportRecipientsCc);

  const payload: Parameters<ResendClient["send"]>[0] = {
    from: FROM_ADDRESS,
    to,
    replyTo: REPLY_TO,
    subject,
    html,
    attachments: [
      {
        filename: site.headerImage.filename,
        content: Buffer.from(bytes).toString("base64"),
        contentType,
        inlineContentId: cidName,
      },
    ],
  };
  if (cc) payload.cc = cc;

  const result = await client.send(payload);
  await stampSent(base, report.id, new Date(), result.messageId);
  return result.messageId;
}

function parseAddresses(field: string | null): string[] | null {
  if (!field) return null;
  const list = field
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}
