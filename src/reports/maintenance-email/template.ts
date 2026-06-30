import type { ReportData } from "../types.js";
import { DEFAULT_COPY, type ResolvedCopy } from "../copy.js";
import { BLURRED_CID } from "./assets/index.js";
import {
  checklistRowsSection,
  lighthouseScoresSection,
  analyticsSection,
} from "../email-sections.js";
import { escapeHtml } from "../../util/html.js";
import { isHttpUrl } from "../../util/url.js";

/**
 * Escape operator/site-controlled strings before interpolating into the MJML markup.
 * MJML parses as XML with `validationLevel: "strict"`. Under mjml@4.18 a raw `&`, `<`,
 * or `>` does NOT throw — it passes straight through into the rendered output, so an
 * unescaped value (e.g. a site name "Brown & Co", a URL, or commentary) silently
 * injects HTML/markup into the email. A raw `"` inside an ATTRIBUTE value (e.g. the
 * image `href`/`alt`) is the one that throws — it terminates the attribute and trips a
 * parse error that blocks the send. So we escape for two reasons: prevent
 * HTML/markup injection in text, and prevent the attribute-quote parse error. Apply
 * to every interpolation of siteName / siteUrl / commentary / copy.
 *
 * This IS `src/util/html.ts`'s `escapeHtml` (the strict-XML set is identical),
 * re-exported under the name the email templates import (the launch template imports
 * `escapeXml` from here).
 */
export const escapeXml = escapeHtml;

// Bundled images: shipped in dist/ via tsup onSuccess copy, attached inline via
// CID by orchestrate.ts at send time. No external CDN dependency. (The green check
// image lives in the shared email-sections checklist component.)
const BLURRED_TESTS = `cid:${BLURRED_CID}`;

export function fmtDate(d: Date | null): string {
  // Guard BOTH null AND an Invalid Date — `new Date("not-a-date")` (a malformed
  // Airtable date string) is a truthy Date whose getUTC* accessors all return
  // NaN, which would render "NaN.NaN.NaN" into a real client email. `!d` alone
  // misses it; `Number.isNaN(d.getTime())` catches it.
  if (!d || Number.isNaN(d.getTime())) return "";
  // Airtable date fields are wall-clock YYYY-MM-DD strings parsed as UTC midnight.
  // Use UTC accessors so the rendered date matches what the operator entered.
  // US format: MM.DD.YYYY (Reddoor is Texas-based, clients are US).
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}.${dd}.${yyyy}`;
}

function maintenanceChecksSection(copy: ResolvedCopy, searchPosition?: number): string {
  // The Google row shows the live search position when available, else the plain label.
  const googleLabel =
    searchPosition !== undefined
      ? `Page 1 Google Result (#${searchPosition})`
      : (copy.maintenanceChecks[3] ?? "");
  const rows = copy.maintenanceChecks.map((label, i) => (i === 3 ? googleLabel : label));
  return checklistRowsSection(rows, { background: "white", lastPaddingBottom: "36px" });
}

function testingChecklistSection(copy: ResolvedCopy): string {
  return checklistRowsSection(copy.testingChecklist, {
    background: "#F4F4F4",
    lastPaddingBottom: "60px",
  });
}

function maintenanceTestingPlaceholder(): string {
  return `
    <mj-section background-color="#F4F4F4">
      <mj-column>
        <mj-image href="mailto:info@reddoorla.com" src="${BLURRED_TESTS}" />
      </mj-column>
    </mj-section>`;
}

function testingIntroSection(copy: ResolvedCopy): string {
  return `
    <mj-section background-color="#F4F4F4">
      <mj-column>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="75px">TESTING</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">${escapeXml(copy.testingIntro)}</mj-text>
      </mj-column>
    </mj-section>`;
}

function commentarySection(text: string, copy: ResolvedCopy): string {
  return `
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="55px">${escapeXml(copy.notesHeader)}</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">${escapeXml(text).replace(/\r\n?|\n/g, "<br/>")}</mj-text>
      </mj-column>
    </mj-section>`;
}

function hasHeaderDims(
  data: ReportData,
): data is ReportData & { headerWidth: number; headerHeight: number; headerBgColor: string } {
  return Boolean(data.headerWidth && data.headerHeight && data.headerBgColor);
}

export function headerImageTag(data: ReportData): string {
  const src = `cid:${data.headerImageCid}`;
  const alt = `${escapeXml(data.siteName)} maintenance report`;
  // escapeXml only escapes markup chars — it does NOT neutralize a dangerous URL
  // scheme. A `javascript:`/`data:` siteUrl would survive escaping and become a live
  // header href. Gate on isHttpUrl (the same http(s) allowlist the audit path uses)
  // and DROP a non-http(s) href entirely (fall back to "#") rather than linking it.
  const href = isHttpUrl(data.siteUrl) ? escapeXml(data.siteUrl) : "#";
  // Reserve the box and show a matched placeholder while the image loads / if blocked.
  // Critically, we do NOT set an mj-image `height` — MJML would emit `height:<px>` while
  // keeping `width:100%`, locking the height while the width scales and distorting the
  // image at any rendered width != the design width (mobile, narrow panes). Instead the
  // image stays `height:auto` (proportional) and the box is reserved via `aspect-ratio`
  // in the head <mj-style> below (see headerStyleBlock). `container-background-color` is
  // the placeholder; the bare fallback (no dims, e.g. local preview) keeps today's behavior.
  if (hasHeaderDims(data)) {
    return `<mj-image href="${href}" src="${src}" alt="${alt}" width="${data.headerWidth}px" css-class="rd-header" container-background-color="${data.headerBgColor}" />`;
  }
  return `<mj-image href="${href}" src="${src}" alt="${alt}" />`;
}

export function headerStyleBlock(data: ReportData): string {
  if (!hasHeaderDims(data)) return "";
  // Reserve the header's vertical space by aspect ratio so it scales proportionally with
  // its fluid (width:100%) width — no fixed pixel height, so it never squishes.
  // `height:auto !important` defends against any client honoring MJML's inline height.
  return `<mj-style>.rd-header img { height: auto !important; aspect-ratio: ${data.headerWidth} / ${data.headerHeight}; }</mj-style>`;
}

export function buildMjml(data: ReportData): string {
  const copy = data.copy ?? DEFAULT_COPY;
  const isTesting = data.reportType === "Testing";
  const previewText = `Checked up on ${escapeXml(data.siteName)}`;

  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-text font-family="helvetica, sans-serif" padding-left="5px" padding-right="5px" />
      <mj-section padding-left="11%" padding-right="11%"/>
      <mj-image padding="0px" />
    </mj-attributes>
    <mj-preview>${previewText}</mj-preview>
    ${headerStyleBlock(data)}
  </mj-head>
  <mj-body background-color="white">
    <mj-section background-color="#F4F4F4" padding-top="0px" padding-bottom="0px" padding-left="0px" padding-right="0px">
      <mj-column>
        ${headerImageTag(data)}
      </mj-column>
    </mj-section>
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="75px">COMPLETED ON</mj-text>
        <mj-text color="#C00" font-size="44px" font-weight="400">${fmtDate(data.completedOn)}</mj-text>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="75px">MAINTENANCE CHECKS</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">${escapeXml(copy.maintenanceIntro)}</mj-text>
      </mj-column>
    </mj-section>
    ${maintenanceChecksSection(copy, data.searchPosition)}
    ${lighthouseScoresSection(data.lighthouse)}
    ${analyticsSection({
      current: data.gaUsersCurrent,
      previous: data.gaUsersPrevious,
      periodDays: data.gaPeriodDays,
      background: "white",
      footnoteLines: [escapeXml(copy.seoCta)],
    })}
    ${isTesting ? testingIntroSection(copy) + testingChecklistSection(copy) : maintenanceTestingPlaceholder()}
    ${data.commentary ? commentarySection(data.commentary, copy) : ""}
    <mj-section background-color="white">
      <mj-column padding-top="36px">
        <mj-text color="#C00" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" padding-top="36px" line-height="36px">Any questions, concerns or requests?</mj-text>
        ${copy.contact
          .map((line, i) => {
            // First line ("Just hit reply.") renders as a red bold heading, matching the
            // "Any questions, concerns or requests?" title above it; the last line keeps
            // its closing padding.
            const isLast = i === copy.contact.length - 1;
            const emphasis =
              i === 0
                ? `color="#C00" font-family="helvetica, sans-serif" font-size="24px" font-weight="700"`
                : `font-family="helvetica, sans-serif" font-size="24px" font-weight="300"`;
            return isLast
              ? `<mj-text ${emphasis} padding-top="0px" line-height="30px" padding-bottom="36px">${escapeXml(line)}</mj-text>`
              : `<mj-text ${emphasis} line-height="30px">${escapeXml(line)}</mj-text>`;
          })
          .join("\n        ")}
        <mj-divider border-width="1px" border-style="solid" border-color="#CCCCCC" padding="0" />
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" line-height="20px" font-style="italic">Copyright ${new Date().getUTCFullYear()} ${escapeXml(copy.footerOrg)}. All rights reserved.</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="700" line-height="16px" padding-top="0" padding-bottom="0px">Our mailing address is:</mj-text>
        ${[copy.footerOrg, ...copy.footerAddress]
          .map(
            (line) =>
              `<mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">${escapeXml(line)}</mj-text>`,
          )
          .join("\n        ")}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
