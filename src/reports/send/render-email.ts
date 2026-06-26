import { renderReportHtml } from "../render.js";
import { loadBundledImages } from "../maintenance-email/assets/index.js";
import { defaultReportSubject } from "../subject.js";
import type { ReportData } from "../types.js";
import type { ResendSendInput } from "./resend.js";

/** A single Resend inline attachment (CID-referenced). */
export type InlineAttachment = NonNullable<ResendSendInput["attachments"]>[number];

/** The downscaled header image + display metadata produced by `prepareHeaderImage`. */
export type PreparedHeader = {
  bytes: Uint8Array;
  contentType: string;
  displayWidth: number;
  displayHeight: number;
  placeholderColor: string;
};

export type RenderedReportEmail = {
  html: string;
  attachments: InlineAttachment[];
  subject: string;
};

/** Build a Resend inline (CID-referenced) attachment from raw bytes — the header image and both
 *  bundled images share this exact shape. */
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

/**
 * Render a report email from fully-assembled `ReportData`: produce the HTML, the gated inline
 * attachments, and the subject. The per-site header attaches always; the two bundled images
 * (`rd-check-png`, `rd-blurred-tests-jpg`) attach only when their cid actually appears in the
 * rendered HTML (a dangling inline part shows as a stray download in some clients). The subject
 * is `subjectOverride` when given, else `defaultReportSubject`. Shared by the production send path
 * (`sendOne`) and the `selftest` command so the rendered email, attachments, and subject can't
 * drift between them. The only I/O is `loadBundledImages` (a disk read of two bundled images).
 */
export async function renderReportEmail(
  reportData: ReportData,
  ctx: { header: PreparedHeader; cidName: string; subjectOverride?: string | undefined },
): Promise<RenderedReportEmail> {
  const { html } = await renderReportHtml(reportData);
  const bundled = await loadBundledImages();
  const attachments: InlineAttachment[] = [
    toInlineAttachment({
      bytes: ctx.header.bytes,
      filename: `${ctx.cidName}.jpg`,
      contentType: ctx.header.contentType,
      cid: ctx.cidName,
    }),
  ];
  for (const img of [bundled.check, bundled.blurred]) {
    if (html.includes(`cid:${img.cid}`)) {
      attachments.push(
        toInlineAttachment({
          bytes: img.bytes,
          filename: img.filename,
          contentType: img.contentType,
          cid: img.cid,
        }),
      );
    }
  }
  const subject =
    ctx.subjectOverride ??
    defaultReportSubject({
      name: reportData.siteName,
      url: reportData.siteUrl,
      type: reportData.reportType,
      date: reportData.completedOn,
    });
  return { html, attachments, subject };
}
