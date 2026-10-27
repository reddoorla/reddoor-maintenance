import type { ReportType } from "./types.js";

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

/** "Acme Co (acme.com)" — name plus its bare, www-stripped host; name alone if the URL
 *  can't be parsed (mirrors the announce recipe's prior siteLabel). */
function siteLabel(name: string, url: string): string {
  try {
    return `${name} (${new URL(url).hostname.replace(/^www\./, "")})`;
  } catch {
    return name;
  }
}

/**
 * The default subject for a report email, per type. Announcement → "Your testing & maintenance
 * report for {Name} ({domain})"; every other type → "{Name} — {Month YYYY} {Type} Report".
 * Shared by the `announce` recipe (which stores it as the Reports row's subjectOverride) and by
 * `renderReportEmail` (the send/self-test default) so the subject can't drift between them. PURE.
 */
export function defaultReportSubject(args: {
  name: string;
  url: string;
  type: ReportType;
  date: Date;
}): string {
  if (args.type === "Announcement") {
    return `Your testing & maintenance report for ${siteLabel(args.name, args.url)}`;
  }
  return `${args.name} — ${monthYear(args.date)} ${args.type} Report`;
}
