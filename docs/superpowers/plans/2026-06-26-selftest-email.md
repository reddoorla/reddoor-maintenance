# selftest email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a supported `selftest email [site]` CLI command that previews any report email (announcement/maintenance/testing/launch) for any site to the operator — real inbox, real images — with zero Airtable side effects.

**Architecture:** Faithfulness via a shared **render seam**: extract `ReportData → {html, attachments, subject}` into `renderReportEmail`, used by both the production send path (`sendOne`) and the new self-test, so the previewed email matches what production sends. A shared `defaultReportSubject` (also adopted by the `announce` recipe) keeps subjects from drifting. The self-test assembles `ReportData` from the **Websites** row via `buildReportDataForSite`, reusing the existing enrichment helpers (`fetchGaUsers`/`fetchSearch`, `announcementSiteExtras`, `resolveCopy`).

**Tech Stack:** TypeScript ESM (`.js` import specifiers), vitest, CAC (CLI), Resend, MJML render, Airtable (read-only here), changesets.

**Refinement vs spec:** The `announce` recipe adopts **`defaultReportSubject`** only (not `buildReportDataForSite`). Its inline `ReportData` assembly stays put because it also needs the raw GA/search values for the Airtable draft write and intentionally renders the draft preview without header dimensions — sharing the full builder would change that behavior. The faithfulness guarantee (render + attachments + subject identical to production) is unchanged.

---

## File Structure

- **Create `src/reports/subject.ts`** — `defaultReportSubject` + the moved `monthYear`/`MONTHS`. One responsibility: compute a report email's subject per type.
- **Create `src/reports/send/render-email.ts`** — `renderReportEmail` (the shared seam) + `InlineAttachment`/`PreparedHeader`/`RenderedReportEmail` types + the moved `toInlineAttachment`. One responsibility: turn a `ReportData` + prepared header into the final `{html, attachments, subject}`.
- **Create `src/reports/report-data.ts`** — `scoresFromRow` (moved from `announce.ts`) + `buildReportDataForSite`. One responsibility: assemble `ReportData` from a Websites row for a given report type.
- **Create `src/recipes/selftest-email.ts`** — `selftestEmail(deps)`: resolve target site(s), build + render + send (or dry-run) each, no Airtable writes.
- **Create `src/cli/commands/selftest.ts`** — `runSelftestCommand(kind, site, opts)`: validate, format, delegate to `selftestEmail`.
- **Modify `src/reports/send/orchestrate.ts`** — `sendOne` calls `renderReportEmail`; remove the now-moved helpers/imports.
- **Modify `src/recipes/announce.ts`** — use `defaultReportSubject` for the subject; use `scoresFromRow` from `report-data.ts`.
- **Modify `src/cli/bin.ts`** — register `selftest <kind> [site]`.
- Tests: `tests/reports/subject.test.ts`, `tests/reports/send/render-email.test.ts`, `tests/reports/report-data.test.ts`, `tests/recipes/selftest-email.test.ts`, `tests/cli/selftest-command.test.ts`.

---

## Task 1: `defaultReportSubject` + move `monthYear`

**Files:**

- Create: `src/reports/subject.ts`
- Test: `tests/reports/subject.test.ts`
- Modify: `src/reports/send/orchestrate.ts` (use it in `sendOne`, drop `monthYear`/`MONTHS`)
- Modify: `src/recipes/announce.ts` (use it for `subjectOverride`, drop local `siteLabel`)

- [ ] **Step 1: Write the failing test**

Create `tests/reports/subject.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defaultReportSubject } from "../../src/reports/subject.js";

const DATE = new Date("2026-05-26T12:00:00Z");

describe("defaultReportSubject", () => {
  it("announcement: full name with bare (www-stripped) domain", () => {
    expect(
      defaultReportSubject({
        name: "Acme Co",
        url: "https://www.acme.example.com/",
        type: "Announcement",
        date: DATE,
      }),
    ).toBe("Your testing & maintenance report for Acme Co (acme.example.com)");
  });
  it("announcement: falls back to name alone when the URL can't be parsed", () => {
    expect(
      defaultReportSubject({ name: "Acme Co", url: "not a url", type: "Announcement", date: DATE }),
    ).toBe("Your testing & maintenance report for Acme Co");
  });
  it("maintenance/testing: name — Month YYYY Type Report (UTC)", () => {
    expect(
      defaultReportSubject({ name: "Acme Co", url: "x", type: "Maintenance", date: DATE }),
    ).toBe("Acme Co — May 2026 Maintenance Report");
    expect(defaultReportSubject({ name: "Acme Co", url: "x", type: "Testing", date: DATE })).toBe(
      "Acme Co — May 2026 Testing Report",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/reports/subject.test.ts`
Expected: FAIL — cannot find module `../../src/reports/subject.js`.

- [ ] **Step 3: Create `src/reports/subject.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/reports/subject.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Adopt it in `orchestrate.ts` (drop `monthYear`/`MONTHS`)**

In `src/reports/send/orchestrate.ts`:

1. Delete the `MONTHS` array (the `const MONTHS = [ ... ];` block, ~lines 39–52) and the `monthYear` function (~lines 54–57).
2. Add an import near the other `../` imports:

```ts
import { defaultReportSubject } from "../subject.js";
```

3. Replace the subject computation in `sendOne` (currently):

```ts
const reportDate = report.completedOn ? new Date(report.completedOn) : new Date();
const subject =
  report.subjectOverride ?? `${site.name} — ${monthYear(reportDate)} ${report.reportType} Report`;
```

with:

```ts
const subject =
  report.subjectOverride ??
  defaultReportSubject({
    name: site.name,
    url: site.url,
    type: report.reportType,
    date: report.completedOn ? new Date(report.completedOn) : new Date(),
  });
```

- [ ] **Step 6: Adopt it in `announce.ts` (drop local `siteLabel`)**

In `src/recipes/announce.ts`:

1. Add an import near the other `../reports/` imports:

```ts
import { defaultReportSubject } from "../reports/subject.js";
```

2. Delete the local `siteLabel` function (the `function siteLabel(w: WebsiteRow): string { ... }` block).
3. Replace the subject line in `draftInputFor` (currently):

```ts
    subjectOverride: `Your testing & maintenance report for ${siteLabel(w)}`,
```

with:

```ts
    subjectOverride: defaultReportSubject({
      name: w.name,
      url: w.url,
      type: "Announcement",
      date: now,
    }),
```

- [ ] **Step 7: Run the affected suites — all green (behavior-preserving)**

Run: `pnpm vitest run tests/reports/subject.test.ts tests/reports/send/orchestrate.test.ts tests/recipes/announce.test.ts`
Expected: PASS. (`orchestrate.test.ts` still asserts `"Acme Co — May 2026 Maintenance Report"` and `"Custom Subject"`; `announce.test.ts` still asserts `"Your testing & maintenance report for Acme Co (acme.example.com)"`.)

- [ ] **Step 8: Commit**

```bash
git add src/reports/subject.ts tests/reports/subject.test.ts src/reports/send/orchestrate.ts src/recipes/announce.ts
git commit -m "refactor(reports): extract defaultReportSubject (shared by send + announce)"
```

---

## Task 2: `renderReportEmail` shared seam

**Files:**

- Create: `src/reports/send/render-email.ts`
- Test: `tests/reports/send/render-email.test.ts`
- Modify: `src/reports/send/orchestrate.ts` (call the seam; drop moved helpers/imports)

- [ ] **Step 1: Write the failing test**

Create `tests/reports/send/render-email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderReportEmail, type PreparedHeader } from "../../../src/reports/send/render-email.js";
import type { ReportData } from "../../../src/reports/types.js";

const HEADER: PreparedHeader = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "image/jpeg",
  displayWidth: 600,
  displayHeight: 200,
  placeholderColor: "#eee",
};

function reportData(over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: "Maintenance",
    completedOn: new Date("2026-05-26T12:00:00Z"),
    lighthouse: { performance: 90, accessibility: 100, bestPractices: 82, seo: 95 },
    gaUsersCurrent: 12345,
    gaUsersPrevious: 6789,
    lastTestedDate: new Date("2025-01-01T00:00:00Z"),
    commentary: null,
    headerImageCid: "acme-co-header",
    headerWidth: HEADER.displayWidth,
    headerHeight: HEADER.displayHeight,
    headerBgColor: HEADER.placeholderColor,
    ...over,
  };
}

describe("renderReportEmail", () => {
  it("always attaches the header, and gates bundled images on the cid appearing in the HTML", async () => {
    const { html, attachments } = await renderReportEmail(reportData(), {
      header: HEADER,
      cidName: "acme-co-header",
    });
    const cids = attachments.map((a) => a.inlineContentId);
    expect(cids).toContain("acme-co-header"); // header always
    // Maintenance renders the green check and the blurred-tests image, so both attach.
    expect(cids).toContain("rd-check-png");
    expect(html).toContain("ANALYTICS"); // sanity: it actually rendered the report
  });

  it("does not attach a bundled image the HTML doesn't reference (Launch has no check)", async () => {
    const { attachments } = await renderReportEmail(reportData({ reportType: "Launch" }), {
      header: HEADER,
      cidName: "acme-co-header",
    });
    const cids = attachments.map((a) => a.inlineContentId);
    expect(cids).toEqual(["acme-co-header"]); // header only
  });

  it("uses defaultReportSubject when no override is given", async () => {
    const { subject } = await renderReportEmail(reportData(), {
      header: HEADER,
      cidName: "acme-co-header",
    });
    expect(subject).toBe("Acme Co — May 2026 Maintenance Report");
  });

  it("prefers an explicit subjectOverride", async () => {
    const { subject } = await renderReportEmail(reportData(), {
      header: HEADER,
      cidName: "acme-co-header",
      subjectOverride: "Custom Subject",
    });
    expect(subject).toBe("Custom Subject");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/reports/send/render-email.test.ts`
Expected: FAIL — cannot find module `render-email.js`.

- [ ] **Step 3: Create `src/reports/send/render-email.ts`**

```ts
import { renderReportHtml } from "../render.js";
import { loadBundledImages } from "../maintenance-email/assets/index.js";
import { defaultReportSubject } from "../subject.js";
import type { ReportData } from "../types.js";
import type { ResendSendInput } from "./resend.js";

/** A single Resend inline attachment (CID-referenced). */
export type InlineAttachment = NonNullable<ResendSendInput["attachments"]>[number];

/** The downscaled header image + display metadata produced by `prepareHeaderImage`. */
export type PreparedHeader = {
  bytes: Uint8Array;
  contentType: string;
  displayWidth: number;
  displayHeight: number;
  placeholderColor: string;
};

export type RenderedReportEmail = {
  html: string;
  attachments: InlineAttachment[];
  subject: string;
};

/** Build a Resend inline (CID-referenced) attachment from raw bytes — the header image and both
 *  bundled images share this exact shape. */
function toInlineAttachment(a: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  cid: string;
}): InlineAttachment {
  return {
    filename: a.filename,
    content: Buffer.from(a.bytes).toString("base64"),
    contentType: a.contentType,
    inlineContentId: a.cid,
  };
}

/**
 * Render a report email from fully-assembled `ReportData`: produce the HTML, the gated inline
 * attachments, and the subject. The per-site header attaches always; the two bundled images
 * (`rd-check-png`, `rd-blurred-tests-jpg`) attach only when their cid actually appears in the
 * rendered HTML (a dangling inline part shows as a stray download in some clients). The subject
 * is `subjectOverride` when given, else `defaultReportSubject`. Shared by the production send path
 * (`sendOne`) and the `selftest` command so the rendered email, attachments, and subject can't
 * drift between them. The only I/O is `loadBundledImages` (a disk read of two bundled images).
 */
export async function renderReportEmail(
  reportData: ReportData,
  ctx: { header: PreparedHeader; cidName: string; subjectOverride?: string },
): Promise<RenderedReportEmail> {
  const { html } = await renderReportHtml(reportData);
  const bundled = await loadBundledImages();
  const attachments: InlineAttachment[] = [
    toInlineAttachment({
      bytes: ctx.header.bytes,
      filename: `${ctx.cidName}.jpg`,
      contentType: ctx.header.contentType,
      cid: ctx.cidName,
    }),
  ];
  for (const img of [bundled.check, bundled.blurred]) {
    if (html.includes(`cid:${img.cid}`)) {
      attachments.push(
        toInlineAttachment({
          bytes: img.bytes,
          filename: img.filename,
          contentType: img.contentType,
          cid: img.cid,
        }),
      );
    }
  }
  const subject =
    ctx.subjectOverride ??
    defaultReportSubject({
      name: reportData.siteName,
      url: reportData.siteUrl,
      type: reportData.reportType,
      date: reportData.completedOn,
    });
  return { html, attachments, subject };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/reports/send/render-email.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor `sendOne` to use the seam**

In `src/reports/send/orchestrate.ts`:

1. Remove the `InlineAttachment` type alias (`type InlineAttachment = NonNullable<...>;`, ~line 68) and the `toInlineAttachment` function (~lines 70–84).
2. Update imports: remove `import { renderReportHtml } from "../render.js";` and `import { loadBundledImages } from "../maintenance-email/assets/index.js";`. Add:

```ts
import { renderReportEmail } from "./render-email.js";
import type { ReportData } from "../types.js";
```

3. In `sendOne`, delete the `const bundled = await loadBundledImages();` line (~line 210).
4. Replace the whole block from `const { html } = await renderReportHtml({` (~line 220) through the end of the `attachments` array construction (~line 275) — i.e. the render call, the `subject` computation, and the `const attachments: InlineAttachment[] = [ ... ]` loop — with:

```ts
const gaPeriodDays =
  report.reportType === "Announcement" ? 30 : windowDays(report.periodStart, report.periodEnd);
const reportData: ReportData = {
  siteName: site.name,
  siteUrl: site.url,
  reportType: report.reportType,
  completedOn: report.completedOn ? new Date(report.completedOn) : new Date(),
  lighthouse: report.lighthouse,
  gaUsersCurrent: report.gaUsersCurrent ?? undefined,
  gaUsersPrevious: report.gaUsersPrevious ?? undefined,
  gaPeriodDays,
  searchPosition:
    report.searchFoundPage1 && report.searchPosition !== null ? report.searchPosition : undefined,
  lastTestedDate: report.lastTestedDate ? new Date(report.lastTestedDate) : null,
  commentary: report.commentary,
  copy: resolveCopy(site),
  headerImageCid: cidName,
  headerWidth: header.displayWidth,
  headerHeight: header.displayHeight,
  headerBgColor: header.placeholderColor,
  // Announcement-only: re-derive cadence + improvements from the site row so the SENT email
  // keeps its cadence copy + improvement callouts (not stored on the Reports row).
  ...(report.reportType === "Announcement" ? announcementSiteExtras(site) : {}),
};
const { html, attachments, subject } = await renderReportEmail(reportData, {
  header,
  cidName,
  subjectOverride: report.subjectOverride ?? undefined,
});
```

Notes:

- The old `const gaPeriodDays = ...` (~line 218) is now inside this block — delete the original standalone declaration so it isn't declared twice.
- The old `const reportDate = ...` and `const subject = report.subjectOverride ?? ...` lines are removed (subject now comes from `renderReportEmail`).
- The `payload` object below is unchanged: it already references `subject`, `html`, and `attachments`, which are now destructured from `renderReportEmail`.
- `windowDays`, `FROM_ADDRESS`, `REPLY_TO`, `withGlobalCc`, `prepareHeaderImage`, `fetchAttachmentBytes`, `resolveCopy`, `announcementSiteExtras` all stay.

- [ ] **Step 6: Typecheck + run the send suite (behavior-preserving)**

Run: `pnpm typecheck && pnpm vitest run tests/reports/send/`
Expected: PASS. `orchestrate.test.ts` asserts the same sent HTML markers, attachment cids, and subjects as before.

- [ ] **Step 7: Commit**

```bash
git add src/reports/send/render-email.ts tests/reports/send/render-email.test.ts src/reports/send/orchestrate.ts
git commit -m "refactor(reports): extract renderReportEmail seam (shared render+attachments+subject)"
```

---

## Task 3: `scoresFromRow` + `buildReportDataForSite`

**Files:**

- Create: `src/reports/report-data.ts`
- Test: `tests/reports/report-data.test.ts`
- Modify: `src/recipes/announce.ts` (import `scoresFromRow` from the new module; drop local copy)

- [ ] **Step 1: Write the failing test**

Create `tests/reports/report-data.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { PreparedHeader } from "../../src/reports/send/render-email.js";

// Mock the live GA/Search enrichment (no network in tests). Default: configured + returns data.
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn(),
  fetchSearch: vi.fn(),
}));
import { fetchGaUsers, fetchSearch } from "../../src/reports/draft.js";
import { scoresFromRow, buildReportDataForSite } from "../../src/reports/report-data.js";

const HEADER: PreparedHeader = {
  bytes: new Uint8Array([1]),
  contentType: "image/jpeg",
  displayWidth: 600,
  displayHeight: 200,
  placeholderColor: "#eee",
};
const NOW = new Date("2026-06-26T12:00:00Z");

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "rec1",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    maintenanceFreq: "Monthly",
    testingFreq: "Monthly",
    ga4PropertyId: "123",
    searchQuery: "acme",
    reportRecipientsTo: null,
    headerImage: { url: "https://x/h.jpg", filename: "h.jpg", type: "image/jpeg" },
    pScore: 69,
    rScore: 100,
    bpScore: 100,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-06-20T00:00:00Z",
    ...over,
  } as WebsiteRow;
}

beforeEach(() => {
  vi.mocked(fetchGaUsers).mockResolvedValue({
    value: { current: 280, previous: 275 },
    softFailed: false,
  });
  vi.mocked(fetchSearch).mockResolvedValue({
    value: { foundOnPage1: true, position: 3 },
    softFailed: false,
  });
});

describe("scoresFromRow", () => {
  it("returns the four scores, or null when any is missing", () => {
    expect(scoresFromRow(site())).toEqual({
      performance: 69,
      accessibility: 100,
      bestPractices: 100,
      seo: 100,
    });
    expect(scoresFromRow(site({ pScore: null }))).toBeNull();
  });
});

describe("buildReportDataForSite", () => {
  const scores = { performance: 69, accessibility: 100, bestPractices: 100, seo: 100 };

  it("announcement: GA window 30d + cadence/improvements + header dims", async () => {
    const d = await buildReportDataForSite(site(), "Announcement", NOW, { scores, header: HEADER });
    expect(d.reportType).toBe("Announcement");
    expect(d.gaUsersCurrent).toBe(280);
    expect(d.gaPeriodDays).toBe(30);
    expect(d.searchPosition).toBe(3);
    expect(d.cadence).toEqual({ maintenance: "Monthly", testing: "Monthly" });
    expect(d.improvements).toEqual({ resendForms: true, svelte5: true });
    expect(d.headerWidth).toBe(600);
    expect(d.lastTestedDate).toBeNull(); // announcement has no last-tested line
  });

  it("maintenance: lastTestedDate from the row, GA window, no cadence/improvements", async () => {
    const d = await buildReportDataForSite(site(), "Maintenance", NOW, { scores, header: HEADER });
    expect(d.reportType).toBe("Maintenance");
    expect(d.lastTestedDate).toEqual(new Date("2026-06-20T00:00:00Z"));
    expect(d.gaPeriodDays).toBe(30);
    expect(d.cadence).toBeUndefined();
    expect(d.improvements).toBeUndefined();
  });

  it("launch: no GA fetch at all (launch email shows no analytics)", async () => {
    const d = await buildReportDataForSite(site(), "Launch", NOW, { scores, header: HEADER });
    expect(d.reportType).toBe("Launch");
    expect(d.gaUsersCurrent).toBeUndefined();
    expect(fetchGaUsers).not.toHaveBeenCalled();
  });

  it("omits GA fields when enrichment is unavailable (null)", async () => {
    vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: false });
    vi.mocked(fetchSearch).mockResolvedValue({ value: null, softFailed: false });
    const d = await buildReportDataForSite(site(), "Maintenance", NOW, { scores, header: HEADER });
    expect(d.gaUsersCurrent).toBeUndefined();
    expect(d.searchPosition).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/reports/report-data.test.ts`
Expected: FAIL — cannot find module `report-data.js`.

- [ ] **Step 3: Create `src/reports/report-data.ts`**

```ts
import type { WebsiteRow } from "./airtable/websites.js";
import { siteSlug } from "./airtable/websites.js";
import type { LighthouseScores, ReportData, ReportType } from "./types.js";
import { resolveCopy } from "./copy.js";
import { fetchGaUsers, fetchSearch } from "./draft.js";
import { announcementSiteExtras } from "./announcement-email/template.js";
import type { PreparedHeader } from "./send/render-email.js";

/** The traffic/search lookback window (days) used for report-email previews. */
const PREVIEW_WINDOW_DAYS = 30;

/** The four stored Lighthouse scores off a Websites row, or null if ANY is missing. */
export function scoresFromRow(site: WebsiteRow): LighthouseScores | null {
  if (
    site.pScore === null ||
    site.rScore === null ||
    site.bpScore === null ||
    site.seoScore === null
  ) {
    return null;
  }
  return {
    performance: site.pScore,
    accessibility: site.rScore,
    bestPractices: site.bpScore,
    seo: site.seoScore,
  };
}

/**
 * Assemble the `ReportData` for a report email from a Websites row, for a given report type. Used
 * by the `selftest` command to preview any report type without an Airtable Reports row. Reuses the
 * same enrichment helpers as the real drafts (`fetchGaUsers`/`fetchSearch`, `resolveCopy`,
 * `announcementSiteExtras`). The GA window is a fixed 30 days (a no-write preview can't read the
 * real recurrence anchor). `Launch` skips GA entirely — the launch email shows no analytics.
 */
export async function buildReportDataForSite(
  site: WebsiteRow,
  type: ReportType,
  now: Date,
  opts: { scores: LighthouseScores; header: PreparedHeader },
): Promise<ReportData> {
  const { scores, header } = opts;
  const cidName = `${siteSlug(site.name)}-header`;
  const base: ReportData = {
    siteName: site.name,
    siteUrl: site.url,
    reportType: type,
    completedOn: now,
    lighthouse: scores,
    lastTestedDate:
      type === "Maintenance" && site.lastLighthouseAuditAt
        ? new Date(site.lastLighthouseAuditAt)
        : null,
    commentary: null,
    copy: resolveCopy(site),
    headerImageCid: cidName,
    headerWidth: header.displayWidth,
    headerHeight: header.displayHeight,
    headerBgColor: header.placeholderColor,
  };

  // The launch email renders no analytics — don't even fetch GA/search.
  if (type === "Launch") return base;

  const periodStart = new Date(now.getTime() - PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const gaUsers = (await fetchGaUsers(site, periodStart, now)).value;
  const search = (await fetchSearch(site, periodStart, now)).value;

  const withAnalytics: ReportData = {
    ...base,
    ...(gaUsers ? { gaUsersCurrent: gaUsers.current, gaUsersPrevious: gaUsers.previous } : {}),
    gaPeriodDays: PREVIEW_WINDOW_DAYS,
    ...(search?.foundOnPage1 && search.position !== null
      ? { searchPosition: search.position }
      : {}),
  };

  if (type === "Announcement") {
    return { ...withAnalytics, ...announcementSiteExtras(site) };
  }
  return withAnalytics; // Maintenance / Testing
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/reports/report-data.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Adopt `scoresFromRow` in `announce.ts` (drop the local copy)**

In `src/recipes/announce.ts`:

1. Add an import near the other `../reports/` imports:

```ts
import { scoresFromRow } from "../reports/report-data.js";
```

2. Delete the local `function scoresFromRow(w: WebsiteRow): LighthouseScores | null { ... }` block. The call site `const scores = scoresFromRow(w);` is unchanged (same signature). If `LighthouseScores` is now an unused import in `announce.ts`, leave it only if still referenced elsewhere; otherwise remove it to satisfy lint.

- [ ] **Step 6: Typecheck + run announce suite**

Run: `pnpm typecheck && pnpm vitest run tests/recipes/announce.test.ts tests/reports/report-data.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/reports/report-data.ts tests/reports/report-data.test.ts src/recipes/announce.ts
git commit -m "feat(reports): buildReportDataForSite + shared scoresFromRow"
```

---

## Task 4: `selftestEmail` recipe (no Airtable writes)

**Files:**

- Create: `src/recipes/selftest-email.ts`
- Test: `tests/recipes/selftest-email.test.ts`

Reuses: `openBase`/`readAirtableConfig`, `listWebsites`/`siteSlug` (airtable/websites), `fetchAttachmentBytes` (airtable/attachments), `prepareHeaderImage` (maintenance-email/header-image), `buildReportDataForSite`/`scoresFromRow` (report-data), `renderReportEmail` (send/render-email), `defaultResendClient`/`ResendClient` (send/resend), `parseAddresses`/`isProbablyEmail` (send/orchestrate). Constants `FROM_ADDRESS`/`REPLY_TO` are private to `orchestrate.ts`; re-declare them here (the file is the source of truth for self-test sends) — keep the strings identical.

- [ ] **Step 1: Write the failing test**

Create `tests/recipes/selftest-email.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";

// No network: GA/Search enrichment and the header fetch/downscale are stubbed.
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn().mockResolvedValue({ value: null, softFailed: false }),
  fetchSearch: vi.fn().mockResolvedValue({ value: null, softFailed: false }),
}));
vi.mock("../../src/reports/airtable/attachments.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/airtable/attachments.js")>()),
  fetchAttachmentBytes: vi
    .fn()
    .mockResolvedValue({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }),
}));
vi.mock("../../src/reports/maintenance-email/header-image.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/maintenance-email/header-image.js")>()),
  prepareHeaderImage: vi.fn().mockResolvedValue({
    bytes: new Uint8Array([1]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 200,
    placeholderColor: "#eee",
  }),
}));

import { selftestEmail } from "../../src/recipes/selftest-email.js";

function scored(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    "Header image": [{ url: "https://x/h.jpg", filename: "h.jpg", type: "image/jpeg" }],
    ...over,
  };
}

function captureResend(): { client: ResendClient; sent: ResendSendInput[] } {
  const sent: ResendSendInput[] = [];
  return {
    sent,
    client: {
      async send(input) {
        sent.push(input);
        return { messageId: `msg_${sent.length}` };
      },
    },
  };
}

const NOW = new Date("2026-06-26T12:00:00Z");

beforeEach(() => {
  process.env.AIRTABLE_PAT = "pat";
  process.env.AIRTABLE_BASE_ID = "app";
  delete process.env.OPERATOR_EMAIL;
});

describe("selftestEmail", () => {
  it("sends one announcement to the operator default and writes NOTHING to Airtable", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec1",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scored(),
          },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    const res = await selftestEmail({ base, resend: client, site: "acme-co", now: NOW });

    expect(res.results).toEqual([
      {
        site: "Acme Co",
        status: "sent",
        subject: expect.any(String),
        recipients: ["info@reddoorla.com"],
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["info@reddoorla.com"]);
    expect(sent[0]!.cc).toBeUndefined(); // private: no global ops CC
    expect(sent[0]!.subject).toContain("Your testing & maintenance report for Acme Co");
    // The core guarantee: zero Airtable mutations.
    expect(base.__calls.filter((c) => c.kind === "create" || c.kind === "update")).toHaveLength(0);
  });

  it("honors --to (comma-separated) and the requested type", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec1",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scored(),
          },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    await selftestEmail({
      base,
      resend: client,
      site: "acme-co",
      type: "Testing",
      to: "a@x.com, b@y.com",
      now: NOW,
    });
    expect(sent[0]!.to).toEqual(["a@x.com", "b@y.com"]);
    expect(sent[0]!.subject).toContain("Testing Report");
  });

  it("--all sends one email per maintenance site; a scores-less site is skipped", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "r1",
          fields: { Name: "Good Co", url: "https://good.com", Status: "maintenance", ...scored() },
        },
        {
          id: "r2",
          fields: {
            Name: "No Scores",
            url: "https://ns.com",
            Status: "maintenance",
            "Header image": [{ url: "u", filename: "f", type: "image/jpeg" }],
          },
        },
        {
          id: "r3",
          fields: { Name: "Hosting Co", url: "https://h.com", Status: "hosting", ...scored() },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    const res = await selftestEmail({ base, resend: client, all: true, now: NOW });
    const byName = new Map(res.results.map((r) => [r.site, r.status]));
    expect(byName.get("Good Co")).toBe("sent");
    expect(byName.get("No Scores")).toBe("skipped");
    expect(byName.has("Hosting Co")).toBe(false); // not a maintenance site
    expect(sent).toHaveLength(1);
  });

  it("--dry-run renders without sending", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec1",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scored(),
          },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    const res = await selftestEmail({
      base,
      resend: client,
      site: "acme-co",
      dryRun: true,
      now: NOW,
    });
    expect(res.results[0]!.status).toBe("dry-run");
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/recipes/selftest-email.test.ts`
Expected: FAIL — cannot find module `selftest-email.js`.

- [ ] **Step 3: Create `src/recipes/selftest-email.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { openBase, readAirtableConfig } from "../reports/airtable/client.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../reports/airtable/websites.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { fetchAttachmentBytes } from "../reports/airtable/attachments.js";
import { prepareHeaderImage } from "../reports/maintenance-email/header-image.js";
import { buildReportDataForSite, scoresFromRow } from "../reports/report-data.js";
import { renderReportEmail } from "../reports/send/render-email.js";
import { defaultResendClient, type ResendClient } from "../reports/send/resend.js";
import { parseAddresses, isProbablyEmail } from "../reports/send/orchestrate.js";
import type { ReportType } from "../reports/types.js";

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
const REPLY_TO = "info@reddoorla.com";

export type SelftestEmailDeps = {
  /** Airtable handle (read-only here). Defaults to the live base from credentials. */
  base?: AirtableBase;
  /** Resend client. Defaults to the real client. */
  resend?: ResendClient;
  /** Single-site slug. Mutually exclusive with `all`. */
  site?: string;
  /** All `maintenance` sites (one email each). Mutually exclusive with `site`. */
  all?: boolean;
  /** Report type to preview. Default "Announcement". */
  type?: ReportType;
  /** Raw `--to` (comma/space-separated). Default: OPERATOR_EMAIL → info@reddoorla.com. */
  to?: string;
  /** Render only; write reports/<slug>/selftest-<type>.html, never send. */
  dryRun?: boolean;
  /** Single timestamp driving the window + completedOn. */
  now?: Date;
};

export type SelftestEmailSiteResult =
  | { site: string; status: "sent" | "dry-run"; subject: string; recipients: string[] }
  | { site: string; status: "skipped"; reason: string }
  | { site: string; status: "error"; message: string };

export type SelftestEmailResult = { results: SelftestEmailSiteResult[] };

/** Resolve the recipient list: explicit `--to` (validated) else the operator default. */
function resolveRecipients(to: string | undefined): string[] {
  const operator = process.env.OPERATOR_EMAIL?.trim() || "info@reddoorla.com";
  const parsed = to ? parseAddresses(to) : null;
  const list = parsed ?? [operator];
  for (const addr of list) {
    if (!isProbablyEmail(addr)) {
      throw Object.assign(new Error(`--to has a malformed address: ${addr}`), { exitCode: 2 });
    }
  }
  return list;
}

/**
 * Send (or dry-render) a single report email per target site to the operator/`--to`, with NO
 * Airtable side effects (no draft, queue, or stamp). Mirrors the production render+send via the
 * shared `renderReportEmail` seam, so the preview matches a real send. One bad site never aborts
 * `--all` (per-site try/catch). Sites missing stored scores or a header image are skipped.
 */
export async function selftestEmail(deps: SelftestEmailDeps): Promise<SelftestEmailResult> {
  const base = deps.base ?? openBase(readAirtableConfig());
  const resend = deps.resend ?? defaultResendClient();
  const type: ReportType = deps.type ?? "Announcement";
  const now = deps.now ?? new Date();
  const recipients = resolveRecipients(deps.to);

  const websites = await listWebsites(base);
  let targets: WebsiteRow[];
  if (deps.all) {
    targets = websites.filter((w) => w.status === "maintenance");
  } else if (deps.site) {
    const wanted = siteSlug(deps.site);
    targets = websites.filter((w) => siteSlug(w.name) === wanted);
  } else {
    throw Object.assign(new Error("Provide a site slug or --all"), { exitCode: 2 });
  }

  const results: SelftestEmailSiteResult[] = [];
  for (const w of targets) {
    try {
      const scores = scoresFromRow(w);
      if (!scores) {
        results.push({ site: w.name, status: "skipped", reason: "missing Lighthouse scores" });
        continue;
      }
      if (!w.headerImage) {
        results.push({ site: w.name, status: "skipped", reason: "no Header image" });
        continue;
      }
      const original = await fetchAttachmentBytes(w.headerImage.url);
      const header = await prepareHeaderImage(original.bytes);
      const slug = siteSlug(w.name);
      const reportData = await buildReportDataForSite(w, type, now, { scores, header });
      const { html, attachments, subject } = await renderReportEmail(reportData, {
        header,
        cidName: `${slug}-header`,
      });

      if (deps.dryRun) {
        const path = `reports/${slug}/selftest-${type.toLowerCase()}.html`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, html, "utf-8");
        results.push({ site: w.name, status: "dry-run", subject, recipients });
        continue;
      }

      await resend.send({
        from: FROM_ADDRESS,
        to: recipients,
        replyTo: REPLY_TO,
        subject,
        html,
        attachments,
      });
      results.push({ site: w.name, status: "sent", subject, recipients });
    } catch (err) {
      results.push({
        site: w.name,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/recipes/selftest-email.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/recipes/selftest-email.ts tests/recipes/selftest-email.test.ts
git commit -m "feat(recipes): selftestEmail — preview any report email, no Airtable writes"
```

---

## Task 5: CLI command + registration

**Files:**

- Create: `src/cli/commands/selftest.ts`
- Test: `tests/cli/selftest-command.test.ts`
- Modify: `src/cli/bin.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/selftest-command.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/recipes/selftest-email.js", () => ({
  selftestEmail: vi.fn(),
}));
import { selftestEmail } from "../../src/recipes/selftest-email.js";
import { runSelftestCommand } from "../../src/cli/commands/selftest.js";

describe("runSelftestCommand", () => {
  it("rejects an unknown kind (exit 2)", async () => {
    const res = await runSelftestCommand("forms", undefined, {});
    expect(res.code).toBe(2);
    expect(res.output).toContain("Unknown selftest kind");
  });

  it("rejects neither site nor --all (exit 2)", async () => {
    const res = await runSelftestCommand("email", undefined, {});
    expect(res.code).toBe(2);
    expect(res.output.toLowerCase()).toContain("site");
  });

  it("rejects both site and --all (exit 2)", async () => {
    const res = await runSelftestCommand("email", "acme", { all: true });
    expect(res.code).toBe(2);
  });

  it("rejects an unknown --type (exit 2)", async () => {
    const res = await runSelftestCommand("email", "acme", { type: "bogus" });
    expect(res.code).toBe(2);
    expect(res.output).toContain("type");
  });

  it("delegates to selftestEmail and formats per-site results", async () => {
    vi.mocked(selftestEmail).mockResolvedValue({
      results: [{ site: "Acme Co", status: "sent", subject: "S", recipients: ["me@x.com"] }],
    });
    const res = await runSelftestCommand("email", "acme", { to: "me@x.com" });
    expect(res.code).toBe(0);
    expect(res.output).toContain("Acme Co");
    expect(res.output).toContain("sent");
    expect(vi.mocked(selftestEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ site: "acme", type: "Announcement", to: "me@x.com" }),
    );
  });

  it("returns exit 1 when any site errored", async () => {
    vi.mocked(selftestEmail).mockResolvedValue({
      results: [{ site: "Bad Co", status: "error", message: "boom" }],
    });
    const res = await runSelftestCommand("email", undefined, { all: true });
    expect(res.code).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/cli/selftest-command.test.ts`
Expected: FAIL — cannot find module `selftest.js`.

- [ ] **Step 3: Create `src/cli/commands/selftest.ts`**

```ts
import { selftestEmail, type SelftestEmailSiteResult } from "../../recipes/selftest-email.js";
import type { ReportType } from "../../reports/types.js";

export type SelftestCommandOptions = {
  type?: string;
  to?: string;
  all?: boolean;
  dryRun?: boolean;
  cwd?: string;
};

const TYPES: Record<string, ReportType> = {
  announcement: "Announcement",
  maintenance: "Maintenance",
  testing: "Testing",
  launch: "Launch",
};

function formatResult(r: SelftestEmailSiteResult): string {
  if (r.status === "skipped") return `[${r.site}] skipped — ${r.reason}`;
  if (r.status === "error") return `[${r.site}] error: ${r.message}`;
  return `[${r.site}] ${r.status} — "${r.subject}" → ${r.recipients.join(", ")}`;
}

/**
 * `selftest <kind> [site]` — operator self-tests. The only kind today is `email`: preview a
 * report email for one site (or `--all` maintenance sites) to the operator/`--to`, with no
 * Airtable side effects. Validates kind/type and the site-xor-all rule before doing any work.
 */
export async function runSelftestCommand(
  kind: string,
  site: string | undefined,
  opts: SelftestCommandOptions,
): Promise<{ output: string; code: number }> {
  if (kind !== "email") {
    return { output: `Unknown selftest kind '${kind}'. Supported: email`, code: 2 };
  }
  if (Boolean(site) === Boolean(opts.all)) {
    return { output: "Provide exactly one of <site> or --all.", code: 2 };
  }
  const typeKey = (opts.type ?? "announcement").toLowerCase();
  const type = TYPES[typeKey];
  if (!type) {
    return {
      output: `Unknown --type '${opts.type}'. Supported: ${Object.keys(TYPES).join(", ")}`,
      code: 2,
    };
  }

  try {
    const { results } = await selftestEmail({
      ...(site ? { site } : {}),
      ...(opts.all ? { all: true } : {}),
      type,
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.dryRun ? { dryRun: true } : {}),
    });
    const output =
      results.length === 0 ? "No matching sites." : results.map(formatResult).join("\n");
    const code = results.some((r) => r.status === "error") ? 1 : 0;
    return { output, code };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/cli/selftest-command.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Register the command in `bin.ts`**

In `src/cli/bin.ts`, add a new command block after the `announce` block (~after line 347):

```ts
cli
  .command(
    "selftest <kind> [site]",
    "Operator self-tests. kind=email: preview a report email for a site (or --all) to yourself.",
  )
  .option("--type <type>", "Report type: announcement (default) | maintenance | testing | launch")
  .option("--to <addr>", "Recipient(s), comma-separated. Default: OPERATOR_EMAIL.")
  .option("--all", "Send a preview for every maintenance site (to --to/operator).")
  .option("--dry-run", "Render only; write reports/<slug>/selftest-<type>.html; do not send.")
  .action(
    async (
      kind: string,
      site: string | undefined,
      opts: {
        type?: string;
        to?: string;
        all?: boolean;
        dryRun?: boolean;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () => (await import("./commands/selftest.js")).runSelftestCommand(kind, site, opts),
        opts,
      ),
  );
```

Note: CAC maps `--dry-run` to `opts.dryRun` (camelCase) automatically.

- [ ] **Step 6: Verify the CLI wires up (help lists it; lazy import works)**

Run: `pnpm build && node dist/cli/bin.js selftest --help`
Expected: prints the `selftest <kind> [site]` usage with the four options. (No credentials needed for `--help`.)

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/selftest.ts tests/cli/selftest-command.test.ts src/cli/bin.ts
git commit -m "feat(cli): selftest email command (preview report emails to the operator)"
```

---

## Task 6: Changeset + full gate

**Files:**

- Create: `.changeset/selftest-email.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/selftest-email.md`:

```md
---
"@reddoorla/maintenance": minor
---

New `selftest email [site]` CLI command: preview any report email (announcement/maintenance/testing/launch) for a site — or `--all` maintenance sites — to yourself (`--to` to override; defaults to `OPERATOR_EMAIL`), with `--dry-run` to render to disk. No Airtable side effects. Faithfulness via a shared `renderReportEmail` seam used by both the real send path and the self-test, plus a shared `defaultReportSubject`.
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all green. If prettier flags any new/edited file, run `npx prettier --write <files>` and re-run `pnpm lint`.

- [ ] **Step 3: Commit**

```bash
git add .changeset/selftest-email.md
git commit -m "chore(changeset): selftest email command"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** command UX (Task 5), all four types (Task 3 + 5 type map), `--to`/operator default (Task 4 `resolveRecipients`), `--all` (Task 4), `--dry-run` (Task 4), no-Airtable-writes guarantee (Task 4 test asserts zero create/update), shared render seam (Task 2), shared subject (Task 1), per-site try/catch + skip-on-missing (Task 4), error exit codes (Task 5). ✔

**Type consistency:** `PreparedHeader` is defined in `render-email.ts` and imported by `report-data.ts`; `renderReportEmail(reportData, { header, cidName, subjectOverride? })` is called identically in `orchestrate.ts` and `selftest-email.ts`; `buildReportDataForSite(site, type, now, { scores, header })` matches its test; `scoresFromRow` returns `LighthouseScores | null` everywhere; `SelftestEmailSiteResult` statuses (`sent`/`dry-run`/`skipped`/`error`) match the formatter and tests. ✔

**Placeholder scan:** every code step has complete code; no TBD/"handle errors"/"similar to". ✔

**Known follow-ups (out of scope, intentional):** `report-data.ts` uses a fixed 30-day window for maintenance/testing previews; `selftest-email.ts` re-declares `FROM_ADDRESS`/`REPLY_TO` (kept identical to `orchestrate.ts`).
