import type { ReportData, ReportFrequency } from "../types.js";
import type { WebsiteRow } from "../airtable/websites.js";
import { DEFAULT_COPY } from "../copy.js";
import { escapeXml, headerImageTag, headerStyleBlock } from "../maintenance-email/template.js";
import { CHECK_CID } from "../maintenance-email/assets/index.js";

/** Frequency → client-facing phrase. "None" is never rendered (the line is omitted). */
const FREQ_PHRASE: Record<Exclude<ReportFrequency, "None">, string> = {
  Monthly: "every month",
  Quarterly: "every quarter",
  Yearly: "every year",
};

const RED = "#C00";
const GREY = "#757575";

// The WHAT TO EXPECT check lists use the report's own green check image (cid:rd-check-png),
// attached inline by orchestrate.ts on every send, so the announcement's checks match the
// monthly report exactly. `alt="✓"` is the fallback shown by the operator's attachment-less
// review preview in place of the (unresolvable) CID — the same tradeoff as the header image.
const CHECK_PNG = `cid:${CHECK_CID}`;

/** Thousands-grouped visitor count. */
function fmtVisitors(n: number): string {
  return n.toLocaleString("en-US");
}

/** A one-line directional trend for visitors vs the previous window, or null when it
 *  can't be computed (missing previous, or previous 0 → no meaningful percentage). */
function visitorTrend(cur?: number, prev?: number): string | null {
  if (cur === undefined || prev === undefined || prev === 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct > 0) return `▲ ${pct}% vs the previous month`;
  if (pct < 0) return `▼ ${Math.abs(pct)}% vs the previous month`;
  return "No change vs the previous month";
}

/**
 * The announcement-only ReportData extras derived from the Websites row: the go-forward
 * cadence and the default-on improvement callouts. Used by BOTH the draft (announce recipe)
 * and the send-time re-render (orchestrate) so the sent email matches the reviewed preview —
 * `renderReportHtml` in the send path otherwise omits these, dropping WHAT TO EXPECT entirely.
 */
export function announcementSiteExtras(
  site: WebsiteRow,
): Pick<ReportData, "cadence" | "improvements"> {
  return {
    cadence: { maintenance: site.maintenanceFreq, testing: site.testingFreq },
    improvements: { resendForms: true, svelte5: true },
  };
}

/** The four Lighthouse-score labels shown to clients, mirroring the maintenance
 *  template's relabeling (Accessibility→"Readability (A11y)", SEO→"Site Structure") so the
 *  announcement's score preview matches the real monthly report. */
const SCORE_PREVIEW: ReadonlyArray<{ label: string; key: keyof ReportData["lighthouse"] }> = [
  { label: "Performance", key: "performance" },
  { label: "Readability (A11y)", key: "accessibility" },
  { label: "Best Practices", key: "bestPractices" },
  { label: "Site Structure", key: "seo" },
];

/** One-time onboarding announcement: header · heading + site intro + body · what to
 *  expect (each cadence pace plus the specific checks it covers, pulled from the same
 *  copy arrays the monthly report renders so the two never drift, each item with a ✓) ·
 *  recent improvements (conditional) · score preview · traffic & search (visitors + trend +
 *  page-1 position, conditional) · open door · contact · footer. Reuses the M6a copy layer
 *  (contact/footer honor per-site overrides). No pricing. */
export function buildAnnouncementMjml(data: ReportData): string {
  const copy = data.copy ?? DEFAULT_COPY;
  const previewText = "Your monthly report from Reddoor";

  // Recent improvements — only the toggled callouts. Empty → the whole section is
  // omitted (no heading, no dangling bullets).
  const improvementItems: string[] = [];
  if (data.improvements?.resendForms) improvementItems.push(copy.announceImprovementResend);
  if (data.improvements?.svelte5) improvementItems.push(copy.announceImprovementSvelte5);
  const improvementsSection =
    improvementItems.length > 0
      ? `
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="36px">RECENT IMPROVEMENTS</mj-text>
        ${improvementItems
          .map(
            (item) => `
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="4px" padding-bottom="4px">• ${escapeXml(item)}</mj-text>`,
          )
          .join("")}
      </mj-column>
    </mj-section>`
      : "";

  // Go-forward cadence ("WHAT TO EXPECT") — one block per non-None pace, testing then
  // maintenance. Each block leads with the pace ("Full site testing — every month") and,
  // beneath it, the specific checks that pass covers, pulled from the SAME copy arrays the
  // monthly report renders (copy.testingChecklist / copy.maintenanceChecks) so the
  // announcement and the report can never drift. The report-each-time note closes the
  // section. Omitted entirely when no cadence is set.
  const cad = data.cadence;
  const cadenceBlocks: Array<{ line: string; checks: string[] }> = [];
  if (cad && cad.testing !== "None")
    cadenceBlocks.push({
      line: `${copy.announceTestingLabel} — ${FREQ_PHRASE[cad.testing]}`,
      checks: copy.testingChecklist,
    });
  if (cad && cad.maintenance !== "None")
    cadenceBlocks.push({
      line: `${copy.announceMaintenanceLabel} — ${FREQ_PHRASE[cad.maintenance]}`,
      checks: copy.maintenanceChecks,
    });
  const cadenceSection =
    cadenceBlocks.length > 0
      ? `
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="36px">${escapeXml(copy.announceCadenceHeading)}</mj-text>
        ${cadenceBlocks
          .map(
            (b) => `
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="400" line-height="24px" padding-top="12px" padding-bottom="2px">• ${escapeXml(b.line)}</mj-text>${b.checks
          .map(
            (c) => `
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="14px" font-weight="300" line-height="22px" padding-top="1px" padding-bottom="0px" padding-left="16px">${escapeXml(c)} <img src="${CHECK_PNG}" alt="✓" width="14" height="14" style="vertical-align:middle;display:inline-block;margin-left:2px;" /></mj-text>`,
          )
          .join("")}`,
          )
          .join("")}
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="14px">${escapeXml(copy.announceCadence)}</mj-text>
      </mj-column>
    </mj-section>`
      : "";

  const scoreRows = SCORE_PREVIEW.map(
    ({ label, key }) => `
        <mj-text color="${RED}" font-size="20px" font-weight="300" padding-top="25px">${label}</mj-text>
        <mj-text color="${RED}" font-size="44px" font-weight="400" padding-top="0px">${data.lighthouse[key]}</mj-text>`,
  ).join("");

  // Optional thin-italic gloss under the scores explaining what they are. Omitted when the
  // copy field is blank (an operator can clear it via per-site copy without touching markup).
  const scoreNote = copy.announceScoreNote
    ? `
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" font-style="italic" line-height="18px" padding-top="16px">${escapeXml(copy.announceScoreNote)}</mj-text>`
    : "";

  // Traffic & search snapshot — visitors (with trend) and the page-1 Google position, both
  // pulled from the enriched ReportData (GA + Search Console, the same data the monthly report
  // shows). Each line is conditional; the whole section is omitted when neither is available.
  const trend = visitorTrend(data.gaUsersCurrent, data.gaUsersPrevious);
  const trafficRows: string[] = [];
  if (data.gaUsersCurrent !== undefined)
    trafficRows.push(`
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="8px"><span style="color:${RED};font-size:22px;font-weight:400;">${escapeXml(fmtVisitors(data.gaUsersCurrent))}</span> visitors in the last month${trend ? ` — ${escapeXml(trend)}` : ""}</mj-text>`);
  if (data.searchPosition !== undefined)
    trafficRows.push(`
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="4px">Page 1 Google result (#${data.searchPosition}) for your brand search</mj-text>`);
  const trafficSection =
    trafficRows.length > 0
      ? `
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="36px">TRAFFIC &amp; SEARCH</mj-text>
        ${trafficRows.join("")}
      </mj-column>
    </mj-section>`
      : "";

  const contactRows = copy.contact
    .map(
      (line) => `
      <mj-text font-family="helvetica, sans-serif" font-size="24px" font-weight="300" line-height="30px">${escapeXml(line)}</mj-text>`,
    )
    .join("");
  const footerAddressRows = copy.footerAddress
    .map(
      (line) => `
      <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">${escapeXml(line)}</mj-text>`,
    )
    .join("");

  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-text font-family="helvetica, sans-serif" padding-left="5px" padding-right="5px" />
      <mj-section padding-left="11%" padding-right="11%"/>
      <mj-image padding="0px" />
    </mj-attributes>
    <mj-preview>${escapeXml(previewText)}</mj-preview>
    ${headerStyleBlock(data)}
  </mj-head>
  <mj-body background-color="white">
    <mj-section background-color="#F4F4F4" padding-top="0px" padding-bottom="0px" padding-left="0px" padding-right="0px">
      <mj-column>${headerImageTag(data)}</mj-column>
    </mj-section>
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="75px">${escapeXml(copy.announceHeading)}</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="20px">Prepared for ${escapeXml(data.siteName)}</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="8px">${escapeXml(copy.announceBody)}</mj-text>
      </mj-column>
    </mj-section>
    ${cadenceSection}
    ${improvementsSection}
    <mj-section background-color="#F4F4F4">
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="55px">${escapeXml(copy.announcePreviewLabel)}</mj-text>
        ${scoreRows}${scoreNote}
      </mj-column>
    </mj-section>
    ${trafficSection}
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="36px">${escapeXml(copy.announceOpenDoor)}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="white">
      <mj-column padding-top="36px">
        <mj-text color="${RED}" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" padding-top="36px" line-height="36px">Any questions, concerns or requests?</mj-text>
        ${contactRows}
        <mj-divider border-width="1px" border-style="solid" border-color="#CCCCCC" padding="0" />
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" line-height="20px" font-style="italic">Copyright ${new Date().getUTCFullYear()} ${escapeXml(copy.footerOrg)}. All rights reserved.</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="700" line-height="16px" padding-top="0" padding-bottom="0px">Our mailing address is:</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">${escapeXml(copy.footerOrg)}</mj-text>
        ${footerAddressRows}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
