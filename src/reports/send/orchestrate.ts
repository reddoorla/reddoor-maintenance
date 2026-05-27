import { openBase, readAirtableConfig } from "../airtable/client.js";
import { listSendableReports, stampSent } from "../airtable/reports.js";
import { listWebsites, siteSlug } from "../airtable/websites.js";
import type { WebsiteRow } from "../airtable/websites.js";
import type { ReportRow } from "../airtable/reports.js";
import { fetchAttachmentBytes } from "../airtable/attachments.js";
import { renderReportHtml } from "../render.js";
import { loadBundledImages } from "../maintenance-email/assets/index.js";
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
  const bundled = await loadBundledImages();

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
  // Run pointOfContact through the parser too — operators sometimes paste
  // "a@x, b@y" into that single-line field.
  const fallbackTo = parseAddresses(site.pointOfContact);
  const to = explicitTo ?? fallbackTo ?? [];
  if (to.length === 0) {
    throw new Error(
      `Site '${site.name}' has no recipients (Report recipients (To) AND point of contact are both empty)`,
    );
  }
  for (const addr of to) {
    if (!isProbablyEmail(addr)) {
      throw new Error(
        `Site '${site.name}' recipient is malformed: ${addr} — fix Report recipients (To) or point of contact in Airtable`,
      );
    }
  }
  const cc = parseAddresses(site.reportRecipientsCc);
  if (cc) {
    for (const addr of cc) {
      if (!isProbablyEmail(addr)) {
        throw new Error(
          `Site '${site.name}' CC is malformed: ${addr} — fix Report recipients (CC) in Airtable`,
        );
      }
    }
  }

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
      // Bundled images referenced via cid:rd-check-png / cid:rd-blurred-tests-jpg
      // in the template. Attached inline so the email is self-contained — no
      // external CDN dependency, no image-blocked broken icons in webmail.
      {
        filename: bundled.check.filename,
        content: Buffer.from(bundled.check.bytes).toString("base64"),
        contentType: bundled.check.contentType,
        inlineContentId: bundled.check.cid,
      },
      {
        filename: bundled.blurred.filename,
        content: Buffer.from(bundled.blurred.bytes).toString("base64"),
        contentType: bundled.blurred.contentType,
        inlineContentId: bundled.blurred.cid,
      },
    ],
    // Stable across retries of the same row — if Airtable stamping fails after a
    // successful Resend, the next --send-ready replays with the same key and
    // Resend returns the original message id rather than sending a duplicate.
    idempotencyKey: `report:${report.id}`,
  };
  if (cc) payload.cc = cc;

  const result = await client.send(payload);
  await stampSent(base, report.id, new Date(), result.messageId);
  return result.messageId;
}

/**
 * Split a comma/newline-separated address field into a clean array.
 * Lowercases (case-insensitive dedupe) and removes empty entries. Returns
 * null if nothing survives. Does NOT understand `Display Name <email>` —
 * operators should put a bare address in the Airtable field, or use multiple
 * lines if needing multiple recipients.
 */
export function parseAddresses(field: string | null): string[] | null {
  if (!field) return null;
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of field.split(/[,\n]/)) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }
  return list.length > 0 ? list : null;
}

/**
 * Cheap email shape check — must contain exactly one @, with non-empty
 * local and domain parts and at least one dot in the domain. We're not
 * trying to be a full RFC validator; we're trying to catch operator
 * mistakes like "ops at acme dot com" or a missing @ before they 422
 * at Resend.
 */
export function isProbablyEmail(s: string): boolean {
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!local || !domain) return false;
  if (!domain.includes(".")) return false;
  if (/\s/.test(s)) return false;
  return true;
}
