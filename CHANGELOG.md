# @reddoorla/maintenance

## 0.15.0

### Minor Changes

- 2bfb7be: `reddoor-maint audit` now shows live progress while audits run, using `listr2` for spinners. Single-site runs show one spinner per audit type (e.g. `lighthouse: P=87 A=95 BP=78 SEO=100 (32s)`); fleet runs (`--fleet`) show one spinner per site with an `N/4 audits` counter. Audits still run fully in parallel — the spinner layer is presentation-only. `--write-airtable` gets its own progress step (`Wrote to Websites[Acme] (4 audit types)`).

  Behavior preserved: `--json` mode is silent (no spinner output, clean JSON on stdout), non-TTY contexts fall back to one-line-per-task transitions (CI logs, file redirects), and the final result table / JSON still prints to stdout exactly as before.

## 0.14.0

### Minor Changes

- c78e515: Fleet homepage now shows per-site cards with a11y violations, deps drift (count + major-behind), security vulnerability counts by severity, last-audited relative time, and a 4-point onboarding status. `audit --write-airtable` extended to persist the new counts to seven new `Websites` columns (`A11y Violations`, `Deps Drifted`, `Deps Major Behind`, `Security Vulns Critical/High/Moderate/Low`) alongside the existing Lighthouse fields.

  **Operator action required:** add the seven new number columns to the Airtable Websites table before running `audit --write-airtable` on the new version. Missing columns won't crash — they'll just stay `null` on the dashboard until populated.

## 0.13.0

### Minor Changes

- 640aa03: Refresh `baselineVersions` against `reddoor-starter`'s May 2026 dep set. Most caret-floated sites in the fleet had drifted ahead of the previous baseline (svelte 5.55.5 → 5.55.10, kit 2.59.0 → 2.61.1, vite 8.0.10 → 8.0.14, prismic-client 7.3.1 → 7.21.8, prismic-svelte 2.0.0 → 2.2.1, slice-machine-ui 2.11.1 → 2.21.3, eslint 10.3.0 → 10.4.0, prettier 3.1.1 → 3.8.3, prettier-plugin-svelte 3.2.6 → 4.0.1, tailwindcss 4.0.14 → 4.3.0, @lucide/svelte 1.14.0 → 1.17.0, and ~10 more). After this change, `deps` audits across the fleet flip from `warn` back to `pass` without any per-site work.

  Also adds `.reddoor-a11y/` to `CANONICAL_GITIGNORE_ENTRIES` so the local audit-output dir lands in every site's managed gitignore block on the next `sync-configs` run.

  The Svelte 4 → 5 upgrade recipe (`src/recipes/svelte-5/step-bump-versions.ts`) is intentionally unchanged — it pins a known-good transition combo, not the live baseline.

## 0.12.1

### Patch Changes

- 0e70da9: Fleet homepage now hides sites without a `Dashboard Token` instead of rendering them with a "no token" badge. The Airtable Websites table tracks every project — many aren't on the Reddoor maintenance stack (deprecated, hosting-only, in-dev for other teams). `dashboardToken` is the explicit opt-in: only sites with a token belong on the fleet view.

  Filter happens at the Netlify function layer; the render module is now a pure "render what you're given" function. Header copy updated from "N sites in the Websites table" to "N sites on the Reddoor stack" to match.

## 0.12.0

### Minor Changes

- 3aa8c8d: Phase 2 of the site dashboard: a password-gated fleet homepage at `/` listing every site in the Airtable Websites table. Each row links to its per-site `/s/<slug>?t=<token>` page (Phase 1). HTTP Basic Auth against a new `DASHBOARD_PASSWORD` env var (Netlify site env); username is ignored. Sites without a `Dashboard Token` set render with a "no token" badge so the homepage doubles as a setup-progress view.

  Operator setup: set `DASHBOARD_PASSWORD` in the Netlify site env (any value), then visit `https://<netlify-domain>/`. Browser prompts for credentials; type anything for username, the configured value for password.

  Phase 2b (click-to-trigger audit per site, via GitHub Actions workflow_dispatch) and Phase 2c (extending `audit --write-airtable` to persist lint/deps/security/a11y findings) are deferred to separate plans.

## 0.11.2

### Patch Changes

- 1882bc8: `audit --write-airtable` no longer refuses to write scores when the lighthouse audit fails because of assertion thresholds (e.g. best-practices below 0.9). The dashboard's whole purpose is to track those scores over time — refusing to push them when one assertion trips defeats the point.

  New behavior: only refuse when the audit produced no scores at all (infrastructure failure — empty `details.summary`, e.g. no manifest written / spawn timeout). Real scores below threshold are written.

  Extracted as `hasRealScores(result)` in `src/audits/lighthouse-airtable.ts` so the policy is unit-testable in isolation.

## 0.11.1

### Patch Changes

- 9ed0f23: Fix `/s/:slug` dashboard routing. The 0.11.0 shape relied on a `[[redirects]]` rewrite with `status=200` to map `/s/:slug` → the site-dashboard function — but Netlify passes the ORIGINAL request URL to the function in that mode, so `slug` was never extractable from the query string and every request fell through to the health-check JSON.

  Switches to Netlify v2 function-level path routing via `export const config = { path: ["/s/:slug", "/.netlify/functions/site-dashboard"] }`. The function reads `slug` from `ctx.params` (with the query-string fallback retained for direct function calls). Drops the rewrite from `netlify.toml`. Caught immediately on the first end-to-end deploy verification against caltex.

## 0.11.0

### Minor Changes

- 58379eb: Add per-site dashboard at `/s/<slug>?t=<token>`, deployed by the existing Netlify site. Pulls site metadata + lighthouse scores + recent reports from Airtable; gated by a new `Dashboard Token` field on the Websites row (operator generates one per site, rotated by replacing the value). Pure render module (`renderSiteDashboardHtml`) + constant-time token compare (`verifyDashboardToken`) are exported from the package entry for library consumers and CLI preview use.

  Operator setup: add a single-line-text field named `Dashboard Token` to the Websites table, generate a token with `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`, paste into the row. The dashboard URL becomes shareable immediately.

  Phase 1 surfaces what's already in Airtable today — lighthouse 4-tile + recent reports list. Phase 2 (extending `audit --write-airtable` to persist lint/deps/security/a11y findings + adding those tiles) lands in a follow-up. Custom domain (e.g. `status.reddoor.la`) is operator DNS work; the function is domain-agnostic.

## 0.10.7

### Patch Changes

- fd5b52c: a11y audit: write the spec/config directory inside `site.path` (not `/tmp`) so the spec's `import AxeBuilder from "@axe-core/playwright"` resolves via Node's walk-up to the site's `node_modules`. Same class of bug as the `webServer.cwd` fix in 0.10.6 — third layer of "the audit's working directory matters." Caltex 0.10.6 dogfood reproduced this in seconds; the manual fix-validation against caltex came back with `0 violations, 1 passed in 9.2s`.

## 0.10.6

### Patch Changes

- b7d6964: Two real fixes surfaced by dogfooding 0.10.5 against caltex.
  - **lighthouse**: `lhci@0.15+` no longer writes `manifest.json` — the audit was reading a stale filename and reporting "no manifest written" against perfectly healthy runs. The audit now scans `.lighthouseci/` for `lhr-*.json` files (which lhci does still write) and builds the manifest equivalent from each lhr's `requestedUrl` + `categories.X.score`.
  - **a11y**: the synthesized playwright config lives in `/tmp`, and playwright's default `webServer.cwd` is the config file's directory — so `npm run vite:dev` was reading `/tmp/.../package.json` and ENOENT'ing before vite ever started. The synthesized config now pins `webServer.cwd` to the site's path.

  Both were silent classes — masked by `manifest.json`-writing test mocks and a `webServer.cwd`-defaulting playwright config. Caltex dogfooding caught both on the first real audit run after 0.10.5 shipped.

## 0.10.5

### Patch Changes

- 488c315: Harden lighthouse + a11y audits against zombie dev-server processes.

  Both audits used to spawn `npm run vite:dev` and probe a hardcoded `localhost:5173`. If another process was already on 5173 (e.g. an orphaned vite from a prior `pnpm dev`), vite would silently bump to a free port while the audit kept probing 5173 — landing on the zombie and getting stale 404s, surfacing as `no manifest written` / `no results written (exit 1)`.

  The audits now allocate a free port up front and pass `--port <port> --strictPort` to vite, so the spawned server either binds the intended port or fails loudly. The lighthouse config gets its URL port rewritten to match; the a11y audit synthesizes its own playwright config (with `reuseExistingServer: false`) instead of relying on the site's local one.

## 0.10.4

### Patch Changes

- 9b506b4: fix: legacy-reactive codemod skips comments + selfPackageVersion/resolvePackageVersion walk up to find our package.json

  Two silent-corruption bug classes surfaced in tonight's deep review of the 0.7→0.10 arc. Both shipped in 0.10.x without ever triggering a test failure or a parser error.

  **1. `legacy-reactive.ts` brace counter ignored comments.**

  The codemod that converts `$: { ... }` Svelte 4 reactive blocks into `$effect(() => { ... })` walked the source counting braces, but only knew how to skip string literals — not `// line comments` or `/* block comments */`. A reactive block containing `// closing brace: }` would have the comment's `}` decrement the depth counter prematurely, causing `findMatchingClose` to return the wrong position. Result: either consume code AFTER the block (the real closing brace would be left as an orphan) or drop code FROM the block (truncated body emitted inside the new `$effect`). Output still compiles in Svelte 5 — no parser to scream — so the corruption shipped silently.

  Fix: `findMatchingClose` now skips both `// …\n` and `/* … */` segments alongside the existing string-literal masking. 3 new regression tests in `tests/recipes/svelte-5/codemods/legacy-reactive.test.ts` pin both comment shapes plus an inflate-depth case.

  **2. `selfPackageVersion` + `resolvePackageVersion` silently returned `"0.0.0"`/`"unknown"` when called from `dist/index.js`.**

  Both helpers used a `here/../../package.json` shortcut that held for `src/X/Y.ts` (in dev) and `dist/cli/bin.js` (in CLI invocations) — both happen to be 2 dirs deep under the package root. But when a consumer imports `onboard` from `dist/index.js` (only 1 dir deep), the lookup walks above the package root, ENOENTs, and the defensive fallback kicks in. Library consumers got `^0.0.0` pinned into their site's `package.json` instead of `^0.10.3`. Same bug class as the bundled-assets ENOENT we hotfixed in 0.10.2.

  Both functions now walk UP from the caller looking for the first `package.json` whose `name` matches `"@reddoorla/maintenance"`. Robust regardless of bundling layout.

  `selfPackageVersion` and `selfCaretRange` are now exported from the library entry so the regression test can invoke them through the built `dist/index.js` — the production context where the bug actually shipped. New `tests/util/self-version.test.ts` covers both src-context and dist-context paths plus the walk-past-unrelated-package.jsons case (essential when the consumer's own `package.json` sits above `node_modules/@reddoorla/maintenance/`).

## 0.10.3

### Patch Changes

- 3a6815a: fix(codemod, audit): dollar-restprops trailing-comma corruption + a11y spawn timeout

  **Codemod (`dollar-restprops`):** when the input `$props()` destructuring had a multi-line shape with a trailing comma (`{ foo, bar, }`), the codemod's `${trimmed}, ...rest` template emitted `bar,, ...rest` — invalid syntax. Surfaced when running init against caltex on 2026-05-27: Accordian.svelte was committed with a double comma and ESLint/prettier choked. Fix strips any trailing comma before insertion; new regression test pins both the plain-JS and TS-annotated forms.

  **a11y audit:** spawn was inheriting the shared 30 s default from `runAudits`. On cold trees, playwright needs to download Chrome + boot the dev server, easily 2-3 min — same failure mode the lighthouse audit had before its 5-min override. a11y now gets the same `timeoutMs: 5 * 60_000` treatment.

  Both bugs surfaced in the same `init` smoke test run; bundling them since they're equally small + same severity (both rendered the chain unable to complete cleanly on a real site).

## 0.10.2

### Patch Changes

- 8bd3751: fix(reports): bundled-image loader walks up to find assets dir (regression in 0.10.0–0.10.1)

  `reddoor-maint report --send-ready` on the published 0.10.0 and 0.10.1 packages crashed with `ENOENT: no such file or directory, open '<install>/dist/cli/check.png'` — tsup inlined the loader module into `dist/cli/bin.js` (and other entries), so its `dirname(fileURLToPath(import.meta.url))`-based sibling resolution looked next to `bin.js` instead of next to the actual `check.png` / `blurredTests.jpg` in `dist/reports/maintenance-email/assets/`. Dev tests didn't catch it because Vitest evaluates source files directly.

  Fix: the loader now walks up from `import.meta.url` looking for the assets dir in either the dev layout (`src/reports/maintenance-email/assets/`) or the published layout (`dist/reports/maintenance-email/assets/`). Memoised — walks once per process. Source layout preferred so workspace dev always reads from the canonical source.

  New regression test (`tests/reports/bundled-assets.test.ts`) builds dist and spawns Node to invoke `loadBundledImages` through `dist/index.js` from arbitrary cwds, including `/` — the actual failure mode that shipped (npx runs the package from `~/.npm/_npx/<hash>/` with the user's cwd elsewhere).

  Also exports `loadBundledImages`, `CHECK_CID`, `BLURRED_CID`, and `BundledImage` from the library entry so consumers / tests can invoke the loader directly.

## 0.10.1

### Patch Changes

- 9e779c9: feat(webhook): GET health-check on `/resend-webhook` + Netlify deploy procedure in README

  `GET /.netlify/functions/resend-webhook` now returns a JSON envelope reporting which of the three required env vars (`RESEND_WEBHOOK_SECRET`, `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`) are present on the deployed Netlify function. Lets operators curl the deployed URL right after wiring env vars and confirm the function is reachable + env is wired before doing any Resend webhook configuration. Reports presence-only — secret values are never echoed (test asserts this).

  README gains a full **Webhook deployment** section under Reports with the click-by-click: create site → set env vars → trigger deploy → curl health → register in Resend → end-to-end smoke against ERP Industrials.

  POST behaviour unchanged.

## 0.10.0

### Minor Changes

- fa098a0: feat(recipes): `reddoor-maint init` — one-shot guided onboarding

  Runs the full onboarding chain (`convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures-page → audit`) in sequence against a site. Thin orchestrator — every underlying recipe still creates its own branch, so the operator ends up with a stack of `maint/<recipe>-<ts>` branches to PR. `noop` results continue the chain; first `failed` recipe or uncaught error short-circuits.

  ```bash
  pnpm reddoor-maint init             # against cwd
  pnpm reddoor-maint init ./my-site   # explicit path
  pnpm reddoor-maint init --fleet airtable   # across the fleet
  ```

  Also adds a new `a11y-fixtures-page` recipe (included in `init`'s default sequence) that writes a starter `src/routes/dev/a11y-fixtures/+page.svelte` if the route doesn't exist. The `lighthouse` and `playwright-a11y` configs both target this URL; newly-onboarded sites need the route to exist for either audit to pass. Template is intentionally generic (semantic landmarks + headings + a relative link) — operator edits to an existing page are never clobbered.

  Library exports: `init`, `a11yFixturesPage`, `DEFAULT_INIT_STEPS`, `InitOptions`, `InitResult`, `InitStep`, `InitStepResult`.

  Closes 0.9.x scope item: `reddoor-maint init` + bootstrap `/dev/a11y-fixtures` route (per [docs/superpowers/plans/2026-05-27-0.9.0-scope.md](docs/superpowers/plans/2026-05-27-0.9.0-scope.md)).

## 0.9.0

### Minor Changes

- a93d84f: feat(audit): per-site lighthouse URL via `package.json#reddoor.lighthouseUrl`

  The lighthouse audit hardcoded `http://localhost:5173/dev/a11y-fixtures` — a hand-crafted Reddoor-fleet dev route. Newly-onboarded sites (e.g. CalTex) don't have that route and the audit failed with "no manifest written" before any scores could be collected. Sites can now override the URL in their own `package.json`:

  ```jsonc
  {
    "reddoor": {
      "lighthouseUrl": "http://localhost:5173/",
    },
  }
  ```

  Fallback unchanged when the field is missing, malformed, empty-string, or wrong type — existing Reddoor sites keep working without edits.

  Also bundled here: the lighthouse audit now gets a 5-minute spawn timeout (was 30 s, the shared default starved lhci on cold trees). This fix was originally pushed to PR #40 after the squash-merge so it never landed; folding it in alongside the related URL work.

## 0.8.0

### Minor Changes

- 2c0ca92: feat(workflow): 0.8.0 — close the operator workflow loop opened in 0.7.0.

  **New: `audit lighthouse --write-airtable [slug]`**

  Pushes the 4 Lighthouse scores directly to the matching Websites row in Airtable, plus a `Last lighthouse audit at` timestamp. Slug defaults to the cwd's `package.json#name` if not provided. Refuses to write if the lighthouse audit failed (won't overwrite good scores with garbage). Eliminates the manual paste step from the report-drafting flow.

  **New: `--fleet airtable`**

  Inventory keyword to read sites directly from the Airtable Websites table instead of a JSON file. Combined with `REDDOOR_FLEET_WORKDIR` env var (or `--workdir`), lets operators run `reddoor-maint audit --fleet airtable` against the full Airtable fleet. Excludes sites where both maintenance + testing freq are None.

  **Reports: orchestrator test coverage**

  `draftReportForSite`, `sendApprovedReports`, and `sendOne` now have real integration tests using a typed `Pick<AirtableBase, …>` fake at `tests/reports/_helpers/fake-airtable-base.ts`. Covers recipient resolution + fallback, Subject override, B1 attachment shape (header + bundled CIDs), B2 idempotencyKey, H4 non-clobbering stamp, missing-headerImage error, orphan-siteId error.

  **Reports: vendored CloudFront images**

  `check.png` and `blurredTests.jpg` are bundled in `src/reports/maintenance-email/assets/` and embedded inline via CID alongside the per-site header. The previous external dependency on `d3eq0h5l8sxf6t.cloudfront.net` is gone; emails are ~600 KB heavier on Maintenance variants and self-contained.

  **Reports: defensive cleanups**
  - `findDueReports` skips sites in status `deprecated` or `probably not our problem`.
  - `attachRenderedHtml` dead-code removed; `uploadHtmlAttachment` moved from `draft.ts` → generalized `uploadAttachment` in `airtable/attachments.ts`.
  - Webhook now imports `findReportByMessageId` + `setDeliveryStatus` from the shared module (was duplicating the query inline).
  - `STATUS_MAP` is single-source at `src/reports/webhook-events.ts` (was duplicated in the webhook test).

  **Perf: `audit --fleet` parallelizes across sites**

  Switched from a sequential for-loop to `runAuditsAcross`. Fleet of 30 sites × 5 audits each goes from ~30 min serial to roughly the longest single-site audit time.

  **Required env (unchanged):** `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY` (CLI); `RESEND_WEBHOOK_SECRET` (webhook only). New optional: `REDDOOR_FLEET_WORKDIR` (default workdir for `--fleet airtable`).

  **Still deferred to 0.9.0:** GA Data API integration, webhook deployment pipeline (Netlify site provisioning).

## 0.7.0

### Minor Changes

- d1218ac: feat(reports): add the `report` concept — per-site maintenance/testing email reports built from Lighthouse + Airtable, sent via Resend with per-client header inlined via CID. New CLI surface: `reddoor-maint report --due`, `reddoor-maint report <slug>`, `reddoor-maint report <slug> --preview`, `reddoor-maint report --send-ready`. Includes a Netlify webhook function for writing Resend delivery events back to Airtable's `Reports.Delivery status`.

  Operator flow: cron `--due` drafts overdue reports → operator reviews HTML attachment on Airtable mobile, fills in the two GA user-count fields, flips `Approved to send` → cron `--send-ready` sends → webhook updates `Delivery status`.

  Required env: `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY` (CLI); `RESEND_WEBHOOK_SECRET` (webhook only). See `.env.example`.

  Deferred to 0.7.1: GA Data API automation (manual entry in Airtable mobile for now).

## 0.6.8

### Patch Changes

- 4d43784: ### Internal: `withRecipe(...)` wrapper consolidates the boilerplate every recipe used to re-implement

  Closes debt item #15 from the deep-review backlog. Pure refactor — no behavior changes (every existing recipe test passes unchanged).

  Every recipe used to hand-roll: site-label resolution, working-tree clean check, branch name + branch creation, commit-with-message + SHA accumulation, and the `RecipeResult` object literal for each of `noop` / `failed` / `applied`. That pattern is now centralised in `src/recipes/_with-recipe.ts`:

  ```ts
  export async function syncConfigs(site, opts): Promise<RecipeResult> {
    // ... compute targets ...
    return withRecipe({
      name: "sync-configs",
      site,
      plan: async () => {
        const diffs = await planTemplateDiffs(...);
        if (nothing) return { kind: "noop", notes: "..." };
        return { kind: "apply", plan: { diffs } };
      },
      apply: async ({ diffs }, { commit }) => {
        for (const t of diffs) {
          await writeFile(...);
          await commit(`chore: sync ${t.config} ...`);
        }
        return { kind: "ok" };
      },
    });
  }
  ```

  Plan runs first — read-only by default, so most recipes can `noop` on a dirty tree without throwing. `bump-deps` opts into `checkTreeFirst: true` because its plan runs `pnpm install` to get an accurate `outdated` probe and would otherwise pollute a dirty tree silently.

  ### Numbers
  - 6 recipes refactored (`sync-configs`, `bump-deps`, `convert-to-pnpm`, `onboard`, `svelte-codemods`, `svelte-4-to-5`)
  - ~142 lines of duplicated boilerplate removed across recipe files
  - One new internal module (~114 lines) holding the shared logic
  - Net: smaller, more focused recipe modules; new recipes can be added with significantly less ceremony
  - 268 / 268 tests pass without modification — the existing per-recipe specs are the spec for this refactor

## 0.6.7

### Patch Changes

- 43d9fbe: MEDIUM-severity hygiene fixes + small debt cleanup from the deep-review backlog. No behavior changes for happy paths — everything in this release is either a safety improvement, an internal extraction, or new test coverage.

  ### Fixed: `branchName` is now millisecond-precision (item #D)

  Was second-precision. Two recipe invocations within the same second produced the same branch name and collided — rare for serial fleet runs, easy to hit when running from two terminals. ISO format now includes the millis fraction (`maint/recipe-20260526T120000123Z`); the collision window is one millisecond.

  ### Fixed: `removeDollarRestProps` no longer corrupts string literals (item #G)

  `dollar-props-class` previously used a single `/g` regex for both the existence check (`.test()`) and the iterating replace (`.replace()`), with a manual `lastIndex = 0` reset to paper over the statefulness. The `.test()` path now uses a stateless non-`/g` regex; the `/g` variant is reserved for the actual iteration. Pure hygiene — no behavior change.

  ### Fixed: security audit no longer reports false-pass on `metadata.vulnerabilities = {}` (item #I)

  A malformed audit output with `{ metadata: { vulnerabilities: {} } }` previously passed the existence check (`!{}` is `false`), counts defaulted to 0, and the audit silently reported "pass." Empty-object is now treated as a tool error and falls through to the other audit tool.

  ### New: `on:click|modifier` emits an `@migration-task` marker (item #E)

  Svelte 5 removed event modifier syntax entirely. The rewrite is non-trivial (`on:click|preventDefault={fn}` → `onclick={(e) => { e.preventDefault(); fn(); }}`) so the codemod doesn't attempt it automatically — but it now inserts a `<!-- @migration-task: ... -->` comment immediately above each offending element. The original attribute is preserved verbatim. The codemod stays idempotent: re-runs against output don't double-insert.

  ### Internal: bin.ts `runOrExit` helper (debt #14)

  The 7 command `.action()` bodies all duplicated the same try/catch + `process.exit(code)` pattern. Extracted to a `runOrExit(fn, opts)` helper; each `.action()` is now a one-liner.

  ### Internal: extracted shared utilities (debt #18)
  - `siteLabel(site)` was inlined identically in 11 files (every audit + every recipe). Moved to `src/util/site.ts`.
  - `findStringEnd(source, openIdx)` (formerly `findStringClose` / `findStringEnd` in two codemods) moved to `src/util/svelte-source.ts`.

  ### New: CLI tests for onboard, convert-to-pnpm, svelte-codemods (debt #16)

  These three CLI commands previously had no dedicated test files — only the underlying recipe tests. Added `--help` + flag-validation smoke tests mirroring the existing bump-deps / sync-configs / upgrade pattern.

## 0.6.6

### Patch Changes

- 4705694: Six recipe + CLI hygiene fixes from the deep-review backlog.

  ### Fixed: `writePackageJson` preserves source indent style (item #5)

  The helper hardcoded `JSON.stringify(pkg, null, 2)`, so any site using tabs or 4-space indent got reformatted on every recipe that touched `package.json` — noisy and irrelevant diffs in `convert-to-pnpm`, `onboard`, and the svelte-5 bump-versions step. The helper now sniffs the existing file's indent (tab vs N-space) and round-trips with the same style. New files default to two spaces, matching prior behavior.

  ### Fixed: `onboard` sources `AUDIT_DEPS` from `baseline-versions` (item #10)

  `AUDIT_DEPS` previously hardcoded `@lhci/cli`, `@playwright/test`, and `@axe-core/playwright` versions inline — the same staleness foot-gun that `DEFAULT_PACKAGE_VERSION` had before 0.6.2. The map now resolves each name from `src/configs/baseline-versions.ts` at module load, throwing immediately if any audit dep is missing from the baseline (programming-error check). A regression test guards against re-introduction of hardcoded literals.

  ### Fixed: `bump-deps` checks the working tree clean before running `pnpm install` (item #6)

  The pre-flight `pnpm install` (needed so `pnpm outdated` sees a fresh lockfile) ran _before_ the clean-tree check, so a desynced lockfile would be silently rewritten on top of whatever else was in the user's tree. The check is now first; `pnpm install` only runs once we know the tree is clean.

  ### New: `bump-deps` detects competing lockfiles and refuses to run (item #7)

  If `package-lock.json` or `yarn.lock` exists without a `pnpm-lock.yaml`, the recipe is now a fast `{ status: "failed", notes: "run convert-to-pnpm first" }` instead of emitting opaque pnpm errors. No pnpm commands are attempted in this case.

  ### Fixed: `sync-configs --only` rejects unknown config names (item #8)

  The CLI's `parseOnly` previously did `as ConfigName[]` and silently passed typos through, producing a confusing "noop" result. It now validates every name against `ALL_CONFIG_NAMES` (newly exported from `recipes/sync-configs.ts` alongside an `isConfigName` type guard, mirroring `ALL_AUDIT_NAMES`) and throws `{ exitCode: 2 }` with the offending name and the valid list. A type-test in `tests/types.test.ts` guards against drift between the runtime array and the `ConfigName` union.

  ### Fixed: `sync-configs --dry` reports gitignore drift (item #9)

  `dryPlan` previously iterated only the five template configs, so a missing or stale `.gitignore` was silently absent from the dry output even though a real run would create or merge one. The dry plan now also calls into the gitignore canonical-entries merge and reports `would create .gitignore` or `would update .gitignore (N canonical entries to add)` as appropriate. Respects `--only gitignore` to scope output.

## 0.6.5

### Patch Changes

- 4f95a23: Two codemod / recipe safety fixes from the deep-review backlog.

  ### Fixed: `convert-to-pnpm` removes `node_modules` before `pnpm install`

  Sharing a flat npm `node_modules` across package managers produces phantom-dep resolution issues — pnpm's nested layout disagrees with what's already on disk, and consumers downstream see unexpected resolution paths until the next clean install. The recipe now `rm -rf node_modules` between rewriting the lockfile/package.json and running `pnpm install`, so the new tree is a clean pnpm layout from the first install. node_modules is gitignored on every reddoor site so this doesn't dirty the working tree.

  ### New: `legacyReactiveToRunes` codemod emits `@migration-task` markers on block conversions

  `$: { … }` blocks are converted to `$effect(() => { … })` — which always compiles, but only stays reactive if the locals the block mutates were declared as `$state(…)` rather than plain `let`. Detecting that automatically would require scope analysis on the declaration sites (out of scope for this codemod), so the codemod now leaves a breadcrumb next to each converted block:

  ```js
  // @migration-task: $effect won't trigger UI updates on plain `let` bindings — refine mutated locals to $state or split into per-variable $derived.
  $effect(() => {
    justify = float;
    if (float === "left") justify = "start";
  });
  ```

  The marker only appears on `$: { … }` block conversions. Simple `$: var = expr` → `let var = $derived(expr)` conversions are reactive-safe (Svelte 5 `$derived` is reactive by construction) and don't get a marker. The codemod remains idempotent: re-running on output doesn't find any new `$:` blocks to convert, so no new markers get added.

## 0.6.4

### Patch Changes

- 39e0567: ### Fixed: `removeDollarRestProps` no longer emits references to an undeclared `rest`

  The codemod previously rewrote `<div {...$$restProps}>` → `<div {...rest}>` unconditionally, but never modified the script's `$props()` destructuring. The result was Svelte 5 source that referenced an undeclared identifier — a silent runtime breakage on any component using `$$restProps`.

  The codemod now:
  - **Injects `...rest` into an existing `$props()` destructuring** when `$$restProps` is used. For TypeScript components, the inline type annotation is widened with an `[key: string]: unknown` index signature so the rest binding actually captures excess attributes (without the widening, TS would infer `rest` as `{}` and the spread would forward nothing).

    ```ts
    // before
    let { name }: { name: string } = $props();
    // …
    <div {...$$restProps}>{name}</div>

    // after
    let { name, ...rest }: { name: string; [key: string]: unknown } = $props();
    // …
    <div {...rest}>{name}</div>
    ```

  - **Is idempotent.** A `$props()` destructuring that already collects `...rest` is left alone — no double-insert.
  - **Refuses to rewrite when no `$props()` call exists.** The rare Svelte 4 component that used `$$restProps` without `export let` to convert now passes through unchanged, leaving the user with the original `$$restProps` and a clear Svelte 5 build error to migrate by hand — rather than receiving broken output.

  ### Fixed: `removeDollarRestProps` no longer corrupts string literals

  The previous global `replace(/\$\$restProps/g, "rest")` also rewrote occurrences inside `'…'`, `"…"`, and backtick-delimited strings in the script body (e.g. a comment-style error message like `"$$restProps was removed in Svelte 5"` became `"rest was removed in Svelte 5"`). The codemod now masks script-level string literals before the rewrite and restores them afterwards.

## 0.6.3

### Patch Changes

- c03fb1e: ### Fixed: `state-effect-sync` codemod missed the multi-line `$effect` form with trailing semicolons

  The regex only matched `$effect(() => { x; name = expr })` — bare expression, no trailing `;` before the closing `}`. In practice every fleet site authored the effect across multiple lines with a semicolon after the assignment:

  ```js
  $effect(() => {
    data;
    content = data.page.data;
  });
  ```

  That form was silently skipped, leaving `$state + $effect` manual-sync pairs untouched on sites the codemod was supposed to clean up. The pattern now also matches an optional `;` after the assignment, so both forms convert to `$derived(...)`.

  ### New: end-to-end pipeline composition test

  Surfaced this bug, plus catches future regressions where individual recipes pass in isolation but break when chained. The fixture (`tests/fixtures/pre-onboarding/`) is a Svelte 5 site still on npm with every legacy pattern reddoor sites accumulated during their original 4→5 migration. The test runs the full onboarding sequence — `convert-to-pnpm → onboard → sync-configs → svelte-codemods` — and verifies both the green path and idempotency on a second pass. This mirrors the actual sequence we ran (manually) against caltex-landing and espada, where bugs like this one only appeared when recipes ran against each other's output.

## 0.6.2

### Patch Changes

- aabba87: Five critical fixes surfaced by an overnight deep review of the codebase after yesterday's `0.3.0 → 0.6.1` arc.

  ### Restored: `legacyReactiveToRunes` codemod

  The Svelte 4 `$:` reactive statement codemod was authored yesterday but never made it into the merged PR #20 — the merge fired against an earlier tip of the branch and the follow-up commit was lost. Fleet sites were patched via local `dist`, but `npm install @reddoorla/maintenance@0.6.1` did not include it. Restored from the orphan branch and registered in the codemod pipeline.

  ### Fixed: registration drift on the recipe registry

  `"svelte-codemods"` was in the `RecipeName` type union but missing from `ALL_RECIPE_NAMES` and the package's main entry. `isRecipeName("svelte-codemods")` silently returned `false`; library consumers couldn't `import { svelteCodemods }` at all. Now exported and registered. Added a type-test that the runtime array exactly matches the union.

  ### Fixed: `DEFAULT_PACKAGE_VERSION` was hardcoded at `^0.2.0`

  Three majors stale. Any fresh `onboard` was pinning new sites to a version of the maintenance package that predates `convert-to-pnpm`, `svelte-codemods`, and every codemod we shipped. The default now derives from this package's own `package.json` at runtime via the new `selfCaretRange(import.meta.url)` helper — no manual syncing at each minor bump.

  ### Fixed: `git clone` argv-injection on inventory `repoUrl`

  [src/cli/fleet/clone-if-needed.ts] previously passed `repoUrl` to `git clone` positionally, so a `repoUrl` starting with `-` was interpreted by git as a flag (CVE-2017-1000117 family — `--upload-pack=evil` is a known RCE primitive). Now validates the URL against a scheme allowlist (`https://`, `http://`, `ssh://`, `git://`, `file://`, or scp-style `user@host:path`) and passes `--` to `git clone` as a defense-in-depth separator.

  ### Bundled tests
  - New regression test in `types.test.ts` that the recipe registry doesn't drift again.
  - New `onboard.test.ts` case that pins use the live package version.
  - 5 new tests in `clone-if-needed.test.ts` covering argv-injection rejection, scheme validation, and the `--` separator.

## 0.6.1

### Patch Changes

- 421a757: Two codemod fixes surfaced by the caltex 0.6.0 pilot — sites failed to build with `Cannot use $$props in runes mode`.

  ### `dollarPropsClass` (new codemod)

  Converts the legacy `$$props.class` pattern (extra HTML class passed from a parent) to a Svelte 5 named-prop destructuring:

  ```svelte
  <!-- before -->
  <script lang="ts">
    let { foo }: { foo?: string } = $props();
  </script>
  <div class="other {$$props.class || ''}">x</div>

  <!-- after -->
  <script lang="ts">
    let { foo, class: className = "" }: { foo?: string; class?: string } = $props();
  </script>
  <div class="other {className || ''}">x</div>
  ```

  The original `svelte-migrate` tool flagged this with `@migration-task` comments because it can't safely combine `$$props` with named props in general. We can for the `class` case specifically — it's the dominant pattern across the reddoor fleet. The codemod also strips those stale `@migration-task` comments when the file's `$$props` issues are fully resolved.

  Conservative match — only transforms files that have BOTH a template `$$props.class` reference AND an existing `$props()` destructuring. Lazy regex backtracking on the destructuring body so default values containing braces (`click = () => {}`, `config = { x: 1 }`) and type annotations containing braces (`items: string[]|{label:string}[]`) don't truncate the match.

  ### `exportLetToProps` (relaxed)

  Previously only matched `<script lang="ts">` blocks. Now matches plain `<script>` too, emitting destructuring without a type annotation. Picks up Svelte 4 → 5 conversions the original migration skipped (caltex's `ArrowButton` was the immediate find).

  ### Re-running

  Sites that already had 0.6.0 codemods applied can safely re-run `reddoor-maint svelte-codemods` — the new codemods are additive and the existing ones are idempotent.

## 0.6.0

### Minor Changes

- 020f511: Add `svelte-codemods` recipe + `state_referenced_locally` codemod.

  Discovered during the caltex 0.5.0 pilot: Svelte 5's `state_referenced_locally` warning flags real reactivity bugs where `let X = $state(prop.expr)` captures a prop only at init time. The same shape appeared in 6+ caltex route files (and likely across the fleet) — a copy-pasted manual-sync pattern:

  ```js
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => {
    data;
    content = data.page.data;
  });
  ```

  ### `stateEffectSyncToDerived` codemod

  New gotcha codemod that collapses the pattern above into the idiomatic Svelte 5 form:

  ```js
  let content = $derived(data.page.data);
  ```

  Joins the existing `onEventToHandler`, `exportLetToProps`, and `removeDollarRestProps` codemods in the gotchas pipeline. Conservative match: only transforms when the `$state(...)` initializer expression and the `$effect`'s assignment expression are textually identical (after trim). Intervening statements between the two block the match. Idempotent.

  ### `svelte-codemods` standalone recipe

  The full `svelte-4-to-5` recipe short-circuits sites already on `svelte ^5.x`. The new `svelte-codemods` recipe runs the same codemod pass on its own — useful when post-migration Svelte 5 strictness warnings emerge and the fleet needs a clean re-application.

  ```sh
  reddoor-maint svelte-codemods /path/to/site
  ```

  Creates a `maint/svelte-codemods-<ts>` branch with one commit: `refactor(svelte5): apply codemods (N files)`. Plans in memory first — no branch is created if the codemods would be a noop, so re-runs are cheap.

  ### Internal refactor

  `applyGotchaCodemods` now delegates to a new `planGotchaCodemods` that returns the change set without writing. `svelte-4-to-5`'s pipeline keeps the existing write-on-apply behavior; `svelte-codemods` uses the plan/apply split to short-circuit cleanly on noop.

## 0.5.0

### Minor Changes

- fb81d1c: `sync-configs` now manages `.gitignore` across the fleet and untracks build artifacts.

  A new canonical config target — `gitignore` — joins the five existing ones (`eslint`, `prettier`, `lighthouse`, `playwright-a11y`, `svelte`). Unlike the others, it **merges** rather than overwrites: the recipe layers in any missing canonical entries while leaving site-specific lines (custom dirs, editor files, OS junk) untouched.

  In the same commit, the recipe also runs `git rm -r --cached` for any tracked paths that fall under a canonical _directory_ entry — typically `build/`, `dist/`, `.svelte-kit/`, `coverage/`, `playwright-report/`, `test-results/`, `.lighthouseci/`, `.vercel/`, `.netlify/`, `node_modules/`. So sites that accidentally committed build output (espada has, caltex has) get cleaned up the next time sync-configs runs.

  ### Canonical entries

  ```gitignore
  node_modules/
  build/
  dist/
  .svelte-kit/
  coverage/
  .vitest-cache/
  playwright-report/
  test-results/
  .lighthouseci/
  .tsbuildinfo
  .env
  .env.*
  !.env.example
  .DS_Store
  *.log
  .vercel/
  .netlify/
  ```

  File-pattern entries (`.env`, `*.log`, `.DS_Store`, `.tsbuildinfo`) are **not** auto-untracked. They may contain user-meaningful data, and `git rm --cached` cannot scrub secrets from history regardless. Surfaced via the `.gitignore` rule itself; manual cleanup if needed.

  ### Merge semantics
  - Existing entries in any normalized form (`build`, `/build`, `build/`, `/build/`) count as present — no duplicates appended.
  - Blank lines and comments are preserved.
  - Missing canonical entries are appended under a `# canonical entries from @reddoorla/maintenance sync-configs` marker.
  - All-present → noop, no commit.

  ### Re-running against onboarded sites

  Sites previously synced under ≤ 0.4.0 will see one new commit: `chore: sync gitignore from @reddoorla/maintenance` — adds the rule, untracks any matching build artifacts. Idempotent: re-running is a noop.

  ### CLI

  ```sh
  # whole site (all six config targets)
  reddoor-maint sync-configs /path/to/site

  # just the gitignore + untrack pass
  reddoor-maint sync-configs /path/to/site --only gitignore
  ```

## 0.4.0

### Minor Changes

- 5e08fe0: Add `createSvelteConfig` helper and svelte.config.js to sync-configs templates.

  Discovered during the caltex pilot: Svelte 5 emits `element_invalid_self_closing_tag` for the `<div ... />` shorthand reddoor codebases use everywhere. Across a fleet this drowns out useful warnings; silencing it once per site was repetitive.

  ### `createSvelteConfig`

  New canonical helper exported from `@reddoorla/maintenance/configs/svelte`. Wraps a site's existing config and layers in the canonical `compilerOptions.warningFilter`, which silences `element_invalid_self_closing_tag`. Composes cleanly with any site-provided filter — both must allow a warning for it to show.

  ```js
  // svelte.config.js
  import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
  import adapter from "@sveltejs/adapter-auto";

  export default createSvelteConfig({
    kit: { adapter: adapter() },
  });
  ```

  ### sync-configs now includes svelte

  The recipe now writes a canonical `svelte.config.js` using `createSvelteConfig` + `adapter-auto`. Sites already on `adapter-auto` (most reddoor sites) get clean syncs. Sites using a different adapter need to edit after sync.

  The new template intentionally **drops** `preprocess: vitePreprocess()` since Svelte 5 no longer needs it. Sites carrying that legacy preprocess setting are quietly modernized during sync.

  ### Re-running sync-configs against onboarded sites

  Sites previously synced under ≤ 0.3.0 will see a new commit for `svelte.config.js` on the next run. Idempotent: re-running again is a noop.

## 0.3.0

### Minor Changes

- 00081f3: Add `onboard` recipe + CLI command for first-time fleet enrollment.

  After running `convert-to-pnpm` to get a site onto pnpm, the next missing piece was: how does the site actually get the deps it needs to run audits? Discovered during the espada pilot — running `sync-configs` against a site missing `@reddoorla/maintenance`, `@lhci/cli`, `@playwright/test`, or `@axe-core/playwright` would land template files that immediately broke at runtime.

  `onboard` closes that gap. It:
  - Adds `@reddoorla/maintenance` as a devDep at the current minor range (`^0.2.0`) if not present
  - Adds the canonical audit deps (`@lhci/cli`, `@playwright/test`, `@axe-core/playwright`) at baseline versions
  - Runs `pnpm install` with streaming output
  - Commits the resulting package.json + pnpm-lock.yaml as one logical change

  Idempotent: returns `noop` when everything is already declared. Refuses on dirty trees. Pre-flights for `pnpm-lock.yaml` and returns `failed` with `"run convert-to-pnpm first"` if absent.

  CLI: `reddoor-maint onboard [site]` with `--audits lighthouse,a11y` to subset (default = both) and `--fleet <inventory>` for batch onboarding.

  Library: `onboard(site, { audits?, packageVersion?, spawn? })` exported from the package.

  ### Recommended workflow for new fleet sites

  ```bash
  reddoor-maint convert-to-pnpm /path/to/site   # if site is on npm/yarn
  reddoor-maint onboard /path/to/site            # install deps
  reddoor-maint sync-configs /path/to/site       # write canonical configs
  reddoor-maint audit /path/to/site              # verify
  ```

## 0.2.0

### Minor Changes

- 366f389: Add `convert-to-pnpm` recipe + CLI command to migrate npm/yarn sites onto pnpm. Also fixes canonical configs to use portable start commands.

  ### New: `convert-to-pnpm` recipe

  For sites still using `package-lock.json` (or `yarn.lock`). Idempotent and branch-isolated like every other recipe:
  - Detects `pnpm-lock.yaml` → returns `noop`
  - Otherwise: removes `package-lock.json` + `yarn.lock`, pins `packageManager: "pnpm@<version>"` in `package.json`, rewrites `npm run X` → `pnpm run X` and `npx X` → `pnpm dlx X` in scripts, runs `pnpm install`, commits the resulting `pnpm-lock.yaml`.
  - Three commits per applied run (lockfile removal, packageManager + script rewrites, new pnpm-lock).
  - Returns `failed` (with the branch preserved for inspection) if `pnpm install` errors.

  CLI: `reddoor-maint convert-to-pnpm [site]` or with `--fleet` for batch conversion.

  Library: `convertToPnpm(site, { spawn?, pnpmVersion? })`.

  ### Fix: canonical configs use portable `npm run vite:dev`

  Both `src/configs/lighthouse.ts` (`startServerCommand`) and `src/configs/playwright-a11y.ts` (`webServer.command`) previously hardcoded `pnpm vite:dev`. After sync-configs landed on an npm site, lhci and Playwright would fail to start the dev server. `npm run vite:dev` works on both pnpm and npm sites with no downside.

  ### Script rewriter is conservative on purpose
  - Touches `npm run <name>` and `npx <token>` (identical semantics under pnpm)
  - Skips bare `npm install`, hyphenated names like `npm-check-updates`, and concurrently's `"npm:scriptName"` shorthand

## 0.1.3

### Patch Changes

- 4939cc5: Fix security audit silently reporting `pass` for npm-using sites (no pnpm-lock.yaml).

  When pnpm was installed but the project had no pnpm-lock.yaml, pnpm audit emitted an error envelope (`{ "error": { "code": "ERR_PNPM_AUDIT_NO_LOCKFILE", ... } }`) and exit code 1. The audit treated that as valid output, read `metadata.vulnerabilities` as undefined → defaulted every count to 0 → returned `pass`. Every npm-using site in a fleet was reported as security-clean.

  Discovered while piloting against an npm-using reddoor site (espada): the site has 9 real CVEs (3 high, 5 moderate, 1 low) including `@sveltejs/kit` and `devalue` advisories. The previous version reported `0 vulnerabilities`.

  The audit now:
  - Falls through to `npm audit` not just when pnpm is missing, but whenever pnpm returns an error envelope, non-zero/non-one exit code, unparseable JSON, or output without `metadata.vulnerabilities`.
  - Skips with a clear `cannot run audit — pnpm: <reason>; npm: <reason>` summary when both tools fail.

  Tests cover the error-envelope, missing-metadata, and both-tools-failed paths.

## 0.1.2

### Patch Changes

- 2391f77: Recipe + audit robustness pass surfaced by a second-deep code review. No public API breakage; one inventory schema tightening flagged below.

  **Recipe fixes:**
  - `svelte-4-to-5` no longer adds packages the site never declared. The step now uses a new `bumpDep(..., { mode: "bump-only" })` option that updates existing entries but skips packages that aren't already present. Sites that intentionally exclude e.g. `@sveltejs/adapter-netlify` stay clean.
  - `svelte.config.js` migration handles multi-name imports (`{ vitePreprocess, sveltePreprocess }` — only `vitePreprocess` is removed, the rest are preserved) and `vitePreprocess(options)` calls with balanced-paren matching instead of an empty-parens regex.
  - `bump-deps` now runs `pnpm install` before `pnpm outdated --json` so the outdated probe acts on a fresh lockfile rather than potentially stale data.
  - `bump-deps` streams `pnpm up` output to the parent so long upgrades show live progress rather than looking hung.
  - `$$Props` interface removal now uses brace counting so nested-brace or multi-line interface bodies are removed correctly.

  **Audit fixes:**
  - A11y spec now sets `test.setTimeout(5 * 60_000)` so multi-route scans don't trip Playwright's 30s per-test default.
  - Lint audit hands relative paths to ESLint (cwd is already set), avoiding symlink dereferencing on pnpm workspaces.
  - Security audit handles npm `via: "string"` chains, deduplicates transitive vulnerabilities to their root advisory, and normalizes `"info"` severity to `"low"` instead of defaulting to `"moderate"`.

  **Robustness:**
  - CLI version readout no longer crashes on Yarn PnP setups (where `node_modules/<pkg>/package.json` isn't a real file). Falls back to `"unknown"`.
  - `cloneIfNeeded` rejects inventory `name` values that contain path separators, absolute paths, or `..` traversal segments — closes a path-escape vector for untrusted inventories.
  - `fromJsonFile` rejects inventory entries with relative `path` values; absolute paths only.

  **New options:**
  - `bumpDep(pkg, name, version, { mode: "bump-only" })` — added.
  - `SpawnFn` options gained `streaming?: boolean` to inherit stdio. When true, the returned stdout/stderr will be empty.

## 0.1.1

### Patch Changes

- 15d81b2: Fix lighthouse and a11y audits to parse real tool output. Previously they discarded everything the tools wrote and synthesized results from spawn exit code alone, which made `details.summary` always empty for lighthouse and silently dropped per-impact axe violation data.
  - Lighthouse now reads `<site>/.lighthouseci/manifest.json` for per-category scores and `<site>/.lighthouseci/assertion-results.json` for which assertions failed at what level.
  - A11y now writes a Playwright spec that aggregates axe violations across all configured routes into `<site>/.reddoor-a11y/results.json` (via the `REDDOOR_A11Y_OUTPUT` env var); the audit reads that artifact regardless of test outcome.
  - Security audit now surfaces per-advisory details (module, severity, title, CVEs) in `details.advisories` alongside the existing counts.
  - Stale `.lighthouseci/` and `.reddoor-a11y/` directories are removed before each run so a failed spawn can't masquerade as success by leaving last run's data in place.

## 0.1.0

### Minor Changes

- daf5ec4: Initial public release: configs, audits, recipes, inventory, CLI.
