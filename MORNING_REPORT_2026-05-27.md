# Morning Report — 2026-05-27 (Road to 1.0)

**Scope decided last night:** 1.0 = Reddoor-internal stable (no OSS audience). GA Data API revisit before 1.0. Time horizon: weeks. Deliverables: this review + an executable plan for the next chunk.

**⚠ Important addendum:** A deeper bug-hunt pass found one BLOCKER and four other blockers in 0.7.0 that this initial report missed. See [MORNING_REPORT_2026-05-27-bug-hunt.md](MORNING_REPORT_2026-05-27-bug-hunt.md) and read that FIRST. The "ready to merge" framing below is wrong — fix the BLOCKER tier before opening the PR.

**Where we are:**

- `main` is at 0.6.8 (last release `9be0625`, May 26). 17 published versions in ~6 days; 0.6.x has been a fast bug-fix cadence.
- `feat/0.7.0-reports` (worktree at `../reddoor-maintenance-reports/`) is **16 commits ahead of origin/main**, all green (296/296 tests, typecheck/lint/build clean). **Nothing pushed. No PR open. Smoke tests not run.**
- The 0.7.0 work added the report concept end-to-end: MJML render layer, Airtable client, due-scanner, draft orchestrator, Resend transport, Netlify webhook. ~1,360 LOC including tests.
- The Airtable schema for Reports + the `Resend message ID` field on Reports are live in production base `appHG8nLOzULzXOER` (the schema migration ran during 0.7.0 execution).
- All four planned 0.7.0 deferrals are still deferred: GA Data API, webhook deployment (Netlify site doesn't exist yet), `audit lighthouse → Websites` automation, manual operator-paste of the 4 score numbers.

The executable plan for the next chunk is at [docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md](docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md). That plan and this report were written together; both reference the same findings.

---

## CRITICAL (ship-now / would embarrass a 1.0)

These are blockers for **even getting 0.7.0 merged**, not for 1.0. Address before opening the PR.

### #1 — Reports orchestrators have zero integration test coverage

The two most complex pieces of 0.7.0 have no tests of their actual behavior:

- [src/reports/draft.ts:44-102](docs/../../reddoor-maintenance-reports/src/reports/draft.ts) — `draftReportForSite` (the 60-line render + create + upload + flip-ready sequence). Untested.
- [src/reports/send/orchestrate.ts:17-47](docs/../../reddoor-maintenance-reports/src/reports/send/orchestrate.ts) — `sendApprovedReports` loop. Untested.
- [src/reports/send/orchestrate.ts:49-110](docs/../../reddoor-maintenance-reports/src/reports/send/orchestrate.ts) — `sendOne` (recipients fallback, headerImage check, render, CID attachment, stamp). Untested.

What exists today: `tests/reports/send/orchestrate.test.ts` is 23 lines of a fake-client-captures-input contract test that doesn't import `sendApprovedReports` at all. The plan acknowledged at Task 4.3 that "a full integration test … requires faking the Airtable SDK, which adds significant surface area for v1" — true, but means a regression in `parseAddresses`, the missing-headerImage error path, or the `stampSent` call ships unnoticed.

**Fix in 0.8.0 (planned).** Specifically: write `tests/reports/draft.test.ts` and a real `tests/reports/send/orchestrate.test.ts` that fake both `AirtableBase` and `ResendClient` via a thin `Pick<AirtableBase, …>` interface. Reference [docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md](docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md) Tasks 4.1–4.3.

### #2 — Webhook test pins a duplicated constant

[tests/webhook/resend-webhook.test.ts:5-9](docs/../../reddoor-maintenance-reports/tests/webhook/resend-webhook.test.ts) re-declares the same `STATUS_MAP` that [netlify/functions/resend-webhook.mts:14-18](docs/../../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts) defines. The test asserts the constant's own shape, not the handler's behavior. If a typo lands in the real handler (`"email.delivere"` → no-op), the test still passes.

**Fix.** Either: (a) export `STATUS_MAP` from the webhook file and import it in the test, or (b) write a behavioral test that constructs a fake `Request`, mocks `Airtable`, and verifies the `setDeliveryStatus` call. Option (a) is the cheap fix; option (b) is what 1.0 deserves.

### #3 — Webhook has no deployment pipeline

`netlify.toml` exists; the function exists at `netlify/functions/resend-webhook.mts`; but:

- No Netlify site connected to this repo.
- `release.yml` is npm-only — no Netlify deploy step.
- `package.json:15-18` declares `files: ["dist", "README.md"]` — the `netlify/` directory **won't ship in the npm tarball**, which is correct, but means the webhook has to deploy via a parallel path that doesn't exist.

The README's Reports section (`README.md:288-289` in the worktree) says delivery status "updates automatically via the Resend webhook" — that's a lie until Netlify is set up and the Resend webhook URL is configured. **Drop this claim from the README or set up the Netlify site before merging.**

Realistic minimum: create a Netlify site pointed at this repo, configure `AIRTABLE_PAT` + `AIRTABLE_BASE_ID` + `RESEND_WEBHOOK_SECRET` env on the site, configure the Resend webhook to POST to the deployed function URL. ~30 min once. Then it's just `git push` and Netlify rebuilds.

---

## HIGH (real bugs / risks for 0.7.0 → 1.0)

### #4 — Dead code in the reports surface

- [src/reports/airtable/reports.ts:110-120](docs/../../reddoor-maintenance-reports/src/reports/airtable/reports.ts) — `attachRenderedHtml(base, recordId, attachment)` is exported but **never called**. The draft orchestrator implements `uploadHtmlAttachment` inline at [src/reports/draft.ts:125-151](docs/../../reddoor-maintenance-reports/src/reports/draft.ts) because Airtable attachments-from-URL aren't viable for HTML.
- [src/reports/airtable/reports.ts:185-200](docs/../../reddoor-maintenance-reports/src/reports/airtable/reports.ts) — `findReportByMessageId(base, messageId)` is exported but **never used**. The webhook reimplements the same query inline at [netlify/functions/resend-webhook.mts:50-56](docs/../../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts).

**Fix in 0.8.0.** Delete `attachRenderedHtml`. Move `uploadHtmlAttachment` from `draft.ts` to `src/reports/airtable/attachments.ts` (where it belongs alongside `fetchAttachmentBytes`). Have the webhook import `findReportByMessageId` instead of duplicating the query.

### #5 — No CLI test for `report` command

Every other CLI command has a test in `tests/cli/`: `audit-command.test.ts`, `onboard-command.test.ts`, `sync-configs-command.test.ts`, etc. The new `report` command at [src/cli/commands/report.ts:17-37](docs/../../reddoor-maintenance-reports/src/cli/commands/report.ts) has none. The flag-mutex logic (`--due` vs. `<slug>` vs. `--send-ready`) is untested.

**Fix in 0.8.0.** `tests/cli/report-command.test.ts` modeled after `tests/cli/audit-command.test.ts`. Validates argv → opts → handler dispatch, error messages on usage misuse.

### #6 — CloudFront image dependency in the email template

[src/reports/maintenance-email/template.ts:3-4](docs/../../reddoor-maintenance-reports/src/reports/maintenance-email/template.ts):

```ts
const CHECK_PNG = "https://d3eq0h5l8sxf6t.cloudfront.net/maintenance-email/check.png";
const BLURRED_TESTS = "https://d3eq0h5l8sxf6t.cloudfront.net/maintenance-email/blurredTests.jpg";
```

Two production sends/month depend on a CloudFront distribution that no one in the repo owns or pays for. If `d3eq0h5l8sxf6t` goes away, every email starts rendering with broken images. The original `reddoor-mailer-absorption.md` memory explicitly called this out: "Vendor CloudFront-hosted header/check images into `assets/` to make the package self-contained." It was forgotten in the 0.7.0 plan.

**Fix in 0.8.0.** Copy the two files into `src/reports/maintenance-email/assets/`, embed them as CID inline attachments alongside the per-site header image. Each email gets +~10 KB but loses the external dependency.

### #7 — `audit lighthouse` → Websites paste is fully manual

Per design memo (and verified in code), the operator's flow today:

1. `cd /path/to/site && pnpm reddoor-maint audit lighthouse` (returns LHCI summary)
2. Read 4 numbers from output (Performance, Accessibility, Best Practices, SEO — actually expressed as a `summary: Record<string, number>` of fractions in [src/audits/lighthouse.ts:43-61](src/audits/lighthouse.ts))
3. Multiply by 100, round
4. Open Airtable mobile/web
5. Find the Websites row for this site
6. Paste 4 numbers into `pScore` / `rScore` / `bpScore` / `seoScore`
7. Then (separately) run `reddoor-maint report --due` which reads those scores

Steps 2–6 are tedious, error-prone, and the prime friction in the new workflow. **Fix in 0.8.0** — `reddoor-maint audit lighthouse --write-airtable [slug]`. Reads the audit result, multiplies, writes to Websites row. Auto-resolves slug from cwd's package.json `name` if not provided.

### #8 — `report --due` issues N+1 Airtable queries

[src/cli/commands/report.ts:41-46](docs/../../reddoor-maintenance-reports/src/cli/commands/report.ts):

```ts
const reports = [];
for (const w of websites) {
  const rs = await listReportsForSite(base, w.id);
  reports.push(...rs);
}
```

For 30 sites this is 30 Airtable list calls. At ~200 ms each that's 6 seconds before the due-scan even starts. Airtable's rate limit (5 req/sec/base) means it's also flirting with throttling for larger fleets.

**Fix in 0.8.0 patch (low priority).** One query: `base("Reports").select({ filterByFormula: "{Sent at} != BLANK()", fields: ["Site", "Report type", "Sent at"] })`. Then bucket in memory.

### #9 — Inconsistent error handling across subsystems

- **Audits**: catch errors, return `{ status: "fail", summary: "..." }` ([src/audits/index.ts:37-46](src/audits/index.ts))
- **Recipes**: throw on dirty tree, return structured result otherwise ([src/recipes/_with-recipe.ts:54,79](src/recipes/_with-recipe.ts))
- **Reports orchestrators**: throw → caught in CLI loop → emit `✗` lines ([src/cli/commands/report.ts:53-58](docs/../../reddoor-maintenance-reports/src/cli/commands/report.ts))
- **Webhook**: HTTP response codes (necessarily different)

The reports break the audits/recipes pattern by throwing rather than returning a structured result. The CLI compensates by catching in the loop, but a programmatic consumer of `sendApprovedReports` gets a different shape than they would from `runAudits`.

**Worth aligning in 0.9.0.** Reports could return `Array<{ report, status: "sent" | "failed", error?, messageId? }>` and let the CLI format. Not blocking for 1.0, but worth aligning before the API is frozen.

### #10 — `step-verify.ts` silently swallows install failures

[src/recipes/svelte-5/step-verify.ts:8-26](src/recipes/svelte-5/step-verify.ts) — if `pnpm install` or `svelte-check` fails during the verify step of the Svelte 4→5 upgrade recipe, the result is `{ skipped: true }` with the error swallowed. The recipe completes "successfully" with no surfaced indication that the verify failed.

Looking at [src/recipes/svelte-5/index.ts:54-58](src/recipes/svelte-5/index.ts), the caller only checks `result.ran`, not `result.skipped`. A 0-exit upgrade with no verify is indistinguishable from a clean upgrade.

**Fix when next touching the recipe.** Promote skipped → failed; or at minimum, populate `recipeNotes` with a "verify skipped: pnpm install failed (stderr...)" line.

### #11 — Onboarding creates 5 separate branches

Per [README.md:14-30](README.md) the recommended new-site sequence is:

```
convert-to-pnpm → onboard → sync-configs → svelte-codemods → audit
```

Each step creates a `maint/<recipe>-<ts>` branch. Operator must either PR-merge between every step (5 PRs per new site) or live with a messy local-only history. For the Reddoor fleet (one new site every 1–2 months) this is bearable; for any acceleration in onboarding cadence this becomes the dominant pain.

**Probably a 0.9 candidate.** `reddoor-maint init` that runs the canonical sequence on one branch. Compose the recipes inside a single `withRecipe` block.

---

## MEDIUM (debt to pay before 1.0)

### #12 — `src/reports/draft.ts` is too big and does too much

151 LOC. Mixes: score validation, render orchestration, preview-vs-write branching, Airtable row creation, HTML upload, draft-ready flip. Splitting into `scoresFromWebsite`, `renderForDraft`, `previewToDisk`, `createReportRow` would make each unit independently testable (see #1).

### #13 — `findDueReports` doesn't filter on `Status`

[src/reports/due.ts:50-80](docs/../../reddoor-maintenance-reports/src/reports/due.ts) considers every Websites row with `maintenence freq ≠ None`. Doesn't filter on `Status` field. Sites in status `"deprecated"` or `"probably not our problem"` would still surface as due if they have a frequency set.

**Mitigation today.** Operator must remember to set `maintenence freq = None` on deprecated sites. Not a code bug, but a 1.0-friendly thing would be auto-skipping non-`maintenance`/`hosting` statuses.

### #14 — `audit --fleet` walks sites sequentially in the CLI

[src/cli/commands/audit.ts:55-58](src/cli/commands/audit.ts) uses a for-loop over sites. But `runAuditsAcross` ([src/audits/index.ts:50-52](src/audits/index.ts)) is `Promise.all`-based — the parallelism exists, just not used. For 30 sites × 5 audits this is the difference between 5 minutes and 30 minutes.

**Easy fix.** Replace the for-loop with `runAuditsAcross(sites, which)`. The reason the for-loop exists is to interleave per-site stdout — preserve that ordering with a sort on the resulting array.

### #15 — `tsup.config.ts` doesn't declare `src/reports/**` entries

[tsup.config.ts:5-17](tsup.config.ts) — current entries: `src/index.ts`, `src/cli/bin.ts`, 5 configs. The reports surface ships only as part of the main entry's re-exports. Works (and bundle size is acceptable per the build output), but means consumers can't do `import { sendApprovedReports } from "@reddoorla/maintenance/reports/send"` the way they can `from "@reddoorla/maintenance/configs/eslint"`.

For a single-tenant tool with you as the only consumer, this is **not a real problem**. Note for the future if the surface ever needs subpath imports.

### #16 — Lint baseline is aggressive

[src/configs/baseline-versions.ts:35-41](src/configs/baseline-versions.ts) pins `eslint: ^10.3.0` and `typescript-eslint: ^8.59.1`. ESLint 10 is recent — when sites adopt these via `sync-configs`, they may hit rule changes. Worth confirming the whole fleet is on this baseline before 1.0 ships, or pinning back to 9.x.

### #17 — No release smoke test

`release.yml` runs `pnpm run test` but never does a `pnpm pack && npm install` round-trip on the tarball. A typo'd `package.json:files` field, a missing subpath in `exports`, or a broken default export would only surface when the next downstream site `pnpm install`s the published package.

**Easy add.** A 3-line job step: `pnpm pack && (cd /tmp && pnpm init && pnpm add /path/to/the/.tgz && node -e 'require("@reddoorla/maintenance")')`.

### #18 — `fmtDate` UTC fix is correct but only by accident

[src/reports/maintenance-email/template.ts:6-13](docs/../../reddoor-maintenance-reports/src/reports/maintenance-email/template.ts) uses `getUTCDate()` / `getUTCMonth()` / `getUTCFullYear()`. That's correct **only because Airtable date fields are stored as `YYYY-MM-DD` strings** (parsed by V8 as UTC midnight). If Airtable's API ever returns a date+time pair (`2025-03-15T15:00:00Z`), the date format would skew by timezone again.

**Belt-and-suspenders fix.** Parse Airtable dates with explicit `.split("-")` + `Date.UTC(y, m-1, d)` rather than relying on string→Date coercion. Add a regression test that asserts a `"2025-03-15"` input produces `"15.03.2025"`.

### #19 — `reddoor-mailer` repo still has rotated SMTP creds in history

`~/Documents/GitHub/reddoor-mailer/src/index.ts:18` has a Gmail app password in plaintext. The password is rotated (per memory), but the git history retains it. Since the credential is invalidated this is informational, but: **1.0 of `@reddoorla/maintenance` is a natural moment to archive or delete `reddoor-mailer`** since its capability is fully absorbed.

### #20 — `findReportByMessageId` and `attachRenderedHtml` lint-export dead code

Covered in #4. Listing again so it shows up in the cleanup task list.

---

## LOW (polish before tagging 1.0)

### #21 — README's Reports section doesn't note `--preview` requires Airtable creds

[README.md:262-266](docs/../../reddoor-maintenance-reports/README.md) — the `--preview` instructions don't mention that it still needs `AIRTABLE_PAT` and `AIRTABLE_BASE_ID` to look up the site's name and scores. A reader might think `--preview` is offline. Add one line.

### #22 — README explains how to "paste the four numbers" but not which 4 numbers

[README.md:258](docs/../../reddoor-maintenance-reports/README.md) — Step 0 says "paste the four numbers (Performance, Accessibility, Best Practices, SEO) into the Websites row's `pScore` / `rScore` / `bpScore` / `seoScore` fields." But `audit lighthouse`'s output is a `summary: Record<string, number>` of *fractions* (e.g. `0.87`). The operator has to multiply by 100 and round. README doesn't mention this. Either fix the documentation, OR (better) make Task 7 of the 0.8.0 plan (`--write-airtable`) make this moot.

### #23 — README points at `src/configs/baseline-versions.ts` line ref

[README.md:242](README.md) — `[src/configs/baseline-versions.ts](src/configs/baseline-versions.ts)` works on GitHub but not on npm where the README is rendered without source. Not a real issue for internal use.

### #24 — `bin.ts` is approaching 200 LOC

[src/cli/bin.ts](src/cli/bin.ts) — 9 commands × ~20 lines of registration each, plus the (re-used) `runOrExit`. Adding `report` to the worktree pushed it past 230 lines. At 10+ commands a registry pattern starts paying off: each command file exports a `register(cli)` function and `bin.ts` is `commands.forEach((c) => c.register(cli))`. Not urgent.

### #25 — `audit` has no `--due` equivalent

`report --due` scans the fleet and surfaces overdue (site, type) pairs. `audit` has no parallel. There's no "show me which sites haven't had their Lighthouse re-checked in 30 days" view. If 0.8.0 ships `--write-airtable`, a follow-up could add `Last lighthouse audit at` timestamp to Websites, and `audit --due` could surface stale sites. Probably 0.9 territory.

### #26 — No structured logging anywhere

Stdout/stderr only. For `report --send-ready` running on a cron, when a send fails you only know about it if you read the cron's stdout. A structured JSON log to a file (or to stderr) would let a future "weekly health report" parse outcomes. Not blocking; nice for ops maturity.

### #27 — `findReportByMessageId`'s `filterByFormula` is string-interpolated

[src/reports/airtable/reports.ts:185-200](docs/../../reddoor-maintenance-reports/src/reports/airtable/reports.ts):

```ts
filterByFormula: `{Resend message ID} = "${messageId}"`,
```

The `messageId` comes from a Resend-signed webhook event so an injected attack is implausible. But Airtable formula injection is a real attack surface in general. **Defensive style: escape `"` and `\` in interpolated values, or restrict to alphanumeric.** Cheap.

### #28 — `recipes/svelte-5/step-svelte-migrate.ts` discards stderr

[src/recipes/svelte-5/step-svelte-migrate.ts:13-15](src/recipes/svelte-5/step-svelte-migrate.ts) — when `npx svelte-migrate svelte-5` fails, `stderr` is captured but never surfaced. Same pattern as #10.

---

## What's working — keep

- **The `withRecipe` wrapper** ([src/recipes/_with-recipe.ts](src/recipes/_with-recipe.ts), 114 LOC, landed in 0.6.8) is the right abstraction. Every recipe converted to it; the plan/apply split prevents accidental side effects in dry-runs. Don't undo this.
- **`tests/types.test.ts`** as a runtime-array ↔ TypeScript-union assertion is a clean drift guard. Caught the 0.6.2 registration bug. Worth extending to reports types in 0.8 (`ReportType`, the eventual `ALL_REPORT_NAMES` if reports gain a registry).
- **`tests/recipes/pipeline-composition.test.ts`** is the highest-leverage test in the repo. Fixture-based, runs an actual 4-recipe pipeline against a real tmp tree with fake spawn. The morning report's debt #16 "highest-leverage test-coverage debt" was paid by this file. Reuse this pattern for reports orchestrator tests in 0.8.
- **Audit spawn-injection pattern** (`AuditContext = { site, spawn? }` at [src/audits/util/inject.ts](src/audits/util/inject.ts)) lets every audit be unit-tested without touching the network or shelling out. Mirror this for reports — every orchestrator should accept an `AirtableBase` parameter (it does) so tests can pass a fake. The pattern just needs one more level of discipline: the bottom-level fake should be a typed `Pick<AirtableBase, ...>` interface, not `any`.
- **`runOrExit` wrapper** ([src/cli/bin.ts:39-52](src/cli/bin.ts)) — 13 lines that paid for themselves across 7+ command files. The morning report's #14 was a successful unification.
- **Changesets + npm OIDC trusted publishing** — set up correctly, working. Don't change this for 1.0.
- **MJML template port worked correctly with bugs fixed in one shot** — the score interpolation, duplicate "Performance" label, hardcoded dates, hardcoded site name were all addressed in [src/reports/maintenance-email/template.ts](docs/../../reddoor-maintenance-reports/src/reports/maintenance-email/template.ts). Render tests guard against regression.
- **`siteSlug()` + the tests for it** ([src/reports/airtable/websites.ts:29-34](docs/../../reddoor-maintenance-reports/src/reports/airtable/websites.ts), [tests/reports/airtable/reports.test.ts:13-23](docs/../../reddoor-maintenance-reports/tests/reports/airtable/reports.test.ts)) — small but the kind of name-normalization that bites later. Good early investment.

---

## Recommended morning sequence

A pragmatic 90-minute path that gets 0.7.0 truly merged and starts 0.8.0:

1. **(10 min)** Open the worktree, skim the 17 commits + the README diff. Confirm the architecture matches what you intended.
2. **(20 min)** Smoke test the `--preview` path: from the worktree, with a populated `.env` (AIRTABLE_PAT, AIRTABLE_BASE_ID, RESEND_API_KEY), pick one site that has all four scores filled in on Websites. Run `pnpm tsx src/cli/bin.ts report <slug> --preview`. Open the resulting HTML in a browser. Confirm: scores correct, no rogue `90`s, third score labeled "Best Practices", maintenance variant shows the blurred-tests placeholder.
3. **(15 min)** Push the branch, open a draft PR. The unmerged work touches 11 new src files + 5 new test files + the netlify dir + bin/index/README/.env.example/.gitignore/package.json. Title: `feat(reports): 0.7.0 — per-site maintenance/testing email reports`.
4. **(decision)** If the smoke test passed cleanly: also try `report --due` against a Websites row that has `maintenance day` set 35+ days ago. This creates a real Reports row + uploads an HTML attachment. If anything looks off in the Airtable Reports table, file a follow-up issue and patch on the same branch before merging.
5. **(decision)** Webhook deploy story. Two options:
   - **Defer to 0.8.0** — drop the "Delivery status updates automatically" line from the README (replace with "Delivery status is set to `pending` on send; the webhook function is shipped in the repo at `netlify/functions/resend-webhook.mts` but is not yet deployed — see the 0.8.0 plan").
   - **Set up Netlify now** — create the site (~10 min), configure env, point Resend at it, merge with the claim intact.
6. **(20 min)** Skim the 0.8.0 plan at [docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md](docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md). If it makes sense, start with Phase 1 (the cleanups — they're independent of any merge).

---

## The 0.7 → 1.0 arc

For a Reddoor-internal stable, weeks-horizon 1.0:

### 0.7.0 — Reports (current branch, awaiting merge)

Status: complete, untested in production, webhook not deployed.

**Ship criteria:** Smoke 1 + Smoke 2 from the plan pass. PR open. Tag + publish.

### 0.7.x — Patches from real-world use

Status: speculative. Likely: edge cases in date math, missing recipient fields, HTML attachment quirks at scale. Expect ~3 patches over a week of dogfooding.

### 0.8.0 — Workflow closure

**Theme:** eliminate the manual `audit lighthouse → Websites` paste, harden the reports orchestrator coverage, clean up dead code from 0.7.0.

**Scope (executable plan at [docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md](docs/superpowers/plans/2026-05-26-0.8.0-workflow-closure.md)):**

1. Cleanups: delete `attachRenderedHtml`, move `uploadHtmlAttachment` to attachments.ts, import `findReportByMessageId` in the webhook (no duplicated query), import `STATUS_MAP` in the webhook test, vendor CloudFront images into `src/reports/maintenance-email/assets/` as bundled assets, embed as CID.
2. `audit lighthouse --write-airtable [slug]` — writes 4 scores + an `Last lighthouse audit at` timestamp to the Websites row. Slug auto-resolves from cwd's `package.json#name` if not provided.
3. New inventory provider `fromAirtableBase()` — read Sites from Websites table as `InventoryProvider`. CLI: `--fleet airtable` shorthand.
4. Orchestrator tests for reports — `tests/reports/draft.test.ts`, real `tests/reports/send/orchestrate.test.ts`, `tests/cli/report-command.test.ts`. All use a typed `Pick<AirtableBase, ...>` fake + a `ResendClient` fake.
5. Defensive Airtable formula escaping in `findReportByMessageId`.
6. Real `findDueReports` `Status` filter (skip "deprecated" / "probably not our problem").

**Estimated effort:** 2–4 days dev + 1 day dogfooding.

**Releases:** likely 0.8.0 (minor — new CLI flag + new inventory source) followed by 0.8.x patches.

### 0.9.0 — GA Data API + webhook deploy

**Theme:** automate the last two manual steps in the report flow.

**Scope:**

1. GA Data API integration. The Workspace OAuth block has to be resolved. Three possible paths (in order of preference):
   - Use a non-Workspace gcloud personal account that has been granted access to each site's GA4 property. Cleanest; sidesteps the Workspace app-access policy entirely.
   - Get the Workspace admin to allowlist `gcloud` in the app-access console for `reddoorla.com`.
   - Build a Property Service Account model where each site's GA4 property has its own bespoke service account email added. Per the design memo, the GA Property UI rejects this with a blocking modal — but the issue may have softened or have a workaround.
   - Plan a discovery spike (~2 hrs) at the start of 0.9 to determine which path is actually viable today; don't assume.
2. Once GA is callable: `src/reports/ga.ts` with `BetaAnalyticsDataClient` + `runReport({ dateRanges, metrics: [{name:'activeUsers'}] })`. Two ranges (current period, previous period). Write into Reports row's `GA users (period)` / `GA users (prev period)` during draft.
3. Webhook deployment pipeline. Either:
   - Connect a Netlify site to the GitHub repo (auto-deploys on push to main). One-time setup, zero ongoing CI changes.
   - Add a Netlify deploy step to `release.yml`. More moving parts (needs `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` secrets), more explicit.
   - Recommend the Netlify-direct-GitHub option — least to maintain.
4. Drop the "(manual GA entry)" claim from the changeset and README.

**Estimated effort:** 1 day for the OAuth path discovery + 1 day for the implementation if discovery is positive + 0.5 day webhook deploy + 0.5 day docs. So 2–3 days if discovery resolves cleanly.

**Risk:** the GA path may not resolve. If after 3 hrs of discovery you can't get *any* path working, ship 0.9.0 with just the webhook deploy + drop GA back to "0.9.1 stretch" and make a call on whether to ship 1.0 without GA. (My recommendation if it comes to that: ship 1.0 with manual GA. It's 10 seconds of typing per report. The "before 1.0" goal is nice-to-have, not blocking.)

### 0.9.x — Patches from second-month dogfooding

Likely focus: GA edge cases (sites without a GA4 property, sites with weird timezone setups, sites that switched GA properties recently).

### 1.0.0 — Freeze

**Ship criteria:**

1. `@reddoorla/maintenance` has been the operator's only tool for one full monthly maintenance cycle without critical bugs.
2. README is updated to drop "deferred" language and reflect the closed-loop workflow.
3. All `0.x.x` patches over the prior month have been merged.
4. Tag `v1.0.0`. No new features in the same PR.
5. CHANGELOG sections for 1.0 calls out: "API frozen — no breaking changes will land in 1.x without a 2.0 bump."
6. `reddoor-mailer` repo archived (separate repo, separate decision but worth doing same week).

**Estimated weeks to here from today:** 2 weeks if 0.8 + 0.9 land clean, 3–4 weeks if GA causes a discovery loop.

---

## Adversarial second pass

Some things the above might have over- or under-prioritized.

### Probably over-prioritized

- **#1 (zero orchestrator coverage)**: This is real but the orchestrators are mostly thin glue. The real complexity is in the data-shape code (`mapRow`, `lighthouseFromFields`, `parseAddresses`) which can be tested without the SDK at all. A 50-line test of `parseAddresses` + `mapRow` field-by-field would catch most realistic bugs at a fraction of the cost of full SDK-fake test infrastructure.
- **#3 (webhook deploy)**: For one operator sending ~30 reports/month, "manually check Resend dashboard" is genuinely fine. The webhook is a polish feature. If it doesn't deploy before 1.0, ship anyway.
- **#15 (tsup subpath exports)**: Single tenant, you're the only consumer. Don't pre-optimize for hypothetical subpath imports.

### Probably under-prioritized

- **#7 (manual paste)**: This is the friction point that determines whether you actually use this tool every month or whether it sits unused. If the paste step is annoying enough, you skip the monthly cycle. Make this **the** 0.8.0 priority.
- **#22 (README about fractions)**: A user (you, in three weeks) running this for the first time will hit "I pasted the numbers but they're wrong" because they didn't multiply by 100. README clarity costs nothing.
- **#10 + #28 (silenced stderr in svelte-5 recipes)**: Stale debt. Easy to fix. The kind of thing that compounds — every recipe that catches errors and swallows them is a future debugging session.
- **#26 (no structured logging)**: For a cron-driven 1.0, "what failed when" is the most important question. A 50-line `src/reports/log.ts` writing JSONL to `~/.reddoor-maint/logs/` would be cheap and high-leverage.

### Things I considered but rejected

- **Multi-tenancy (other agencies using this)**: explicitly out of scope per your 1.0 definition.
- **A `report` registry à la `ALL_AUDIT_NAMES`**: only one report kind exists. Adding a registry now is YAGNI.
- **Splitting reports into a separate package `@reddoorla/maintenance-reports`**: complicates publishing for no benefit when you're the only consumer.
- **A web UI for review** (instead of Airtable mobile): explicitly rejected in the design memo. Airtable wins.

---

## Riskiest unknown

**Whether the GA Data API path can be resolved at all.**

Per the design memo, both the service-account path (blocked by a "blocking modal" on the GA Property UI) and the OAuth path (blocked by Google Workspace app-access policy) hit dead ends. The current 0.7.0 ships with manual GA entry as a deliberate punt.

If you confirm before 1.0 that GA *can't* be solved within reasonable effort, the question becomes: does 1.0 ship with manual GA entry? You said you want it solved before 1.0 — but if the cost is "wait 3 more months while we negotiate Workspace policy with whoever owns reddoorla.com," that price might not be worth paying. The decision is judgement, but worth flagging up front.

**Concrete first step in 0.9:** spend 2 hours on a focused discovery spike. Try the personal-Google-account path first (it sidesteps the Workspace block entirely if you can OAuth into your contact@tuckerlemos.com account directly without going through reddoorla.com). If that works, 0.9 is straightforward. If it doesn't, escalate to a decision.

---

## Notes on the worktree / merge

When you're ready to merge 0.7.0:

- The worktree is at `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance-reports/` on `feat/0.7.0-reports`, 17 commits ahead of origin/main.
- 296/296 tests pass; typecheck + lint + build all clean.
- No conflicts expected with main (main hasn't moved since 0.7.0 was branched from `9be0625`).
- After merge, the worktree can be cleaned up: `git worktree remove ../reddoor-maintenance-reports` from the main checkout.
- The `Resend message ID` field on the Reports table was added live during 0.7.0 execution (field ID `fldza2EJwzC83oyWh`). It exists in production and shouldn't need re-adding.

---

## Open questions for you

These are questions I don't have answers to that the next session might need:

1. **Netlify**: do you have a Netlify account already? Are you OK with the webhook function living on Netlify specifically (vs. Cloudflare Workers, Vercel, etc.)?
2. **GA Data API**: are you the Workspace admin for `reddoorla.com`? If yes, allowlisting gcloud SDK in the admin console may be trivial. If no, the discovery spike outcome matters more.
3. **`reddoor-mailer` repo**: archive, delete, or leave in place? It's harmless once `@reddoorla/maintenance` 0.7+ is in production, but I'd prefer archive as a 1.0-tagging-week task.
4. **`reports@reddoorla.com` sender address**: is this address set up in Resend with a verified domain? If not, the first real send will 401. (The smoke tests will catch this; just heads-up.)
5. **Cron**: when 0.7.0 is in production, how do you intend to invoke `report --due` and `report --send-ready`? Local cron? GitHub Action on a schedule? Doesn't need to be answered before merge but matters for 0.8/0.9 design.

---

End of report.
