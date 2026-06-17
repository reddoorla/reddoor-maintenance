import mjml2html from "mjml";
import type { ReportData } from "./types.js";
import { buildMjml } from "./maintenance-email/template.js";
import { buildLaunchMjml } from "./launch-email/template.js";
import { buildAnnouncementMjml } from "./announcement-email/template.js";

export type RenderResult = {
  html: string;
  warnings: Array<{ line: number; message: string }>;
};

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
