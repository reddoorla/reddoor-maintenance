# `selftest` — operator self-test commands (Design)

**Status:** approved design, pre-plan
**Date:** 2026-06-26
**Author:** Tucker + Claude

## Goal

Replace the hand-rolled throwaway "send myself a preview of a report email" script with a
supported CLI command, so the operator can preview any report email for any site in a real inbox
(real client rendering, real inline images) **without any Airtable side effects**. Build it under
a `selftest` namespace that can house other operator self-tests as features change over time.

## Background / current state

- There is no CLI affordance to send a single report email to an arbitrary recipient. `report
--send-ready` is fleet-wide (sends every sendable Reports row, no `--to`); recipients come only
  from the Websites row.
- `report [site] --preview` renders a Maintenance/Testing email to `reports/<slug>/draft.html`
  with no Airtable writes — but it writes to disk, never sends, and doesn't cover
  announcement/launch.
- `report --digest` already emails the operator (`OPERATOR_EMAIL`, falling back to
  `info@reddoorla.com`).
- The render template (`renderReportHtml` + `email-sections.ts`) is already a single shared source
  across all four report types. What differs per type is the **data assembly** (which scores, GA
  window, cadence, last-tested, etc.) and the **send wrapper** (attachments, subject, recipients).
- The real send path is `sendOne` in `src/reports/send/orchestrate.ts`: it builds `ReportData`
  from an Airtable **Reports row**, prepares the header image, loads bundled images, renders,
  builds inline attachments (header always; `rd-check-png`/`rd-blurred-tests-jpg` gated on the cid
  actually appearing in the HTML), computes the subject (`report.subjectOverride ?? "{name} —
{Month YYYY} {type} Report"`), sends via Resend, then stamps Airtable.

## Command UX

A `selftest` command group. First (only, for now) kind is `email`. CAC v6 has no multi-word command
names, so this is realized as `selftest <kind> [site]` and presented as:

```text
reddoor-maint selftest email [site]
  --type <announcement|maintenance|testing|launch>   default: announcement
  --to <addr[,addr]>     default: OPERATOR_EMAIL (→ info@reddoorla.com fallback)
  --all                  send a separate test email (to --to/operator) for every `maintenance` site
  --dry-run              render only; write reports/<slug>/selftest-<type>.html; do not send
```

Examples:

```text
reddoor-maint selftest email gallerysonder
reddoor-maint selftest email gallerysonder --type testing --to me@example.com
reddoor-maint selftest email --all                       # one email per maintenance site, to operator
reddoor-maint selftest email gallerysonder --dry-run     # writes HTML, no send
```

Rules:

- `[site]` is a slug (matched via `siteSlug`, same as `announce`). Exactly one of `[site]` or
  `--all` must be provided; both or neither is a usage error.
- `--to` accepts a comma/space-separated list, parsed with the existing `parseAddresses`; each must
  pass `isProbablyEmail`. Unset → `OPERATOR_EMAIL?.trim() || "info@reddoorla.com"`.
- Self-tests are **private**: recipients are the operator/`--to` only. No client `To`, **no global
  ops CC** (`withGlobalCc` is NOT used).
- `from` / `replyTo` reuse the production constants (`Reddoor Reports <reports@reddoorla.com>` /
  `info@reddoorla.com`).
- No `idempotencyKey` (these are intentionally repeatable).
- `--all` targets sites with `status === "maintenance"` (same filter as `announce`).

Output: one line per site (drafted/sent/dry-run/skipped/error), mirroring `announce`'s formatter.
Exit non-zero if any site errored. A site missing stored Lighthouse scores or a header image is
**skipped** with a clear note (not a hard error), so `--all` keeps going.

## Architecture (Option A — shared render seam)

The faithfulness guarantee is at the **render** step: extract the "`ReportData` →
`{ html, attachments, subject }`" logic into one function used by **both** `sendOne` and
`selftest`, so a self-test renders byte-for-byte what production emails (same template, same
attachment gating, same subject logic). `ReportData` is still assembled from different sources
(Reports row for production; Website row for self-test) — that divergence is legitimate.

### New / changed components

1. **`src/reports/send/render-email.ts`** (new) — the shared seam.

   ```ts
   export type PreparedHeader = {
     bytes: Uint8Array;
     contentType: string;
     displayWidth: number;
     displayHeight: number;
     placeholderColor: string;
   }; // = the return of prepareHeaderImage

   export type RenderedReportEmail = {
     html: string;
     attachments: InlineAttachment[];
     subject: string;
   };

   /** Render a report email from fully-assembled ReportData: produce the HTML, the gated inline
    *  attachments (header + only the bundled images the HTML references), and the subject. PURE
    *  except for loadBundledImages (disk read of the two bundled PNG/JPG). Shared by sendOne and
    *  selftest so the rendered email can't drift. `subjectOverride` wins when present (the stored
    *  Announcement subject on the Reports row); otherwise defaultReportSubject() is used. */
   export async function renderReportEmail(
     reportData: ReportData,
     ctx: { header: PreparedHeader; cidName: string; subjectOverride?: string },
   ): Promise<RenderedReportEmail>;
   ```

   Moves `toInlineAttachment`, the bundled-image gating loop, and the subject computation out of
   `sendOne` into here. `sendOne` keeps: guards, recipient resolution, header/`ReportData` build
   from the Reports row, **then calls `renderReportEmail`**, then send + Airtable stamping +
   global CC. Behavior of `sendOne` is unchanged (covered by existing `orchestrate.test.ts`).

2. **`src/reports/subject.ts`** (new, tiny) — `defaultReportSubject`.

   ```ts
   /** The default subject for a report email, per type. Announcement → "Your testing &
    *  maintenance report for {Name} ({domain})"; others → "{Name} — {Month YYYY} {Type} Report".
    *  Shared by the announce recipe (which stores it as subjectOverride) and renderReportEmail so
    *  the self-test's announcement subject matches the real one. */
   export function defaultReportSubject(args: {
     name: string;
     url: string;
     type: ReportType;
     date: Date;
   }): string;
   ```

   The `announce` recipe's `siteLabel` + subject string move here; `announce.ts` imports it (so the
   stored Announcement subject and the self-test's computed subject are the same code).

3. **`src/recipes/selftest-email.ts`** (new) — the self-test orchestration (no Airtable writes).

   ```ts
   export type SelftestEmailDeps = {
     base?: AirtableBase; // defaults to live base (read-only use)
     resend?: ResendClient; // defaults to defaultResendClient()
     site?: string; // single-site slug
     all?: boolean; // all maintenance sites
     type?: ReportType; // default "Announcement"
     to?: string; // raw --to; parsed/validated; default operator
     dryRun?: boolean;
     now?: Date;
   };
   export type SelftestEmailSiteResult =
     | { site: string; status: "sent" | "dry-run"; subject: string; recipients: string[] }
     | { site: string; status: "skipped"; reason: string }
     | { site: string; status: "error"; message: string };
   export async function selftestEmail(
     deps: SelftestEmailDeps,
   ): Promise<{ results: SelftestEmailSiteResult[] }>;
   ```

   For each target site: `buildReportDataForSite` → `prepareHeaderImage` → `renderReportEmail` →
   send to recipients (or, dry-run, write `reports/<slug>/selftest-<type>.html`). Per-site
   try/catch; reads Airtable only (no create/update/stamp).

4. **`src/reports/report-data.ts`** (new) — `buildReportDataForSite(siteRow, type, now)` plus the
   shared `scoresFromRow(siteRow)` (moved here from `announce.ts`). Assembles `ReportData` from a
   Website row, reusing existing shared helpers so it tracks the real drafts:
   - **scores**: `scoresFromRow` (extracted from `announce.ts` to a shared util and reused by both;
     skip the site if any of the four is null).
   - **copy**: `resolveCopy(siteRow)`.
   - **announcement**: live `fetchGaUsers`/`fetchSearch` over a 30-day window, `gaPeriodDays: 30`,
     plus `announcementSiteExtras(siteRow)` (cadence + improvements). Same as the `announce`
     recipe's render block (which is refactored to call this builder, guaranteeing parity for the
     live use case).
   - **maintenance / testing**: live `fetchGaUsers`/`fetchSearch`; `gaPeriodDays` = days in the
     window; `lastTestedDate` from `siteRow.lastLighthouseAuditAt` (Maintenance only);
     `searchPosition` from the search result. Window = last 30 days (the self-test can't read the
     real recurrence anchor without scanning Reports; 30 days is the documented preview window).
   - **launch**: stored scores; launch copy; no GA fetch (the launch template renders no
     analytics/checks). Minimal `ReportData`.

5. **`src/cli/commands/selftest.ts`** (new) — `runSelftestCommand(kind, site, opts)`: validate
   `kind === "email"` (else error listing supported kinds), parse/validate `--to`, enforce the
   `[site]` xor `--all` rule, call `selftestEmail`, format results, return `{ output, code }`.

6. **`src/cli/bin.ts`** — register `cli.command("selftest <kind> [site]", "...")` with `--type`,
   `--to`, `--all`, `--dry-run`, lazy-loading `./commands/selftest.js` in the action (matches the
   existing lazy-load convention so the heavy report/resend chain stays out of `--help`).

### Faithfulness boundary (what's guaranteed vs. not)

- **Guaranteed identical to production**: the rendered HTML, the inline-attachment set + gating,
  and the subject — because `renderReportEmail` + `defaultReportSubject` are the same code paths.
  The announcement `ReportData` assembly is also shared (the `announce` recipe adopts
  `buildReportDataForSite`).
- **Best-effort parallel**: the maintenance/testing/launch `ReportData` assembly from a Website row
  reuses the same enrichment helpers but is its own small assembler (the real drafts derive the
  period window from the Reports history, which a no-write preview can't replicate — it uses a
  fixed 30-day window). This is acceptable for a visual/format self-test and is documented in the
  command help.

## Error handling

- Per-site `try/catch`; one failure never aborts `--all`.
- Missing scores / missing header image → `skipped` with reason (not error).
- Malformed `--to` → usage error before any send (exit 2).
- Resend failure → that site's result is `error`; the run continues; exit code 1.
- No Airtable writes anywhere — a self-test must never mutate fleet state.

## Testing

- `selftestEmail` with a fake Airtable base + captured Resend client + mocked `fetchGaUsers`/
  `fetchSearch` (as in `announce.test.ts`):
  - single site → one `sent` result, recipients = operator default; **fake base records zero
    create/update calls** (the core no-side-effects guarantee).
  - `--to a@x,b@y` → both recipients; no global ops CC present.
  - `--all` → one result per maintenance site; a scores-less site is `skipped`, others still sent.
  - `--dry-run` → no Resend call; HTML written; status `dry-run`.
  - each `--type` → captured HTML contains the type's marker (e.g. `LAUNCHED` for launch,
    `>ANALYTICS<`/checklist for maintenance).
- `renderReportEmail`: given fixed `ReportData` + a fake header, returns expected attachments
  (header always; check gated on cid) and subject; `subjectOverride` wins when passed.
- `defaultReportSubject`: announcement vs the dated default, per type.
- `orchestrate.test.ts` stays green (sendOne behavior unchanged) — proves the seam extraction is
  behavior-preserving.

## Out of scope (YAGNI)

- Other `selftest` kinds (forms ingest, digest, webhooks) — the namespace leaves room; not built now.
- Re-auditing for launch self-tests (uses stored scores).
- Reading the real recurrence window for maintenance/testing previews (fixed 30-day window).
- Any change to how real reports are drafted/sent beyond the behavior-preserving seam extraction.

## File summary

- New: `src/reports/send/render-email.ts`, `src/reports/subject.ts`,
  `src/recipes/selftest-email.ts`, `src/cli/commands/selftest.ts`.
- Changed: `src/reports/send/orchestrate.ts` (sendOne calls the seam), `src/recipes/announce.ts`
  (uses `defaultReportSubject` + `buildReportDataForSite` for the announcement assembly),
  `src/cli/bin.ts` (register command). `buildReportDataForSite` + `scoresFromRow` live in a shared
  module (e.g. `src/recipes/selftest-email.ts` or `src/reports/report-data.ts` — finalized in the
  plan).
- Tests: `tests/recipes/selftest-email.test.ts`, `tests/reports/send/render-email.test.ts`,
  `tests/reports/subject.test.ts`; existing suites stay green.
- Changeset: minor (`@reddoorla/maintenance`).
