/** Where the prospect-facing report lives now: a real, branded route on the
 *  marketing site rather than generated HTML on the ops app's domain. */
export const DEFAULT_REPORT_BASE_URL = "https://reddoorla.com";

/**
 * Resolve the public report origin.
 *
 * Deliberately its own variable rather than reusing `DASHBOARD_BASE_URL`. That
 * one addresses operators and points at the ops app; this one addresses a
 * prospect and points at reddoorla.com. They are different audiences on
 * different domains, and sharing a variable would mean one of them silently
 * moving the day the other is repointed.
 */
export function resolveReportBaseUrl(raw: string | undefined): string {
  return (raw?.trim() || DEFAULT_REPORT_BASE_URL).replace(/\/$/, "");
}

/** The link a prospect opens. */
export function reportUrl(token: string, raw = process.env.REPORT_BASE_URL): string {
  return `${resolveReportBaseUrl(raw)}/audit/${token}`;
}

/** The print-designed variant, which the runner renders to a PDF. Same token,
 *  same guards — a separate document, not a stylesheet over the page. */
export function reportPrintUrl(token: string, raw = process.env.REPORT_BASE_URL): string {
  return `${reportUrl(token, raw)}/print`;
}
