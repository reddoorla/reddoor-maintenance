import mjml2html from "mjml";
import type { ReportData } from "./types.js";
import { buildMjml } from "./maintenance-email/template.js";
import { buildLaunchMjml } from "./launch-email/template.js";
import { buildAnnouncementMjml } from "./announcement-email/template.js";
import { templateFor } from "./template-for.js";

// Re-exported for existing importers; the dashboard imports ./template-for.js,
// because this module pulls in MJML (cheerio, juice, uglify-js, clean-css).
export { rendersCommentary } from "./template-for.js";

export type RenderResult = {
  html: string;
  warnings: Array<{ line: number; message: string }>;
};

export async function renderReportHtml(data: ReportData): Promise<RenderResult> {
  const template = templateFor(data.reportType);
  const mjml =
    template === "launch"
      ? buildLaunchMjml(data)
      : template === "announcement"
        ? buildAnnouncementMjml(data)
        : buildMjml(data);
  const out = await mjml2html(mjml, { validationLevel: "strict" });
  return { html: out.html, warnings: out.errors ?? [] };
}
