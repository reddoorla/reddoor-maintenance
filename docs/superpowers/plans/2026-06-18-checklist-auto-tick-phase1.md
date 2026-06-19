# Checklist Auto-Tick — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the auto-tick engine + 3-state dashboard rendering, and wire the first live signal (Google Indexed), so a Maintenance report's `Maint: Google Indexed` box auto-ticks at draft time when Search Console shows page 1 — with evidence shown at the approve step and the human approve gate unchanged.

**Architecture:** A pure `autoTickChecklist(site, reportType, now, signals)` returns a per-checklist-field evidence record `{result, checkedAt, note}`. `draftReportForSite` calls it, ticks the Reports boolean for each `result==="pass"` entry, and snapshots all evidence into one new `Checklist auto-evidence` JSON field on the Reports row. The dashboard's `checklistBlock` renders three states (auto-green / amber / manual) from that snapshot. Fail-safe: tick only on fresh positive proof; anything else stays manual.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), vitest, Airtable SDK, the existing report pipeline.

**Spec:** docs/superpowers/specs/2026-06-18-checklist-auto-tick-design.md

---

## File Structure

- **Create** `src/reports/auto-tick.ts` — evidence types + the pure `autoTickChecklist`. One responsibility: given a site + inline signals, decide per-check pass/fail/unknown + note. The single home of the fail-safe invariant.
- **Create** `tests/reports/auto-tick.test.ts` — table-driven tests for the pure function.
- **Modify** `src/reports/airtable/reports.ts` — add `autoEvidence` to `ReportRow` (parsed in `mapRow`), add checklist booleans + `autoEvidence` to `DraftInput`, write them in `createDraft`.
- **Modify** `src/reports/draft.ts` — call `autoTickChecklist` before `createDraft`; pass ticked booleans + evidence JSON.
- **Modify** `src/dashboard/render.ts` — `checklistBlock` renders 3 states from `r.autoEvidence`.
- **Modify** tests: `tests/reports/draft.test.ts`, `tests/dashboard/render.test.ts`.

---

## Task 1: Evidence types + `autoTickChecklist` (pure, Google Indexed only)

**Files:**

- Create: `src/reports/auto-tick.ts`
- Test: `tests/reports/auto-tick.test.ts`

**Context:** `SearchPresence` is `{ foundOnPage1: boolean; position: number | null }` (src/reports/search/client.ts:30). The draft already fetches it via `fetchSearch` → `{ value: SearchPresence | null; softFailed: boolean }`. The checklist field for Google Indexed is `"Maint: Google Indexed"` (src/reports/checklist.ts:18). In Phase 1 only this check has a signal; every other check returns no evidence (→ stays manual). The function is PURE — no IO.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/auto-tick.test.ts
import { describe, it, expect } from "vitest";
import { autoTickChecklist, type AutoTickSignals } from "../../src/reports/auto-tick.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-06-18T12:00:00.000Z");
const GOOGLE = "Maint: Google Indexed";

function signals(over: Partial<AutoTickSignals> = {}): AutoTickSignals {
  return { search: { value: null, softFailed: false }, ...over };
}

describe("autoTickChecklist — Google Indexed", () => {
  it("passes when Search Console shows page 1, with the position in the note", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals({
      search: { value: { foundOnPage1: true, position: 3 }, softFailed: false },
    }));
    const g = ev.get(GOOGLE)!;
    expect(g.result).toBe("pass");
    expect(g.checkedAt).toBe(NOW.toISOString());
    expect(g.note).toMatch(/page 1/i);
    expect(g.note).toContain("3");
  });

  it("fails (no tick) when not on page 1", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals({
      search: { value: { foundOnPage1: false, position: 18 }, softFailed: false },
    }));
    expect(ev.get(GOOGLE)!.result).toBe("fail");
  });

  it("is unknown (no tick) when the Search Console call soft-failed", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals({
      search: { value: null, softFailed: true },
    }));
    expect(ev.get(GOOGLE)!.result).toBe("unknown");
  });

  it("emits no Google evidence when search is not configured (value null, not soft-failed)", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals());
    expect(ev.has(GOOGLE)).toBe(false);
  });

  it("emits no Google evidence for a Testing report's maintenance-subset? (it DOES — Testing gates on all 13)", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Testing", NOW, signals({
      search: { value: { foundOnPage1: true, position: 1 }, softFailed: false },
    }));
    expect(ev.get(GOOGLE)!.result).toBe("pass");
  });

  it("emits nothing for Launch/Announcement (no checklist)", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Launch", NOW, signals({
      search: { value: { foundOnPage1: true, position: 1 }, softFailed: false },
    }));
    expect(ev.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/reports/auto-tick.test.ts`
Expected: FAIL — `autoTickChecklist` not found.

- [ ] **Step 3: Implement the minimal code**

```typescript
// src/reports/auto-tick.ts
import type { ReportType } from "./types.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { SearchPresence } from "./search/client.js";
import { checklistFor } from "./checklist.js";

/** A single auto-check outcome. `pass` + fresh ⇒ the caller ticks the box. */
export type EvidenceResult = "pass" | "fail" | "unknown";
export type EvidenceRecord = { result: EvidenceResult; checkedAt: string | null; note: string };

/** Inline signals fetched during the draft (Phase 1: Search Console only). Phase 2/3 read the
 *  remaining signals off the Websites row passed as `site`. */
export type AutoTickSignals = {
  search: { value: SearchPresence | null; softFailed: boolean };
};

/**
 * Decide, per checklist item for this report type, an evidence record — ONLY for items that
 * currently have a signal. Items with no signal are omitted (→ caller leaves them manual). PURE.
 * Fail-safe lives here: a box is only tickable when result === "pass". Google Indexed is an
 * inline signal (fetched at draft), so its evidence is inherently fresh (checkedAt = now).
 */
export function autoTickChecklist(
  site: WebsiteRow,
  reportType: ReportType,
  now: Date,
  signals: AutoTickSignals,
): Map<string, EvidenceRecord> {
  const out = new Map<string, EvidenceRecord>();
  const fields = new Set(checklistFor(reportType).map((i) => i.field));

  // Google Indexed — Search Console (inline, always fresh).
  if (fields.has("Maint: Google Indexed")) {
    const g = googleEvidence(now, signals.search);
    if (g) out.set("Maint: Google Indexed", g);
  }

  return out;
}

function googleEvidence(
  now: Date,
  search: AutoTickSignals["search"],
): EvidenceRecord | null {
  const at = now.toISOString();
  if (search.softFailed) {
    return { result: "unknown", checkedAt: at, note: "Search Console unavailable this run" };
  }
  if (search.value === null) return null; // not configured → leave manual, no evidence
  if (search.value.foundOnPage1) {
    const pos = search.value.position;
    return { result: "pass", checkedAt: at, note: `Page 1 on Google${pos !== null ? ` (#${pos})` : ""}` };
  }
  const pos = search.value.position;
  return { result: "fail", checkedAt: at, note: `Not on page 1${pos !== null ? ` (avg #${pos})` : ""}` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reports/auto-tick.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/reports/auto-tick.ts tests/reports/auto-tick.test.ts
git commit -m "feat(reports): autoTickChecklist pure engine (Google Indexed signal)"
```

---

## Task 2: Reports row `Checklist auto-evidence` field + checklist booleans in createDraft

**Files:**

- Modify: `src/reports/airtable/reports.ts`
- Test: `tests/reports/reports-autoevidence.test.ts` (create)

**Context:** `ReportRow` is at reports.ts:25-56; `mapRow` at 68-101 (checklist built line 99 via `ALL_CHECKLIST_FIELDS`); `DraftInput` at 129-149; `createDraft` at 165-195. Mirror `parseNotifyRouting` (websites.ts:125-146) for the JSON parse. The evidence snapshot is ONE Airtable field `Checklist auto-evidence` holding a JSON object keyed by checklist field → `EvidenceRecord`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/reports-autoevidence.test.ts
import { describe, it, expect } from "vitest";
import { createDraft, parseAutoEvidence } from "../../src/reports/airtable/reports.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";

describe("parseAutoEvidence", () => {
  it("parses a valid evidence JSON object", () => {
    const raw = JSON.stringify({ "Maint: Google Indexed": { result: "pass", checkedAt: "2026-06-18T12:00:00.000Z", note: "Page 1 (#3)" } });
    const ev = parseAutoEvidence(raw);
    expect(ev?.["Maint: Google Indexed"]?.result).toBe("pass");
  });
  it("returns null on non-string / malformed / array input", () => {
    expect(parseAutoEvidence(undefined)).toBeNull();
    expect(parseAutoEvidence("{not json")).toBeNull();
    expect(parseAutoEvidence("[]")).toBeNull();
  });
});

describe("createDraft writes checklist booleans + auto-evidence", () => {
  it("ticks supplied checklist fields and writes the evidence JSON", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, {
      reportId: "Acme Co — Maintenance — 2026-06-18",
      siteId: "rec_site",
      reportType: "Maintenance",
      periodStart: new Date("2026-06-01T00:00:00Z"),
      periodEnd: new Date("2026-06-18T00:00:00Z"),
      completedOn: new Date("2026-06-18T00:00:00Z"),
      lighthouse: { performance: 90, accessibility: 100, bestPractices: 82, seo: 100 },
      lastTestedDate: null,
      checklistTicks: ["Maint: Google Indexed"],
      autoEvidence: { "Maint: Google Indexed": { result: "pass", checkedAt: "2026-06-18T12:00:00.000Z", note: "Page 1 (#3)" } },
    });
    const create = base.__calls.find((c) => c.kind === "create")!;
    const fields = create.records[0]!.fields;
    expect(fields["Maint: Google Indexed"]).toBe(true);
    expect(typeof fields["Checklist auto-evidence"]).toBe("string");
    expect(JSON.parse(fields["Checklist auto-evidence"] as string)["Maint: Google Indexed"].result).toBe("pass");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/reports/reports-autoevidence.test.ts`
Expected: FAIL — `parseAutoEvidence` / `checklistTicks` not defined.

- [ ] **Step 3: Implement**

In `src/reports/airtable/reports.ts`:

1. Import the evidence type at top: `import type { EvidenceRecord } from "../auto-tick.js";`
2. Add to `ReportRow` (after `checklist`): `autoEvidence: Record<string, EvidenceRecord> | null;`
3. Add `parseAutoEvidence` (modeled on `parseNotifyRouting`):

```typescript
/** Parse the `Checklist auto-evidence` JSON field → a field→EvidenceRecord map, or null when
 *  absent/malformed. Permissive on shape (it's display-only); a bad blob just yields null. */
export function parseAutoEvidence(raw: unknown): Record<string, EvidenceRecord> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, EvidenceRecord>;
}
```

4. In `mapRow`, add: `autoEvidence: parseAutoEvidence(f["Checklist auto-evidence"]),`
5. Add to `DraftInput`: `checklistTicks?: string[];` and `autoEvidence?: Record<string, EvidenceRecord>;`
6. In `createDraft`, after the existing optional writes, before `create`:

```typescript
for (const field of input.checklistTicks ?? []) fields[field] = true;
if (input.autoEvidence && Object.keys(input.autoEvidence).length > 0) {
  fields["Checklist auto-evidence"] = JSON.stringify(input.autoEvidence);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reports/reports-autoevidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/reports.ts tests/reports/reports-autoevidence.test.ts
git commit -m "feat(reports): persist auto-tick booleans + Checklist auto-evidence on the report row"
```

---

## Task 3: Wire `autoTickChecklist` into `draftReportForSite`

**Files:**

- Modify: `src/reports/draft.ts`
- Test: `tests/reports/draft.test.ts` (add cases)

**Context:** `draftReportForSite` computes `search` (the SearchPresence value) and `searchResult` (`{value, softFailed}`) around lines 122-125. `createDraft` is called at lines 181-196. Plug the auto-tick computation in just before `createDraft` and feed it the result. Reuse `searchResult` (which carries `softFailed`). NOTE: the completeRowId path (lines ~156-171) does NOT createDraft — Phase 1 only adds auto-tick to the create path; the complete path keeps current behavior (a follow-up can revisit).

- [ ] **Step 1: Write the failing test** (append to `tests/reports/draft.test.ts`)

```typescript
it("auto-ticks Google Indexed when Search Console shows page 1", async () => {
  vi.mocked(fetchSearch).mockResolvedValue({ value: { foundOnPage1: true, position: 2 }, softFailed: false });
  const base = makeFakeBase({ Reports: [] });
  await draftReportForSite(base, siteFixture(), "Maintenance");
  const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
  expect(fields["Maint: Google Indexed"]).toBe(true);
  const ev = JSON.parse(fields["Checklist auto-evidence"] as string);
  expect(ev["Maint: Google Indexed"].result).toBe("pass");
});

it("does NOT auto-tick Google Indexed when not on page 1", async () => {
  vi.mocked(fetchSearch).mockResolvedValue({ value: { foundOnPage1: false, position: 22 }, softFailed: false });
  const base = makeFakeBase({ Reports: [] });
  await draftReportForSite(base, siteFixture(), "Maintenance");
  const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
  expect(fields["Maint: Google Indexed"]).toBeUndefined();
});
```

(`fetchSearch` is already mocked in this file — confirm the existing `vi.mock("../../src/reports/draft.js", ...)` exposes it; if the file mocks search elsewhere, follow that idiom.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/reports/draft.test.ts`
Expected: FAIL — booleans/evidence not written.

- [ ] **Step 3: Implement**

In `src/reports/draft.ts`:

1. Import: `import { autoTickChecklist } from "./auto-tick.js";`
2. Just before the `createDraft` call (the create path, ~line 181), compute:

```typescript
const evidence = autoTickChecklist(siteRow, reportType, completedOn, {
  search: searchResult,
});
const checklistTicks = [...evidence.entries()]
  .filter(([, e]) => e.result === "pass")
  .map(([field]) => field);
const autoEvidence = Object.fromEntries(evidence);
```

3. Add to the `createDraft({ ... })` object: `checklistTicks, autoEvidence,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reports/draft.test.ts`
Expected: PASS (incl. the two new cases).

- [ ] **Step 5: Commit**

```bash
git add src/reports/draft.ts tests/reports/draft.test.ts
git commit -m "feat(reports): draft auto-ticks checklist boxes from autoTickChecklist"
```

---

## Task 4: Dashboard `checklistBlock` — 3-state rendering (auto-green / amber / manual)

**Files:**

- Modify: `src/dashboard/render.ts`
- Test: `tests/dashboard/render.test.ts` (add cases)

**Context:** `checklistBlock(r: ReportRow)` is at render.ts:50-67; it has the full `ReportRow`, so it can read `r.autoEvidence`. Per item: if `r.autoEvidence?.[item.field]` exists, render a badge — green when `result==="pass"` (box rendered `checked`), amber otherwise (box not checked) — with the `note` as a `title=` tooltip + visible text. Items with no evidence render exactly as today. The checkbox stays operator-toggleable (data-* attrs unchanged).

- [ ] **Step 1: Write the failing test** (append to `tests/dashboard/render.test.ts`)

```typescript
it("renders an auto-green badge with evidence note for a passed auto-check", () => {
  const r = pendingMaintenanceReport({
    checklist: { ...COMPLETE_MAINTENANCE, "Maint: Google Indexed": true },
    autoEvidence: { "Maint: Google Indexed": { result: "pass", checkedAt: "2026-06-18T12:00:00.000Z", note: "Page 1 on Google (#3)" } },
  });
  const html = renderSiteDashboardHtml(siteRow(), [r]);
  expect(html).toContain("Page 1 on Google (#3)");
  expect(html).toMatch(/auto/i);
});

it("renders an amber badge (box not checked) for a failed auto-check", () => {
  const r = pendingMaintenanceReport({
    checklist: { "Maint: Google Indexed": false },
    autoEvidence: { "Maint: Google Indexed": { result: "fail", checkedAt: "2026-06-18T12:00:00.000Z", note: "Not on page 1 (avg #22)" } },
  });
  const html = renderSiteDashboardHtml(siteRow(), [r]);
  expect(html).toContain("Not on page 1 (avg #22)");
});
```

(Use the file's existing report-fixture helper; if none, build a `ReportRow` literal with `autoEvidence` set. Ensure `pendingMaintenanceReport`/equivalent sets `reportType: "Maintenance"`, `draftReady: true`, `sentAt: null`, `approvedToSend: false` so it lands in the pending list.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dashboard/render.test.ts`
Expected: FAIL — note not present.

- [ ] **Step 3: Implement**

Replace the per-item map in `checklistBlock` (render.ts:60-65) with evidence-aware rendering:

```typescript
const boxes = items
  .map((item) => {
    const ev = r.autoEvidence?.[item.field];
    const checked = r.checklist[item.field] === true ? " checked" : "";
    const badge = ev
      ? ev.result === "pass"
        ? ` <span class="auto-badge auto-pass" title="${escapeHtml(ev.note)}">auto ✓</span>`
        : ` <span class="auto-badge auto-amber" title="${escapeHtml(ev.note)}">auto: ${escapeHtml(ev.note)}</span>`
      : "";
    return `<label class="check-item"><input type="checkbox" class="checklist-checkbox" data-checklist-report-id="${rid}" data-field="${escapeHtml(item.field)}" data-checklist-url="${escapeHtml(url)}"${checked} /> ${escapeHtml(item.label)}${badge}</label>`;
  })
  .join("");
```

Add minimal CSS near the existing `.checklist` rule (render.ts:~225):

```css
.auto-badge { font-size: 0.72rem; border-radius: 0.25rem; padding: 0 0.35rem; }
.auto-pass { background: #e6f4ea; color: #137333; }
.auto-amber { background: #fef7e0; color: #b06000; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dashboard/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/render.ts tests/dashboard/render.test.ts
git commit -m "feat(dashboard): render auto-tick evidence (green/amber) beside checklist items"
```

---

## Task 5: Full gate + changeset

**Files:**

- Create: `.changeset/checklist-auto-tick-phase1.md`

- [ ] **Step 1: Add the changeset**

```markdown
---
"@reddoorla/maintenance": minor
---

Report checklist items can now auto-tick from verified signals. Phase 1 ships the engine
(`autoTickChecklist`, a `Checklist auto-evidence` snapshot on the report, and green/amber
evidence badges on the dashboard beside each checkbox) and wires the first signal: **Google
Indexed** auto-ticks when Search Console shows the brand query on page 1 at draft time.
Fail-safe — a box auto-ticks only on fresh positive proof; missing/soft-failed/negative
signals leave it manual (amber, with the reason). The per-report human approve gate is unchanged.
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add .changeset/checklist-auto-tick-phase1.md
git commit -m "chore(reports): changeset for checklist auto-tick phase 1"
```

---

## Airtable operator setup (out-of-band, note in the PR)

One new field must exist on the **Reports** table before draft writes it: **`Checklist auto-evidence`** (Long text). Until it exists, Airtable rejects the write — so the PR description must call this out as a pre-merge/pre-run operator step (mirrors prior "add the field" gates).

---

## Self-Review

- **Spec coverage:** engine (Task 1), evidence snapshot (Task 2), draft integration (Task 3),
  dashboard 3-state (Task 4), Google Indexed signal (Tasks 1+3), fail-safe invariant (Task 1
  tests). Security/Domain/Browser are Phase 2/3 (out of scope here, by design).
- **Type consistency:** `EvidenceRecord` defined in auto-tick.ts, imported by reports.ts;
  `checklistTicks: string[]` + `autoEvidence: Record<string, EvidenceRecord>` consistent across
  DraftInput/createDraft/draft.ts; `autoEvidence` on ReportRow read by render.ts.
- **No placeholders:** every step has concrete code + commands.
