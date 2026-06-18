import type { ReportData, ReportFrequency } from "../types.js";
import type { WebsiteRow } from "../airtable/websites.js";
import { DEFAULT_COPY } from "../copy.js";
import { escapeXml, headerImageTag, headerStyleBlock } from "../maintenance-email/template.js";
import {
  checklistRowsSection,
  lighthouseScoresSection,
  analyticsSection,
} from "../email-sections.js";

/** Frequency → client-facing phrase. "None" is never rendered (the line is omitted). */
const FREQ_PHRASE: Record<Exclude<ReportFrequency, "None">, string> = {
  Monthly: "every month",
  Quarterly: "every quarter",
  Yearly: "every year",
};

const RED = "#C00";
const GREY = "#757575";

// Equal top/bottom padding for every alternating-background band, applied at the mj-section
// level so each colored band has symmetric breathing room. (Starting baseline — easy to tune.)
const SECTION_PAD = "40px";

/** A red all-caps section label. Top spacing comes from the section padding, so this is flush. */
function sectionLabel(text: string): string {
  return `<mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="0px">${escapeXml(text)}</mj-text>`;
}

/** A grey 16px body paragraph, matching the report's section intros. */
function bodyLine(text: string, paddingTop = "8px"): string {
  return `<mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="${paddingTop}">${escapeXml(text)}</mj-text>`;
}

/**
 * The announcement-only ReportData extras derived from the Websites row: the go-forward
 * cadence and the default-on improvement callouts. Used by BOTH the draft (announce recipe)
 * and the send-time re-render (orchestrate) so the sent email matches the reviewed preview —
 * `renderReportHtml` in the send path otherwise omits these, dropping the cadence + improvements.
 */
export function announcementSiteExtras(
  site: WebsiteRow,
): Pick<ReportData, "cadence" | "improvements"> {
  return {
    cadence: { maintenance: site.maintenanceFreq, testing: site.testingFreq },
    improvements: { resendForms: true, svelte5: true },
  };
}

/**
 * One-time onboarding announcement, built from the SAME components as the monthly report so it
 * reads as a testing report with extra explanation: header · intro ("your ongoing care") ·
 * MAINTENANCE CHECKS · TESTING (each: intro with the cadence baked into the copy + the report's
 * checklist rows) · LIGHTHOUSE SCORES · ANALYTICS (users + trend + the Google-position line) ·
 * RECENT IMPROVEMENTS (conditional; closes with the open-door invitation). Reuses the M6a copy
 * layer (contact/footer honor per-site overrides). No pricing. A pace set to None omits its
 * checklist section. Every band carries equal top/bottom padding (SECTION_PAD).
 */
export function buildAnnouncementMjml(data: ReportData): string {
  const copy = data.copy ?? DEFAULT_COPY;
  const previewText = "Your monthly report from Reddoor";
  const cad = data.cadence;

  // MAINTENANCE CHECKS (first) — intro with the maintenance cadence baked into the copy, then the
  // report's checklist rows. The report-frequency reassurance (announceCadence) trails the LAST
  // check block, so it sits here only when there's no testing block after it. Omitted when None.
  const maintenanceSection =
    cad && cad.maintenance !== "None"
      ? `
    <mj-section background-color="#F4F4F4" padding-top="${SECTION_PAD}" padding-bottom="0px">
      <mj-column>
        ${sectionLabel("MAINTENANCE CHECKS")}
        ${bodyLine(`${copy.maintenanceIntro} We do this ${FREQ_PHRASE[cad.maintenance]}.${cad.testing === "None" ? ` ${copy.announceCadence}` : ""}`)}
      </mj-column>
    </mj-section>${checklistRowsSection(copy.maintenanceChecks, {
      background: "#F4F4F4",
      lastPaddingBottom: SECTION_PAD,
    })}`
      : "";

  // TESTING (second) — intro with the testing cadence + the report-frequency note baked in, then
  // the report's checklist rows. Omitted when None.
  const testingSection =
    cad && cad.testing !== "None"
      ? `
    <mj-section background-color="white" padding-top="${SECTION_PAD}" padding-bottom="0px">
      <mj-column>
        ${sectionLabel("TESTING")}
        ${bodyLine(`${copy.testingIntro} We run a full test ${FREQ_PHRASE[cad.testing]}. ${copy.announceCadence}`)}
      </mj-column>
    </mj-section>${checklistRowsSection(copy.testingChecklist, {
      background: "white",
      lastPaddingBottom: SECTION_PAD,
    })}`
      : "";

  // ANALYTICS — the report's big user count + trend, plus the Google search-position line.
  const analytics = analyticsSection({
    current: data.gaUsersCurrent,
    previous: data.gaUsersPrevious,
    background: "white",
    pad: SECTION_PAD,
    bodyLines:
      data.searchPosition !== undefined
        ? [`Page 1 Google result (#${data.searchPosition}) for your brand search`]
        : [],
  });

  // RECENT IMPROVEMENTS — the toggled callouts, closed by the open-door invitation. Omitted
  // entirely when there are no improvements (the open-door rides along with this block).
  const improvementItems: string[] = [];
  if (data.improvements?.resendForms) improvementItems.push(copy.announceImprovementResend);
  if (data.improvements?.svelte5) improvementItems.push(copy.announceImprovementSvelte5);
  const improvementsSection =
    improvementItems.length > 0
      ? `
    <mj-section background-color="#F4F4F4" padding-top="${SECTION_PAD}" padding-bottom="${SECTION_PAD}">
      <mj-column>
        ${sectionLabel("RECENT IMPROVEMENTS")}
        ${improvementItems.map((item) => bodyLine(item)).join("\n        ")}
        ${bodyLine(copy.announceOpenDoor, "16px")}
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
    <mj-section background-color="white" padding-top="${SECTION_PAD}" padding-bottom="${SECTION_PAD}">
      <mj-column>
        ${sectionLabel(copy.announceHeading)}
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="20px">Prepared for ${escapeXml(data.siteName)}</mj-text>
        ${bodyLine(copy.announceBody)}
      </mj-column>
    </mj-section>
    ${maintenanceSection}
    ${testingSection}
    ${lighthouseScoresSection(data.lighthouse, { pad: SECTION_PAD })}
    ${analytics}
    ${improvementsSection}
    <mj-section background-color="white" padding-top="${SECTION_PAD}" padding-bottom="${SECTION_PAD}">
      <mj-column>
        <mj-text color="${RED}" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" padding-top="0px" line-height="36px">Any questions, concerns or requests?</mj-text>
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
