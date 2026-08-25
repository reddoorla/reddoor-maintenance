import mjml2html from "mjml";
import type { ReportData } from "./types.js";
import { buildMjml } from "./maintenance-email/template.js";
import { buildLaunchMjml } from "./launch-email/template.js";
import { buildAnnouncementMjml } from "./announcement-email/template.js";

export type RenderResult = {
  html: string;
  warnings: Array<{ line: number; message: string }>;
};

/**
 * True when this report type's template actually renders `commentary`.
 *
 * Deliberately expressed as the INVERSE of the dispatch below, and sitting right
 * next to it, so the two cannot drift: `buildLaunchMjml` and
 * `buildAnnouncementMjml` never reference the field, and everything else routes
 * to `buildMjml`, which does. tests/reports/renders-commentary.test.ts renders
 * every type through the real MJML pipeline and fails if that stops being true.
 *
 * Consumers use it to avoid OFFERING commentary where it would be silently
 * dropped — the console shipped an editor on every unsent report before this
 * existed, so an operator could write commentary on an Announcement, save it,
 * and never see it reach the client.
 */
export function rendersCommentary(type: ReportData["reportType"]): boolean {
  return type !== "Launch" && type !== "Announcement";
}

export async function renderReportHtml(data: ReportData): Promise<RenderResult> {
  const mjml =
    data.reportType === "Launch"
      ? buildLaunchMjml(data)
      : data.reportType === "Announcement"
        ? buildAnnouncementMjml(data)
        : buildMjml(data);
  const out = await mjml2html(mjml, { validationLevel: "strict" });
  return { html: out.html, warnings: out.errors ?? [] };
}
