import { escapeHtml } from "../util/html.js";
import { CHECK_CID } from "./maintenance-email/assets/index.js";
import type { ReportData } from "./types.js";

/**
 * Shared MJML section builders for the report family of emails (maintenance/testing report,
 * announcement). Centralizing them here guarantees the announcement renders the SAME polished
 * components as the monthly report — the checklist rows, the full Lighthouse block, and the
 * analytics block — so the two can't drift in design. PURE string builders; no I/O.
 *
 * Escaping: callers pass already-trusted copy for fixed labels, but any site/operator string
 * (check labels, trailing notes) is escaped here via `escapeXml`.
 */
export const escapeXml = escapeHtml;

const RED = "#C00";
const GREY = "#757575";
const BORDER = "#CCCCCC";
const TREND_UP = "#2E7D32"; // positive green — growth reads as good
const TREND_NEUTRAL = GREY; // muted grey — dips/flat aren't failures (brand red is reserved)

// The report's bundled green check (cid:rd-check-png), attached inline by orchestrate.ts at
// send time. Standalone previews (no attachments) show the image's alt instead.
const CHECK_PNG = `cid:${CHECK_CID}`;

/** Thousands-grouped user/visitor count. */
export function fmtUsers(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * A checklist "table": one ruled row per label, the label on the left and the green check
 * right-aligned, matching the monthly report. `background` tints the band (white for the
 * maintenance list, #F4F4F4 for the testing list); `lastPaddingBottom` is the trailing gap
 * under the final row. Labels are escaped. PURE.
 */
export function checklistRowsSection(
  rows: string[],
  opts: { background: string; lastPaddingBottom: string },
): string {
  return rows
    .map((label, i) => {
      const isLast = i === rows.length - 1;
      const border = isLast ? "" : ` border-bottom="solid ${BORDER} 1px"`;
      const lastPad = isLast ? ` padding-bottom="${opts.lastPaddingBottom}"` : "";
      return `
    <mj-section background-color="${opts.background}" padding="0px"${lastPad}>
      <mj-group>
        <mj-column padding-left="0px" width="90%"${border}>
          <mj-text height="25px" padding-left="0px" color="${GREY}" padding-top="20px" padding-bottom="7.5px" font-size="16px">${escapeXml(label)}</mj-text>
        </mj-column>
        <mj-column width="10%"${border} padding-top="15px">
          <mj-image align="right" padding-right="0px" width="20px" height="20px" padding-top="2.5px" padding-bottom="15px" src="${CHECK_PNG}" />
        </mj-column>
      </mj-group>
    </mj-section>`;
    })
    .join("");
}

/** The four Lighthouse scores with their client-facing labels and acceptable/ideal bands.
 *  Ideal always tops at 100 (the metric's ceiling). */
const LIGHTHOUSE_ROWS: ReadonlyArray<{
  label: string;
  key: keyof ReportData["lighthouse"];
  range: string;
}> = [
  { label: "Performance", key: "performance", range: "Acceptable 50–89 // Ideal 90–100" },
  { label: "Readability (A11y)", key: "accessibility", range: "Acceptable 80–99 // Ideal 100" },
  { label: "Best Practices", key: "bestPractices", range: "Acceptable 60–79 // Ideal 80–100" },
  { label: "Site Structure", key: "seo", range: "Acceptable 50–89 // Ideal 90–100" },
];

/**
 * The full "LIGHTHOUSE SCORES*" block: each score as a big red number under its label with the
 * acceptable/ideal band beneath, ruled between scores, closed by the explanatory footnote.
 * `background` tints the section (default #F4F4F4, matching the report). When `pad` is given the
 * band's top/bottom padding moves to the section (symmetric bands for the announcement); omitting
 * it keeps the report's original inner paddings. PURE.
 */
export function lighthouseScoresSection(
  lighthouse: ReportData["lighthouse"],
  opts: { background?: string; pad?: string } = {},
): string {
  const background = opts.background ?? "#F4F4F4";
  const sectionPad = opts.pad ? ` padding-top="${opts.pad}" padding-bottom="${opts.pad}"` : "";
  const labelTop = opts.pad ?? "55px";
  const footnoteBottom = opts.pad ? "0px" : "36px";
  const rows = LIGHTHOUSE_ROWS.map(
    ({ label, key, range }, i) => `
        <mj-text color="${RED}" font-size="20px" font-weight="300" padding-top="25px">${label}</mj-text>
        <mj-text color="${RED}" font-size="44px" font-weight="400" padding-top="0px">${lighthouse[key]}</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="0px" padding-bottom="36px">${range}</mj-text>${
          i < LIGHTHOUSE_ROWS.length - 1
            ? `
        <mj-divider border-width="1px" border-style="solid" border-color="${BORDER}" padding="0" />`
            : ""
        }`,
  ).join("");
  return `
    <mj-section background-color="${background}"${sectionPad}>
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="${labelTop}">LIGHTHOUSE SCORES*</mj-text>${rows}
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" padding-bottom="${footnoteBottom}" line-height="20px">*A Lighthouse score is a numerical measure provided by <a href="https://developer.chrome.com/docs/lighthouse/overview" style="color:${RED}; text-decoration:underline;">Google's Lighthouse tool</a>, which evaluates various aspects of a web page's quality.</mj-text>
      </mj-column>
    </mj-section>`;
}

/** The line under "{N} Users": a directional trend vs the previous period when both numbers
 *  are real, else a graceful fallback. `undefined` = GA unavailable (distinct from a real 0).
 *  Up = green; down/flat = muted grey (a traffic dip isn't a failure). PURE. */
export function analyticsTrendLine(
  cur: number | undefined,
  prev: number | undefined,
  periodDays?: number,
): string {
  // The prior window the trend compares against: a concrete "the previous N days" when the
  // caller knows the window length, else the generic "last period" (keeps the label honest for
  // callers — and tests — that don't supply it).
  const priorLabel =
    periodDays && periodDays > 0 ? `the previous ${periodDays} days` : "last period";
  if (cur === undefined || prev === undefined) {
    return trendLine(TREND_NEUTRAL, `Last Period: ${prev !== undefined ? fmtUsers(prev) : "—"}`);
  }
  if (prev === 0) {
    return cur > 0
      ? trendLine(TREND_UP, "▲ New this period (0 last period)")
      : trendLine(TREND_NEUTRAL, "Last Period: 0");
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  const range = `(${fmtUsers(prev)} → ${fmtUsers(cur)})`;
  if (pct > 0) return trendLine(TREND_UP, `▲ ${pct}% vs ${priorLabel} ${range}`);
  if (pct < 0) return trendLine(TREND_NEUTRAL, `▼ ${Math.abs(pct)}% vs ${priorLabel} ${range}`);
  return trendLine(TREND_NEUTRAL, `No change vs ${priorLabel} (${fmtUsers(prev)})`);
}

/** A 16px coloured line (the trend, and the announcement's search line). */
function trendLine(color: string, text: string): string {
  return `<mj-text color="${color}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">${text}</mj-text>`;
}

/** A 12px muted footnote line (the SEO call-to-action / Lighthouse note style). */
function footnoteLine(text: string): string {
  return `<mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" padding-bottom="36px" line-height="20px">${text}</mj-text>`;
}

/**
 * The "ANALYTICS" block: a big red user count, the trend line, then any 16px `bodyLines`
 * (e.g. the announcement's Google-position line) and 12px muted `footnoteLines` (e.g. the
 * report's SEO call-to-action). Callers pass already-escaped line text. PURE.
 */
export function analyticsSection(opts: {
  current?: number | undefined;
  previous?: number | undefined;
  /** Length in days of the current window; drives the trend's "vs the previous N days" label. */
  periodDays?: number | undefined;
  background: string;
  bodyLines?: string[];
  footnoteLines?: string[];
  pad?: string;
}): string {
  const users = opts.current !== undefined ? fmtUsers(opts.current) : "—";
  const body = (opts.bodyLines ?? []).map((l) => trendLine(TREND_NEUTRAL, l)).join("\n        ");
  const footnotes = (opts.footnoteLines ?? []).map(footnoteLine).join("\n        ");
  const sectionPad = opts.pad ? ` padding-top="${opts.pad}" padding-bottom="${opts.pad}"` : "";
  const labelTop = opts.pad ?? "75px";
  return `
    <mj-section background-color="${opts.background}"${sectionPad}>
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="${labelTop}">ANALYTICS</mj-text>
        <mj-text color="${RED}" font-size="44px" font-weight="400">${users} Users</mj-text>
        ${analyticsTrendLine(opts.current, opts.previous, opts.periodDays)}
        ${body}
        ${footnotes}
      </mj-column>
    </mj-section>`;
}
