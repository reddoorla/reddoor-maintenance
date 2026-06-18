import { openBase, readAirtableConfig } from "../airtable/client.js";
import { listSendableReports, stampSent } from "../airtable/reports.js";
import { listWebsites, siteSlug, updateLaunched } from "../airtable/websites.js";
import type { WebsiteRow } from "../airtable/websites.js";
import type { ReportRow } from "../airtable/reports.js";
import { fetchAttachmentBytes } from "../airtable/attachments.js";
import { renderReportHtml } from "../render.js";
import { resolveCopy } from "../copy.js";
import { announcementSiteExtras } from "../announcement-email/template.js";
import { loadBundledImages } from "../maintenance-email/assets/index.js";
import { prepareHeaderImage } from "../maintenance-email/header-image.js";
import { defaultResendClient, type ResendClient, type ResendSendInput } from "./resend.js";
import { isIdempotencyConflict } from "./idempotency.js";
import { checklistFor, isChecklistComplete } from "../checklist.js";

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
const REPLY_TO = "info@reddoorla.com";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "May 2026" — UTC month/year, consistent with the rest of the reports pipeline's dates. */
function monthYear(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

type InlineAttachment = NonNullable<ResendSendInput["attachments"]>[number];

/** Build a Resend inline (CID-referenced) attachment from raw bytes — the header
 *  image and both bundled images share this exact shape. */
function toInlineAttachment(a: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  cid: string;
}): InlineAttachment {
  return {
    filename: a.filename,
    content: Buffer.from(a.bytes).toString("base64"),
    contentType: a.contentType,
    inlineContentId: a.cid,
  };
}

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
      if (report.reportType === "Launch") {
        try {
          await updateLaunched(base, site.id, new Date().toISOString());
          lines.push(`  ↳ launched: ${site.name} flipped to maintenance`);
        } catch (e) {
          lines.push(`  ⚠ launch flip failed for ${site.name}: ${(e as Error).message}`);
        }
      }
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
  // Hard checklist gate: a Maintenance/Testing report whose operator checklist isn't
  // fully checked must never go out — even if "Approved to send" was ticked directly in
  // Airtable, bypassing the dashboard's approve gate. Throw so the report is skipped and
  // `Sent at` stays null (at-least-once retry preserved), exactly like the other sendOne
  // guards. Launch/Announcement have an empty checklist → vacuously complete, never gated.
  if (!isChecklistComplete(report)) {
    const items = checklistFor(report.reportType);
    const done = items.filter((i) => report.checklist[i.field] === true).length;
    throw new Error(
      `Report ${report.reportId} checklist incomplete — ${done}/${items.length} items checked`,
    );
  }
  if (!site.headerImage) {
    throw new Error(`Site '${site.name}' has no Header image set on the Websites row`);
  }
  if (!report.lighthouse) {
    throw new Error(
      `Report ${report.reportId} has no Lighthouse scores — all four cells ` +
        `(Lighthouse — Performance / Accessibility / Best Practices / SEO) must be numeric ` +
        `on the Reports row; one non-numeric or blank cell nulls all four`,
    );
  }

  // Resolve + validate recipients BEFORE the expensive work (header fetch + sharp
  // downscale + full MJML render). A misconfigured-recipients site is a guaranteed
  // failure, so fail fast here rather than after burning that work. Same checks +
  // messages as before — only the position moved.
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
        `Site '${site.name}' recipient is malformed: ${addr} — use a bare address only ` +
          `(no \`Name <addr>\` display-name syntax); fix Report recipients (To) or point of contact in Airtable`,
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

  const original = await fetchAttachmentBytes(site.headerImage.url);
  // Downscale the (often multi-MB / 2400px+) Airtable header to email display size, and get
  // back display dims + a placeholder color so the template can reserve the box.
  const header = await prepareHeaderImage(original.bytes);
  const bundled = await loadBundledImages();

  const slug = siteSlug(site.name);
  const cidName = `${slug}-header`;
  const { html } = await renderReportHtml({
    siteName: site.name,
    siteUrl: site.url,
    reportType: report.reportType,
    completedOn: report.completedOn ? new Date(report.completedOn) : new Date(),
    lighthouse: report.lighthouse,
    gaUsersCurrent: report.gaUsersCurrent ?? undefined,
    gaUsersPrevious: report.gaUsersPrevious ?? undefined,
    searchPosition:
      report.searchFoundPage1 && report.searchPosition !== null ? report.searchPosition : undefined,
    lastTestedDate: report.lastTestedDate ? new Date(report.lastTestedDate) : null,
    commentary: report.commentary,
    copy: resolveCopy(site),
    headerImageCid: cidName,
    headerWidth: header.displayWidth,
    headerHeight: header.displayHeight,
    headerBgColor: header.placeholderColor,
    // Announcement-only: re-derive cadence + improvements from the site row so the SENT email
    // keeps its cadence copy + improvement callouts. Without this the send-time re-render drops
    // them entirely (they're not stored on the Reports row). Ignored by the other templates.
    ...(report.reportType === "Announcement" ? announcementSiteExtras(site) : {}),
  });

  const reportDate = report.completedOn ? new Date(report.completedOn) : new Date();
  const subject =
    report.subjectOverride ?? `${site.name} — ${monthYear(reportDate)} ${report.reportType} Report`;

  const payload: Parameters<ResendClient["send"]>[0] = {
    from: FROM_ADDRESS,
    to,
    replyTo: REPLY_TO,
    subject,
    html,
    attachments: [
      toInlineAttachment({
        bytes: header.bytes,
        filename: `${cidName}.jpg`,
        contentType: header.contentType,
        cid: cidName,
      }),
      // Bundled images referenced via cid:rd-check-png / cid:rd-blurred-tests-jpg
      // in the template. Attached inline so the email is self-contained — no
      // external CDN dependency, no image-blocked broken icons in webmail.
      toInlineAttachment({
        bytes: bundled.check.bytes,
        filename: bundled.check.filename,
        contentType: bundled.check.contentType,
        cid: bundled.check.cid,
      }),
      toInlineAttachment({
        bytes: bundled.blurred.bytes,
        filename: bundled.blurred.filename,
        contentType: bundled.blurred.contentType,
        cid: bundled.blurred.cid,
      }),
    ],
    // Stable across retries of the same row — if Airtable stamping fails after a
    // successful Resend, the next --send-ready replays with the same key and
    // Resend returns the original message id rather than sending a duplicate.
    idempotencyKey: `report:${report.id}`,
  };
  if (cc) payload.cc = cc;

  let result: Awaited<ReturnType<ResendClient["send"]>>;
  try {
    result = await client.send(payload);
  } catch (err) {
    // The send path is at-least-once: client.send succeeds → stampSent writes
    // `Sent at` (the ONLY thing that removes the row from listSendableReports). If
    // stampSent threw on a PRIOR run (an Airtable blip), `Sent at` stayed null and
    // the row replays here. By replay time the rendered body has usually changed
    // (operator Commentary edit, `report --due` rewrote scores, or the header
    // re-encodes non-deterministically), so Resend rejects the same-key
    // (`report:<id>`) / different-body re-send with a 409 (`invalid_idempotent_request`).
    //
    // That 409 means the email ALREADY WENT OUT under this key on the prior run.
    // Do NOT re-throw and do NOT re-send (re-throwing leaves the row unstamped, and
    // after the 24h key TTL a SECOND real email would go out). Instead stamp the row
    // so it stops replaying, then return success so the caller runs the Launch flip —
    // which self-heals a launch that sent-but-never-flipped on the prior run.
    //
    // Any OTHER error (real network/Resend failure) re-throws, exactly as before, so
    // a genuine failure still fails loudly and the row replays next run.
    if (isIdempotencyConflict(err)) {
      // Stamp `Sent at` ONLY — the original send's messageId is unrecoverable on
      // the 409 path, so we leave `Resend message ID` null rather than writing a
      // sentinel that would masquerade as a real id and orphan webhook lookups.
      // Still return the sentinel string so the caller logs the already-sent path
      // and runs the Launch flip.
      await stampSent(base, report.id, new Date(), null);
      console.log(`↻ already sent (idempotency conflict), stamped: ${report.reportId}`);
      return "idempotent-conflict";
    }
    throw err;
  }
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
