import type { ReportData, ReportFrequency } from "../types.js";
import { DEFAULT_COPY } from "../copy.js";
import { escapeXml, headerImageTag, headerStyleBlock } from "../maintenance-email/template.js";

/** Frequency → client-facing phrase. "None" is never rendered (the line is omitted). */
const FREQ_PHRASE: Record<Exclude<ReportFrequency, "None">, string> = {
  Monthly: "every month",
  Quarterly: "every quarter",
  Yearly: "every year",
};

const RED = "#C00";
const GREY = "#757575";

/** The four Lighthouse-score labels shown to clients, mirroring the maintenance
 *  template's relabeling (Accessibility→"Readability", SEO→"Site Structure") so the
 *  announcement's score preview matches the real monthly report. */
const SCORE_PREVIEW: ReadonlyArray<{ label: string; key: keyof ReportData["lighthouse"] }> = [
  { label: "Performance", key: "performance" },
  { label: "Readability", key: "accessibility" },
  { label: "Best Practices", key: "bestPractices" },
  { label: "Site Structure", key: "seo" },
];

/** One-time onboarding announcement: header · heading + site intro + body · what to
 *  expect (each cadence pace plus the specific checks it covers, pulled from the same
 *  copy arrays the monthly report renders so the two never drift) · recent improvements
 *  (conditional) · score preview · open door · contact · footer. Reuses the M6a copy
 *  layer (contact/footer honor per-site overrides). No analytics / pricing. */
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
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="400" line-height="24px" padding-top="12px" padding-bottom="0px">• ${escapeXml(b.line)}</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="13px" font-weight="300" line-height="20px" padding-top="2px" padding-bottom="0px" padding-left="16px">${escapeXml(b.checks.join(" · "))}</mj-text>`,
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
        ${scoreRows}
      </mj-column>
    </mj-section>
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
