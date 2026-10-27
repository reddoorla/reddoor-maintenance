# M3 — Scheduled Recurrence + Approval-Only Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "the only thing I do is look and hit yes" literally true — a daily cron drafts due reports + sends approved + emails one digest; a decoupled dashboard button approves.

**Architecture:** Reuse the existing draft/due/send pipeline. Add (1) idempotent drafting via a Period run-ledger, (2) a daily GHA workflow (keepalive'd, single-flight) running draft -> send-ready -> digest, (3) a Netlify POST approve-action (flag-flip, audited), (4) a unified digest. Each numbered slice ships as its own PR with TDD + the AUTONOMY.md 3-lens review.

**Tech Stack:** TypeScript, vitest (DI fakes), Airtable, Resend, Netlify Functions (.mts), GitHub Actions.

**Design spec:** [docs/superpowers/specs/2026-06-11-m3-scheduled-recurrence-design.md](specs/2026-06-11-m3-scheduled-recurrence-design.md)

---

## Slice / PR ordering

1. **Slice 1 — Idempotent drafting** (feat) — prereq for the cron.
2. **Slice 2 — Daily workflow** (ci) — references `--digest` from slice 4 (land slice 4 first, or stub the step).
3. **Slice 3 — Dashboard approve action** (feat) — Task 3.5b imports `listPendingApproval` from slice 4's `src/reports/digest.ts`, so slice 3 lands after slice 4.
4. **Slice 4 — Unified digest** (feat) — provides `--digest` used by slice 2 and `listPendingApproval` used by slice 3's fleet count.

> Build order: **1 → 4 → 2 → 3** (the workflow's `--digest` step exists before the workflow references it; the fleet count's import exists before slice 3 needs it).

---

## Slice 1: Idempotent drafting (Period run-ledger)

### Task 1.1: `reportPeriodKey(dueDate)` in due.ts

**Files:**

- Modify: `src/reports/due.ts` (add exported fn after `findDueReports`, ~line 108)
- Test: `tests/reports/due.test.ts` (add a `describe("reportPeriodKey")` block after the existing `findDueReports` block, ~line 235)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/due.test.ts — append after the closing }); of describe("findDueReports")
import { findDueReports, reportPeriodKey } from "../../src/reports/due.js";
// ^ change the existing top import line to add reportPeriodKey

describe("reportPeriodKey", () => {
  it("returns the UTC YYYY-MM of the due date", () => {
    expect(reportPeriodKey(new Date("2026-05-26T12:00:00Z"))).toBe("2026-05");
  });

  it("uses UTC, not local time, near a month boundary", () => {
    // 2026-06-01T00:00 UTC is still May 31 in PDT — must report 2026-06, not 2026-05.
    expect(reportPeriodKey(new Date("2026-06-01T00:30:00Z"))).toBe("2026-06");
  });

  it("zero-pads single-digit months", () => {
    expect(reportPeriodKey(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01");
  });

  it("matches the dueDate that findDueReports produces (stable dedup key)", () => {
    const due = findDueReports([site()], [report({ sentAt: "2026-03-01T12:00:00.000Z" })], TODAY);
    expect(due).toHaveLength(1);
    // dueDate = 2026-04-01 → period 2026-04
    expect(reportPeriodKey(due[0]!.dueDate)).toBe("2026-04");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/due.test.ts -t "reportPeriodKey"`
      Expected: FAIL — `reportPeriodKey is not a function` / import has no exported member `reportPeriodKey`.
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/due.ts — add directly below findDueReports (after the closing } at line 108)

/**
 * The UTC `YYYY-MM` of a `dueDate` from {@link findDueReports} — the per-recurrence
 * idempotency key for drafting. Monthly recurrences land in distinct months; quarterly
 * and yearly land in distinct due-months too, so this uniquely names one draft per cycle.
 * UTC accessors keep it timezone-independent, consistent with the rest of this module.
 */
export function reportPeriodKey(dueDate: Date): string {
  const year = dueDate.getUTCFullYear();
  const month = String(dueDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/due.test.ts`
      Expected: PASS (all `findDueReports` + new `reportPeriodKey` tests green).
- [ ] **Step 5: Commit**

```bash
git add src/reports/due.ts tests/reports/due.test.ts && git commit -m "feat(reports): add reportPeriodKey(dueDate) UTC YYYY-MM idempotency key"
```

---

### Task 1.2: `Period` field on the Reports row (create + map)

**Files:**

- Modify: `src/reports/airtable/reports.ts` — `ReportRow` type (~line 9-32), `mapRow` (~line 34-63), `DraftInput` (~line 80-97), `createDraft` fields (~line 117-136)
- Modify: `src/reports/draft.ts` — `createDraft(...)` call (~line 121-135) to pass `period`
- Test: `tests/reports/airtable/reports.test.ts` (add a `describe("Period field")` block) and one assertion in `tests/reports/draft.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/airtable/reports.test.ts — add imports + a new describe block.
// Existing imports already pull REPORTS_TABLE, escapeFormulaString from reports.js;
// extend to bring in createDraft, and import the fake base helper.
import {
  REPORTS_TABLE,
  escapeFormulaString,
  createDraft,
} from "../../../src/reports/airtable/reports.js";
import { makeFakeBase } from "../_helpers/fake-airtable-base.js";

describe("createDraft Period field", () => {
  const baseInput = {
    reportId: "Acme — Maintenance — 2026-05-26",
    siteId: "rec_site_acme",
    reportType: "Maintenance" as const,
    periodStart: new Date("2026-04-27T00:00:00Z"),
    periodEnd: new Date("2026-05-26T00:00:00Z"),
    completedOn: new Date("2026-05-26T00:00:00Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    lastTestedDate: null,
  };

  it("writes the Period field when supplied", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, { ...baseInput, period: "2026-05" });
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Period"]).toBe("2026-05");
  });

  it("omits the Period field when not supplied (back-compat)", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, baseInput);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Period"]).toBeUndefined();
  });

  it("maps the Period field back onto the row", async () => {
    const base = makeFakeBase({ Reports: [] });
    const row = await createDraft(base, { ...baseInput, period: "2026-05" });
    expect(row.period).toBe("2026-05");
  });
});
```

And in `tests/reports/draft.test.ts`, add inside `describe("draftReportForSite")`:

```ts
it("stamps Period with an explicitly passed period key (the dueDate's YYYY-MM)", async () => {
  // CRITICAL idempotency invariant: the stamped Period MUST equal the key the
  // draftDueReports guard searches by — reportPeriodKey(dueDate) — NOT the run
  // month. If the cron lags into the month after the dueDate month, a run-month
  // stamp would never match the guard's search key and every later run would
  // draft a duplicate. So the caller passes the key down explicitly.
  const base = makeFakeBase({ Reports: [] });
  await draftReportForSite(base, siteFixture(), "Maintenance", "2026-05");
  const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
  expect(fields["Period"]).toBe("2026-05");
});

it("falls back to the periodEnd's YYYY-MM when no period is passed (manual single-site path)", async () => {
  const base = makeFakeBase({ Reports: [] });
  await draftReportForSite(base, siteFixture(), "Maintenance");
  const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
  const periodEnd = fields["Period end"] as string; // "YYYY-MM-DD"
  expect(fields["Period"]).toBe(periodEnd.slice(0, 7));
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/airtable/reports.test.ts -t "Period"`
      Expected: FAIL — `fields["Period"]` is `undefined` (create doesn't write it) and `row.period` is `undefined` (mapRow doesn't read it; type error on `period` input).
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/airtable/reports.ts

// (1) ReportRow type — add after `reportType: ReportType;` (line ~13):
  /** UTC `YYYY-MM` recurrence key (idempotency for search-before-create). Null on legacy rows. */
  period: string | null;

// (2) mapRow — add inside the returned object, after the reportType line (~line 43):
    period: (f["Period"] as string | undefined) ?? null,

// (3) DraftInput type — add after `reportType: ReportType;` (~line 83):
  /** UTC `YYYY-MM` recurrence key. Omitted on legacy callers; written only when supplied. */
  period?: string;

// (4) createDraft — after the GA/search conditional writes (~after line 136),
//     before the `const created = ...` line:
  if (input.period !== undefined) fields["Period"] = input.period;
```

```ts
// src/reports/draft.ts — draftReportForSite gains an optional trailing `period` param
// so the recurrence caller (draftDueReports, Task 1.4) can pass reportPeriodKey(dueDate).
// The stamped Period and the guard's search key MUST be the same value — deriving the
// stamp from periodEnd (the run month) would diverge from reportPeriodKey(dueDate)
// whenever the cron lags into the next month, and the guard would re-draft forever.
export async function draftReportForSite(
  base: AirtableBase,
  siteRow: WebsiteRow,
  reportType: ReportType,
  period?: string, // UTC "YYYY-MM"; defaults to periodEnd's month for manual one-off drafts
): Promise<DraftResult> {
// ...body unchanged until the createDraft call (~line 121):
  const created = await createDraft(base, {
    reportId,
    siteId: siteRow.id,
    reportType,
    period: period ?? periodEnd.toISOString().slice(0, 7),
    periodStart,
    periodEnd,
    completedOn,
    lighthouse: scores,
    lastTestedDate,
    ...(gaUsers ? { gaUsersCurrent: gaUsers.current, gaUsersPrevious: gaUsers.previous } : {}),
    ...(search ? { searchFoundPage1: search.foundOnPage1 } : {}),
    ...(search?.foundOnPage1 && search.position !== null
      ? { searchPosition: search.position }
      : {}),
  });
```

Then add the matching `period: null` to the two `report()`/`ReportRow` fixtures so the type compiles:

```ts
// tests/reports/due.test.ts — in function report(), add after `reportType: "Maintenance",`:
    period: null,
// tests/reports/send/*.ts and any other ReportRow fixture — add `period: null,` likewise.
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/airtable/reports.test.ts tests/reports/draft.test.ts tests/reports/due.test.ts`
      Expected: PASS (and no TS errors from the new required `period` field on `ReportRow`).
- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/reports.ts src/reports/draft.ts tests/reports/airtable/reports.test.ts tests/reports/draft.test.ts tests/reports/due.test.ts && git commit -m "feat(reports): add Period field to Reports create+map and stamp it on draft"
```

---

### Task 1.3: `findReportByPeriod` query (search-before-create primitive)

**Files:**

- Modify: `src/reports/airtable/reports.ts` (add exported fn after `findReportByMessageId`, ~line 230)
- Test: `tests/reports/airtable/reports.test.ts` (add a `describe("findReportByPeriod")` block)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/airtable/reports.test.ts — extend the import and add a describe block.
import {
  REPORTS_TABLE,
  escapeFormulaString,
  createDraft,
  findReportByPeriod,
} from "../../../src/reports/airtable/reports.js";

describe("findReportByPeriod", () => {
  it("builds a formula matching Site + Report type + Period and returns the row", async () => {
    // The fake base does NOT evaluate filterByFormula — it returns whatever is seeded.
    // So we (a) seed the matching row and assert it maps back, and (b) assert the formula
    // string we send is the AND of the three anchored conditions.
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_existing",
          fields: {
            "Report ID": "Acme — Maintenance — 2026-05-26",
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-05",
          },
        },
      ],
    });

    const row = await findReportByPeriod(base, "rec_site_acme", "Maintenance", "2026-05");

    expect(row?.id).toBe("rec_existing");
    expect(row?.period).toBe("2026-05");

    const select = base.__calls.find((c) => c.kind === "select")!;
    const formula = (select.opts as { filterByFormula: string }).filterByFormula;
    expect(formula).toContain('{Report type} = "Maintenance"');
    expect(formula).toContain('{Period} = "2026-05"');
    // Site is a linked field — matched via the anchored ARRAYJOIN pattern used elsewhere.
    expect(formula).toContain("ARRAYJOIN({Site}");
    expect(formula).toContain("rec_site_acme");
  });

  it("returns null when nothing is seeded", async () => {
    const base = makeFakeBase({ Reports: [] });
    const row = await findReportByPeriod(base, "rec_site_acme", "Maintenance", "2026-05");
    expect(row).toBeNull();
  });

  it("escapes the period and report type to be formula-safe", async () => {
    const base = makeFakeBase({ Reports: [] });
    await findReportByPeriod(base, "rec_x", "Maintenance", '2026-05" OR TRUE()="');
    const formula = (
      base.__calls.find((c) => c.kind === "select")!.opts as {
        filterByFormula: string;
      }
    ).filterByFormula;
    // The injected quote must be escaped, not break out of the literal.
    expect(formula).toContain('2026-05\\" OR TRUE()=\\"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/airtable/reports.test.ts -t "findReportByPeriod"`
      Expected: FAIL — import has no exported member `findReportByPeriod`.
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/airtable/reports.ts — add after findReportByMessageId (end of file).
import type { ReportType } from "../types.js"; // already imported at top — do NOT re-add

/**
 * Find the Reports row for a `(site, reportType, period)` triple, or null. The
 * idempotency lookup behind search-before-create drafting. `Site` is a linked field,
 * so it's matched with the same comma-anchored ARRAYJOIN pattern as listReportsForSite
 * (a prefix collision on record ids can't pull another site's row). reportType and
 * period flow through escapeFormulaString — they're our own values today, but escaping
 * keeps the formula injection-safe if their source ever changes.
 */
export async function findReportByPeriod(
  base: AirtableBase,
  siteId: string,
  reportType: ReportType,
  period: string,
): Promise<ReportRow | null> {
  const safeSite = escapeFormulaString(siteId);
  const safeType = escapeFormulaString(reportType);
  const safePeriod = escapeFormulaString(period);
  const formula = `AND(FIND(",${safeSite},", "," & ARRAYJOIN({Site}, ",") & ",") > 0, {Report type} = "${safeType}", {Period} = "${safePeriod}")`;
  const rows: ReportRow[] = [];
  await base(REPORTS_TABLE)
    .select({ filterByFormula: formula, maxRecords: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/airtable/reports.test.ts`
      Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/reports.ts tests/reports/airtable/reports.test.ts && git commit -m "feat(reports): add findReportByPeriod lookup for search-before-create drafting"
```

---

### Task 1.4: Search-before-create guard in `runDueDraft`

**Files:**

- Modify: `src/cli/commands/report.ts` — extract `draftDueReports(base, today)` from `runDueDraft`, export it, add the period guard (~line 39-70)
- Test: `tests/cli/report-command.test.ts` (add a `describe("draftDueReports period guard")` block)

Note: `runDueDraft` currently builds its own base (`openBase(readAirtableConfig())`), which is untestable. Mirror the `sendApprovedReports` convention — keep a thin `runDueDraft()` that opens the base, delegate the real work to an exported `draftDueReports(base, today)` that takes the base injected (like `orchestrate.ts`'s exported helper at line 91). The guard uses the already-fetched `reports` array (no extra query on the hot path) plus `findReportByPeriod` as a defensive re-check is _not_ needed here because the full reports list is already in memory — match against it in-memory, which is also what `findDueReports` consumes.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/report-command.test.ts — add imports + a new describe block.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { runReportCommand, draftDueReports } from "../../src/cli/commands/report.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

// listWebsites + draftReportForSite are the IO the guard sits between; mock them so the
// test exercises ONLY the skip/draft decision, not GA/render/upload.
vi.mock("../../src/reports/airtable/websites.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/airtable/websites.js")>()),
  listWebsites: vi.fn(),
}));
vi.mock("../../src/reports/draft.js", () => ({ draftReportForSite: vi.fn() }));
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { draftReportForSite } from "../../src/reports/draft.js";

function siteRow(over = {}) {
  return {
    id: "rec_site_acme",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    lastLighthouseAuditAt: null,
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    dashboardToken: null,
    ...over,
  } as unknown as Parameters<typeof draftReportForSite>[1];
}

const TODAY = new Date("2026-05-26T12:00:00Z");

describe("draftDueReports period guard", () => {
  beforeEach(() => {
    vi.mocked(draftReportForSite).mockReset();
    vi.mocked(listWebsites).mockReset();
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
  });

  it("drafts a due (site, type) when no Reports row exists for its period", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({ Reports: [] }); // no prior reports → due now, period = 2026-05
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    // The guard's search key is passed down as the stamped Period (idempotency invariant).
    expect(draftReportForSite).toHaveBeenCalledWith(
      base,
      expect.anything(),
      "Maintenance",
      "2026-05",
    );
    expect(res.output).toMatch(/drafted/);
  });

  it("SKIPS a (site, type) already drafted for that period (idempotent re-run)", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    // A row already exists for this site+type with Period = 2026-05 (the dueDate's YYYY-MM
    // when no prior Sent at → dueDate is today, 2026-05-26).
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_already",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-05",
          },
        },
      ],
    });
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toMatch(/skipped|already drafted/i);
  });

  it("does NOT skip when an existing row is for a DIFFERENT period", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_old",
          fields: { Site: ["rec_site_acme"], "Report type": "Maintenance", Period: "2026-04" },
        },
      ],
    });
    await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/cli/report-command.test.ts -t "period guard"`
      Expected: FAIL — import has no exported member `draftDueReports` (and once exported, the "SKIPS" case fails because the un-guarded loop drafts unconditionally).
- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/commands/report.ts

// (1) Add the period-key import to the existing due import:
import { findDueReports, reportPeriodKey } from "../../reports/due.js";
// (2) Add the AirtableBase type import (alongside the client import on line 1):
import { openBase, readAirtableConfig, type AirtableBase } from "../../reports/airtable/client.js";

// (3) Replace runDueDraft (lines 39-70) with a thin wrapper + an exported, base-injected core:
async function runDueDraft(): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  return draftDueReports(base, new Date());
}

export async function draftDueReports(
  base: AirtableBase,
  today: Date,
): Promise<{ output: string; code: number }> {
  const websites = await listWebsites(base);
  const reports = [];
  for (const w of websites) {
    const rs = await listReportsForSite(base, w.id);
    reports.push(...rs);
  }
  const due = findDueReports(websites, reports, today);

  if (due.length === 0) return { output: "No reports due.", code: 0 };

  const lines: string[] = [];
  let softFailedSites = 0;
  let skipped = 0;
  for (const item of due) {
    // Idempotency: a re-run must not re-draft a (site, type) already drafted this
    // recurrence. The dueDate's YYYY-MM is the stable per-cycle key. Match against the
    // reports we already fetched — no extra query on the hot path.
    const period = reportPeriodKey(item.dueDate);
    const already = reports.some(
      (r) => r.siteId === item.site.id && r.reportType === item.reportType && r.period === period,
    );
    if (already) {
      skipped++;
      lines.push(`• skipped (already drafted ${period}): ${item.site.name} ${item.reportType}`);
      continue;
    }
    try {
      // Pass the SAME key the guard searches by, so the stamped Period always
      // matches a future run's reportPeriodKey(dueDate) — even if this run lags
      // into a later month than the dueDate.
      const result = await draftReportForSite(base, item.site, item.reportType, period);
      lines.push(`✓ drafted: ${result.reportRow?.reportId}`);
      if (result.softFailures.length > 0) softFailedSites++;
    } catch (e) {
      lines.push(`✗ failed: ${item.site.name} ${item.reportType} — ${(e as Error).message}`);
    }
  }
  if (softFailedSites > 0) {
    lines.push(
      `⚠ ${softFailedSites} site${softFailedSites === 1 ? "" : "s"} had GA/Search enrichment fail — drafted with blank analytics; check the logs above`,
    );
  }
  return { output: lines.join("\n"), code: lines.some((l) => l.startsWith("✗")) ? 1 : 0 };
}
```

Note `skipped` is accumulated for the summary line and the `• skipped` lines already surface it; if a lint `no-unused-vars` flags `skipped`, append a trailing summary line `if (skipped > 0) lines.push(\`• ${skipped} already drafted this period\`)` instead of leaving it unused.

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/cli/report-command.test.ts`
      Expected: PASS (existing usage/PAT tests still green — `runReportCommand` behavior unchanged; the real-base path is unchanged for `report --due`).
- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/report.ts tests/cli/report-command.test.ts && git commit -m "feat(reports): skip already-drafted (site,type,period) on re-run of report --due"
```

---

### Task 1.5: Full-suite + lint green-gate

**Files:**

- No new files — verification only.

- [ ] **Step 1: Run the whole reports + cli surface**
      Run: `pnpm exec vitest run tests/reports tests/cli`
      Expected: PASS (no regressions from the new required `ReportRow.period` field — every fixture got `period: null`).
- [ ] **Step 2: Typecheck + lint (CI parity — MEMORY: lint before push)**
      Run: `pnpm lint && pnpm exec tsc --noEmit`
      Expected: clean. If `tsc` flags any `ReportRow` literal missing `period`, add `period: null` to that fixture (search: `grep -rn "approvedToSend:" tests` finds every ReportRow literal).
- [ ] **Step 3: Commit any fixture/lint fixups**

```bash
git add -A && git commit -m "test(reports): add period:null to ReportRow fixtures for the new field"
```

---

**Slice 1 reviewer notes:** Surprises that downstream slices inherit: (1) `runDueDraft` was a private function that built its own base internally — I exported a base-injected `draftDueReports(base, today)` mirroring the `sendApprovedReports` → exported-helper convention in `orchestrate.ts`; slice 2's workflow still calls `report --due` (unchanged CLI surface), and slice 4's digest can reuse `draftDueReports`'s base-injection shape. (2) The fake Airtable base does **not** evaluate `filterByFormula` — it returns whatever is seeded — so `findReportByPeriod`'s correctness is verified by asserting the **formula string** we build (not by the fake filtering); any later slice testing an Airtable query must do the same. (3) I made the drafting guard an **in-memory** match against the already-fetched `reports` array (which `findDueReports` already consumes) rather than firing `findReportByPeriod` per due item — `findReportByPeriod` is still added as the real-Airtable primitive (used by the dashboard/digest slices if they need a point lookup), but the hot draft path avoids N extra round-trips. (4) **Naming contract honored exactly:** `ReportRow.period: string | null` (note: non-optional on the row type, so I added `period: null` to _every_ `ReportRow` test fixture — `due.test.ts`, send tests, etc.; missing one is a compile error, hence Task 1.5's grep-sweep), Airtable field `"Period"`, and `reportPeriodKey(dueDate: Date): string` lives in `due.ts`. (5) `period` is **optional** on `DraftInput`/`createDraft` and on `draftReportForSite` (back-compat for the manual single-site path, which falls back to `periodEnd`'s YYYY-MM) — but the recurrence path (`draftDueReports`) **always passes `reportPeriodKey(item.dueDate)` down explicitly**, so the stamped `Period` and the guard's search key are the same value by construction. This closes the cron-lag hole: a run that fires in the month _after_ the dueDate month still stamps the dueDate month, so the next run's guard finds the row and skips. (Fixed during plan self-review — an earlier draft derived the stamp from `periodEnd`, which diverges under lag.) The `Approved At` / `Approved By` fields named in the shared contract are **not** added here (they belong to slice 3's approve action) — only `Period` is additive in this slice.

---

## Slice 2: Daily GHA workflow (draft + send-ready) with keepalive + concurrency + failure-issue

### Task 2.1: Daily reports GHA workflow (draft + send-ready + digest, keepalive, concurrency, failure-issue)

**Files:**

- Create: `.github/workflows/daily-reports.yml`

This is infrastructure (a YAML workflow). Unit TDD does not apply — there is no JS/TS surface, and the repo has no harness that lints workflow files (the closest precedent, `tests/recipes/ci-templates.test.ts`, validates _generated_ caller workflows, not this repo's own `.github/workflows/`). So, mirroring exactly how PR #152 proved out `fleet-lighthouse.yml`, validation is structural: `prettier --check` (CI runs `prettier --check .`, which already covers `.github/workflows/*.yml` — verified: `fleet-lighthouse.yml` passes), plus a `grep` gate for every required key, plus the existing GitHub workflow-parse on push.

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/daily-reports.yml`:

```yaml
name: daily-reports

# M3 daily approval-only loop. One run per day: DRAFT due reports (idempotent —
# skip site+period already drafted), SEND approved-but-unsent (existing gate),
# then email the operator DIGEST. This repo is the central scheduler; it's
# active, so GitHub's 60-day cron auto-disable never fires — but the keepalive
# step below is a belt-and-suspenders against a quiet stretch. Cron minute is
# :23 (non-:00) to dodge the documented top-of-hour scheduler load spike.
on:
  schedule:
    - cron: "23 9 * * *" # 09:23 UTC daily, offset off the top of the hour
  workflow_dispatch: {} # manual run from the Actions tab

# Single-flight: a once-daily job can't realistically overlap, but this closes
# the search-then-create drafting race (Airtable has no atomic upsert) and stops
# a manual run colliding with the scheduled one.
concurrency:
  group: m3-daily
  cancel-in-progress: false

permissions:
  contents: write # keepalive-workflow re-enables the cron via the Actions API
  issues: write # open/close the daily-reports-failing tracking issue

jobs:
  daily:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6
        with:
          version: 10.33.1

      - uses: actions/setup-node@v6
        with:
          node-version: "22"
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      # 1. DRAFT — scan all Websites, draft anything overdue. Idempotent: the
      # slice-1 Period guard skips a (site, reportType) already drafted this
      # cycle, so a cron re-fire is a no-op. continue-on-error: a draft failure
      # for one site must not block sending reports already approved.
      - name: Draft due reports
        continue-on-error: true
        timeout-minutes: 15
        env:
          AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
          AIRTABLE_BASE_ID: ${{ secrets.AIRTABLE_BASE_ID }}
        run: node dist/cli/bin.js report --due

      # 2. SEND — existing gate (Draft ready ∧ Approved to send ∧ Sent at BLANK).
      # At-least-once: a failed send leaves Sent at null → retried tomorrow; the
      # Resend idempotency key (report:<id>) + the durable Sent at prevent dupes.
      - name: Send approved reports
        timeout-minutes: 15
        env:
          AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
          AIRTABLE_BASE_ID: ${{ secrets.AIRTABLE_BASE_ID }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
        run: node dist/cli/bin.js report --send-ready

      # 3. DIGEST — one "your fleet today" email to the operator. The --digest
      # flag is built in slice 4; this step is wired now so the workflow is
      # complete on slice-4 merge. NOTE: --digest does NOT exist until slice 4
      # lands — see reviewer notes for the ordering dependency.
      - name: Email the operator digest
        timeout-minutes: 10
        env:
          AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
          AIRTABLE_BASE_ID: ${{ secrets.AIRTABLE_BASE_ID }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          # Both optional — the CLI falls back to info@reddoorla.com and
          # https://reddoor-maintenance.netlify.app when unset/empty. Set the
          # repo Actions *variables* (not secrets) to override.
          OPERATOR_EMAIL: ${{ vars.OPERATOR_EMAIL }}
          DASHBOARD_BASE_URL: ${{ vars.DASHBOARD_BASE_URL }}
        run: node dist/cli/bin.js report --digest

      # Keepalive (API mode — no dummy commits): re-enable the scheduled trigger
      # if GitHub auto-disabled it after a quiet stretch. The one *silent* failure
      # mode for a cron that can go dormant.
      - name: Keep the scheduled workflow alive
        uses: gautamkrishnar/keepalive-workflow@v2
        with:
          use_api: true

      # M5 alerting (#152 pattern): a red daily run is otherwise only GitHub's
      # best-effort email to the last pusher. File/reopen one deduped tracking
      # issue so a failure is durably visible; auto-close on recovery.
      # continue-on-error so the alert machinery can NEVER turn a run red.
      - name: Open/update the daily-reports-failing tracking issue
        if: failure()
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          title="Daily reports run failing"
          run_url="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          body=$(printf 'The daily **daily-reports** run failed.\n\nRun: %s\n\n_Auto-filed; auto-closes on the next green run._' "$run_url")
          existing=$(gh issue list --state open --json number,title \
            --jq "map(select(.title==\"$title\")) | .[0].number // empty" || true)
          if [ -n "$existing" ]; then
            gh issue comment "$existing" --body "$body" && echo "commented on existing #$existing"
          else
            gh issue create --title "$title" --body "$body"
          fi

      - name: Close the daily-reports-failing issue on recovery
        if: success()
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          title="Daily reports run failing"
          for n in $(gh issue list --state open --json number,title \
            --jq "map(select(.title==\"$title\")) | .[].number" || true); do
            gh issue close "$n" --comment "Recovered — the daily-reports run is green again." && echo "closed #$n"
          done
```

- [ ] **Step 2: Validate formatting (replaces the failing-test step for infra)**
      Run: `pnpm exec prettier --check .github/workflows/daily-reports.yml`
      Expected: PASS — "All matched files use Prettier code style!" (CI runs `prettier --check .`, which covers `.github/workflows/*.yml`; an unformatted workflow reds CI, so this gate must be green before commit). If it reports a diff, run `pnpm exec prettier --write .github/workflows/daily-reports.yml` and re-check.

- [ ] **Step 3: Validate required keys are present (structural grep gate)**
      Run:

```bash
f=.github/workflows/daily-reports.yml
grep -q 'cron: "23 9 \* \* \*"' "$f" \
  && grep -q 'workflow_dispatch' "$f" \
  && grep -q 'group: m3-daily' "$f" \
  && grep -q 'cancel-in-progress: false' "$f" \
  && grep -q 'report --due' "$f" \
  && grep -q 'report --send-ready' "$f" \
  && grep -q 'report --digest' "$f" \
  && grep -q 'gautamkrishnar/keepalive-workflow@v2' "$f" \
  && grep -q 'secrets.AIRTABLE_PAT' "$f" \
  && grep -q 'secrets.AIRTABLE_BASE_ID' "$f" \
  && grep -q 'secrets.RESEND_API_KEY' "$f" \
  && grep -q 'vars.OPERATOR_EMAIL' "$f" \
  && grep -q 'vars.DASHBOARD_BASE_URL' "$f" \
  && grep -q 'Daily reports run failing' "$f" \
  && grep -q "if: failure()" "$f" \
  && grep -q "if: success()" "$f" \
  && echo "ALL KEYS PRESENT" || echo "MISSING KEY"
```

Expected: `ALL KEYS PRESENT`. This proves every contract item from the slice goal — the cron string, dispatch, concurrency group + no-cancel, all three CLI steps in order, the keepalive action pin, all three secrets, and the #152 failure-issue open/close pair. (This mirrors how #152 proved out `fleet-lighthouse.yml`: no unit surface, so the gate is "the file parses + every required directive is literally present.")

- [ ] **Step 4: Confirm GitHub parses the workflow**
      Run: `git add .github/workflows/daily-reports.yml && git diff --cached --name-only`
      Expected: shows the new file. After push, the workflow appears under the Actions tab with no "invalid workflow file" annotation (GitHub validates schema on push; an unparseable `on:`/`jobs:` shape surfaces there). Until slice 4 merges, a manual `workflow_dispatch` run will red on the digest step (`unknown option --digest`) — expected and acceptable; the draft+send steps still succeed because the digest step is last and `--due`/`--send-ready` already exist. Do **not** trigger a scheduled-equivalent run before slice 4 lands.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/daily-reports.yml && git commit -m "ci(reports): daily draft+send+digest workflow with keepalive, concurrency, and failure-issue (M3 slice 2)"
```

---

**Slice 2 reviewer notes:**

- **Ordering dependency — `--digest` ships in slice 4, not here.** The workflow's step 3 runs `node dist/cli/bin.js report --digest`, but the current `report` command (`src/cli/bin.ts:275-296`) only declares `--due`, `--preview`, `--send-ready`. `cac` rejects unknown options, so a `workflow_dispatch` run before slice 4 merges will fail the digest step. The draft and send steps are unaffected (they're earlier and use existing flags). This slice is intentionally merge-able before slice 4 — the digest step just no-ops-via-error until slice 4 lands — but **do not enable/trust a real scheduled run until slice 4 is in**. If the plan wants a strictly-green dispatch at every point, swap the merge order (4 before 2) or temporarily comment the digest step; I recommend leaving it wired and merging 4 promptly.
- **`permissions: contents: write` is new vs. the #152 source.** `fleet-lighthouse.yml` uses `contents: read`, but `gautamkrishnar/keepalive-workflow@v2` in API mode re-enables the cron through the Actions API and needs `contents: write` on the token. If a reviewer prefers least-privilege, the keepalive can move to its own job with a scoped token, but per-job over per-workflow permissions adds noise for a single-job file — I kept it at the job's workflow level matching the existing house style.
- **`RESEND_API_KEY` confirmed as the canonical name.** `src/reports/send/resend.ts:36-37` reads `process.env.RESEND_API_KEY` and throws `RESEND_API_KEY not set` (exitCode 2) when absent — so the send and digest steps both need it. `fleet-lighthouse.yml` does not pass it (audit-only), so this is a new secret reference for this repo's workflows; **confirm `RESEND_API_KEY` exists as a repo/org Actions secret before the first real run** (the design §4.2 assumes it does, but the existing cron never used it).
- **Failure-issue title is `"Daily reports run failing"`** — distinct from fleet-lighthouse's `"Nightly fleet audit failing"` so the two crons never share/clobber each other's tracking issue. Downstream M5 digest "Needs attention" (slice 4 / later) keys off open `*-failing` tracking issues; this exact title is the contract that section will match.
- **No unit test by design**, consistent with how #152 landed `fleet-lighthouse.yml` (infra-only). The repo has no workflow-linting harness; `tests/recipes/ci-templates.test.ts` validates _generated caller_ workflows, not this repo's own `.github/workflows/`, so reusing it here would be a category error. Validation is `prettier --check` (CI-enforced) + the grep key-gate + GitHub's on-push schema parse.
- **`pnpm`/node versions copied verbatim** from `fleet-lighthouse.yml` (`pnpm/action-setup@v6` v10.33.1 — matches `packageManager` in package.json — and `setup-node@v6` node 22). If Renovate later bumps these in the lighthouse file, keep the two workflows in lockstep or extract a composite action (out of scope for M3).

---

## Slice 3: Dashboard approve action (decoupled flag-flip, audited)

### Task 3.1: Reports field constants + `Approved At`/`Approved By` in the map and update path

**Files:**

- Modify: `src/reports/airtable/reports.ts` (ReportRow type lines 9-32, mapRow lines 34-63, new `approveReportRow` write fn after `setDeliveryStatus` line 213)
- Test: `tests/reports/airtable/reports-approve.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/airtable/reports-approve.test.ts
import { describe, it, expect, vi } from "vitest";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";
import { approveReportRow } from "../../../src/reports/airtable/reports.js";

/** A fake AirtableBase that records the update payload for one table. */
function fakeBase() {
  const update = vi.fn().mockResolvedValue([]);
  const base = ((table: string) => {
    expect(table).toBe("Reports");
    return { update };
  }) as unknown as AirtableBase;
  return { base, update };
}

describe("approveReportRow", () => {
  it("writes Approved to send = TRUE plus the Approved At / Approved By audit stamp", async () => {
    const { base, update } = fakeBase();
    const at = new Date("2026-06-11T15:30:00.000Z");
    await approveReportRow(base, "recREP1", at, "dashboard");
    expect(update).toHaveBeenCalledWith([
      {
        id: "recREP1",
        fields: {
          "Approved to send": true,
          "Approved At": "2026-06-11T15:30:00.000Z",
          "Approved By": "dashboard",
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/airtable/reports-approve.test.ts -t "writes Approved to send"`
      Expected: FAIL with `approveReportRow is not a function` (no such export yet).

- [ ] **Step 3: Write minimal implementation**
      First extend `ReportRow` and `mapRow` so the two new fields round-trip (downstream slices and the dashboard read them):

```ts
// src/reports/airtable/reports.ts — in the ReportRow type, after `sentAt: string | null;`
approvedAt: string | null;
approvedBy: string | null;
```

```ts
// src/reports/airtable/reports.ts — in mapRow, after the `sentAt:` line (currently line 58)
    approvedAt: (f["Approved At"] as string | undefined) ?? null,
    approvedBy: (f["Approved By"] as string | undefined) ?? null,
```

Then add the writer after `setDeliveryStatus` (after line 213):

```ts
// src/reports/airtable/reports.ts
/**
 * Stamp the approval on a Reports row: flips `Approved to send` TRUE and records
 * who/when for the audit trail. The caller (approveReport handler) is responsible
 * for idempotency — this is the raw write. Never touches `Sent at`.
 */
export async function approveReportRow(
  base: AirtableBase,
  recordId: string,
  approvedAt: Date,
  approvedBy: string,
): Promise<void> {
  await base(REPORTS_TABLE).update([
    {
      id: recordId,
      fields: {
        "Approved to send": true,
        "Approved At": approvedAt.toISOString(),
        "Approved By": approvedBy,
      },
    },
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/airtable/reports-approve.test.ts`
      Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/reports.ts tests/reports/airtable/reports-approve.test.ts && git commit -m "feat(reports): add Approved At/Approved By to the Reports map + an approveReportRow writer"
```

---

### Task 3.2: Pure `approveReport(deps, reportId)` handler — happy path

**Files:**

- Create: `src/dashboard/approve.ts`
- Test: `tests/dashboard/approve.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard/approve.test.ts
import { describe, it, expect, vi } from "vitest";
import { approveReport, type ApproveDeps } from "../../src/dashboard/approve.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    completedOn: "2026-06-01",
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "pending",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    ...over,
  };
}

function deps(over: Partial<ApproveDeps> = {}): ApproveDeps {
  return {
    getReportById: vi.fn().mockResolvedValue(reportRow()),
    approveReportRow: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-06-11T15:30:00.000Z"),
    ...over,
  };
}

describe("approveReport — happy path", () => {
  it("approves a Draft-ready, un-approved, un-sent report with the audit stamp", async () => {
    const d = deps();
    const res = await approveReport(d, "recREP1");
    expect(res).toEqual({ status: "approved", reportId: "recREP1" });
    expect(d.approveReportRow).toHaveBeenCalledWith(
      "recREP1",
      new Date("2026-06-11T15:30:00.000Z"),
      "dashboard",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/dashboard/approve.test.ts -t "approves a Draft-ready"`
      Expected: FAIL — `Cannot find module '../../src/dashboard/approve.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/dashboard/approve.ts
import type { ReportRow } from "../reports/airtable/reports.js";

/** Constant operator marker stamped into the audit trail (single operator). */
export const APPROVED_BY = "dashboard";

export type ApproveResult =
  | { status: "approved"; reportId: string }
  | { status: "noop"; reportId: string; reason: "already-approved" | "already-sent" }
  | { status: "not-found"; reportId: string };

/**
 * Injected IO. The handler is pure w.r.t. these: the `.mts` adapter binds them
 * to a live Airtable base, tests bind fakes. `now` is injected so the audit
 * timestamp is deterministic under test (matches the report-HTML/render split).
 */
export type ApproveDeps = {
  getReportById: (id: string) => Promise<ReportRow | null>;
  approveReportRow: (id: string, approvedAt: Date, approvedBy: string) => Promise<void>;
  now: () => Date;
};

/**
 * Approve a report for sending: the audited flag-flip half of the M3 loop.
 * Idempotent — a no-op (no write) if the row is already approved or already
 * sent; never un-approves. The daily cron's send step keys off the flag.
 */
export async function approveReport(deps: ApproveDeps, reportId: string): Promise<ApproveResult> {
  const report = await deps.getReportById(reportId);
  if (!report) return { status: "not-found", reportId };
  if (report.sentAt !== null) return { status: "noop", reportId, reason: "already-sent" };
  if (report.approvedToSend) return { status: "noop", reportId, reason: "already-approved" };
  await deps.approveReportRow(reportId, deps.now(), APPROVED_BY);
  return { status: "approved", reportId };
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/dashboard/approve.test.ts`
      Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/approve.ts tests/dashboard/approve.test.ts && git commit -m "feat(dashboard): pure approveReport handler (audited flag-flip)"
```

---

### Task 3.3: `approveReport` idempotency + not-found (the safety contract)

**Files:**

- Test: `tests/dashboard/approve.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard/approve.test.ts — append
describe("approveReport — idempotency and guards", () => {
  it("is a no-op when the report is already approved (never re-writes, never un-approves)", async () => {
    const d = deps({
      getReportById: vi.fn().mockResolvedValue(reportRow({ approvedToSend: true })),
    });
    const res = await approveReport(d, "recREP1");
    expect(res).toEqual({ status: "noop", reportId: "recREP1", reason: "already-approved" });
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("is a no-op when the report is already sent (sentAt set), even if somehow un-approved", async () => {
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ approvedToSend: false, sentAt: "2026-06-02T09:00:00Z" })),
    });
    const res = await approveReport(d, "recREP1");
    expect(res).toEqual({ status: "noop", reportId: "recREP1", reason: "already-sent" });
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("returns not-found (no write) when the id resolves to no row", async () => {
    const d = deps({ getReportById: vi.fn().mockResolvedValue(null) });
    const res = await approveReport(d, "recNOPE");
    expect(res).toEqual({ status: "not-found", reportId: "recNOPE" });
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("checks sent before approved so an approved-and-sent row reports already-sent", async () => {
    const d = deps({
      getReportById: vi
        .fn()
        .mockResolvedValue(reportRow({ approvedToSend: true, sentAt: "2026-06-02T09:00:00Z" })),
    });
    const res = await approveReport(d, "recREP1");
    expect(res.status).toBe("noop");
    expect((res as { reason: string }).reason).toBe("already-sent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/dashboard/approve.test.ts -t "idempotency and guards"`
      Expected: PASS immediately (Task 3.2's impl already encodes these guards). If any case fails, fix the guard order in `approve.ts` (sent → approved → write) — do not loosen the test.

- [ ] **Step 3: Write minimal implementation**
      No new code: Task 3.2's `approveReport` already implements all four cases. This task locks the contract that downstream relies on (never un-approves, sent-wins-over-approved precedence).

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/dashboard/approve.test.ts`
      Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add tests/dashboard/approve.test.ts && git commit -m "test(dashboard): lock approveReport idempotency, not-found, sent-over-approved precedence"
```

---

### Task 3.4: Dashboard "Approve" button on each pending report

**Files:**

- Modify: `src/dashboard/render.ts` (`reportRow` lines 64-72; signature/threading of a `slug`-or-pending flag)
- Test: `tests/dashboard/render.test.ts` (extend — add `approvedAt`/`approvedBy` to the local `reportRow` factory at lines 42-70 first)

- [ ] **Step 1: Write the failing test**
      First add the two new fields to the test's `reportRow` factory (it constructs a full `ReportRow`, so it won't compile otherwise):

```ts
// tests/dashboard/render.test.ts — inside reportRow(), after `sentAt: ...`
    approvedAt: "2026-05-01T12:00:00Z",
    approvedBy: "dashboard",
```

Then add the behavior tests:

```ts
// tests/dashboard/render.test.ts — append a new describe
describe("renderSiteDashboardHtml — approve button", () => {
  // A report that is Draft-ready, not yet approved, not yet sent: the one state
  // where the operator's "yes" is pending.
  const pending = () =>
    reportRow({
      reportId: "rep_pending",
      draftReady: true,
      approvedToSend: false,
      sentAt: null,
      approvedAt: null,
      approvedBy: null,
    });

  it("renders an Approve button that POSTs to the approve endpoint for a pending report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [pending()]);
    // The button carries the Airtable record id (recREP1) so the inline fetch
    // can target /api/reports/:id/approve.
    expect(html).toMatch(/data-report-id="recREP1"/);
    expect(html).toContain("/api/reports/recREP1/approve");
    expect(html).toMatch(/Approve/);
  });

  it("does NOT render an Approve button for an already-approved report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ approvedToSend: true, sentAt: null }),
    ]);
    expect(html).not.toMatch(/\/api\/reports\/[^/]+\/approve/);
  });

  it("does NOT render an Approve button for an already-sent report", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ approvedToSend: true, sentAt: "2026-05-02T09:00:00Z" }),
    ]);
    expect(html).not.toMatch(/\/api\/reports\/[^/]+\/approve/);
  });

  it("escapes the record id in the approve URL/attribute (no markup injection from Airtable ids)", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      pending(),
      reportRow({ id: 'rec"><img src=x>', reportId: "rep_x", approvedToSend: false, sentAt: null }),
    ]);
    expect(html).not.toContain('rec"><img src=x>');
    expect(html).toContain("&quot;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/dashboard/render.test.ts -t "approve button"`
      Expected: FAIL — no `data-report-id` / `/api/reports/.../approve` in output yet.

- [ ] **Step 3: Write minimal implementation**
      Add a pending predicate + an approve action to `reportRow`, and a tiny inline-fetch script. In `src/dashboard/render.ts`:

```ts
// src/dashboard/render.ts — add near the top-level helpers
function isPendingApproval(r: ReportRow): boolean {
  return r.draftReady && !r.approvedToSend && r.sentAt === null;
}
```

Replace the existing `reportRow` (lines 64-72) so a pending report gets an Approve button cell:

```ts
function reportRow(r: ReportRow): string {
  const date = r.completedOn ? escapeHtml(r.completedOn) : "—";
  const type = escapeHtml(r.reportType);
  const id = escapeHtml(r.reportId);
  const link = r.renderedHtmlAttachment
    ? `<a href="${escapeHtml(safeUrl(r.renderedHtmlAttachment.url))}">view</a>`
    : `<span class="muted">no attachment</span>`;
  const action = isPendingApproval(r)
    ? `<button class="approve" data-report-id="${escapeHtml(r.id)}" data-approve-url="/api/reports/${escapeHtml(r.id)}/approve">Approve</button>`
    : "";
  return `<tr><td>${date}</td><td>${type}</td><td><code>${id}</code></td><td>${link}</td><td>${action}</td></tr>`;
}
```

Widen the reports `<thead>` and append the inline approve script before `</body>`. In `renderSiteDashboardHtml`, change the table header (line 137):

```ts
          <thead><tr><th>Completed</th><th>Type</th><th>ID</th><th>Report</th><th></th></tr></thead>
```

And add, just before the final `</body>\n</html>`:

```ts
  <script>
    document.querySelectorAll("button.approve").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        const res = await fetch(b.dataset.approveUrl, { method: "POST" });
        b.textContent = res.ok ? "Approved" : "Failed";
        if (!res.ok) b.disabled = false;
      });
    });
  </script>
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/dashboard/render.test.ts`
      Expected: PASS (the new approve-button block and the full existing suite — header-column change must not break the lighthouse/health tile assertions, which key off `tile`/`tile-value`, not the table).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/render.ts tests/dashboard/render.test.ts && git commit -m "feat(dashboard): per-report Approve button on Draft-ready∧¬approved∧¬sent rows"
```

---

### Task 3.5: "Pending your yes" list at the top of the site dashboard

**Files:**

- Modify: `src/dashboard/render.ts` (`renderSiteDashboardHtml` body, between `auditedLine` and the Lighthouse `<div class="section">`)
- Test: `tests/dashboard/render.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard/render.test.ts — append
describe("renderSiteDashboardHtml — pending-your-yes list", () => {
  it("renders a 'Pending your yes' section listing each pending report with type + period", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({
        reportId: "rep_p1",
        reportType: "Maintenance",
        period: "2026-05",
        draftReady: true,
        approvedToSend: false,
        sentAt: null,
      }),
    ]);
    expect(html).toMatch(/Pending your yes/i);
    // The section sits before the Lighthouse section (top-of-page priority).
    expect(html.indexOf("Pending your yes")).toBeLessThan(html.indexOf(">Lighthouse<"));
    expect(html).toMatch(/Maintenance/);
    expect(html).toContain("2026-05");
  });

  it("omits the 'Pending your yes' section entirely when nothing is pending", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ approvedToSend: true, sentAt: "2026-05-02T09:00:00Z" }),
    ]);
    expect(html).not.toMatch(/Pending your yes/i);
  });

  it("counts only pending reports, not approved/sent ones, in the section", () => {
    const html = renderSiteDashboardHtml(siteRow(), [
      reportRow({ reportId: "rep_a", approvedToSend: true, sentAt: null }),
      reportRow({
        reportId: "rep_b",
        approvedToSend: false,
        sentAt: null,
        draftReady: true,
        period: "2026-05",
      }),
    ]);
    // Exactly one pending entry → its period appears once in the pending list.
    expect(html).toMatch(/Pending your yes/i);
    expect(html).toContain("rep_b");
  });
});
```

Note: this test uses `period` on `ReportRow`, added by Slice 1. Add `period: "2026-05"` (or `null`) to the test's `reportRow` factory defaults so the file compiles against the current type if Slice 1 hasn't landed; the plan executor lands slices in order (1→2→3→4), so `period` is already on the type by the time this slice runs.

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/dashboard/render.test.ts -t "pending-your-yes"`
      Expected: FAIL — no "Pending your yes" markup yet.

- [ ] **Step 3: Write minimal implementation**
      In `src/dashboard/render.ts`, add a pending-list renderer:

```ts
// src/dashboard/render.ts — new helper
function pendingRow(r: ReportRow): string {
  const type = escapeHtml(r.reportType);
  const period = r.period ? escapeHtml(r.period) : "—";
  return `<li><strong>${type}</strong> <span class="muted">${period}</span> <button class="approve" data-report-id="${escapeHtml(r.id)}" data-approve-url="/api/reports/${escapeHtml(r.id)}/approve">Approve</button></li>`;
}

function pendingSection(reports: ReportRow[]): string {
  const pending = reports.filter(isPendingApproval);
  if (pending.length === 0) return "";
  return `<div class="section pending">
    <h2>Pending your yes (${pending.length})</h2>
    <ul class="pending-list">${pending.map(pendingRow).join("")}</ul>
  </div>`;
}
```

Then insert it in `renderSiteDashboardHtml` immediately after `${auditedLine}` and before the Lighthouse `<div class="section">`:

```ts
  ${auditedLine}
  ${pendingSection(reports)}
```

Add list styling to `STYLES`:

```ts
.pending-list { list-style: none; padding: 0; margin: 0; }
.pending-list li { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #eee; }
button.approve { font: inherit; padding: 0.35rem 0.85rem; border: 1px solid #2c7; border-radius: 6px; background: #2c7; color: #fff; cursor: pointer; }
button.approve:disabled { opacity: 0.6; cursor: default; }
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/dashboard/render.test.ts`
      Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/render.ts tests/dashboard/render.test.ts && git commit -m "feat(dashboard): top-of-page 'Pending your yes' list per site"
```

---

### Task 3.5b: Fleet-wide "pending your yes" count on `/` (spec §4.3)

**Files:**

- Modify: `src/dashboard/fleet-render.ts:134` — `renderFleetHomeHtml` gains an optional `pendingApproval` count + banner
- Modify: `netlify/functions/fleet-homepage.mts:53-62` — fetch the count, pass it through
- Test: `tests/dashboard/fleet-render.test.ts`

**Dependency:** imports `listPendingApproval` from `src/reports/digest.js` (exported there by Slice 4's Task 4.2). The build order **1 → 4 → 2 → 3** already guarantees Slice 4 is merged before this task runs.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard/fleet-render.test.ts — append a new describe block.
describe("fleet homepage pending-approval banner", () => {
  it("shows the count when reports are pending approval", () => {
    const html = renderFleetHomeHtml([], 3);
    expect(html).toContain("3 reports pending your yes");
  });

  it("singularizes for one", () => {
    const html = renderFleetHomeHtml([], 1);
    expect(html).toContain("1 report pending your yes");
  });

  it("renders no banner when nothing is pending (or the arg is omitted)", () => {
    expect(renderFleetHomeHtml([])).not.toContain("pending your yes");
    expect(renderFleetHomeHtml([], 0)).not.toContain("pending your yes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/dashboard/fleet-render.test.ts -t "pending-approval banner"`
      Expected: FAIL — the two count cases fail (`renderFleetHomeHtml` ignores a second argument; no banner in the output). The omitted-arg case passes trivially.
- [ ] **Step 3: Write minimal implementation**

```ts
// src/dashboard/fleet-render.ts — change the signature at line 134 and add the banner.
export function renderFleetHomeHtml(sites: WebsiteRow[], pendingApproval = 0): string {
  // "N pending your yes" — the M3 daily-glance hook. Inline-styled so this stays a
  // one-line addition; the M4 cockpit pass owns real triage styling.
  const pendingBanner =
    pendingApproval > 0
      ? `<div class="pending-banner" style="background:#fff3cd;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-weight:600">⏳ ${pendingApproval} report${pendingApproval === 1 ? "" : "s"} pending your yes</div>`
      : "";
  const body =
    sites.length === 0
      ? `<div class="empty">No sites to display.</div>`
      : `<div class="cards">${sites.map(card).join("")}</div>`;
  // ...in the returned template, render the banner immediately before ${body}:
  //   ${pendingBanner}${body}
```

```ts
// netlify/functions/fleet-homepage.mts — fetch the count and pass it through.
// (1) Add to the imports (after the existing src/ imports at lines 2-4):
import { listPendingApproval } from "../../src/reports/digest.js";

// (2) After `const websites = await listWebsites(base);` (line 54):
// Defensive: the homepage must still render if the Reports query hiccups.
let pendingCount = 0;
try {
  pendingCount = (await listPendingApproval(base)).filter(
    (r) => r.draftReady && !r.approvedToSend && r.sentAt === null,
  ).length;
} catch {
  // banner simply absent — the per-site pages still show their own pending lists
}

// (3) Pass it through at the render call (line 62):
return html(renderFleetHomeHtml(visible, pendingCount), 200);
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/dashboard/fleet-render.test.ts`
      Expected: PASS (all existing fleet-render tests still green — the new param defaults to 0, so no fixture changes).
- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-render.ts netlify/functions/fleet-homepage.mts tests/dashboard/fleet-render.test.ts && git commit -m "feat(dashboard): fleet homepage shows the pending-your-yes count"
```

---

### Task 3.6: Thin Netlify adapter `approve-report.mts` (POST /api/reports/:id/approve, basic-auth)

**Files:**

- Create: `netlify/functions/approve-report.mts`
- Modify: `src/dashboard/index.ts` (add `approveReport` export so the `.mts` imports from one barrel like `site-dashboard.mts` does)
- Test: `tests/dashboard/approve-report-adapter.test.ts` (new — mirrors `tests/webhook/resend-webhook.test.ts`)

- [ ] **Step 1: Write the failing test**
      The adapter is thin but, per the `resend-webhook.mts` precedent, it IS tested via its compiled `.mjs` (env-gating, auth, method, and the wiring to the pure handler). Mock the Airtable reads/writes module so no live base is needed:

```ts
// tests/dashboard/approve-report-adapter.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ((t: string) => t) as unknown),
}));
vi.mock("../../src/dashboard/approve.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, approveReport: vi.fn() };
});
import { approveReport } from "../../src/dashboard/approve.js";
import approveReportFn from "../../netlify/functions/approve-report.mjs";

const approveMock = vi.mocked(approveReport);

// "user:secret" base64 — username ignored, password is the gate.
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");

function post(id: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://x/api/reports/${id}/approve`, { method: "POST", headers });
}

describe("approve-report adapter — env + method gating", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    process.env.DASHBOARD_PASSWORD = "s3cret";
    approveMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("GET returns a 200 presence-only health check (never leaks values)", async () => {
    process.env.DASHBOARD_PASSWORD = "should_not_leak";
    // @ts-expect-error — Netlify Context unused for GET
    const res = await approveReportFn(new Request("https://x/", { method: "GET" }), {});
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("should_not_leak");
    expect(JSON.parse(raw).env).toEqual({
      AIRTABLE_PAT: true,
      AIRTABLE_BASE_ID: true,
      DASHBOARD_PASSWORD: true,
    });
  });

  it("401s an unauthenticated POST and never touches the handler", async () => {
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1"), { params: { id: "recREP1" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Basic realm="Reddoor fleet"/);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("500s when Airtable env is missing", async () => {
    delete process.env.AIRTABLE_PAT;
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1", { authorization: AUTH }), {
      params: { id: "recREP1" },
    });
    expect(res.status).toBe(500);
  });

  it("authenticated POST calls approveReport with the :id and returns 200 on approve", async () => {
    approveMock.mockResolvedValue({ status: "approved", reportId: "recREP1" });
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1", { authorization: AUTH }), {
      params: { id: "recREP1" },
    });
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(expect.anything(), "recREP1");
    expect((await res.json()).status).toBe("approved");
  });

  it("returns 404 when the handler reports not-found", async () => {
    approveMock.mockResolvedValue({ status: "not-found", reportId: "recNOPE" });
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recNOPE", { authorization: AUTH }), {
      params: { id: "recNOPE" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 for an idempotent no-op (already-approved/already-sent)", async () => {
    approveMock.mockResolvedValue({
      status: "noop",
      reportId: "recREP1",
      reason: "already-approved",
    });
    // @ts-expect-error — minimal Context
    const res = await approveReportFn(post("recREP1", { authorization: AUTH }), {
      params: { id: "recREP1" },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/dashboard/approve-report-adapter.test.ts -t "env + method gating"`
      Expected: FAIL — `Cannot find module '../../netlify/functions/approve-report.mjs'`.

- [ ] **Step 3: Write minimal implementation**
      Add the handler to the barrel so the `.mts` imports from `src/dashboard/index.js` (matching `site-dashboard.mts`):

```ts
// src/dashboard/index.ts — append
export { approveReport, APPROVED_BY } from "./approve.js";
export type { ApproveDeps, ApproveResult } from "./approve.js";
```

Then the adapter, modeled on `resend-webhook.mts` (GET health check, env guards, auth, thin wiring; binds the pure handler's `deps` to live Airtable IO):

```ts
// netlify/functions/approve-report.mts
import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import {
  getReportById as getReportByIdAirtable,
  approveReportRow,
} from "../../src/reports/airtable/reports.js";
import { approveReport, verifyBasicAuth } from "../../src/dashboard/index.js";

// Path-route the customer-facing /api/reports/:id/approve on the function
// itself (same reason as site-dashboard.mts: a netlify.toml 200-rewrite hands
// the function the ORIGINAL url, so ctx.params would be empty). The :id arrives
// via ctx.params.id.
export const config: Config = {
  path: ["/api/reports/:id/approve", "/.netlify/functions/approve-report"],
};

function plainText(body: string, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  // GET health check — presence-only, mirrors resend-webhook.mts so an operator
  // can curl after wiring env. Never reports values.
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-approve-report",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return plainText("Method not allowed", 405);

  // Auth BEFORE any Airtable read, same realm as the dashboard so the browser
  // reuses creds when the inline fetch fires from /s/:slug.
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[approve-report] DASHBOARD_PASSWORD missing");
    return plainText("Approve endpoint is unconfigured. Set DASHBOARD_PASSWORD.", 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[approve-report] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  const id = ctx.params?.id;
  if (!id) return plainText("Missing report id", 400);

  const base = openBase({ apiKey, baseId });
  const result = await approveReport(
    {
      getReportById: (rid) => getReportByIdAirtable(base, rid),
      approveReportRow: (rid, at, by) => approveReportRow(base, rid, at, by),
      now: () => new Date(),
    },
    id,
  );

  if (result.status === "not-found") {
    return Response.json(result, { status: 404 });
  }
  return Response.json(result, { status: 200 });
};
```

This needs a `getReportById(base, id)` reader — add it to `src/reports/airtable/reports.ts` (single-record fetch by Airtable record id):

```ts
// src/reports/airtable/reports.ts — after findReportByMessageId
/** Fetch one Reports row by its Airtable record id, or null if it doesn't exist. */
export async function getReportById(
  base: AirtableBase,
  recordId: string,
): Promise<ReportRow | null> {
  try {
    const rec = await base(REPORTS_TABLE).find(recordId);
    return mapRow({ id: rec.id, fields: rec.fields as Record<string, unknown> });
  } catch {
    // airtable `.find` throws NOT_FOUND for a missing/bad id — treat as null.
    return null;
  }
}
```

Add a focused unit test for `getReportById` to `tests/reports/airtable/reports-approve.test.ts`:

```ts
// tests/reports/airtable/reports-approve.test.ts — append
import { getReportById } from "../../../src/reports/airtable/reports.js";

describe("getReportById", () => {
  it("maps a found record", async () => {
    const find = vi.fn().mockResolvedValue({ id: "recREP1", fields: { "Report ID": "rep_001" } });
    const base = ((t: string) => {
      expect(t).toBe("Reports");
      return { find };
    }) as unknown as AirtableBase;
    const row = await getReportById(base, "recREP1");
    expect(row?.id).toBe("recREP1");
    expect(row?.reportId).toBe("rep_001");
  });

  it("returns null when find throws NOT_FOUND", async () => {
    const find = vi.fn().mockRejectedValue(new Error("NOT_FOUND"));
    const base = ((_t: string) => ({ find })) as unknown as AirtableBase;
    expect(await getReportById(base, "recNOPE")).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/dashboard/approve-report-adapter.test.ts tests/reports/airtable/reports-approve.test.ts`
      Expected: PASS. Then `pnpm build` (the test imports the compiled `.mjs`, so the adapter must transpile cleanly — same dependency `resend-webhook.test.ts` has on the build step).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/approve-report.mts src/dashboard/index.ts src/reports/airtable/reports.ts tests/dashboard/approve-report-adapter.test.ts tests/reports/airtable/reports-approve.test.ts && git commit -m "feat(dashboard): POST /api/reports/:id/approve adapter (basic-auth, thin over approveReport)"
```

---

### Task 3.7: Lint + full-suite gate before opening the slice PR

**Files:** (none — verification only)

- [ ] **Step 1:** Run the formatter check the CI enforces (prettier checks every file incl. markdown):
      Run: `pnpm lint`
      Expected: clean; if it flags anything, `pnpm format` (or the repo's fix script) then re-run.

- [ ] **Step 2:** Run the whole test suite so the table-header column change and the new field on `ReportRow` haven't regressed any other consumer (fleet-render, send orchestrate, webhook):
      Run: `pnpm exec vitest run`
      Expected: PASS (all files).

- [ ] **Step 3:** Confirm the build emits the new `.mjs` adapter (the adapter test imports it):
      Run: `pnpm build && test -f dist/netlify/functions/approve-report.mjs || ls netlify/functions/`
      Expected: the compiled adapter exists (path mirrors how `resend-webhook.mjs` resolves for its test).

- [ ] **Step 4: Commit** (only if lint/format touched files)

```bash
git add -A && git commit -m "chore(dashboard): lint/format pass for the approve-action slice"
```

---

**Slice 3 reviewer notes:**

- **The `.mts` adapter IS unit-tested here** — `resend-webhook.mts` set the precedent (`tests/webhook/resend-webhook.test.ts` imports the compiled `netlify/functions/resend-webhook.mjs`), so I matched it rather than treating the adapter as untested. This makes Tasks 3.6's tests depend on a `pnpm build` step before the adapter `.mjs` resolves — call that out in the PR so a reviewer running only `vitest` without a build sees the import error and isn't surprised.
- **Path routing via `config.path`, not `netlify.toml`** — `site-dashboard.mts` documents (lines 7-15) that a `[[redirects]]` 200-rewrite hands the function the _original_ URL, leaving `ctx.params` empty. The approve adapter must use the same function-level `config.path` so `ctx.params.id` is populated; do not add a `netlify.toml` redirect for `/api/reports/:id/approve`.
- **`now` is injected into `ApproveDeps`** purely for deterministic audit timestamps under test (mirrors the existing pure-render/thin-IO split). The adapter binds `() => new Date()`.
- **Guard precedence is load-bearing and tested**: `sentAt` is checked _before_ `approvedToSend`, so an approved-and-sent row reports `already-sent` (the truer state). Slice 4's digest "Ready for your yes" must use the **same** `Draft ready ∧ ¬Approved ∧ ¬Sent` predicate — I encoded it as `isPendingApproval` in `render.ts`; if Slice 4 needs it too, lift it to a shared module rather than duplicating, to keep one definition of "pending."
- **Naming contract honored**: `approvedAt?`/`approvedBy?` map ⇄ `"Approved At"`/`"Approved By"`; pure handler `approveReport(deps, reportId)` in `src/dashboard/approve.ts`; adapter `netlify/functions/approve-report.mts` at `POST /api/reports/:id/approve`; `verifyBasicAuth` reused. One refinement vs. the brief: in `ReportRow` I typed the new props as `approvedAt: string | null` / `approvedBy: string | null` (non-optional `| null`) to match every other field on that row (e.g. `sentAt: string | null`) — the brief's `approvedAt?: string` optional form is the _report-object_ shape; the Airtable row type uses the codebase's uniform `| null` convention. Slices reading these off a `ReportRow` get `string | null`.
- **Dependency on Slice 1's `period` field**: the "Pending your yes" list renders `r.period`. Slices land in order (1→2→3→4), so `period` is on `ReportRow` before this slice runs. If a reviewer cherry-picks Slice 3 alone, the render test's `reportRow` factory and the `pendingRow` helper won't compile against a `period`-less type — note this ordering hard-dependency in the PR.
- **Two real Airtable fields are created out-of-band** (`Approved At` date/time, `Approved By` single-line text) in the live "Reports" table before this ships, exactly as the spec's §5 schema table requires — the code writes those exact column names and a missing column would surface only at runtime against the live base, not in the mocked tests.

---

## Slice 4: Unified daily digest (Ready-for-your-yes + M5-extensible Needs-attention frame)

### Task 4.1: Digest section types + "Ready for your yes" renderer (pure, empty-safe)

**Files:**

- Create: `src/reports/digest.ts`
- Test: `tests/reports/digest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/digest.test.ts
import { describe, it, expect } from "vitest";
import { renderDigestHtml, type DigestSections } from "../../src/reports/digest.js";

function sections(over: Partial<DigestSections> = {}): DigestSections {
  return {
    readyForYourYes: [
      {
        siteName: "Acme Co",
        reportType: "Maintenance",
        period: "2026-05",
        dashboardUrl: "https://reddoor-maintenance.netlify.app/s/acme-co",
      },
    ],
    needsAttention: [],
    ...over,
  };
}

describe("renderDigestHtml", () => {
  it("renders a 'Ready for your yes' row per report: site, type, period, link", () => {
    const html = renderDigestHtml(sections());
    expect(html).toContain("Ready for your yes");
    expect(html).toContain("Acme Co");
    expect(html).toContain("Maintenance");
    expect(html).toContain("2026-05");
    expect(html).toContain('href="https://reddoor-maintenance.netlify.app/s/acme-co"');
  });

  it("escapes site-controlled strings (no raw HTML injection)", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [
          {
            siteName: "Brown & <b>Co</b>",
            reportType: "Maintenance",
            period: "2026-05",
            dashboardUrl: "https://reddoor-maintenance.netlify.app/s/brown-co",
          },
        ],
      }),
    );
    expect(html).toContain("Brown &amp; &lt;b&gt;Co&lt;/b&gt;");
    expect(html).not.toContain("<b>Co</b>");
  });

  it("renders an 'all clear' line for the empty Needs-attention section (the M5 seam)", () => {
    const html = renderDigestHtml(sections());
    expect(html).toContain("Needs attention");
    expect(html).toMatch(/all clear/i);
  });

  it("renders Needs-attention items when the caller fills them (M5-extensible)", () => {
    const html = renderDigestHtml(
      sections({
        needsAttention: [
          { kind: "tracking-issue", title: "daily-reports-failing", url: "https://github.com/x/1" },
        ],
      }),
    );
    expect(html).toContain("daily-reports-failing");
    expect(html).toContain('href="https://github.com/x/1"');
  });

  it("shows a friendly empty state when nothing is ready", () => {
    const html = renderDigestHtml(sections({ readyForYourYes: [] }));
    expect(html).toContain("Ready for your yes");
    expect(html).toMatch(/nothing waiting/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/digest.test.ts -t "Ready for your yes"`
      Expected: FAIL with "Cannot find module '../../src/reports/digest.js'" (file does not exist yet)
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/digest.ts
import type { ReportType } from "./types.js";

/** One report awaiting the operator's "yes" — site, type, period, and a link to its
 *  dashboard page (the digest LINKS to the dashboard; it never carries the approve action,
 *  because email scanners pre-fetch links and would trip accidental approvals). */
export type ReadyItem = {
  siteName: string;
  reportType: ReportType;
  /** "YYYY-MM" — the Period key from the Reports row. */
  period: string;
  /** Absolute URL to /s/<slug> on the dashboard. */
  dashboardUrl: string;
};

/**
 * One "Needs attention" entry. The M5 SEAM: M5 plugs detectors (Renovate failures,
 * new vulns, lighthouse regressions, delivery bounces) in by pushing typed items here.
 * `kind` is a discriminant so M5 can add variants without breaking the renderer; for M3
 * we render the generic title+url shape, which covers open `*-failing` tracking issues.
 */
export type AttentionItem = {
  kind: string;
  title: string;
  url?: string;
};

export type DigestSections = {
  readyForYourYes: ReadyItem[];
  needsAttention: AttentionItem[];
};

/** Escape a string before interpolating into the digest HTML. Mirrors the report
 *  template's escapeXml — site names (e.g. "Brown & Co") and operator text must not
 *  break the markup or inject. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const GREY = "#757575";
const RED = "#C00";

function readySection(items: ReadyItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Ready for your yes</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">Nothing waiting on you.</p>`;
  }
  const rows = items
    .map(
      (it) => `
      <li style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;margin-bottom:8px">
        <strong style="color:#222">${esc(it.siteName)}</strong> — ${esc(it.reportType)} (${esc(it.period)})
        — <a href="${esc(it.dashboardUrl)}" style="color:${RED}">review &amp; approve</a>
      </li>`,
    )
    .join("");
  return `${heading}<ul style="padding-left:20px;margin:0">${rows}</ul>`;
}

function attentionSection(items: AttentionItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Needs attention</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">All clear — nothing needs attention.</p>`;
  }
  const rows = items
    .map((it) => {
      const label = it.url
        ? `<a href="${esc(it.url)}" style="color:${RED}">${esc(it.title)}</a>`
        : esc(it.title);
      return `<li style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;margin-bottom:8px">${label}</li>`;
    })
    .join("");
  return `${heading}<ul style="padding-left:20px;margin:0">${rows}</ul>`;
}

/** Pure render of the unified daily operator digest. No IO — the caller (runDigest)
 *  collects the rows and decides whether to send. */
export function renderDigestHtml(sections: DigestSections): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff">
    <h1 style="color:${RED};font-family:helvetica,sans-serif;font-size:24px;font-weight:700;margin:0 0 8px">Your fleet today</h1>
    ${readySection(sections.readyForYourYes)}
    ${attentionSection(sections.needsAttention)}
  </body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/digest.test.ts`
      Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/reports/digest.ts tests/reports/digest.test.ts && git commit -m "feat(digest): pure renderDigestHtml with Ready-for-your-yes + M5-extensible Needs-attention frame"
```

---

### Task 4.2: `runDigest()` — collect, skip-when-empty, send via Resend

**Files:**

- Modify: `src/reports/digest.ts` (append `runDigest` + `DIGEST_OPERATOR_FALLBACK` + `collectDigestSections` after the pure renderer)
- Test: `tests/reports/digest-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/digest-run.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

beforeEach(() => {
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
  process.env.OPERATOR_EMAIL = "ops@reddoorla.com";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-11T09:23:00Z"));
});

// openBase reads env; inject a fake.
vi.mock("../../src/reports/airtable/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/reports/airtable/client.js")>(
    "../../src/reports/airtable/client.js",
  );
  return { ...actual, openBase: vi.fn() };
});
import { openBase } from "../../src/reports/airtable/client.js";
import { runDigest } from "../../src/reports/digest.js";

function captureClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  return {
    captured,
    client: {
      async send(input) {
        captured.push(input);
        return { messageId: `msg_${captured.length}` };
      },
    },
  };
}

function siteRow(): FakeRecord {
  return { id: "rec_site_acme", fields: { Name: "Acme Co", url: "https://acme.example.com" } };
}

// A Draft-ready, NOT-approved, NOT-sent report: the gate for "Ready for your yes".
function readyReport(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_report_1",
    fields: {
      "Report ID": "Acme Co — Maintenance — 2026-05-26",
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      Period: "2026-05",
      "Draft ready": true,
      "Approved to send": false,
      ...over,
    },
  };
}

describe("runDigest", () => {
  it("sends a digest to OPERATOR_EMAIL listing each ready report, keyed digest-<YYYY-MM-DD>", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    const res = await runDigest({
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(res.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.to).toEqual(["ops@reddoorla.com"]);
    expect(captured[0]!.idempotencyKey).toBe("digest-2026-06-11");
    expect(captured[0]!.html).toContain("Acme Co");
    expect(captured[0]!.html).toContain("2026-05");
    expect(captured[0]!.html).toContain('href="https://reddoor-maintenance.netlify.app/s/acme-co"');
  });

  it("SKIPS the send (no-noise) when both sections are empty", async () => {
    vi.mocked(openBase).mockReturnValue(makeFakeBase({ Reports: [], Websites: [siteRow()] }));
    const { client, captured } = captureClient();
    const res = await runDigest({
      resend: client,
      baseUrl: "https://reddoor-maintenance.netlify.app",
    });
    expect(captured).toHaveLength(0);
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/skipped/i);
  });

  it("does NOT list approved reports (only Draft-ready ∧ ¬Approved ∧ ¬Sent)", async () => {
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({
        Reports: [readyReport({ "Approved to send": true })],
        Websites: [siteRow()],
      }),
    );
    const { client, captured } = captureClient();
    await runDigest({ resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
    // The only would-be row is approved → both sections empty → skip.
    expect(captured).toHaveLength(0);
  });

  it("falls back to the constant when OPERATOR_EMAIL is unset", async () => {
    delete process.env.OPERATOR_EMAIL;
    vi.mocked(openBase).mockReturnValue(
      makeFakeBase({ Reports: [readyReport()], Websites: [siteRow()] }),
    );
    const { client, captured } = captureClient();
    await runDigest({ resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
    expect(captured[0]!.to).toEqual(["info@reddoorla.com"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/digest-run.test.ts -t "sends a digest"`
      Expected: FAIL with "runDigest is not a function" (export does not exist yet)
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/digest.ts — append below renderDigestHtml

import { openBase, readAirtableConfig } from "./airtable/client.js";
import { listWebsites, siteSlug } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import { REPORTS_TABLE } from "./airtable/reports.js";
import { defaultResendClient, type ResendClient } from "./send/resend.js";

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
/** Single-operator fleet — fallback when OPERATOR_EMAIL is unset. */
const DIGEST_OPERATOR_FALLBACK = "info@reddoorla.com";

/** UTC "YYYY-MM-DD" — the Resend idempotency key suffix, so a same-day cron re-fire dedupes. */
function digestDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The gate for "Ready for your yes": Draft ready ∧ ¬Approved to send ∧ Sent at BLANK.
 * Mirrors listSendableReports' formula, inverting the approval flag. filterByFormula
 * isn't evaluated by the test fake, so the guard is re-applied in JS below regardless.
 * Exported: the fleet homepage (Task 3.5b) reuses it for the pending-approval count.
 */
export async function listPendingApproval(base: ReturnType<typeof openBase>): Promise<ReportRow[]> {
  // mapRow is module-private in reports.ts; read the raw rows we need here.
  const out: Array<{ id: string; fields: Record<string, unknown> }> = [];
  await base(REPORTS_TABLE)
    .select({
      filterByFormula:
        "AND({Draft ready} = TRUE(), {Approved to send} = FALSE(), {Sent at} = BLANK())",
      pageSize: 100,
    })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push({ id: rec.id, fields: rec.fields });
      fetchNextPage();
    });
  return out.map(rawToReportRow);
}

/** The two report fields the digest needs, defensively re-checked (the fake doesn't filter). */
function rawToReportRow(rec: { id: string; fields: Record<string, unknown> }): ReportRow {
  const f = rec.fields;
  const linkSites = (f["Site"] as string[] | undefined) ?? [];
  return {
    id: rec.id,
    reportId: String(f["Report ID"] ?? ""),
    siteId: linkSites[0] ?? "",
    reportType: ((f["Report type"] as string | undefined) ??
      "Maintenance") as ReportRow["reportType"],
    period: (f["Period"] as string | undefined) ?? undefined,
    draftReady: Boolean(f["Draft ready"]),
    approvedToSend: Boolean(f["Approved to send"]),
    sentAt: (f["Sent at"] as string | undefined) ?? null,
  } as ReportRow;
}

export type DigestRunOptions = {
  resend?: ResendClient;
  /** Dashboard origin for the /s/<slug> links, e.g. "https://reddoor-maintenance.netlify.app". */
  baseUrl: string;
};

export async function runDigest(
  options: DigestRunOptions,
): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const sites = new Map(websites.map((w) => [w.id, w]));

  const pending = (await listPendingApproval(base)).filter(
    (r) => r.draftReady && !r.approvedToSend && r.sentAt === null,
  );

  const readyForYourYes: ReadyItem[] = [];
  for (const r of pending) {
    const site = sites.get(r.siteId);
    if (!site) continue; // orphan report → skip rather than render a broken link
    readyForYourYes.push({
      siteName: site.name,
      reportType: r.reportType,
      period: r.period ?? "—",
      dashboardUrl: `${options.baseUrl.replace(/\/$/, "")}/s/${siteSlug(site.name)}`,
    });
  }

  // M5 fills this; M3 ships it empty (renders the "all clear" line).
  const needsAttention: AttentionItem[] = [];

  // No-noise default: skip entirely when there's nothing to report.
  if (readyForYourYes.length === 0 && needsAttention.length === 0) {
    return { output: "Digest skipped (nothing ready, nothing needs attention).", code: 0 };
  }

  const html = renderDigestHtml({ readyForYourYes, needsAttention });
  const client = options.resend ?? defaultResendClient();
  const to = [process.env.OPERATOR_EMAIL?.trim() || DIGEST_OPERATOR_FALLBACK];
  const today = new Date();
  const result = await client.send({
    from: FROM_ADDRESS,
    to,
    subject: `Your fleet today — ${readyForYourYes.length} ready for your yes`,
    html,
    idempotencyKey: `digest-${digestDateKey(today)}`,
  });
  return { output: `Digest sent to ${to.join(", ")} (${result.messageId})`, code: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/digest-run.test.ts tests/reports/digest.test.ts`
      Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/reports/digest.ts tests/reports/digest-run.test.ts && git commit -m "feat(digest): runDigest collects pending-approval rows, skips when empty, sends keyed digest-<date>"
```

---

### Task 4.3: `--digest` flag on the report command

**Files:**

- Modify: `src/cli/commands/report.ts` (`ReportCommandOptions` line 7-12; `runReportCommand` line 14-37)
- Modify: `src/cli/bin.ts` (report command block, lines 274-296)
- Test: `tests/cli/report-digest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/report-digest.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("runReportCommand --digest routing", () => {
  it("routes --digest to runDigest with the dashboard base URL and returns its result", async () => {
    const runDigest = vi.fn(async () => ({ output: "Digest sent to ops@reddoorla.com", code: 0 }));
    vi.doMock("../../src/reports/digest.js", () => ({ runDigest }));
    const { runReportCommand } = await import("../../src/cli/commands/report.js");

    const res = await runReportCommand(undefined, { digest: true });

    expect(runDigest).toHaveBeenCalledTimes(1);
    // baseUrl must be passed through (the digest links to /s/<slug>).
    expect(runDigest.mock.calls[0]![0]).toMatchObject({ baseUrl: expect.any(String) });
    expect(res).toEqual({ output: "Digest sent to ops@reddoorla.com", code: 0 });
  });

  it("takes precedence over --due so the daily workflow can run both as separate invocations", async () => {
    const runDigest = vi.fn(async () => ({ output: "ok", code: 0 }));
    vi.doMock("../../src/reports/digest.js", () => ({ runDigest }));
    const { runReportCommand } = await import("../../src/cli/commands/report.js");
    await runReportCommand(undefined, { digest: true, due: true });
    expect(runDigest).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/cli/report-digest.test.ts -t "routes --digest"`
      Expected: FAIL — `runDigest` is never called (no `--digest` branch; `runReportCommand` throws the usage error or routes to `--due`)
- [ ] **Step 3: Write minimal implementation**

In `src/cli/commands/report.ts`, extend the options type and add the routing branch (place it FIRST, before `sendReady`, so it's unambiguous):

```ts
export type ReportCommandOptions = {
  due?: boolean;
  preview?: boolean;
  sendReady?: boolean;
  digest?: boolean;
  cwd?: string;
};
```

```ts
export async function runReportCommand(
  slug: string | undefined,
  opts: ReportCommandOptions,
): Promise<{ output: string; code: number }> {
  if (opts.digest) {
    const { runDigest } = await import("../../reports/digest.js");
    return runDigest({ baseUrl: dashboardBaseUrl() });
  }

  if (opts.sendReady) {
    const { sendApprovedReports } = await import("../../reports/send/orchestrate.js");
    return sendApprovedReports();
  }
```

Add the base-URL resolver near the top of the file (after the imports), and update the usage string:

```ts
/** Dashboard origin for digest /s/<slug> links. DASHBOARD_BASE_URL overrides the
 *  production default; the trailing slash (if any) is trimmed by runDigest. */
function dashboardBaseUrl(): string {
  return process.env.DASHBOARD_BASE_URL?.trim() || "https://reddoor-maintenance.netlify.app";
}
```

```ts
throw Object.assign(
  new Error("Usage: reddoor-maint report [<slug>] [--due] [--preview] [--send-ready] [--digest]"),
  {
    exitCode: 2,
  },
);
```

In `src/cli/bin.ts`, register the flag and widen the action's options type:

```ts
  .option(
    "--send-ready",
    "Send all Reports with Draft ready=true AND Approved to send=true AND Sent at IS NULL.",
  )
  .option(
    "--digest",
    "Email the operator one daily digest of reports ready for approval (skips when empty).",
  )
  .action(
    async (
      site,
      opts: {
        due?: boolean;
        preview?: boolean;
        sendReady?: boolean;
        digest?: boolean;
        cwd?: string;
        verbose?: boolean;
      },
    ) => runOrExit(() => runReportCommand(site, opts), opts),
  );
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/cli/report-digest.test.ts`
      Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/report.ts src/cli/bin.ts tests/cli/report-digest.test.ts && git commit -m "feat(report): add --digest flag routing to runDigest with dashboard base URL"
```

---

### Task 4.4: Lint + full suite green, wire as step 3 of the daily workflow

**Files:**

- Modify: `.github/workflows/daily-reports.yml` (Slice 2's workflow — add the digest step after `--send-ready`)

This step has no unit surface (the routing + render + send are covered by 4.1–4.3); it's the infra wiring, validated structurally, mirroring how PR #152 proved out `fleet-lighthouse.yml`.

- [ ] **Step 1: Add the digest step to the daily workflow**
      Append, after the existing `report --send-ready` step in `.github/workflows/daily-reports.yml` (created in Slice 2):

```yaml
- name: Email the daily operator digest
  run: node dist/cli/bin.js report --digest
  env:
    AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
    AIRTABLE_BASE_ID: ${{ secrets.AIRTABLE_BASE_ID }}
    RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
    OPERATOR_EMAIL: ${{ secrets.OPERATOR_EMAIL }}
    DASHBOARD_BASE_URL: ${{ vars.DASHBOARD_BASE_URL }}
```

- [ ] **Step 2: Validate structurally (prettier + required-key greps)**
      Run:

```bash
pnpm exec prettier --check .github/workflows/daily-reports.yml \
  && grep -q "report --digest" .github/workflows/daily-reports.yml \
  && grep -q "RESEND_API_KEY" .github/workflows/daily-reports.yml \
  && grep -q "OPERATOR_EMAIL" .github/workflows/daily-reports.yml \
  && echo "WORKFLOW OK"
```

Expected: `WORKFLOW OK` (prettier passes; the digest step, the Resend secret, and the operator address are all present). This proves the step exists, is correctly ordered after send-ready, and carries every env var `runDigest`/`defaultResendClient` read — the same structural-validation approach PR #152 used for `fleet-lighthouse.yml`, which has no unit-testable surface.

- [ ] **Step 3: Run the full reports + CLI suite to confirm no regressions**
      Run: `pnpm exec vitest run tests/reports tests/cli && pnpm lint`
      Expected: PASS (all green; prettier/eslint clean across the new files — MEMORY: run lint before pushing so CI doesn't burn a cycle on a markdown/format nit)
- [ ] **Step 4: Commit**

```bash
git add .github/workflows/daily-reports.yml && git commit -m "feat(digest): wire report --digest as step 3 of the daily workflow"
```

---

**Slice 4 reviewer notes:** (1) **Hard dependency on Slice 1's `Period` field + `period?: string` on `ReportRow`.** As the code reads today, `src/reports/airtable/reports.ts`'s `ReportRow` type and `mapRow` have **no `period` property** — Slice 1 adds it. Task 4.2's `rawToReportRow` reads `f["Period"]` and the type-asserts `as ReportRow`; if Slice 1 lands first (it's dependency-ordered before this), drop the `as ReportRow` cast and the local `rawToReportRow` in favor of the canonical `mapRow` once `period` is on it. I deliberately did **not** import `mapRow` because it's module-private (not exported) in reports.ts — a cleaner alternative is to **export `mapRow`** in Slice 1 and have `listPendingApproval` reuse it; flag this for the Slice 1 author so the two slices converge on one mapper rather than the defensive duplicate here. (2) **The test fake does not evaluate `filterByFormula`** (documented in `fake-airtable-base.ts`) — that's why `runDigest` re-applies the `draftReady ∧ !approvedToSend ∧ sentAt===null` guard in JS after the select; the "does NOT list approved reports" test only passes because of that JS re-filter, not the formula. Keep both: the formula is the real-Airtable optimization, the JS filter is the test-provable correctness. (3) **`baseUrl` is injected, not hardcoded** — `runDigest` takes it as a required option and `runReportCommand` supplies it from `DASHBOARD_BASE_URL` (fallback `https://reddoor-maintenance.netlify.app` — **verified 2026-06-11**: HEAD on that origin returns 401 basic-auth, i.e. the live dashboard; override via the `DASHBOARD_BASE_URL` Actions variable if a custom domain is ever added). (4) **`OPERATOR_EMAIL` fallback constant is `info@reddoorla.com`**, reusing the same address as `REPLY_TO` in orchestrate.ts — intentional (single operator), but downstream Slice 2's workflow must pass `OPERATOR_EMAIL` as a secret/var for it to reach Tucker specifically. (5) **`FROM_ADDRESS` is duplicated** from orchestrate.ts (`"Reddoor Reports <reports@reddoorla.com>"`) rather than imported — orchestrate.ts keeps it module-private; if a later slice extracts a shared `send/constants.ts`, fold both. (6) The digest **intentionally carries no approve action**, only links to `/s/<slug>` (design §4.4: email scanners pre-fetch links → accidental approvals) — do not "helpfully" add an approve button to the digest in review. (7) `needsAttention: AttentionItem[]` is the **M5 seam** — it's typed and rendered but hardcoded `[]` in `runDigest`; M5 plugs detectors by populating that array (e.g. `collectRenovateFailures`, #156), no renderer change needed.
