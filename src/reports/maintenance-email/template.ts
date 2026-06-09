import type { ReportData } from "../types.js";
import { CHECK_CID, BLURRED_CID } from "./assets/index.js";

// Bundled images: shipped in dist/ via tsup onSuccess copy, attached inline via
// CID by orchestrate.ts at send time. No external CDN dependency.
const CHECK_PNG = `cid:${CHECK_CID}`;
const BLURRED_TESTS = `cid:${BLURRED_CID}`;

function fmtDate(d: Date | null): string {
  if (!d) return "";
  // Airtable date fields are wall-clock YYYY-MM-DD strings parsed as UTC midnight.
  // Use UTC accessors so the rendered date matches what the operator entered.
  // US format: MM.DD.YYYY (Reddoor is Texas-based, clients are US).
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}.${dd}.${yyyy}`;
}

function fmtUsers(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Escape operator/site-controlled strings before interpolating into the MJML markup.
 * MJML parses as XML with `validationLevel: "strict"`, so a raw `&`, `<`, `>`, or `"`
 * in a site name (e.g. "Brown & Co"), URL, or commentary throws at render time and blocks
 * the send. Apply to every interpolation of siteName / siteUrl / commentary.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TREND_UP = "#2E7D32"; // positive green — growth reads as good
const TREND_NEUTRAL = "#757575"; // muted grey — dips/flat aren't failures (and brand red is reserved)

function trendText(color: string, text: string): string {
  return `<mj-text color="${color}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">${text}</mj-text>`;
}

/**
 * The line under "{N} Users": a directional trend vs the previous period when both numbers
 * are real, else a graceful fallback. `undefined` means GA was unavailable (distinct from a
 * real 0). Up = green; down/flat = muted grey (a traffic dip isn't a failure).
 */
function analyticsTrendLine(cur: number | undefined, prev: number | undefined): string {
  if (cur === undefined || prev === undefined) {
    // GA unavailable for one/both — show the prior count if we have it, else an em dash.
    return trendText(TREND_NEUTRAL, `Last Period: ${prev !== undefined ? fmtUsers(prev) : "—"}`);
  }
  if (prev === 0) {
    return cur > 0
      ? trendText(TREND_UP, "▲ New this period (0 last period)")
      : trendText(TREND_NEUTRAL, "Last Period: 0");
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  const range = `(${fmtUsers(prev)} → ${fmtUsers(cur)})`;
  if (pct > 0) return trendText(TREND_UP, `▲ ${pct}% vs last period ${range}`);
  if (pct < 0) return trendText(TREND_NEUTRAL, `▼ ${Math.abs(pct)}% vs last period ${range}`);
  return trendText(TREND_NEUTRAL, `No change vs last period (${fmtUsers(prev)})`);
}

function maintenanceChecksSection(searchPosition?: number): string {
  const googleLabel =
    searchPosition !== undefined ? `Page 1 Google Result (#${searchPosition})` : "Google Indexed";
  const rows = [
    "Reviewed Logs",
    "CMS Checked",
    "DNS Checked",
    googleLabel,
    "Reviewed Certificate",
    "Security Updates",
  ];
  return rows
    .map(
      (label, i) => `
    <mj-section background-color="white" padding="0px"${i === rows.length - 1 ? ' padding-bottom="36px"' : ""}>
      <mj-group>
        <mj-column padding-left="0px" width="90%"${i < rows.length - 1 ? ' border-bottom="solid #CCCCCC 1px"' : ""}>
          <mj-text height="25px" padding-left="0px" color="#757575" padding-top="20px" padding-bottom="7.5px" font-size="16px">${label}</mj-text>
        </mj-column>
        <mj-column width="10%"${i < rows.length - 1 ? ' border-bottom="solid #CCCCCC 1px"' : ""} padding-top="15px">
          <mj-image align="right" padding-right="0px" width="20px" height="20px" padding-top="2.5px" padding-bottom="15px" src="${CHECK_PNG}" />
        </mj-column>
      </mj-group>
    </mj-section>`,
    )
    .join("");
}

function testingChecklistSection(): string {
  const rows = [
    "Desktop Browsers",
    "Mobile Browsers",
    "Package Updates",
    "Bottlenecks",
    "Form Functionality",
    "Animation Functionality",
  ];
  return rows
    .map(
      (label, i) => `
    <mj-section background-color="#F4F4F4" padding="0px"${i === rows.length - 1 ? ' padding-bottom="60px"' : ""}>
      <mj-group>
        <mj-column width="90%" padding-left="0px"${i < rows.length - 1 ? ' border-bottom="solid #CCCCCC 1px"' : ""}>
          <mj-text height="25px" padding-left="0px" color="#757575" padding-top="20px" padding-bottom="7.5px" font-size="16px">${label}</mj-text>
        </mj-column>
        <mj-column width="10%"${i < rows.length - 1 ? ' border-bottom="solid #CCCCCC 1px"' : ""} padding-top="15px">
          <mj-image align="right" padding-right="0px" width="20px" height="20px" padding-top="2.5px" padding-bottom="15px" src="${CHECK_PNG}" />
        </mj-column>
      </mj-group>
    </mj-section>`,
    )
    .join("");
}

function maintenanceTestingPlaceholder(lastTested: Date | null): string {
  return `
    <mj-section background-color="#F4F4F4">
      <mj-column>
        <mj-image href="mailto:info@reddoorla.com" src="${BLURRED_TESTS}" />
      </mj-column>
    </mj-section>
    <mj-section background-color="#F4F4F4" padding-top="0px">
      <mj-column>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">Last Tested: ${fmtDate(lastTested)}</mj-text>
      </mj-column>
    </mj-section>`;
}

function testingIntroSection(): string {
  return `
    <mj-section background-color="#F4F4F4">
      <mj-column>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="75px">TESTING</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">Testing includes checks similar to those at launch: testing on common browsers and operating systems, at different screen sizes, and checking every function, and updating all packages for performance rather than just those needed for security.</mj-text>
      </mj-column>
    </mj-section>`;
}

function commentarySection(text: string): string {
  return `
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="55px">NOTES</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">${escapeXml(text).replace(/\n/g, "<br/>")}</mj-text>
      </mj-column>
    </mj-section>`;
}

function hasHeaderDims(
  data: ReportData,
): data is ReportData & { headerWidth: number; headerHeight: number; headerBgColor: string } {
  return Boolean(data.headerWidth && data.headerHeight && data.headerBgColor);
}

function headerImageTag(data: ReportData): string {
  const src = `cid:${data.headerImageCid}`;
  const alt = `${escapeXml(data.siteName)} maintenance report`;
  const href = escapeXml(data.siteUrl);
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

function headerStyleBlock(data: ReportData): string {
  if (!hasHeaderDims(data)) return "";
  // Reserve the header's vertical space by aspect ratio so it scales proportionally with
  // its fluid (width:100%) width — no fixed pixel height, so it never squishes.
  // `height:auto !important` defends against any client honoring MJML's inline height.
  return `<mj-style>.rd-header img { height: auto !important; aspect-ratio: ${data.headerWidth} / ${data.headerHeight}; }</mj-style>`;
}

export function buildMjml(data: ReportData): string {
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
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px">Includes checking the hosting, DNS, Content Management System (CMS, if applicable), search indexing and security of the site for major flaws and updating as necessary.</mj-text>
      </mj-column>
    </mj-section>
    ${maintenanceChecksSection(data.searchPosition)}
    <mj-section background-color="#F4F4F4">
      <mj-column>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="55px">LIGHTHOUSE SCORES*</mj-text>
        <mj-text color="#C00" font-size="20px" font-weight="300" padding-top="25px">Performance</mj-text>
        <mj-text color="#C00" font-size="44px" font-weight="400" padding-top="0px">${data.lighthouse.performance}</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="0px" padding-bottom="36px">Acceptable 50–89 // Ideal 90–100</mj-text>
        <mj-divider border-width="1px" border-style="solid" border-color="#CCCCCC" padding="0" />
        <mj-text color="#C00" font-size="20px" font-weight="300" padding-top="25px">Readability</mj-text>
        <mj-text color="#C00" font-size="44px" font-weight="400" padding-top="0px">${data.lighthouse.accessibility}</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="0px" padding-bottom="36px">Acceptable 80–99 // Ideal 100</mj-text>
        <mj-divider border-width="1px" border-style="solid" border-color="#CCCCCC" padding="0" />
        <mj-text color="#C00" font-size="20px" font-weight="300" padding-top="25px">Best Practices</mj-text>
        <mj-text color="#C00" font-size="44px" font-weight="400" padding-top="0px">${data.lighthouse.bestPractices}</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="0px" padding-bottom="36px">Acceptable 60–79 // Ideal 80–92</mj-text>
        <mj-divider border-width="1px" border-style="solid" border-color="#CCCCCC" padding="0" />
        <mj-text color="#C00" font-size="20px" font-weight="300" padding-top="25px">Site Structure</mj-text>
        <mj-text color="#C00" font-size="44px" font-weight="400" padding-top="0px">${data.lighthouse.seo}</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="0px" padding-bottom="36px">Acceptable 50–89 // Ideal 90–100</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" padding-bottom="36px" line-height="20px">*A Lighthouse score is a numerical measure provided by Google's Lighthouse tool, which evaluates various aspects of a web page's quality.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="#C00" font-size="20px" font-weight="700" padding-top="75px">ANALYTICS</mj-text>
        <mj-text color="#C00" font-size="44px" font-weight="400">${data.gaUsersCurrent !== undefined ? fmtUsers(data.gaUsersCurrent) : "—"} Users</mj-text>
        ${analyticsTrendLine(data.gaUsersCurrent, data.gaUsersPrevious)}
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" padding-bottom="36px" line-height="20px">Contact us if you are interested in more in-depth data or have questions about SEO.</mj-text>
      </mj-column>
    </mj-section>
    ${isTesting ? testingIntroSection() + testingChecklistSection() : maintenanceTestingPlaceholder(data.lastTestedDate)}
    ${data.commentary ? commentarySection(data.commentary) : ""}
    <mj-section background-color="white">
      <mj-column padding-top="36px">
        <mj-text color="#C00" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" padding-top="36px" line-height="36px">Any questions, concerns or requests?</mj-text>
        <mj-text font-family="helvetica, sans-serif" font-size="24px" font-weight="300" line-height="30px">Just hit reply.</mj-text>
        <mj-text font-family="helvetica, sans-serif" font-size="24px" font-weight="300" padding-top="0px" line-height="30px" padding-bottom="36px">We're here to help in any way we can.</mj-text>
        <mj-divider border-width="1px" border-style="solid" border-color="#CCCCCC" padding="0" />
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" line-height="20px" font-style="italic">Copyright ${new Date().getUTCFullYear()} Reddoor Creative, LLC. All rights reserved.</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="700" line-height="16px" padding-top="0" padding-bottom="0px">Our mailing address is:</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">Reddoor Creative, LLC</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">29027 Dapper Dan</mj-text>
        <mj-text color="#757575" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">Fair Oaks Ranch, TX 78015</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
