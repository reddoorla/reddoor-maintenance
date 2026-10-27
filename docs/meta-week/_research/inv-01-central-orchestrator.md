# inv-01 — The central orchestrator: `reddoor-maintenance`

Survey date **2026-09-12**. Repo: `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance`,
on `main` at `9f5fc898`, package `@reddoorla/maintenance@0.95.1` (npm `latest` = 0.95.1,
published 2026-09-10).

Everything below is either a command's output or a file I read. Where I inferred
rather than measured, the line says so.

---

## 1. What this repo actually is

Three things wearing one name, and that is the most important fact about it:

1. **A published npm library** (`@reddoorla/maintenance`) that 23 fleet checkouts
   install. It ships shared eslint/prettier/svelte/lighthouse/playwright configs, a
   form-submission client, and a types-only audit-result contract.
2. **A CLI** (`reddoor-maint`, 32 commands) that is the executable body of the fleet.
   Every nightly GitHub Actions workflow in `.github/workflows/fleet-*.yml` and
   `daily-reports.yml` is a thin YAML wrapper around `node dist/cli/bin.js <cmd>`.
3. **A deployed web application** — 20 Netlify functions in `netlify/functions/*.mts`
   serving the operator cockpit, the per-site dashboard, the public form-ingest
   endpoint, the shareable prospect-audit report, and the Resend delivery webhook.

The same `dist/` build serves all three. `src/index.ts` opens by explaining the seam:
the bare package entry transitively imports `mjml`, `airtable`, `resend`,
`@libsql/client`, `@google-analytics/data`, `sharp` and `svix` — all of which live in
`devDependencies` so consuming sites do not inherit them. Fleet sites are only ever
allowed to import `./forms`, `./configs/*`, `./images`, `./client` and `./audit`. That
contract is machine-enforced by `scripts/smoke-dist.mjs`, which loads each
consumer-facing entry under a Node resolution hook (`scripts/central-dep-blocker.mjs`)
that makes those 11 packages unresolvable — reproducing a consumer's install exactly.
It replaced an earlier source-scanning regex that "silently missed esbuild's
multi-line imports and so passed vacuously." That is the house style in one sentence.

## 2. Scale, measured

```
$ find src -name '*.ts' | wc -l                   → 379 files
$ find src -name '*.ts' -exec cat {} + | wc -l    → 77,958 lines
$ find tests -name '*.ts' -exec cat {} + | wc -l  → 104,713 lines (484 *.test.ts)
$ cat netlify/functions/*.mts | wc -l             → 2,695 lines (20 functions)
$ cat .github/workflows/*.yml workflows/reusable/*.yml | wc -l → 2,334 (14 workflows)
$ find docs -name '*.md' | wc -l                  → 169 files, 112,222 lines
$ wc -l README.md                                 → 507 lines (CHANGELOG.md is 406,723 bytes)
```

Tests outweigh source 1.34 : 1 by line count. Docs outweigh source outright.

### Where the code is concentrated

| area             | src files | src lines | test lines | test:src | last commit    | commits/90d | commits/30d |
| ---------------- | --------: | --------: | ---------: | -------: | -------------- | ----------: | ----------: |
| `src/prospect/`  |        30 |    15,598 |     14,918 |     0.96 | 2026-09-08     |          18 |          18 |
| `src/blux/`      |        63 |     9,188 |     10,792 |     1.17 | 2026-09-01     |          54 |       **2** |
| `src/cli/`       |        37 |     8,960 |     10,283 |     1.15 | 2026-09-09     |          92 |          35 |
| `src/recipes/`   |        44 |     8,547 |     10,418 |     1.22 | 2026-09-10     |          42 |          18 |
| `src/reports/`   |        43 |     7,980 |     11,474 |     1.44 | 2026-09-04     |         101 |          34 |
| `src/dashboard/` |        33 |     6,215 |     12,389 | **1.99** | 2026-09-11     |          68 |          24 |
| `src/audits/`    |        33 |     5,858 |      8,147 |     1.39 | 2026-09-11     |          43 |          11 |
| `src/db/`        |        19 |     4,719 |      7,099 |     1.50 | 2026-09-10     |          57 |          39 |
| `src/forms/`     |        21 |     3,184 |      5,479 |     1.72 | 2026-09-03     |          46 |          11 |
| `src/prismic/`   |        10 |     2,199 |      4,350 |     1.98 | 2026-08-31     |           4 |           4 |
| `src/github/`    |         5 |     1,555 |      2,160 |     1.39 | 2026-08-25     |          18 |           1 |
| `src/webflow/`   |         9 |     1,029 |        806 | **0.78** | **2026-07-28** |           1 |           0 |
| `src/alerts/`    |         5 |       916 |      1,835 |     2.00 | 2026-09-04     |          11 |           3 |
| `src/util/`      |        12 |       811 |        982 |     1.21 | 2026-09-09     |           9 |           7 |
| `src/configs/`   |         6 |       630 |        594 |     0.94 | 2026-09-10     |           9 |           5 |
| `src/inventory/` |         4 |       171 |        340 |     1.99 | 2026-08-24     |           4 |           1 |
| `src/client/`    |         2 |       151 |        222 |     1.47 | 2026-07-05     |           1 |           0 |
| `src/images/`    |         1 |        67 |         77 |     1.15 | 2026-09-01     |           1 |           1 |

(Commit counts from `git log --since=… --oneline -- <dir> | wc -l`; 90d window from
2026-06-14, 30d from 2026-08-13.)

Twenty largest single source files — the concentration is real:

```
3453 src/prospect/site-checks.ts
2506 src/recipes/match-harness/template.ts
2344 src/cli/commands/prismic-models.ts
1212 src/prospect/crawl.ts
1204 src/reports/airtable/websites.ts
1152 src/dashboard/render.ts
 985 src/audits/form-e2e.ts
 977 src/cli/commands/blux.ts
 918 src/cli/bin.ts
 908 src/audits/browser.ts
```

`src/recipes/match-harness/template.ts` is 2,506 lines of embedded `.mjs`/`.md` source
shipped as TypeScript template literals — a whole second program living inside a
string. Hold that thought for §9.

---

## 3. The subsystems, and what each does

### `src/audits/` — 11 audits over a fleet roster

`src/audits/index.ts` holds a `REGISTRY: Record<AuditName, (ctx) => Promise<AuditResult>>`
with exactly 11 entries: `deps, lighthouse, a11y, security, lint, domain, browser,
netlify-deploy, function-health, smoke, form-e2e`. Every audit returns the closed union
`"pass" | "warn" | "fail" | "skip"`. `runOneAudit` wraps each in a 30s-timeout spawn and
converts a thrown error into a `fail` result rather than crashing the sweep.

Each audit has a paired `*-airtable.ts` writer (`lighthouse-airtable.ts`,
`smoke-airtable.ts`, …) plus `write-audits-to-airtable.ts` and `health-mirror.ts` that
dual-writes to Turso. `fleet-event-detectors.ts` + `fleet-events-writer.ts` turn audit
deltas into the `fleet_events` rows the cockpit's activity feed reads.
`protection-coverage.ts` and `github-signals.ts` are org-level, not per-site.

### `src/reports/` — the per-site maintenance/testing email pipeline

The most-committed area of the last 90 days (101 commits). Flow: `due.ts` (what is
scheduled) → `draft.ts` (assemble `ReportData`, enrich with GA + Search Console via
`ga/` and `search/`) → `render.ts` + `maintenance-email/template.ts` (MJML) → operator
approves in the dashboard → `send/orchestrate.ts` → `send/resend.ts`. Supporting:
`header-image/` (Playwright-captures the live homepage and composes it onto a plate —
`capture.ts`/`compose.ts`/`geometry.ts` plus five PNG assets that tsup copies into
`dist/` via an explicit `onSuccess` hook), `digest.ts` (the daily operator digest),
`checklist.ts` + `auto-tick.ts` (the 12-item pre-send gate), `preflight.ts`, `queue.ts`,
`webhook-events.ts` (Resend delivery status), `announcement-email/` and `launch-email/`
templates, and `airtable/` (7 files, the store layer).

### `src/dashboard/` — the operator cockpit

Highest test:src ratio in the repo (1.99). `fleet-render.ts` + `fleet-cockpit.ts` render
the three-band severity cockpit; `render.ts` (1,152 lines) the per-site page;
`fleet-table*.ts` the sortable fleet view; `submissions-page*.ts` the leads view;
`prospect-audits-render.ts` the prospect index. Mutating handlers are kept separate from
renderers: `approve.ts`, `site-details.ts`, `report-commentary.ts`,
`submission-status.ts`, `trigger-renovate.ts`, `trigger-rerender.ts`, `refresh-fleet.ts`,
`prospect-audit-trigger.ts`. Auth is `auth/` (Google OAuth) plus `basic-auth.ts` and
`csrf.ts`.

Routing note worth carrying: every endpoint declares its own
`export const config = { path: [...] }` inside the `.mts` function rather than a
`netlify.toml` redirect, because a `[[redirects]]` rewrite with `status=200` passes the
_original_ URL to the function and `ctx.params` never populates. The comment in
`netlify.toml` records that this cost a debugging session.

### `src/forms/` — the fleet lead pipeline

`endpoint.ts`/`action.ts` are the SvelteKit-side surface sites import via
`@reddoorla/maintenance/forms`. Central side: `ingest.ts` (normalise → Turnstile verify →
spam score → persist → fan out), `spam-classifier.ts` (`SPAM_THRESHOLD` plus the
`BLOCKED_EMAIL_DOMAINS` domain tier), `turnstile.ts`, `token.ts`, `notify.ts`,
`default-replies.ts` + `reply-copy.ts` + `prismic.ts` (CMS-authored auto-replies),
`replay.ts` (dead-letter re-run), `site-lookup.ts`, `webhook.ts`, `mailchimp.ts`, `ics.ts`.

### `src/db/` — Turso/libSQL, now authoritative

19 files, 17 migrations (`migrations.ts`, `0001_init` … `0017_prospect_audits_opened_at`),
a Kysely-typed `schema.ts` with 11 tables (`submissions`, `spam_screenouts`,
`fleet_events`, `migrations`, `submission_deadletter`, `sites`, `site_health`,
`site_schedule`, `reports`, `prospect_audits`, `digest_state`). Operational modules:
`dump.ts`/`parity.ts`/`usage.ts` (backup, verification, quota), `import-airtable.ts`
(the retired hourly sync), `site-mirror.ts`/`fleet-state.ts` (write-through), and
**`freeze.ts`**, the best single file to read if you want to understand how this
codebase thinks:

```ts
// src/db/freeze.ts:52
export const TURSO_IS_AUTHORITATIVE = true;
```

It is a code constant rather than an env var _on purpose_ — the same artifact runs in
Netlify functions and Actions runners, and an env var could be set in one and missed in
the other, giving "a PARTIAL freeze … which is a worse state than either end."
Consumers take it as a **default parameter** so tests exercise both worlds as fixtures,
with exactly one test asserting the shipped value. Flipped 2026-08-31 on the recorded
evidence `FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`.

### `src/prospect/` — the external AEO/SEO audit tool (largest, newest, hottest)

30 files, 15,598 lines, and **all 18 of its last-90-day commits landed in the last 30
days**. It crawls a stranger's site (`crawl.ts`, `pages.ts`, `extract.ts`), probes it
(`http-probes.ts`, `dns.ts`, `assets.ts`, `interaction.ts`, `lighthouse.ts`), scores it
(`checks.ts`, `site-checks.ts` — 3,453 lines — `accessibility.ts`, `consistency.ts`,
`journey.ts`, `answer-space.ts`), asks an LLM about it (`analyze.ts`, `claude-code.ts`,
`accuracy.ts`, `questions.ts`, `goals.ts`), then renders and publishes a shareable
report (`render.ts`, `pdf.ts`, `report-url.ts`, `email.ts`). `types.ts` is published as
`@reddoorla/maintenance/audit` and a test pins it free of runtime imports so a consuming
site never pulls the Anthropic SDK or Playwright into its bundle.

### `src/blux/` — the Webflow/Blux → Prismic conversion pipeline

63 files, 9,188 src + 10,792 test lines: the second-largest investment in the repo.
`parse.ts` → `normalize.ts` → `ir.ts` (an intermediate representation with a 16-member
`Diagnostic` union) → `assemble.ts` → `emit/` (migration plan, custom types, theme) →
`validate.ts`, plus `catalog/`, `grid/`, `freeze/`, `collections.ts`, `products.ts`.

### `src/recipes/` — idempotent, branch-creating site mutations

13 registered names in `ALL_RECIPE_NAMES`. The shared contract, enforced in
`_with-recipe.ts` and documented in the README: refuse on a dirty tree, create a fresh
`maint/<recipe>-<UTC-ms>` branch, emit atomic commits, be idempotent (re-run →
`{status:"noop", commits:[]}`). `init` chains six of them.

### Smaller pieces

- `src/github/` (5 files) — `gh.ts` (PR CI-rollup + mergeability normalisation, with
  `UNKNOWN` explicitly documented as "not known to conflict"), `gh-rest.ts`,
  `rulesets.ts`, `renovate-dispatch.ts`.
- `src/alerts/` (5 files) — the attention/digest contract. `attention.ts` exists
  specifically to break an import cycle between `reports/digest.ts` and `alerts/*`.
- `src/prismic/models/` (10 files) — headless content-model delivery: `canon.ts`,
  `diff.ts`, `local.ts`, `remote.ts`, `push.ts`, `write.ts`, `token.ts`.
- `src/inventory/` (4 files) — `local.ts`, `json.ts`, `airtable.ts`, and a barrel.
  **There is no `turso.ts`.** See §12.
- `src/webflow/` (9 files) — the Webflow importer. Last touched 2026-07-28.
- `src/util/`, `src/configs/`, `src/client/`, `src/images/` — leaves.

---

## 4. How it fits together: the spine

```
                   Airtable "Websites" base            (still the ROSTER)
                            │  --fleet airtable
                            ▼
  cron ──► .github/workflows/fleet-*.yml ──► node dist/cli/bin.js audit --only …
                            │                          │
                            │                          ├─► src/audits/REGISTRY (11)
                            │                          └─► write-audits-to-airtable.ts
                            │                                  ├─► Airtable (shadow)
                            │                                  └─► Turso  (AUTHORITATIVE)
                            ▼
  cron 09:23 ─► daily-reports.yml ─► bin.js report --due / --preview --enrich
                                              │            / --send-ready / --digest
                                              ▼
                             src/reports/{due,draft,render,send}  ──► Resend
                                              │
                                              ▼
  Netlify (20 functions) ─► src/dashboard/*  ◄── operator approves / edits / triggers
                          ─► src/forms/ingest ◄── public form POST from a fleet site
                                              └─► Turso submissions + notify fan-out
```

Schedules, read from the workflow files (all UTC, deliberately staggered with the
reasoning written into the cron comments):

| cron          | workflow            | what it runs                                                                              |
| ------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `30 4 * * *`  | fleet-db-backup     | `db dump`, `db verify-dump` ×2, `db usage`                                                |
| `0 5 * * *`   | fleet-prismic-drift | `prismic-models --fleet`                                                                  |
| `0 6 * * *`   | fleet-security      | `audit --only security,deps`, `protection-audit`, `renovate-dispatch`, `self-updating`    |
| `0 8 * * *`   | fleet-lighthouse    | `audit --only lighthouse,domain,browser,netlify-deploy,function-health`, `github-signals` |
| `23 9 * * *`  | daily-reports       | `report --due`, `--preview --enrich`, `--send-ready`, `--digest`                          |
| `0 10 * * *`  | fleet-smoke         | `audit --only smoke`                                                                      |
| `15 10 * * *` | fleet-form-e2e      | `audit --only form-e2e`                                                                   |
| `30 14 * * *` | release-health      | npm publish-drift guard                                                                   |
| `0 11 * * 1`  | time-travel         | the whole suite on a clock shifted 90 days forward                                        |

All four `audit` sweeps pass `--fleet airtable --write-airtable`.

**The CI gate is one list, derived rather than restated.** `package.json`'s `verify` is
`typecheck && lint && build && test:coverage && test:dist`; `ci.yml` lists those five as
individual `- run:` steps for attributability, and `tests/ci-gate.test.ts` parses
`verify` and asserts `ciRunSteps()` equals `verifySteps()` in content _and order_. Setup
steps are written as `- name:` + `run:` precisely so the drift test ignores them
(including `playwright install chromium`, which exists because one prospect test drives
a real browser to prove the Tier 4 form probe aborts before a stranger's form is
actually submitted). A final CI step fails the build if `git status --porcelain` is
non-empty after build+tests — a leak tripwire for tests that write into the repo.

---

## 5. The CLI surface (32 commands)

Extracted with `re.finditer(r'\.command\(\s*\n?\s*"([^"]+)"', bin.ts)`. A naive
`grep '\.command("'` finds only 10, because 22 registrations wrap the argument onto the
next line — worth knowing before anyone counts them by eye:

```
announce  audit  blux  bump-deps  convert-to-pnpm  db  ensure-site
forms-notify-target  github-signals  header-image  health-endpoint  init  launch
list-audits  list-recipes  match-harness  onboard  preflight  prismic-ci
prismic-models  prospect-audit  protection-audit  renovate-dispatch  report
self-updating  selftest  smoke-suite  submissions  svelte-codemods  sync-configs
upgrade  webflow
```

`bin.ts` (918 lines) is a `cac` registry whose actions are all
`await import("./commands/X.js")` — deliberately dynamic, because `tsup.config.ts` sets
`splitting: true` so those become on-demand chunks. With splitting off, esbuild inlines
every command into `bin.js` and the external `import "mjml"` / `import "airtable"`
execute at CLI startup, "which would crash a consuming fleet site … the moment it ran
`reddoor-maint audit --only a11y`."

`db` has 11 sub-actions: `migrate, import-airtable, sync, parity, dump, verify-dump,
restore, usage, row, replay-deadletters, backfill-digest-state, backfill-header-images`.

### `package.json` scripts

`verify` (the gate) · `build`/`dev` (tsup) · `test` / `test:watch` / `test:coverage` /
`test:dist` / `test:time-travel` · `lint` (`eslint . && prettier --check .`) · `format` ·
`typecheck` (`tsc --noEmit` **twice** — the second against `tsconfig.netlify.json`) ·
`changeset` / `version-packages` / `release` · `prepublishOnly` re-runs the whole gate.
`pretest` and `pretest:dist` both force a build, and `vitest.global-setup.ts` rebuilds
`dist/` if `src` changed so CLI subprocess tests never exec stale output.

---

## 6. The published package, and who consumes it

`exports` declares 11 entry points: `.`, `./forms`, `./forms/prismic`, `./audit`,
`./client`, `./images`, and `./configs/{lighthouse,eslint,prettier,playwright-a11y,svelte}`.
One `bin`: `reddoor-maint`.

23 local checkouts declare a dependency on it. Import-site counts across
`~/Documents/GitHub/*/src` and configs:

```
120  @reddoorla/maintenance                  (central-only; the starter's own tooling)
 96  @reddoorla/maintenance/images
 38  @reddoorla/maintenance/forms
 34  @reddoorla/maintenance/configs/playwright-a11y
 19  @reddoorla/maintenance/configs/svelte
 18  @reddoorla/maintenance/configs/eslint
 16  @reddoorla/maintenance/configs/lighthouse
  7  @reddoorla/maintenance/forms/prismic
  7  @reddoorla/maintenance/client
  3  @reddoorla/maintenance/audit
```

**Version spread across the 23 consumers** (declared range → bucket):

| range     |                                sites |
| --------- | -----------------------------------: |
| `^0.75.x` | 1 (`the-pointe`, archived on GitHub) |
| `^0.81.x` |                                    4 |
| `^0.83.x` |                                    3 |
| `^0.90.x` |                                   11 |
| `^0.93.x` |                                    4 |

Central is at **0.95.1**. Because the package is `0.x`, a caret range does **not**
resolve forward across minors — `^0.81.0` means `>=0.81.0 <0.82.0`. Verified against the
lockfiles rather than assumed:

```
la-homelessness-initiative  pnpm-lock.yaml → version: 0.81.0
data-dynamiq                pnpm-lock.yaml → version: 0.81.0
the-tower-burbank           pnpm-lock.yaml → version: 0.90.1
gallerysonder               pnpm-lock.yaml → version: 0.93.0
```

So two production sites are running a build **14 minors behind** central, and only 4 of
23 are within two minors. Renovate is the only mechanism that moves them, and per the
repo's own record a `@reddoorla/maintenance` bump carries `automerge: false` in the
shared preset — so each one needs a human merge. (That the rule is intentional is
established; that the resulting drift is 14 minors deep is the new number.)

---

## 7. Tests: layout, and what is actually covered

484 `*.test.ts` files, 1,236 `describe` blocks, ~6,339 `it`/`test` literals by grep. The
tree mirrors `src/` one-for-one (`tests/audits`, `tests/reports`, …) plus four that do
not:

- `tests/build/` (10 files) — asserts the _workflow YAML_ is correct:
  `daily-reports-workflow.test.ts`, `fleet-security-workflow.test.ts`,
  `fleet-smoke-workflow.test.ts`, `fleet-db-backup-workflow.test.ts`,
  `fleet-prismic-drift-workflow.test.ts`, `report-rerender-workflow.test.ts`,
  `reusable-prismic-workflow.test.ts` (which _executes_ the workflow's own comment step
  and measures the bytes it produces), `autonomy-prismic-clause.test.ts` (asserts
  `AUTONOMY.md` still says what the workflow relies on), `dist-freshness.test.ts`.
- `tests/ci-gate.test.ts` — the verify/ci.yml equality gate above.
- `tests/time-travel-guard.test.ts` — guards the clock-shift harness.
- `tests/webhook/`, `tests/_helpers/`, `tests/fixtures/`.

**The real numbers, from the last CI run on `main`** (`gh run view 34641685130 --log`,
2026-09-11, commit `9f5fc898`):

```
 Test Files  482 passed | 2 skipped (484)
      Tests  6520 passed | 4 skipped (6524)
   Duration  124.95s
 % Coverage report from v8
Statements   : 90.51% ( 17545/19383 )
Branches     : 84.79% ( 13015/15348 )
Functions    : 89.45% ( 3163/3536 )
Lines        : 91.53% ( 15443/16871 )
```

The enforced floor in `vitest.config.ts` is `statements 78 / branches 67 / functions 76 /
lines 80`. Its own comment says it was set "a few points under the current numbers
(S 81 / B 70 / F 81 / L 84, 2026-06-10) … raise the floor as it climbs." It has climbed
9–18 points and **the floor has not moved in three months**. Today a change could drop
roughly 2,400 covered statements and still pass the gate green.

Coverage `include` is `src/**/*.ts`, so untested files score 0 and drag the global
number — the floor is not limited to the test import graph. One deliberate exclusion:
`src/blux/emit/run-migration.ts` (pure IO against the Prismic Migration API).

### Which source files no test imports directly

I wrote a scanner: for each of the 379 `src/**/*.ts`, search every test file for the
literal specifier `<relpath>.js`. It reports 354 matched, 25 not.

**Proving the instrument before trusting it** (the repo's own top rule): it correctly
matches the ordinary case (`src/audits/deps.ts` ← `tests/audits/deps.test.ts`), so it
can pass. I then hand-checked three negatives and found a known false-positive mode — it
does not follow transitive imports:

- `src/recipes/svelte-5/step-gotchas.ts` is reached via `src/recipes/svelte-codemods.ts`,
  which `tests/recipes/svelte-codemods.test.ts` does import.
- `src/reports/send/idempotency.ts` is reached via `digest.ts`/`orchestrate.ts`, and its
  409 branch **is** exercised — `tests/reports/digest-run.test.ts:228` and
  `tests/reports/send/orchestrate.test.ts:121` both feed it the real Resend error string.

So read the list as _"has no test file of its own"_, **not** _"untested"_:

```
src/audits/browser-airtable.ts          src/audits/util/inject.ts
src/blux/catalog/catalog-page-type.ts   src/blux/freeze/section.ts
src/blux/freeze/settle.ts               src/blux/grid/signature.ts
src/cli/commands/announce.ts            src/cli/commands/onboard.ts
src/client/index.ts                     src/dashboard/favicon.ts
src/db/migrations.ts                    src/forms/index.ts
src/inventory/index.ts                  src/recipes/match-harness/previous.ts
src/recipes/svelte-5/step-{bump-versions,gotchas,summary,svelte-migrate,tailwind-upgrade,verify}.ts
src/reports/maintenance-email/assets/index.ts   src/reports/send/idempotency.ts
src/util/svelte-source.ts               src/util/working-tree.ts
src/webflow/text.ts
```

Several are barrels (`forms/index.ts`, `inventory/index.ts`, `client/index.ts`), which is
exactly the shape of open issue **#731**: "Three recipe barrel exports never reach
`dist/index.js`, and nothing notices when one is dropped."

---

## 8. `docs/`

169 markdown files, 112,222 lines.

- **`docs/superpowers/`** — 140 files: `specs/` (56) and `plans/` (84). The working
  convention is design-doc → plan → execute; a feature typically has a dated
  `*-design.md` and one or more dated plan files. Newest:
  `2026-09-09-prospect-report-operator-edits-design.md`,
  `2026-09-08-webflow-rebuild-pipeline-design.md` (+ five plans `a`–`f`),
  `2026-09-03-audit-check-backlog.md`.
- **`docs/workJournal.md`** — 1,975 lines, **22 entries**, opened only 2026-09-05
  ("Journal opened, CLAUDE.md brought back into version control, and 743 commits
  summarised rather than reconstructed"). ~90 lines per entry, and the entries are
  genuinely analytical — e.g. `2026-09-10 — next.mjs scored 12/3 and called the backlog
empty`. Append-only; corrections are new entries plus a one-line forward pointer under
  the superseded heading.
- **`docs/runbooks/`** (6) — `ga-search-role-account-cutover`, `pat-retirement-2026-08`,
  `prismic-model-delivery`, `renovate-app-identity`, `require-turnstile-rollout`,
  `turnstile-widgets`.
- **`docs/morning-reports/`** (16), newest `2026-09-02`. `docs/decisions/` has exactly one
  ADR (`2026-06-09-mjml-supply-chain.md`). Also `docs/SETUP.md`, `docs/private-runner/`,
  `docs/autonomy-journal.md`.
- Root: `README.md` (507 lines), `AUTONOMY.md` (green/yellow/red blast-radius tiers plus
  merge authority), `CLAUDE.md` (session rules).

---

## 9. Maintained vs dormant — with the evidence

**Hot (where the last 30 days went):** `src/db` (39 commits), `src/cli` (35),
`src/reports` (34), `src/dashboard` (24), `src/recipes` (18), `src/prospect` (18). The
last two weeks read as one program: the prospect-report **operator override layer**
(#762 → #765 → #768, plus `docs/superpowers/plans/2026-09-09-report-edits-{a,b}-*.md`)
and the **match-harness recipe** (#733 plus ten follow-up bug issues).

**Cooling:** `src/github` (18 in 90d, 1 in 30d), `src/prismic` (4/4 — bursty, all at the
08-31 delivery), `src/alerts` (11/3), `src/forms` (46/11), `src/audits` (43/11).

**Dormant, and this is where capital is parked:**

- **`src/blux/` — ~20k lines (src+tests), 50 commits in July, 3 in August, 1 in
  September.** No workflow references it
  (`grep -rln blux .github/workflows/ scripts/` → nothing). It is reachable only by a
  human typing `reddoor-maint blux <action>`. Its first real consumer, `the-pointe`, is
  archived on GitHub; `reddoor-starter-blux` remains the render mirror. This is the
  largest body of code in the repo with no automated exercise and no active consumer.
- **`src/webflow/` — last commit `db52934c`, 2026-07-28**, and `tests/webflow` has not
  moved since that same commit. Lowest test:src ratio in the repo (0.78). Yet on
  **2026-09-08** a design and five plans were written for a "Webflow rebuild pipeline"
  (`docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`) whose first
  consumer is 29 Navy. The spec explicitly _corrects_ the earlier starter-track-split
  design. So: the new plan is live, the module it would plausibly build on is six weeks
  cold, and the plan routes around it via the match-harness recipe instead. Whether
  `src/webflow/` is now dead weight or the intended substrate is a question for the
  operator — I did not find an answer written anywhere.
- `src/client/` (2026-07-05) and `src/images/` are leaves and fine being still.

### Shipping cadence, and its shape

From `corpus/commits.jsonl` + `prs.jsonl`, window 2026-07-30 → 2026-09-12:

- 413 commits in this repo (Tucker 369, `reddoor-renovate[bot]` 43): 30 in July, 282 in
  August, 101 in September.
- Conventional types: `feat` 160, `fix` 130, `chore` 52, `docs` 45, `test` 8, `ci` 6,
  `perf` 6. Top scopes: `prospect` 75, `db` 39, `forms` 33, `release` 32, `dashboard` 28,
  `header-image` 24, `reports` 23.
- 219 PRs (211 merged, 5 closed, 3 open). The 179 merged human PRs carry
  **+148,725 / −4,661** across a median of 6 changed files — a **32 : 1** add-to-delete
  ratio. Median PR is +223/−7; the tail is enormous (#526 +24,211; #703 +12,413;
  #580 +12,380).

That ratio is the clearest single number in this survey. This codebase grows and almost
never sheds. The one scheduled deletion in the entire backlog is #646.

---

## 10. Health, measured

`gh run list` over 2026-09-04 → 2026-09-12 (the window the corpus covers for this repo):

| workflow                                                                             |   runs | outcome                                  |
| ------------------------------------------------------------------------------------ | -----: | ---------------------------------------- |
| ci                                                                                   |    165 | 162 success, 3 failure                   |
| release                                                                              |     41 | 40 success, 1 failure                    |
| renovate                                                                             |     18 | all success                              |
| release-health                                                                       |     10 | all success                              |
| fleet-lighthouse                                                                     |     10 | all success                              |
| fleet-security                                                                       |     10 | all success                              |
| fleet-form-e2e / fleet-smoke / daily-reports / fleet-prismic-drift / fleet-db-backup | 9 each | all success                              |
| time-travel                                                                          |      1 | success                                  |
| report-rerender                                                                      |      0 | dispatch-only; never fired in the window |

The four failures were three feature branches plus one `release` on `main`
(2026-09-08, the prospect check battery); later releases on 09-10/09-11 succeeded and
npm `latest` is 0.95.1, matching `package.json`. A `chore(release): version packages` PR
(#771) and one changeset (`a11y-summary-counts-the-routes-that-ran.md`) are queued for
0.95.2 — normal changesets flow, not a stall.

**Caveat the repo itself insists on:** a green `fleet-smoke` means _all sites measured_,
not _all sites passed_ — the verdict lands in the store, not the exit code (since #550 an
_unmeasured_ site does red the run). So the table is evidence the machinery ran, not that
the fleet is healthy. That is a different dimension's question.

Backlog: **58 open issues**, only 16 labelled at all (14 `enhancement`, 2 `bug`). The
oldest four are structural, not stale bugs: #490 (Renovate dashboard), #539 (the
migration), #545 (feature→staging→main protection), #582 (convert the dashboard to
Svelte). By keyword in the title: `match-harness` 10, `recipe` 5, `report` 5,
`prospect` 4, `Airtable` 3, `dashboard` 3, `prismic` 3, `launch` 3.

Ten of 58 open issues are about a recipe that shipped nine days ago (#733, 2026-09-09).
That is a normal shakedown curve for a 2,506-line embedded-script generator, but it is
also the concentration point of current defect load, and it lives in the hardest place to
test: `.mjs` source stored as TypeScript template literals, whose output is only exercised
once installed into a site.

---

## 11. Specific things I verified that are wrong or stale

### a) `pnpm lint` fails in the main checkout right now, and it is not the code

`prettier --check .` — the second half of the `lint` script — descends into
`.claude-worktrees/`, a git-worktree directory that is **not in `.gitignore`**.
`.gitignore` lists `.worktrees/` (and Prettier 3 honours `.gitignore` by default) but
not `.claude-worktrees/`. Measured:

```
$ ./node_modules/.bin/prettier --check .
…
[warn] .claude-worktrees/meta-week/tests/webflow/fixtures/our-team.html
[error] .claude-worktrees/meta-week/tests/webflow/fixtures/services-index.html: SyntaxError:
        Unexpected closing tag "div" … (136:9)
[warn] fmt.mjs
Error occurred when checking code style in the above file.
```

Two separate causes, both live right now:

1. `.claude-worktrees/` is unignored, so every Claude worktree makes `pnpm lint` re-lint
   a whole second copy of the repo — and hard-_error_ on a Webflow fixture, because
   `.prettierignore`'s `tests/webflow/fixtures/` is relative and does not match
   `.claude-worktrees/*/tests/webflow/fixtures/`.
2. `fmt.mjs` — an untracked 40-line throwaway at the repo root, reading `/tmp/body_*.txt`,
   left over from the match-harness prettier-config comparison — is not prettier-clean:
   `./node_modules/.bin/prettier --check fmt.mjs → [warn] fmt.mjs`.

CI is unaffected (fresh checkout, and `fmt.mjs` is untracked), so this is purely local
friction. But it means an operator's `pnpm verify` reds on neither a type error nor a
test — exactly the kind of signal that trains you to stop reading the gate.

### b) `CLAUDE.md`'s "In flight: the Airtable → Turso migration" section is stale three ways

```
CLAUDE.md:206  ## In flight: the Airtable → Turso migration
CLAUDE.md:208  Scheduled for the weekend of 2026-08-22. Pinned as issue #539. Design and plan
CLAUDE.md:209  are on branch `docs/airtable-to-turso-spec` under `docs/superpowers/`.
CLAUDE.md:211  Do not start it early or opportunistically.
```

1. The flip landed **2026-08-31**, not the weekend of 08-22 (`src/db/freeze.ts:52`,
   `TURSO_IS_AUTHORITATIVE = true`; #643). Phases 0–5 are complete.
2. The design and plan are **on `main`**, and have been since `0b3a7b9c` (2026-08-31,
   "mark #539 Phase 5 complete"). Main's copies are _longer_ than the branch's — 308 vs
   292 lines for `specs/2026-08-17-airtable-to-turso-migration-design.md`, 191 vs 127 for
   `plans/2026-08-17-airtable-to-turso-migration.md`. Following the CLAUDE.md pointer
   gets you the superseded text.
3. A sibling worktree is parked on that superseded branch: `git worktree list` →
   `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance-turso-spec 4f5f1a14
[docs/airtable-to-turso-spec]`, last commit 2026-08-17. This is the exact "a stale
   worktree poisons archaeology" hazard the repo's own instructions warn about, pointed
   at by the instructions themselves.

The second stale worktree is worse: `reddoor-maintenance-e2ebudget` sits on
`fix/form-e2e-budget-attribution` at `72c2f275`, a `wip(form-e2e): measure the POST span
separately for the budget check` commit from **2026-08-17** that exists on **no remote**
(`git ls-remote --heads origin fix/form-e2e-budget-attribution` → 0 rows) and is not
merged into `main`. Twenty-six days of work committed to nowhere, in a directory nothing
points at.

### c) The README documents less than half the surface

- **Audits:** the table lists 5 (`deps, lighthouse, a11y, security, lint`) and the code
  block literally says "all five against cwd". `ALL_AUDIT_NAMES` has **11**. The six
  undocumented ones — `domain, browser, netlify-deploy, function-health, smoke,
form-e2e` — are precisely the ones the nightly fleet workflows run.
- **CLI:** the `## CLI` code block lists 11 commands plus a prose entry for
  `prospect-audit`. There are **32**.
- **Recipes:** nine `###` sections for **13** registered names. Undocumented:
  `health-endpoint`, `smoke-suite`, `self-updating`, `prismic-ci` — and `self-updating`
  runs nightly inside `fleet-security.yml`.
- `header-image` and `digest` appear **zero** times in the README; `blux` once.

The README's last content edits track features (#765 on 09-10, #733 on 09-09), so it is
being _appended to_, not _reconciled_. `docs/SETUP.md` is pointed at as the end-to-end
walkthrough, so the README is meant to be a per-command reference — which is the one job
it is measurably not doing.

### d) The coverage floor is 10–18 points below reality

`vitest.config.ts` thresholds `{statements:78, branches:67, functions:76, lines:80}` vs
measured `90.51 / 84.79 / 89.45 / 91.53`. The file's own comment names the remedy
("raise the floor as it climbs"); it has not moved since 2026-06-10.

---

## 12. The one structural coupling that matters most

Turso is authoritative for the _data_. Airtable is still the _roster_.

```ts
// src/cli/fleet/resolve-sites.ts:41
if (input.fleet === "airtable") {
  const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
  const { fromAirtableBase } = await import("../../inventory/airtable.js");
  const base = openBase(readAirtableConfig());
  const provider = fromAirtableBase(base, input.workdir ? { workdir: input.workdir } : {});
  return provider();
}
```

All four nightly sweeps pass `--fleet airtable`. `src/inventory/` contains `local.ts`,
`json.ts`, `airtable.ts` — **and no `turso.ts`**. So twelve days after the freeze, an
Airtable outage still takes out fleet-security, fleet-lighthouse, fleet-smoke and
fleet-form-e2e, even though none of them writes there authoritatively any more. (The
fleet has already seen this exact failure once: one Airtable quota event reddened six
workflows, presented as unrelated timeouts with nothing named Airtable.)

This is not a discovery — issue **#646 step 4** already says it, and says it better:

> **4. Move batch enumeration off Airtable.** Every sweep and batch job still uses
> Airtable as the fleet roster: `audit.ts:372,436` (`listWebsites`) — including the
> nightly **form-e2e**, the one instrument that catches a 404ing lead path; …
> Until this step, Airtable is still load-bearing for reads and an Airtable quota outage
> still reds the batch fleet.

#646 is an 8-step dependency-ordered checklist whose _first_ step is "relocate the pure
helpers stranded in the doomed directory" — `src/db/fleet-state.ts:42-59` _value-imports_
`canonicalizeStatus`, `parseNotifyRouting`, `parseSecurityAdvisories`, `toFrequency`,
`siteSlug` and the report coercers from the Airtable layer, and those run inside
`rowFromJoined` on **every lead read**. Deleting `src/reports/airtable/**` without step 1
breaks Turso-only reads.

The rollback window ended around 2026-09-07, and Phase 6 needs the operator's explicit go
because executing it _ends_ that window. It is **open, due, and blocking removal of
`src/reports/airtable/` (7 files; `websites.ts` alone is 1,204 lines) plus the `airtable`
npm dependency** — and it is the only large deletion anywhere in the backlog. Related and
also open: #698 ("Strip 'airtable' out of the namespace — the names now misdescribe the
store, and agents keep believing them"), #647, #645.

---

## 13. What I did not verify

- I did not run `pnpm test`, `pnpm build` or `pnpm typecheck` (out of scope). The test and
  coverage numbers in §7 come from reading the 2026-09-11 CI log for the current `main`
  SHA, not from a local run.
- `dist/` in the working tree is 4 days stale (31 `src` files are newer than
  `dist/index.js`, whose mtime is 2026-09-08 12:33). That is expected —
  `vitest.global-setup.ts` rebuilds before the suite — but a bare
  `node dist/cli/bin.js` locally today runs 09-08 code.
- I did not assess whether the _fleet_ is healthy, only whether the orchestrator's
  machinery ran. Nor did I open the Netlify deploy state for the dashboard site.
- I did not read the contents of the 84 plans / 56 specs beyond titles and three files,
  so "which plans are finished" is unanswered here.
- Session-corpus counts for this repo look under-attributed: `sessions.jsonl` has 334
  sessions with a `cwd` under `reddoor-maintenance` (156 of them inside one
  `.claude/worktrees/prismic-types-headless-delivery` worktree) but only 33 in September,
  against 101 September commits and 189 September operator prompts. I did not chase it
  down; treat central-repo session counts as a floor.
