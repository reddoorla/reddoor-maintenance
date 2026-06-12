# M6a — Copy flow implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move every hardcoded email-copy string out of `template.ts` into one `DEFAULT_COPY` module, let a site override **intro · contact · footer** via three Airtable fields (`override ?? default`), and thread a resolved `copy` object through `ReportData`. A site with blank overrides renders a **byte-identical** email to today.

**Architecture:** `src/reports/copy.ts` holds `ResolvedCopy` + `DEFAULT_COPY` (all current literals, verbatim) + pure `resolveCopy(site)`. `ReportData` gains optional `copy`; `buildMjml` reads `data.copy ?? DEFAULT_COPY`. The two `ReportData` assembly sites thread `copy: resolveCopy(site)`.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), vitest, MJML. No new deps.

**Reference (real code):**

- `src/reports/maintenance-email/template.ts` — `buildMjml(data)`, the literal copy in `maintenanceChecksSection`/`testingChecklistSection`/`testingIntroSection`/`commentarySection` + the inline intro/contact/footer/SEO strings; `escapeXml`.
- `src/reports/types.ts` — `ReportData` (add `copy?`).
- `src/reports/airtable/websites.ts` — `WebsiteRow`/`mapRow`; `dashboardToken` is the blank-trim-to-null pattern to mirror.
- `src/reports/draft.ts:109` and `src/reports/send/orchestrate.ts:114` — the two `renderReportHtml({...})` `ReportData` literals to thread `copy` into (`site` is in scope at both).
- `tests/reports/render.test.ts` — the existing render regression test (must stay green = byte-identical proof).

**PREREQUISITE (controller, before merge):** create three Websites long-text fields live via Airtable MCP (base `appHG8nLOzULzXOER`, table `tblerElkKDif2VqrO`): `Copy — Intro`, `Copy — Contact`, `Copy — Footer`. Additive.

---

## File Structure

- **Create** `src/reports/copy.ts` — `ResolvedCopy`, `DEFAULT_COPY`, `resolveCopy`.
- **Create** `tests/reports/copy.test.ts`.
- **Modify** `src/reports/types.ts` — `ReportData.copy?: ResolvedCopy`.
- **Modify** `src/reports/maintenance-email/template.ts` — read from `data.copy ?? DEFAULT_COPY`.
- **Modify** `src/reports/airtable/websites.ts` — 3 fields + `mapRow` + (fixtures across the suite).
- **Modify** `src/reports/draft.ts`, `src/reports/send/orchestrate.ts` — thread `copy: resolveCopy(site)`.
- **Create** `.changeset/m6a-copy-flow.md`.

---

## Task 1: The copy module (`DEFAULT_COPY` + `resolveCopy`)

**Files:** Create `src/reports/copy.ts`, `tests/reports/copy.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_COPY, resolveCopy, type ResolvedCopy } from "../../src/reports/copy.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

// Minimal WebsiteRow with the 3 copy override fields; controller provides the full factory.
function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    copyIntro: null,
    copyContact: null,
    copyFooter: null,
    name: "Acme",
    id: "rec1",
  } as WebsiteRow;
}

describe("resolveCopy", () => {
  it("with no overrides returns the defaults verbatim", () => {
    const c = resolveCopy(site());
    expect(c).toEqual(DEFAULT_COPY);
  });

  it("overrides the maintenance intro from copyIntro", () => {
    const c = resolveCopy(site({ copyIntro: "Custom intro." }));
    expect(c.maintenanceIntro).toBe("Custom intro.");
    expect(c.maintenanceChecks).toEqual(DEFAULT_COPY.maintenanceChecks); // untouched
  });

  it("splits a multi-line contact override into lines", () => {
    const c = resolveCopy(site({ copyContact: "Line one\nLine two" }));
    expect(c.contact).toEqual(["Line one", "Line two"]);
  });

  it("footer override: first line → org, rest → address lines", () => {
    const c = resolveCopy(site({ copyFooter: "Beta LLC\n1 Main St\nAustin, TX 78701" }));
    expect(c.footerOrg).toBe("Beta LLC");
    expect(c.footerAddress).toEqual(["1 Main St", "Austin, TX 78701"]);
  });

  it("treats a blank/whitespace override as absent (keeps default)", () => {
    const c = resolveCopy(site({ copyIntro: "   " }));
    expect(c.maintenanceIntro).toBe(DEFAULT_COPY.maintenanceIntro);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- copy`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/reports/copy.ts`

Copy every literal from `template.ts` VERBATIM (do not rephrase):

```ts
import type { WebsiteRow } from "./airtable/websites.js";

export type ResolvedCopy = {
  maintenanceIntro: string;
  maintenanceChecks: string[]; // 6; index 3 is the Google row's no-position default
  testingIntro: string;
  testingChecklist: string[]; // 6
  notesHeader: string;
  seoCta: string;
  contact: string[]; // closing invitation lines
  footerOrg: string;
  footerAddress: string[];
};

export const DEFAULT_COPY: ResolvedCopy = {
  maintenanceIntro:
    "Includes checking the hosting, DNS, Content Management System (CMS, if applicable), search indexing and security of the site for major flaws and updating as necessary.",
  maintenanceChecks: [
    "Reviewed Logs",
    "CMS Checked",
    "DNS Checked",
    "Google Indexed",
    "Reviewed Certificate",
    "Security Updates",
  ],
  testingIntro:
    "Testing includes checks similar to those at launch: testing on common browsers and operating systems, at different screen sizes, and checking every function, and updating all packages for performance rather than just those needed for security.",
  testingChecklist: [
    "Desktop Browsers",
    "Mobile Browsers",
    "Package Updates",
    "Bottlenecks",
    "Form Functionality",
    "Animation Functionality",
  ],
  notesHeader: "NOTES",
  seoCta: "Contact us if you are interested in more in-depth data or have questions about SEO.",
  contact: ["Just hit reply.", "We're here to help in any way we can."],
  footerOrg: "Reddoor Creative, LLC",
  footerAddress: ["29027 Dapper Dan", "Fair Oaks Ranch, TX 78015"],
};

/** Trim an override to null when blank (mirrors dashboardToken). */
function override(v: string | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Resolve a site's effective copy: DEFAULT_COPY with the three per-site narrative
 * overrides applied. Only maintenanceIntro/contact/footer are per-site (M6a §2);
 * everything else is the shared default. PURE.
 */
export function resolveCopy(site: WebsiteRow): ResolvedCopy {
  const intro = override(site.copyIntro);
  const contact = override(site.copyContact);
  const footer = override(site.copyFooter);
  const footerLines = footer ? footer.split("\n") : null;
  return {
    ...DEFAULT_COPY,
    maintenanceIntro: intro ?? DEFAULT_COPY.maintenanceIntro,
    contact: contact ? contact.split("\n") : DEFAULT_COPY.contact,
    footerOrg: footerLines ? (footerLines[0] ?? DEFAULT_COPY.footerOrg) : DEFAULT_COPY.footerOrg,
    footerAddress: footerLines ? footerLines.slice(1) : DEFAULT_COPY.footerAddress,
  };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm test -- copy` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/copy.ts tests/reports/copy.test.ts
git commit -m "feat(copy): DEFAULT_COPY catalog + resolveCopy (per-site intro/contact/footer)"
```

---

## Task 2: Websites copy fields + `WebsiteRow`

**Files:** Modify `src/reports/airtable/websites.ts`; update WebsiteRow fixtures across the suite.

- [ ] **Step 1: Add the fields to `WebsiteRow`** (after `dashboardToken`):

```ts
/** Per-site copy overrides (M6a). Blank → null → the DEFAULT_COPY value. */
copyIntro: string | null;
copyContact: string | null;
copyFooter: string | null;
```

- [ ] **Step 2: Add `mapRow` reads** (mirror `dashboardToken`'s blank-trim-to-null):

```ts
    copyIntro: trimToNull(f["Copy — Intro"]),
    copyContact: trimToNull(f["Copy — Contact"]),
    copyFooter: trimToNull(f["Copy — Footer"]),
```

If a `trimToNull` helper doesn't exist, inline the same `typeof === "string"` + trim logic `dashboardToken` uses, or add a small local helper. (Note the em-dash `—` in the column names — copy them exactly.)

- [ ] **Step 3: Update every WebsiteRow fixture.** Adding required fields breaks the shared full-object factories (this is the recurring fixture churn — see the slice-2a lesson). Run `pnpm typecheck`, then add the three fields (`copyIntro: null, copyContact: null, copyFooter: null`) to EVERY full-`WebsiteRow` fixture it flags (e.g. `tests/dashboard/*.test.ts`, `tests/alerts/digest-collectors.test.ts`, `tests/audits/write-audits-to-airtable.test.ts`, `tests/reports/draft.test.ts`, `tests/reports/due.test.ts`, and the new `tests/reports/copy.test.ts` site() factory). Iterate `pnpm typecheck` until 0 errors.

- [ ] **Step 4: Verify** — `pnpm typecheck` (0 errors) + `pnpm test -- websites copy` → green.

- [ ] **Step 5: Commit**

```bash
git add -A ':!docs/morning-reports'
git commit -m "feat(airtable): WebsiteRow copy override fields (copyIntro/copyContact/copyFooter)"
```

---

## Task 3: Thread `copy` through `ReportData` + refactor the template

**Files:** Modify `src/reports/types.ts`, `src/reports/maintenance-email/template.ts`; Test `tests/reports/render.test.ts` (existing, must stay green) + add an override test.

- [ ] **Step 1: Add `copy?` to `ReportData`** (`src/reports/types.ts`, after `commentary`):

```ts
  /** Resolved per-site copy (M6a). Omitted → the template falls back to DEFAULT_COPY. */
  copy?: import("./copy.js").ResolvedCopy;
```

- [ ] **Step 2: Refactor `template.ts` to read from copy.** Import `DEFAULT_COPY`; at the top of `buildMjml`, add `const copy = data.copy ?? DEFAULT_COPY;`. Then replace each literal:

- `maintenanceChecksSection(searchPosition)` → take `copy` (or the labels) as an arg; build rows from `copy.maintenanceChecks`, substituting the Google row (index 3): `const rows = copy.maintenanceChecks.map((label, i) => (i === 3 ? googleLabel : label));` where `googleLabel = searchPosition !== undefined ? \`Page 1 Google Result (#${searchPosition})\` : copy.maintenanceChecks[3]`.
- `testingChecklistSection()` → build rows from `copy.testingChecklist`.
- `testingIntroSection()` → the body text → `escapeXml(copy.testingIntro)`.
- `commentarySection` header "NOTES" → `escapeXml(copy.notesHeader)`.
- The maintenance intro literal (line ~212) → `escapeXml(copy.maintenanceIntro)`.
- The SEO CTA literal (line ~242) → `escapeXml(copy.seoCta)`.
- The closing contact lines "Just hit reply." / "We're here to help…" (lines ~250–251) → render from `copy.contact` (`.map` to the existing `<mj-text>` shape, `escapeXml` each).
- The footer org/address literals (lines ~255–257) → `escapeXml(copy.footerOrg)` + `copy.footerAddress.map(...)`. Keep the `Copyright ${year}` line as-is (auto-year).

Thread `copy` into the section helpers that need it (pass `copy` or the specific arrays). Keep ALL MJML attributes/markup byte-identical — only the text content changes source.

- [ ] **Step 3: Add the override + regression tests** to `tests/reports/render.test.ts`:

```ts
// Byte-identical: a report with no `copy` renders exactly as before (the existing
// assertions already pin this — keep them green). Add an override check:
it("a per-site copy override changes only that string", async () => {
  const base = /* the existing test's ReportData */;
  const { html } = await renderReportHtml({ ...base, copy: { ...DEFAULT_COPY, maintenanceIntro: "ZZZ-CUSTOM-INTRO" } });
  expect(html).toContain("ZZZ-CUSTOM-INTRO");
  expect(html).not.toContain(DEFAULT_COPY.maintenanceIntro);
});
```

(Import `DEFAULT_COPY` in the test. Reuse whatever `ReportData` the existing tests build.)

- [ ] **Step 4: Verify** — `pnpm test -- render` → the EXISTING assertions stay green (proves byte-identical) + the new override test passes. Then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/reports/types.ts src/reports/maintenance-email/template.ts tests/reports/render.test.ts
git commit -m "feat(copy): template reads data.copy ?? DEFAULT_COPY (no literals)"
```

---

## Task 4: Thread `resolveCopy(site)` into the two assembly sites

**Files:** Modify `src/reports/draft.ts`, `src/reports/send/orchestrate.ts`. (Integration; gate = typecheck + build + the full suite.)

- [ ] **Step 1:** In `src/reports/send/orchestrate.ts` (~line 114, the `renderReportHtml({...})` literal), import `resolveCopy` and add `copy: resolveCopy(site),` to the object. (`site` is the `WebsiteRow` in scope in `sendOne`.)

- [ ] **Step 2:** In `src/reports/draft.ts` (~line 109, the `renderReportHtml({...})` literal), likewise add `copy: resolveCopy(site),`. (Confirm the in-scope site variable name; it's the `WebsiteRow`/`Site` the draft renders for — if it's the lighter `Site` type without the copy fields, resolve from the `WebsiteRow` the draft already loads, or pass through. Read the function to confirm which object carries `copyIntro`.)

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm build && pnpm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add src/reports/draft.ts src/reports/send/orchestrate.ts
git commit -m "feat(copy): resolve per-site copy at report assembly (send + draft paths)"
```

---

## Task 5: Changeset + final gate

- [ ] **Step 1:** Create `.changeset/m6a-copy-flow.md`:

```md
---
"@reddoorla/maintenance": minor
---

feat(copy): email copy is now data, not scattered literals (M6a). Every hardcoded string in the report template moves into one `DEFAULT_COPY` catalog (`src/reports/copy.ts`) — fleet-wide wording is a one-file edit. A site can override the three most client-facing narrative blocks — **intro · contact · footer** — via new Airtable fields (`Copy — Intro/Contact/Footer`), merged `override ?? default` like report recipients. A site with no overrides renders a byte-identical email. Sets up the launch email (M6b) to reuse the same copy layer.
```

- [ ] **Step 2: Commit** — `git add .changeset/m6a-copy-flow.md && git commit -m "chore(changeset): M6a copy flow"`.

- [ ] **Step 3: Final gate** (controller): `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist` → all green. Then the AUTONOMY.md 3-lens review (spec / quality / a LIVE lens confirming the 3 Airtable column names match `mapRow` exactly + a blank-override row renders defaults) before the head-SHA merge.

---

## Self-review

- **Spec coverage:** `DEFAULT_COPY` + `resolveCopy` (§4.1) → Task 1; fields + `WebsiteRow` (§4.2) → Task 2; `ReportData.copy` + template (§4.3) → Task 3; assembly threading (§4.4) → Task 4.
- **Byte-identical guarantee:** the existing `tests/reports/render.test.ts` assertions are the regression guard — they must pass unchanged after Task 3 (literals moved verbatim into `DEFAULT_COPY`). Task 3's new test proves the override path.
- **Type consistency:** `ResolvedCopy` defined in Task 1, consumed by `ReportData.copy` (Task 3) and the template; `copyIntro/copyContact/copyFooter` on `WebsiteRow` (Task 2) read by `resolveCopy` (Task 1) — verify the field names match.
- **Fixture churn:** Task 2 Step 3 explicitly updates all WebsiteRow fixtures (the slice-2a lesson — don't defer it).
