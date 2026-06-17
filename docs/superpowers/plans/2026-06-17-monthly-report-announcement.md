# Monthly-Report Announcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Add an `Announcement` report type that rides the existing draft→approve→send pipeline to send maintenance clients a one-time, personalized "your new monthly report" email — with a live preview of their latest Lighthouse scores, recent-improvement callouts (Resend forms + Svelte 5, where relevant), and a soft open door.

**Architecture:** New `ReportType` + a dedicated MJML template + a fleet-wide draft recipe + CLI command. The send path, approve loop, idempotency, delivery tracking, and M6a copy layer are reused unchanged. See `docs/superpowers/specs/2026-06-17-monthly-report-announcement-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), MJML email templates, Airtable, vitest. TDD throughout. Full gate before merge: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`.

**Key reused shapes (already verified in the codebase):**

- `ReportType = "Maintenance" | "Testing" | "Launch"` (`src/reports/types.ts:1`).
- `ReportData` (`src/reports/types.ts:20`) — `lighthouse: LighthouseScores` is **required, all four fields non-null `number`**.
- `LighthouseScores = { performance; accessibility; bestPractices; seo }` (numbers).
- `ResolvedCopy` / `DEFAULT_COPY` / `resolveCopy(site)` (`src/reports/copy.ts`) — `resolveCopy` spreads `DEFAULT_COPY`, so new keys flow through automatically.
- `buildLaunchMjml(data)` (`src/reports/launch-email/template.ts`) — the template to mirror; imports `escapeXml, fmtDate, headerImageTag, headerStyleBlock` from `../maintenance-email/template.js`. **All copy is escaped.**
- `renderReportHtml` dispatch (`src/reports/render.ts:12`): `data.reportType === "Launch" ? buildLaunchMjml(data) : buildMjml(data)`.
- `createDraft` / `DraftInput` (`src/reports/airtable/reports.ts:115,147`); `toReportType` (`:9`); `findReportByPeriod`, `updateReportScores`, `setDraftReady`.
- `launch` recipe (`src/recipes/launch.ts`) — mirror its dedupe + render→upload→setDraftReady block. `announce` does NOT bootstrap/audit; it is draft-only over stored Airtable scores.
- `WebsiteRow` (`src/reports/airtable/websites.ts`): `status`, `url`, `pScore/rScore/bpScore/seoScore` (`number | null`), `reportRecipientsTo`, `copy*`. `listWebsites`, `siteSlug`.
- Send path (`src/reports/send/orchestrate.ts`): `sendOne` renders by `report.reportType` and guards `if (!report.lighthouse)`; the post-send Status flip is gated `if (report.reportType === "Launch")` — **Announcement needs no send-path edit.**
- CLI: `runLaunchCommand` (`src/cli/commands/launch.ts`), registered in `src/cli/bin.ts:289`.

---

## Task A: Type + copy + Airtable plumbing

**Files:**

- Modify: `src/reports/types.ts`
- Modify: `src/reports/copy.ts`
- Modify: `src/reports/airtable/reports.ts`
- Test: `tests/reports/copy.test.ts`, `tests/reports/airtable/reports.test.ts`

- [ ] **Step 1 — types.** In `src/reports/types.ts`: add `"Announcement"` to `ReportType`. Add to `ReportData`:

```ts
  /** Announcement-only: which recent-improvement callouts to render. Undefined for
   *  Maintenance/Testing/Launch → the section is absent. */
  improvements?: { resendForms?: boolean; svelte5?: boolean };
```

- [ ] **Step 2 — copy (failing test first).** In `tests/reports/copy.test.ts` add a test that `DEFAULT_COPY` has the announcement keys and `resolveCopy(makeWebsiteRow({}))` passes them through unchanged. Run it; expect FAIL (keys absent).

- [ ] **Step 3 — copy impl.** In `src/reports/copy.ts` extend `ResolvedCopy` and `DEFAULT_COPY` with:

```ts
  announceHeading: string;        // e.g. "YOUR MONTHLY REPORT"
  announceBody: string;           // intro: ongoing monitoring & maintenance for {site}
  announceMonitorItems: string[]; // ["Performance", "Accessibility", "Security", "Uptime"]
  announcePreviewLabel: string;   // "A snapshot of your first report:"
  announceImprovementResend: string; // forms-via-Resend callout
  announceImprovementSvelte5: string; // Svelte 5 modernization callout
  announceCadence: string;        // "You'll get this every month — nothing's needed from you."
  announceOpenDoor: string;       // "If you'd ever like to expand scope or add features to your site, just reply."
```

Default wording (pure value, no pricing; `{site}` is substituted by the template, not stored here — keep these site-agnostic). `resolveCopy` already spreads `DEFAULT_COPY`, so no change to its body. Run the test; expect PASS.

- [ ] **Step 4 — reports.ts (failing tests first).** In `tests/reports/airtable/reports.test.ts` add: (a) `toReportType("Announcement")` returns `"Announcement"`; (b) `createDraft` writes `"Subject override"` when `subjectOverride` is supplied and omits the key when not. Run; expect FAIL.

- [ ] **Step 5 — reports.ts impl.** In `src/reports/airtable/reports.ts`: `toReportType` accepts `"Announcement"` (add to the known set). Add `subjectOverride?: string` to `DraftInput`; in `createDraft`, `if (input.subjectOverride !== undefined) fields["Subject override"] = input.subjectOverride;` (place beside the other optional-field writes). Run tests; expect PASS.

- [ ] **Step 6 — gate + commit.** `pnpm lint && pnpm typecheck && pnpm test`. Commit: `feat(reports): Announcement report type + announcement copy + createDraft subjectOverride`.

## Task B: Announcement template + render dispatch

**Files:**

- Create: `src/reports/announcement-email/template.ts`
- Modify: `src/reports/render.ts`
- Test: `tests/reports/announcement-email/template.test.ts`, `tests/reports/render.test.ts`

- [ ] **Step 1 — template tests first.** New `tests/reports/announcement-email/template.test.ts`. Build a `ReportData` with `reportType:"Announcement"`, real `lighthouse` scores, `copy: DEFAULT_COPY` (or a resolved copy). Assert the MJML string:
  - contains `announceHeading`, `announceBody` (with the site name substituted), each of the four score numbers, the four `announceMonitorItems`, `announcePreviewLabel`, `announceOpenDoor`;
  - when `improvements: { resendForms:true, svelte5:true }` → contains BOTH improvement strings; `{ resendForms:true }` only → contains the Resend one, NOT the Svelte 5 one; `improvements` undefined → contains NEITHER (and no empty improvements heading);
  - **no-pricing invariant:** does not match `/\$|\bprice\b|\bplan\b|\bpricing\b/i`;
  - escaping: a site name like `A & B <co>` is escaped;
  - copy override: a resolved copy with custom `contact`/`footer` renders those.
    Run; expect FAIL (module absent).

- [ ] **Step 2 — template impl.** Create `buildAnnouncementMjml(data: ReportData)` mirroring `buildLaunchMjml`'s structure (head/attributes/preview/`headerStyleBlock`, header section via `headerImageTag`, then content sections). Use `const copy = data.copy ?? DEFAULT_COPY`. Escape ALL copy + the site name via `escapeXml`. Sections in order: greeting/`announceBody` (substitute `escapeXml(data.siteName)`), conditional improvements list (render an item per enabled flag from `data.improvements`; omit the whole `mj-text`/list block if neither flag set), `announceMonitorItems` list, score preview (`announcePreviewLabel` + the four `data.lighthouse` numbers, labeled Performance/Accessibility/Best Practices/SEO), `announceCadence`, `announceOpenDoor`, then the contact + footer block copied from the launch template (contact rows, divider, copyright/footerOrg/footerAddress). Run tests; expect PASS.

- [ ] **Step 3 — render dispatch (failing test first).** In `tests/reports/render.test.ts` add: rendering a `reportType:"Announcement"` `ReportData` produces HTML containing an announcement-only marker (e.g. the `announceOpenDoor` text), and a `"Maintenance"`/`"Launch"` data still renders their templates. Run; expect FAIL.

- [ ] **Step 4 — render impl.** In `src/reports/render.ts:12` change the dispatch to:

```ts
const mjml =
  data.reportType === "Launch"
    ? buildLaunchMjml(data)
    : data.reportType === "Announcement"
      ? buildAnnouncementMjml(data)
      : buildMjml(data);
```

Add the import. Run tests; expect PASS.

- [ ] **Step 5 — gate + commit.** `pnpm lint && pnpm typecheck && pnpm test`. Commit: `feat(reports): announcement email template + render dispatch`.

## Task C: `announce` recipe + CLI

**Files:**

- Create: `src/recipes/announce.ts`
- Create: `src/cli/commands/announce.ts`
- Modify: `src/cli/bin.ts`
- Modify: `src/index.ts` (export `announce` + result types if siblings are exported there)
- Test: `tests/recipes/announce.test.ts`

- [ ] **Step 1 — recipe tests first.** New `tests/recipes/announce.test.ts` using `makeFakeBase` seeded with Websites rows. Define:

```ts
export type AnnounceSiteResult =
  | { site: string; status: "drafted" | "reused"; reportId: string; recipientMissing: boolean }
  | { site: string; status: "skipped-no-scores" }
  | { site: string; status: "error"; message: string };
export type AnnounceResult = { results: AnnounceSiteResult[] };
export async function announce(opts?: {
  base?: AirtableBase;
  site?: string;
  now?: Date;
}): Promise<AnnounceResult>;
```

Assert: only `status === "maintenance"` sites are processed; `site` filter selects one by `siteSlug`; a site missing ANY of the four scores → `skipped-no-scores` (no draft); a complete-score site → a `createDraft` call with `reportType:"Announcement"`, `improvements:{resendForms:true,svelte5:true}`, a non-empty `subjectOverride`, and `setDraftReady` true; `recipientMissing` true when `reportRecipientsTo` is blank; a pre-existing Announcement row for (site, period) → `reused` (no second create — assert via `findReportByPeriod`/fake call count); one site throwing does NOT abort the rest (seed a row that forces an error path and assert other sites still drafted). Run; expect FAIL.

- [ ] **Step 2 — recipe impl.** Create `src/recipes/announce.ts`:
  - `const base = opts.base ?? openBase(readAirtableConfig()); const now = opts.now ?? new Date();`
  - `const websites = await listWebsites(base);`
  - `let targets = websites.filter((w) => w.status === "maintenance");` then if `opts.site`, `targets = targets.filter((w) => siteSlug(w.name) === siteSlug(opts.site))`.
  - `const period = now.toISOString().slice(0, 7);`
  - For each target, wrapped in try/catch (push an `error` result, continue — never throw the loop):
    - `const scores = scoresFromRow(w)` → returns `LighthouseScores | null` (null if any of pScore/rScore/bpScore/seoScore is null). If null → push `skipped-no-scores`, continue.
    - `findReportByPeriod(base, w.id, "Announcement", period)`; if existing → `updateReportScores(base, existing.id, scores, now)`, `report = existing`, status `reused`; else `createDraft(base, draftInputFor(w, scores, now, period))`, status `drafted`.
    - Render via `renderReportHtml({ siteName, siteUrl: w.url, reportType:"Announcement", completedOn: now, lighthouse: scores, lastTestedDate:null, commentary:null, copy: resolveCopy(w), headerImageCid: \`${slug}-header\`, improvements: { resendForms:true, svelte5:true } })`; upload `Rendered HTML`(best-effort, warn on failure like launch);`setDraftReady(base, report.id, true)` (NOT wrapped — failure → error result).
    - `recipientMissing = !w.reportRecipientsTo` (after trim).
  - `draftInputFor` sets `reportType:"Announcement"`, `reportId = \`${w.name} — Announcement — ${ymd}\``, `period`, `periodStart/End/completedOn = now`, `lighthouse: scores`, `lastTestedDate: null`, `subjectOverride`(e.g.`\`Your ${w.name} maintenance report is live\`` — confirm wording in review).
    Run tests; expect PASS.

- [ ] **Step 3 — CLI command (test + impl).** Mirror `src/cli/commands/launch.ts`: `runAnnounceCommand(site: string | undefined, opts)` calls `announce({ site })`, prints the per-site result list (drafted/reused/skipped/error + a `⚠ recipient missing` note). Add a small format test if `launch.ts` has one; otherwise a focused unit test on the formatter. Register in `src/cli/bin.ts` mirroring `:289`: `announce [site]` (optional arg), description "Draft the monthly-report announcement email for maintenance sites (all, or one) for approval."

- [ ] **Step 4 — exports.** If `launch` is exported from `src/index.ts`, export `announce` + its result types beside it (keep the public surface consistent). Verify with `pnpm test:dist` later.

- [ ] **Step 5 — gate + commit.** `pnpm lint && pnpm typecheck && pnpm test`. Commit: `feat(recipes): announce — draft monthly-report announcement per maintenance site`.

## Task D: changeset, full gate, PR

- [ ] **Step 1 — changeset.** `.changeset/monthly-report-announcement.md`, `minor`: describe the Announcement report type + `announce` recipe/CLI, the live score preview, the recent-improvement callouts (Resend forms + Svelte 5, default-on with operator review), and the operational prereq (add the `Announcement` Airtable `Report type` option). Wrap host/glob tokens in code-spans (prettier reads `*.x` as emphasis).

- [ ] **Step 2 — full gate.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`. Fix any prettier issues with `npx prettier --write` on touched files.

- [ ] **Step 3 — sample render (manual sanity).** Render one announcement to HTML from a seeded `ReportData` (a tiny script via `ctx_execute` or a throwaway test) and eyeball the copy + score preview + improvements + no-pricing before opening the PR.

- [ ] **Step 4 — PR.** Branch already `feat/monthly-report-announcement`. Push, open PR (closes nothing; references the spec). Body: what shipped, the operational prereqs (Airtable `Announcement` option, release, recipients), and the suggested first run (`announce <one-site>` to a test recipient).

## Self-review notes (author)

- Spec coverage: Task A (types/copy/subjectOverride), B (template/dispatch), C (recipe/CLI) ⇒ every spec component 1–7. ✓
- Type consistency: `improvements` shape identical in types.ts (Step A1), template (B2), recipe (C2). `AnnounceSiteResult`/`AnnounceResult` defined in C1 used in C2/C3. `scoresFromRow` returns `LighthouseScores | null`. ✓
- The "—/null score" degradation from the spec is intentionally replaced by **skip-if-any-null** (because `LighthouseScores` is non-nullable) — recipe enforces complete scores; template never sees a null. ✓
- No send-path edits (verified `sendOne` renders by type + Launch-only status flip). ✓
