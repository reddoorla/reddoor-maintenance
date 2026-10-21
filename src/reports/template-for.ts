import type { ReportData } from "./types.js";

/**
 * Which email template a report type renders through. `renderReportHtml`
 * dispatches on this, and `rendersCommentary` reads it, so the two cannot
 * drift. A leaf module on purpose: render.ts pulls in MJML and its HTML
 * toolchain, and the dashboard needs only the answer (maintenance#1642).
 */
export function templateFor(
  type: ReportData["reportType"],
): "launch" | "announcement" | "maintenance" {
  if (type === "Launch") return "launch";
  if (type === "Announcement") return "announcement";
  return "maintenance";
}

/**
 * True when this report type's template actually renders `commentary`.
 *
 * `buildLaunchMjml` and `buildAnnouncementMjml` never reference the field, and
 * everything else routes to `buildMjml`, which does.
 * tests/reports/renders-commentary.test.ts renders every type through the real
 * MJML pipeline and fails if that stops being true.
 *
 * Consumers use it to avoid OFFERING commentary where it would be silently
 * dropped — the console shipped an editor on every unsent report before this
 * existed, so an operator could write commentary on an Announcement, save it,
 * and never see it reach the client.
 */
export function rendersCommentary(type: ReportData["reportType"]): boolean {
  return templateFor(type) === "maintenance";
}
