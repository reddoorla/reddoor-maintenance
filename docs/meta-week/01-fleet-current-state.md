# 01 — The fleet as it is built today

Assembled **2026-09-12** from nine independent current-state surveys
(`_research/inv-01` … `inv-09`), each written by an agent with direct machine
access and each required to name the command behind every number. This document
merges them by subsystem. Where two surveys disagree, §10 says so rather than
silently picking a winner.

**Confidence convention, used throughout.** A claim tagged **[measured]** was
produced by a command whose output the surveying agent quotes. **[inferred]**
means the facts constrain the explanation but the mechanism was not directly
observed. **[unverified]** means nobody checked, and the claim is here only so
that it is not mistaken for settled. The surveys carried this discipline because
the repo's own first rule demands it — _prove the instrument before you trust its
verdict_ — and it earned its keep: three separate instruments built during these
surveys returned a false FAIL on their first run (§9.2).

---

## 0. Orientation — what this fleet is

Tucker Lemos runs a small web agency, **Reddoor**, close to single-handedly, with
very heavy AI-agent leverage. The product is client websites; the operating
model is that **one central repository maintains all of them automatically**, and
the operator's job is to approve, decide and unblock rather than to perform
per-site maintenance.

The shape, in one paragraph: roughly **45 websites are recorded** in an
operational database, of which **13 carry a live maintenance contract**. Client
sites are SvelteKit 2 / Svelte 5 / Vite 8 / Tailwind 4 / pnpm, content-managed in
Prismic, hosted on Netlify, generated from one of two starter templates. A single
central repo — `reddoor-maintenance`, published to npm as
`@reddoorla/maintenance` — contains the audit engine, the client-report email
pipeline, an operator cockpit deployed as Netlify functions, the public
form-ingest endpoint for every site's contact form, and 13 idempotent "recipes"
that mutate a site repo to bring it up to standard. **Eight scheduled GitHub
Actions workflows** run nightly against the fleet, each a thin YAML wrapper around
`node dist/cli/bin.js <command>`. Dependency updates are automated fleet-wide by
Renovate from a single shared preset. Client communication happens in Discord,
one channel per project. All engineering work is done through Claude Code
sessions, heavily delegated to subagents.

### The three populations wearing the name "fleet" [measured]

`~/Documents/GitHub` holds **41 git checkouts** plus two loose non-repo artefacts.
They are not one thing:

| population                                  |   n | what it is                                                                                                                |
| ------------------------------------------- | --: | ------------------------------------------------------------------------------------------------------------------------- |
| **Client sites under contract**             |  13 | Airtable `Status = maintained`. Every nightly sweep filters on this value.                                                |
| **Pre-contract client sites**               |   9 | 2 `launching`, 7 `building` — 3 of the 7 have no repo at all. Outside every sweep.                                        |
| **Templates, prototypes, internal tooling** |   8 | 2 starters, 1 prototype, the orchestrator, the org `.github` repo, an md→pdf tool, the RFP output store, the skills repo. |
| **Personal / non-Reddoor**                  |  11 | games, a songbook app, worldbuilding notes, small tools. One (`Broken`) lives on someone else's GitHub account.           |
| **Cannot receive a push**                   |   3 | `reddoor-mailer` + `the-pointe` archived on GitHub; `rfp-analyze` has no `origin`.                                        |

Two facts about attention follow immediately, and both are measured:

- **13 of the 20 client-site repos received zero Claude sessions** in the
  2026-07-30 → 2026-09-12 window. Their most recent non-docs commit is a fleet
  sweep, not per-site work.
- **Four of the six busiest checkouts are personal projects** (`Broken`,
  `songbook`, `caldea`, `dont-lose-your-head`), not client work.

### The single most important structural fact

**The system is centralised in code and decentralised in data — and the data half
is half-migrated.** Turso (libSQL) became the authoritative store on 2026-08-31
(`src/db/freeze.ts:52`, `TURSO_IS_AUTHORITATIVE = true`), but **Airtable is still
the fleet roster**: all four nightly `audit` sweeps run `--fleet airtable`, and
`src/inventory/` contains `local.ts`, `json.ts`, `airtable.ts` and **no
`turso.ts`**. So every quality instrument the fleet owns still depends on a store
that no longer owns the truth, twelve days after the flip. Everything downstream
in this document — the sweep boundary, the alarm coverage, the naming confusion,
the one large deletion in the backlog — traces back to that seam. [measured]

---

## 1. The spine — how one night runs

```
                   Airtable "Websites" base            (still the ROSTER)
                            │  --fleet airtable  (Status = maintained → 13 sites)
                            ▼
  cron ──► .github/workflows/fleet-*.yml ──► node dist/cli/bin.js audit --only …
                            │                          │
                            │                          ├─► src/audits/REGISTRY (11 audits)
                            │                          └─► write-audits-to-airtable.ts
                            │                                  ├─► Airtable (shadow, still written)
                            │                                  └─► Turso  (AUTHORITATIVE, strict mirror)
                            ▼
  cron 09:23 ─► daily-reports.yml ─► bin.js report --due / --preview --enrich
                                              │            / --send-ready / --digest
                                              ▼
                             src/reports/{due,draft,render,send}  ──► Resend ──► client
                                              │
                                              ▼
  Netlify (20 functions) ─► src/dashboard/*  ◄── operator approves / edits / triggers
                          ─► src/forms/ingest ◄── public form POST from a fleet site
                                              └─► Turso submissions + notify fan-out
```

**The nightly clock** (UTC; the staggering and its reasoning are written into the
cron comments) [measured]:

| cron           | workflow              | what it establishes                                                                                               |
| -------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `30 4 * * *`   | `fleet-db-backup`     | Turso dump, restore rehearsal, **decrypt-and-re-verify the .gpg it uploads**, then plan-quota headroom            |
| `0 5 * * *`    | `fleet-prismic-drift` | does each repo's content model still match its Prismic repository                                                 |
| `0 6 * * *`    | `fleet-security`      | vuln counts + deps drift → store; Renovate dispatch; org-wide protection-coverage audit; `self-updating`          |
| `0 8 * * *`    | `fleet-lighthouse`    | lighthouse + domain + browser + netlify-deploy + function-health against **deployed** URLs; then `github-signals` |
| `23 9 * * *`   | `daily-reports`       | draft due reports → send approved → email the operator digest                                                     |
| `0 10 * * *`   | `fleet-smoke`         | clone each site, run its own `pnpm test:smoke`                                                                    |
| `15 10 * * *`  | `fleet-form-e2e`      | drive each deployed `/contact` form with the `testMode` marker                                                    |
| `30 14 * * *`  | `release-health`      | npm-`latest` vs `main`'s version **and** the release workflow's own redness                                       |
| `0 11 * * 1`   | `time-travel`         | the whole test suite on a clock shifted +90 days                                                                  |
| `0 */12 * * *` | `renovate`            | PR creation **and** merge (platform auto-merge is off fleet-wide)                                                 |

Event-driven: `ci` (push to `main`/`changeset-release/main`/`staging`, plus every
`pull_request`), `release` (push to `main` + dispatch), `report-rerender`
(dispatch only).

**The critical semantic**, stated by the repo itself and worth carrying: a green
`fleet-smoke` means _every site was measured_, not _every site passed_. The
verdict lands in the store; the exit code only reports whether the sweep ran. The
same is true of every sweep. Reading the workflow table as fleet health is the
single easiest mistake to make with this system.

---

## 2. `reddoor-maintenance` — the central orchestrator

### 2.1 It is three products in one repo, and that is the most important fact about it

1. **A published npm library** — `@reddoorla/maintenance@0.95.1`, installed by 23
   fleet checkouts. Ships shared eslint/prettier/svelte/lighthouse/playwright
   configs, a form-submission client, and a types-only audit-result contract.
2. **A CLI** — `reddoor-maint`, **32 registered commands**, the executable body of
   every nightly workflow.
3. **A deployed web application** — 20 Netlify functions (`netlify/functions/*.mts`,
   2,695 lines) serving the operator cockpit, the per-site dashboard, the public
   form-ingest endpoint, the shareable prospect-audit report, and the Resend
   delivery webhook.

The same `dist/` build serves all three, and the seam is machine-enforced.
`src/index.ts` opens by explaining it: the bare package entry transitively imports
`mjml`, `airtable`, `resend`, `@libsql/client`, `@google-analytics/data`, `sharp`
and `svix`, all of which sit in `devDependencies` so consuming sites do not
inherit them. Fleet sites may import only `./forms`, `./forms/prismic`,
`./configs/*`, `./images`, `./client` and `./audit`. `scripts/smoke-dist.mjs`
loads each consumer-facing entry under a Node resolution hook
(`scripts/central-dep-blocker.mjs`) that makes those 11 packages unresolvable,
reproducing a consumer's install exactly. It replaced an earlier source-scanning
regex that "silently missed esbuild's multi-line imports and so passed
vacuously." That sentence is the house style in miniature. [measured]

### 2.2 Scale [measured]

```
src            379 TypeScript files    77,958 lines
tests          484 *.test.ts files    104,713 lines      (test:src = 1.34 : 1)
netlify         20 *.mts functions      2,695 lines
workflows       13 + 1 reusable         2,334 lines YAML
docs           169 markdown files     112,222 lines      (docs outweigh src)
README.md      507 lines · CHANGELOG.md 407 KB (generated)
```

Where the code is concentrated, with commit recency (90-day window from
2026-06-14, 30-day from 2026-08-13):

| area             | src files | src lines | test lines | test:src | last commit    | 90d |    30d |
| ---------------- | --------: | --------: | ---------: | -------: | -------------- | --: | -----: |
| `src/prospect/`  |        30 |    15,598 |     14,918 |     0.96 | 2026-09-08     |  18 | **18** |
| `src/blux/`      |        63 |     9,188 |     10,792 |     1.17 | 2026-09-01     |  54 |  **2** |
| `src/cli/`       |        37 |     8,960 |     10,283 |     1.15 | 2026-09-09     |  92 |     35 |
| `src/recipes/`   |        44 |     8,547 |     10,418 |     1.22 | 2026-09-10     |  42 |     18 |
| `src/reports/`   |        43 |     7,980 |     11,474 |     1.44 | 2026-09-04     | 101 |     34 |
| `src/dashboard/` |        33 |     6,215 |     12,389 | **1.99** | 2026-09-11     |  68 |     24 |
| `src/audits/`    |        33 |     5,858 |      8,147 |     1.39 | 2026-09-11     |  43 |     11 |
| `src/db/`        |        19 |     4,719 |      7,099 |     1.50 | 2026-09-10     |  57 | **39** |
| `src/forms/`     |        21 |     3,184 |      5,479 |     1.72 | 2026-09-03     |  46 |     11 |
| `src/prismic/`   |        10 |     2,199 |      4,350 |     1.98 | 2026-08-31     |   4 |      4 |
| `src/github/`    |         5 |     1,555 |      2,160 |     1.39 | 2026-08-25     |  18 |      1 |
| `src/webflow/`   |         9 |     1,029 |        806 | **0.78** | **2026-07-28** |   1 |  **0** |
| `src/alerts/`    |         5 |       916 |      1,835 |     2.00 | 2026-09-04     |  11 |      3 |
| `src/inventory/` |         4 |       171 |        340 |     1.99 | 2026-08-24     |   4 |      1 |

Largest single files: `src/prospect/site-checks.ts` 3,453 · `src/recipes/match-harness/template.ts`
2,506 · `src/cli/commands/prismic-models.ts` 2,344 · `src/prospect/crawl.ts` 1,212 ·
`src/reports/airtable/websites.ts` 1,204 · `src/dashboard/render.ts` 1,152.

### 2.3 The subsystems

- **`src/audits/` — 11 audits.** `src/audits/index.ts` holds a `REGISTRY` with
  exactly 11 entries: `deps, lighthouse, a11y, security, lint, domain, browser,
netlify-deploy, function-health, smoke, form-e2e`. Every audit returns the
  closed union `pass | warn | fail | skip`; `runOneAudit` wraps each in a
  30-second-timeout spawn and converts a thrown error into a `fail` rather than
  crashing the sweep. Each has a paired `*-airtable.ts` writer plus
  `health-mirror.ts` dual-writing to Turso, and `fleet-event-detectors.ts` turns
  audit deltas into the `fleet_events` rows the cockpit's activity feed reads.
  `protection-coverage.ts` and `github-signals.ts` are org-level, not per-site.
- **`src/reports/` — the client email pipeline.** The most-committed area of the
  last 90 days (101 commits). `due.ts` → `draft.ts` (GA + Search Console
  enrichment) → `render.ts` + MJML → operator approval in the cockpit →
  `send/orchestrate.ts` → Resend. Plus `header-image/` (Playwright-captures the
  live homepage and composes it onto a plate; `tsup.config.ts` has an explicit
  `onSuccess` hook copying 7 PNG assets into `dist/`), `digest.ts`,
  `checklist.ts` + `auto-tick.ts` (the 12-item pre-send gate), `queue.ts`,
  `webhook-events.ts`.
- **`src/dashboard/` + `netlify/functions/` — the cockpit.** Highest test:src
  ratio in the repo. Three-band severity cockpit, per-site page, sortable fleet
  table, submissions view, prospect-audit index. Mutating handlers are kept
  separate from renderers (`approve.ts`, `site-details.ts`, `trigger-renovate.ts`,
  `refresh-fleet.ts`, …) behind Google OAuth + CSRF. Every endpoint declares its
  own `export const config = { path: [...] }` inside the `.mts` rather than a
  `netlify.toml` redirect, because a `[[redirects]]` rewrite with `status=200`
  passes the _original_ URL and `ctx.params` never populates — `netlify.toml`
  records that this cost a debugging session.
- **`src/forms/` — the lead pipeline.** Public ingest: normalise → Turnstile
  verify → spam score (`SPAM_THRESHOLD` plus a `BLOCKED_EMAIL_DOMAINS` domain
  tier) → persist to Turso → notify fan-out, with dead-letter capture, replay,
  and CMS-authored auto-replies.
- **`src/db/` — Turso/libSQL.** 11 Kysely-typed tables, 17 migrations,
  dump/verify/restore/parity/usage tooling. `freeze.ts` is the best single file
  to read to understand how this codebase thinks: the authority switch is a code
  constant rather than an env var _on purpose_, because the same artifact runs in
  Netlify functions and Actions runners and an env var set in one and missed in
  the other would give "a PARTIAL freeze … which is a worse state than either
  end." Consumers take it as a default parameter so tests exercise both worlds,
  with exactly one test asserting the shipped value.
- **`src/prospect/` — the external AEO/SEO audit tool.** Largest, newest, hottest:
  15,598 lines, and **all 18 of its 90-day commits landed in the last 30 days**.
  Crawl → probe → score → LLM-analyse → render and publish a shareable report.
  Its `types.ts` is published as `@reddoorla/maintenance/audit`, with a test
  pinning it free of runtime imports so a consuming site never pulls the
  Anthropic SDK or Playwright into its bundle.
- **`src/recipes/` — 13 idempotent site mutations.** `sync-configs`, `bump-deps`,
  `svelte-4-to-5`, `svelte-codemods`, `convert-to-pnpm`, `onboard`,
  `a11y-fixtures-page`, `health-endpoint`, `smoke-suite`, `self-updating`,
  `prismic-ci`, `match-harness`, `init`. The shared contract, enforced in
  `_with-recipe.ts`: refuse a dirty tree, create a fresh `maint/<recipe>-<UTC-ms>`
  branch, emit atomic commits, be idempotent (re-run → `{status:"noop"}`).
- **`src/blux/` — the Webflow/Blux → Prismic conversion pipeline.** 63 files,
  ~20k lines including tests: the second-largest investment in the repo. See §2.6.
- **Smaller:** `src/github/` (PR CI-rollup + mergeability normalisation, ruleset
  primitives, renovate dispatch), `src/alerts/` (the attention/digest contract;
  `attention.ts` exists specifically to break an import cycle), `src/prismic/models/`
  (headless content-model canon/diff/push), `src/webflow/` (the importer, cold
  since 2026-07-28).

### 2.4 The CLI [measured]

32 `.command("…")` registrations in `src/cli/bin.ts`, extracted with a regex that
tolerates line wrapping — **a naive `grep '.command("'` finds only 10**, because
22 registrations wrap the argument onto the next line. Worth knowing before
anyone counts by eye.

```
announce  audit  blux  bump-deps  convert-to-pnpm  db  ensure-site
forms-notify-target  github-signals  header-image  health-endpoint  init  launch
list-audits  list-recipes  match-harness  onboard  preflight  prismic-ci
prismic-models  prospect-audit  protection-audit  renovate-dispatch  report
self-updating  selftest  smoke-suite  submissions  svelte-codemods  sync-configs
upgrade  webflow
```

Every action is a dynamic `await import("./commands/X.js")` because
`tsup.config.ts` sets `splitting: true`. With splitting off, esbuild inlines every
command into `bin.js` and the external `import "mjml"` / `import "airtable"`
execute at CLI startup, "which would crash a consuming fleet site … the moment it
ran `reddoor-maint audit --only a11y`."

`package.json#scripts.verify` is the gate: `typecheck && lint && build &&
test:coverage && test:dist`. `typecheck` runs `tsc --noEmit` **twice**, the second
time against `tsconfig.netlify.json`. `vitest.global-setup.ts` rebuilds `dist/` if
`src` changed so CLI subprocess tests never exec stale output.

### 2.5 Tests and coverage [measured]

From the last CI run on `main` (`gh run view 34641685130 --log`, 2026-09-11,
commit `9f5fc898`):

```
 Test Files  482 passed | 2 skipped (484)
      Tests  6520 passed | 4 skipped (6524)     Duration 124.95s
Statements : 90.51% (17545/19383)   Branches : 84.79% (13015/15348)
Functions  : 89.45% ( 3163/3536)    Lines    : 91.53% (15443/16871)
```

The tree mirrors `src/` one-for-one plus four directories that do not:
`tests/build/` (10 files asserting the _workflow YAML_ is correct, including one
that **executes** a workflow's own comment step and measures the bytes it
produces), `tests/ci-gate.test.ts`, `tests/time-travel-guard.test.ts`,
`tests/webhook/`.

**The enforced floor has not moved in three months.** `vitest.config.ts` holds
`statements 78 / branches 67 / functions 76 / lines 80` against measured
90.51 / 84.79 / 89.45 / 91.53. Its own comment says the floor was set "a few
points under the current numbers (S 81 / B 70 / F 81 / L 84, 2026-06-10) … raise
the floor as it climbs." At 78% statements against 19,383 total, roughly **2,400
currently-covered statements could become uncovered with the gate still green.**

A scanner run during the survey found 25 of the 379 source files with no test
file of their own — but the surveying agent hand-checked three negatives and
found the instrument does not follow transitive imports (e.g.
`src/reports/send/idempotency.ts` has no test file but its 409 branch _is_
exercised from two other suites). Read the list as _"has no test file of its
own"_, not _"untested"_. [measured, with the instrument's limit named]

### 2.6 What is dormant, and where capital is parked [measured]

- **`src/blux/` — ~20k lines (src + tests), 50 commits in July, 3 in August, 1 in
  September.** `grep -rln blux .github/workflows/ scripts/` returns nothing: no
  workflow exercises it. It is reachable only by a human typing
  `reddoor-maint blux <action>`. Its first real consumer, `the-pointe`, is
  **archived on GitHub**. This is the largest body of code in the repo with no
  automated exercise and no active consumer, and **nothing written down states
  whether it is intended substrate or dead weight.**
- **`src/webflow/` — last commit `db52934c`, 2026-07-28**, lowest test:src ratio
  in the repo (0.78). Yet on 2026-09-08 a design plus five plans were written for
  a "Webflow rebuild pipeline"
  (`docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`, first
  consumer 29 Navy) which **routes around it** via the match-harness recipe. The
  new plan is live; the module it would plausibly build on is six weeks cold.

### 2.7 Shipping cadence, and its shape [measured]

Window 2026-07-30 → 2026-09-12, central repo:

- **413 commits** (Tucker 369, `reddoor-renovate[bot]` 43): 30 in July, 282 in
  August, 101 in September.
- Conventional types: `feat` 160, `fix` 130, `chore` 52, `docs` 45, `test` 8,
  `ci` 6, `perf` 6. Top scopes: `prospect` 75, `db` 39, `forms` 33, `release` 32,
  `dashboard` 28, `header-image` 24, `reports` 23.
- **219 PRs** (211 merged, 5 closed, 3 open). The 179 merged human PRs carry
  **+148,725 / −4,661** across a median of 6 changed files — a **32 : 1
  add-to-delete ratio**. Median PR is +223/−7; the tail is enormous (#526
  +24,211; #703 +12,413; #580 +12,380).

That ratio is the clearest single number in the whole survey set. **This codebase
grows and almost never sheds**, and the only scheduled deletion anywhere in a
58-issue backlog is #646 (delete the Airtable layer).

### 2.8 The published package and its consumers [measured]

`exports` declares 11 entry points plus the `reddoor-maint` bin. 23 local
checkouts depend on it. Import-site counts across `~/Documents/GitHub/*/src`:
`./images` 96 · `./forms` 38 · `./configs/playwright-a11y` 34 · `./configs/svelte`
19 · `./configs/eslint` 18 · `./configs/lighthouse` 16 · `./forms/prismic` 7 ·
`./client` 7 · `./audit` 3.

Version spread of the declared range against central's **0.95.1**:

```
^0.93.x  4   29-navy, reddoor-starter, reddoor-starter-blux, gallerysonder
^0.90.x 11
^0.83.x  3   espada, medical-solutions-of-texas, reddoor-website
^0.81.x  4   1836dig, data-dynamiq, la-homelessness-initiative, la-homelessness-youth
^0.80.x  1   composition-hospitality (org repo, no local checkout)
^0.75.x  1   the-pointe (ARCHIVED)
```

**Not one site is on 0.95.1.** Because the package is `0.x`, a caret range does
not cross minors — `^0.81.0` resolves only inside `0.81.x` — so **four production
sites are 14 minors behind the plumbing package the fleet is built on**, and nine
are 5 behind. Verified against lockfiles, not assumed: `la-homelessness-initiative`
and `data-dynamiq` resolve `0.81.0`, `the-tower-burbank` `0.90.1`, `gallerysonder`
`0.93.0`. Only a manifest bump can move them, and the only mechanism that does
that is Renovate's grouped non-major PR — which has not existed since 2026-08-10
(§6).

### 2.9 Health [measured, with a hard caveat]

`gh run list` for the central repo, **2026-09-04 → 2026-09-12 only** — the corpus
caps at 300 runs per repo and this repo hits the cap, so the window is **nine
days, not six weeks**:

| workflow                                                                             |    runs | outcome                                  |
| ------------------------------------------------------------------------------------ | ------: | ---------------------------------------- |
| ci                                                                                   |     165 | 162 success, 3 failure                   |
| release                                                                              |      41 | 40 success, 1 failure                    |
| renovate                                                                             |      18 | all success                              |
| release-health / fleet-lighthouse / fleet-security                                   | 10 each | all success                              |
| fleet-form-e2e / fleet-smoke / daily-reports / fleet-prismic-drift / fleet-db-backup |  9 each | all success                              |
| time-travel                                                                          |       1 | success                                  |
| report-rerender                                                                      |       0 | dispatch-only; never fired in the window |

**Do not quote the nightlies' 0% failure rate as a six-week result.** It is a
nine-day result, and three real repos (`espada`, `gallerysonder`, `hedloc`) are
absent from the run corpus entirely because the collector's API calls were reset
mid-fetch — a fetch failure, not silence. `hedloc`'s cron was verified alive by a
live `gh run list`; the other two could not be verified because every retry hit
`tls: failed to verify certificate: x509: OSStatus -26276` through the sandbox.

**Backlog: 58 open issues in the central repo.** Only 8–16 carry a label (the two
surveys disagree; see §10.6), none carry a milestone or assignee. **Forty-seven
of the 58 were filed in the last twelve days.** By ISO week, opened vs closed:
W34 7/7, W35 11/5, W36 24/4, W37 35/6. Through mid-August the tracker was at
equilibrium; since 2026-08-31 it has opened 59 and closed 10.

### 2.10 Documentation drift in the README [measured]

The README is being _appended to_, never reconciled, and the gap is precisely the
automated half of the system:

- **Audits:** the table lists 5 (`deps, lighthouse, a11y, security, lint`) and the
  code block literally says "all five against cwd". `ALL_AUDIT_NAMES` has 11. The
  six undocumented ones — `domain, browser, netlify-deploy, function-health,
smoke, form-e2e` — are exactly the ones the nightly workflows run.
- **CLI:** the `## CLI` block lists 11 commands plus prose for `prospect-audit`.
  There are 32.
- **Recipes:** 9 `###` sections for 13 registered names. Undocumented:
  `health-endpoint`, `smoke-suite`, `self-updating`, `prismic-ci` — and
  `self-updating` runs nightly inside `fleet-security.yml`.
- `header-image` and `digest` appear **zero** times; `blux` once.

An agent or operator reading the README as the per-command reference would
conclude the fleet checks five things.

---

## 3. The site fleet — composition, and how heterogeneous it actually is

### 3.1 The 13 contract sites [measured]

`lastCode` = last non-bot, non-`docs:`/`chore:` commit in the window. `unit` =
`*.test.ts` under `src/` + `tests/`.

| checkout                   | Airtable name · freq            | prismic                                | maint   | lastCode   |    unit | e2e | sessions |
| -------------------------- | ------------------------------- | -------------------------------------- | ------- | ---------- | ------: | --: | -------: |
| beachfront-dentistry       | Beachfront Dentistry · Q/Yearly | yes (`48bb12d1`)                       | ^0.90.0 | 2026-09-10 | **110** |  23 |       95 |
| reddoor-website            | Reddoor · Q/None                | yes (`reddoor-la`)                     | ^0.83.0 | 2026-09-11 |  **42** |  21 |      701 |
| gallerysonder              | Sonder · **Monthly**/Q          | yes                                    | ^0.93.0 | 2026-09-10 |       0 |  12 |       27 |
| revogen                    | Revogen · Q/None                | yes                                    | ^0.90.1 | 2026-09-02 |       0 |   2 |       14 |
| medical-solutions-of-texas | MSOT · Q/None                   | yes (`msot`)                           | ^0.83.0 | 2026-09-01 |       0 |   1 |        0 |
| erp-industrial             | ERP Industrials · Q/Yearly      | yes                                    | ^0.90.0 | 2026-09-01 |       0 |   1 |        0 |
| espada                     | Espada · Q/None                 | yes                                    | ^0.83.0 | 2026-09-01 |       0 |   1 |        0 |
| vineyard-custom-homes      | Vineyard · Q/None               | yes                                    | ^0.90.0 | 2026-09-01 |       0 |   1 |        0 |
| caltex-landing             | CalTex · Q/None                 | yes                                    | ^0.90.0 | 2026-09-01 |       0 |   1 |        0 |
| data-dynamiq               | Data Dynamiq · Q/None           | **config only** (`reddoor-wireframer`) | ^0.81.0 | 2026-09-01 |       0 |   1 |        0 |
| 1836dig                    | 1836dig · Q/None                | **no**                                 | ^0.81.0 | 2026-09-01 |       0 |   1 |        0 |
| la-homelessness-initiative | LA-H Initiative · Q/None        | **no**                                 | ^0.81.0 | 2026-09-01 |       0 |   1 |        0 |
| la-homelessness-youth      | LA-H Youth · **freq None**      | **no**                                 | ^0.81.0 | 2026-09-01 |       0 |   1 |        0 |

`la-homelessness-youth` holds `Status = maintained` with `maintenence freq = None`
**deliberately** — it is the portfolio copy of the Initiative site, and
`maintained` is what keeps it inside the sweeps while `freq None` stops the client
reports. Documented idiom, not a misconfiguration.

**Eleven of the thirteen contract sites have zero unit tests in their own repo.**
Their entire quality signal is produced centrally, post-deploy, against the live
URL.

### 3.2 The sweep boundary is doing more work than it looks like [measured]

Every fleet job filters on `Status = maintained`. Consequence:

- `hedloc` and `alamo-anatomy` (both `launching`, both with real prod-shaped URLs)
  were last security-audited **2026-07-08**, while every maintained site was
  audited 2026-09-12 09:51 UTC. **A 66-day gap, and nothing alarms on it.**
- The seven `building` rows carry **no** `Security Vulns *`, `Smoke OK`,
  `Last lighthouse audit at` or `Deps Outdated` values at all — they have never
  been audited. Verified by listing those exact fields for every non-archived row.
- `29-navy` (building, live at `www.29navy.com`) has an Airtable row with **no
  `Git repo` and no `Netlify ID`** — row and repo are unlinked. Flipping it to
  `maintained` before filling the `Git repo` cell would make the clone throw on
  the first night it is swept. Do the cell first.

### 3.3 Two generations of site, cleanly separable by test count [measured]

```
generation 2 (starter-descended)     routes slices unit e2e
  beachfront-dentistry                  14    31   110  23
  reddoor-starter-blux                  10    29    94   4
  the-pointe-burbank                    10    27    97   5
  the-tower-burbank                     10    27    91   4
  vida-legacy-foundation                 6    18    73   4
  canvas-starter                         8    16    63   2
  29-navy                                7    15    54   3
  reddoor-starter                        6    10    45   2
  reddoor-website                       24    16    42  21

generation 1 (pre-starter)
  gallerysonder 10/7/0/12 · espada 9/2/0/1 · msot 9/2/0/1 · caltex 8/5/0/1
  vineyard 8/3/0/1 · erp-industrial 6/4/0/1 · hedloc 6/5/0/1 · revogen 5/8/0/2
  data-dynamiq 20/2/0/1 · alamo-anatomy 9/0/1/1 · 1836dig 2/0/0/1
  la-homelessness-initiative 2/0/0/1 · la-homelessness-youth 2/0/0/1
```

The split is **not** about site size — `data-dynamiq` has 20 routes and zero unit
tests, `vida-legacy-foundation` has 6 routes and 73. It is about **when the repo
was created relative to the starter**. Everything descended from `reddoor-starter`
inherited `test:unit && test:smoke`; everything older got a single smoke spec
bolted on by a sweep and nothing since. **A site's feature set is a fossil of the
day it was generated** (§4.4). The generation-1 sites are the ones with revenue
attached.

### 3.4 Uniform on the surface, drifted underneath [measured]

- **Version spread across 23 site-shaped repos:** `svelte` 5 distinct ranges,
  `@sveltejs/kit` 6, `vite` 5, `tailwindcss` 4, `@prismicio/svelte` 3 + 3 absent.
  `gallerysonder` declares `@sveltejs/kit: ^2.0.0` — so wide it is effectively
  unpinned. `erp-industrial` is the only repo still on `@prismicio/svelte@1.x`, a
  major behind everyone else.
- **npm scripts: 23 repos, 14 distinct script sets.** The largest agreeing group
  is four repos. `test:a11y` exists in exactly four (`29-navy`, `reddoor-starter`,
  `the-pointe`, `vida-legacy-foundation`) — **the starter ships an a11y gate that
  19 of 20 client sites never received.**
- **Prismic: three different relationships to one CMS.** 17 repos ship
  `slicemachine.config.json` with a real repository name and all use
  `@slicemachine/adapter-sveltekit` + `./src/lib/slices` (genuinely uniform).
  `data-dynamiq` points at `reddoor-wireframer` — not its own repo — and the
  config is nonetheless load-bearing: removing it breaks the build.
  `beachfront-dentistry` uses an opaque repo id (`48bb12d1`). Three sites have no
  Prismic at all.
- **Netlify: uniform adapter, drifted config.** Every site uses
  `@sveltejs/adapter-netlify@^6.0.4` publishing `build/`, but `command = "pnpm build"`
  in 8 repos vs `"pnpm run build"` in 11, and `functions = "functions/"` is
  declared in exactly 8 and absent from 12 — including every generation-2 site.
- **`Netlify ID` is populated for 12 of 13 maintained sites.** The exception is
  **Beachfront Dentistry**, the fleet's most actively developed client site, which
  has no `Netlify ID` and no `Deploy status`. `Deploy status` drives the cockpit's
  _Broken_ band, so that site sits outside the one alarm that would catch a failed
  production deploy. [measured]

### 3.5 The security-pin layer is the most drifted surface in the fleet [measured]

`pnpm-workspace.yaml` `overrides:` is hand-managed, and the same advisory is
pinned **five different ways**. For GHSA-pxg6-pf52-xh8x (`cookie` < 0.7.0):

| right-hand side                                                             | repos                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `">=0.7.0 <1"`                                                              | 11 repos incl. both starters, reddoor-website, reddoor-maintenance |
| `"^0.7.2"`                                                                  | 8 repos                                                            |
| `">=0.7.0 <2"` — **permits cookie 1.x**                                     | 1836dig, hedloc                                                    |
| `"@sveltejs/kit>cookie": "^0.7.0"` — parent>child selector, not a scope cap | caltex-landing                                                     |
| _(no `overrides:` block at all)_                                            | **la-homelessness-youth**, the-pointe, welcome-to-the-flower-court |

Lockfile resolution confirms the consequence: `la-homelessness-youth` is the only
maintained site with no overrides block and the only one resolving
**`cookie@0.6.0`** — the vulnerable version — pulled in as `@sveltejs/kit`'s own
dependency at `pnpm-lock.yaml:1803`. Its sibling `la-homelessness-initiative`,
same stack and same sweep history, pins `^0.7.2` and resolves `0.7.2`.

**This loop is explicitly NOT closed.** Airtable reports `Security Vulns
High/Moderate/Low = 0` and `Security advisories = []` for that site, audited
2026-09-12 09:51 UTC. The fleet security audit derives from GitHub's Dependabot
alerts, and that endpoint was unreachable from the surveying session (three
consecutive `tls: failed to verify certificate` failures; one earlier attempt
returned empty with exit 0, which was almost certainly the same error swallowed
by `--jq`). The measured facts are (a) the override is absent, (b) the lockfile
resolves the vulnerable version, (c) the audit reports zero. **Reconciling those
three needs the Dependabot alerts API from an unsandboxed shell.** [measured +
explicitly unverified]

Same shape for `sharp`: override idioms disagree five ways, and two repos with no
sharp override (`canvas-starter`, `the-pointe-burbank`) resolve the vulnerable
transitive `sharp@0.33.5` via `imagetools-core@6.0.4` — exactly the path the
override was written for. Neither is `maintained`, so neither is audited.

### 3.6 Working-tree state [measured]

Nine of 41 checkouts have HEAD on a non-default branch: `a-budget`,
`beachfront-dentistry`, `gallerysonder`, `reddoor-mailer`, `reddoor-website`,
`rfp-analyze`, `the-pointe`, `vida-legacy-foundation`,
`welcome-to-the-flower-court`. Seven have a dirty tree. Worktree sprawl is
concentrated in the two heavy repos — `reddoor-website` 8 worktrees,
`reddoor-maintenance` 5 — with **18 worktrees beyond the primary across 7 repos,
3 of them prunable** (they point into deleted session scratchpads). Disk: ~18 GB
in the top twelve checkouts, almost entirely `node_modules` across worktrees.

---

## 4. Starters and templates

### 4.1 The two-track model [measured]

`reddoor-starter` is the **native default**; `/new-site <slug>` runs
`gh repo create reddoorla/<slug> --public --template reddoorla/reddoor-starter`,
and `--track blux` swaps in `reddoorla/reddoor-starter-blux`.

|                                                     | reddoor-starter | reddoor-starter-blux | canvas-starter |
| --------------------------------------------------- | --------------- | -------------------- | -------------- |
| `isTemplate`                                        | **true**        | **true**             | **false**      |
| commits                                             | 288             | 279                  | 31             |
| tracked files                                       | 203             | 358                  | 238            |
| test files                                          | 49              | 98                   | 65             |
| slices                                              | 9               | 28 (11 `Blux*`)      | 15             |
| custom types                                        | 2               | 8                    | 1              |
| `pnpm verify`                                       | **yes**         | no                   | no             |
| `test:a11y`                                         | **yes**         | no                   | no             |
| `.prettierrc.json`                                  | **yes**         | **no**               | **no**         |
| `reddoor.a11yRoutes`                                | `["/"]`         | **absent**           | **absent**     |
| `docs/STARTER.md` / `NEW-SITE.md` / `COMPONENTS.md` | y/y/y           | –/–/–                | –/–/–          |

`reddoor-starter-blux` is a **full-history snapshot**, not a fork: `git merge-base
main starter/main` = `82d93b08`, exactly the documented split point (2026-08-31).
The native repo then shed the Blux layer in `ac7660f` (#106): 242 files changed,
1,453 insertions, **29,941 deletions**, 136 of the 178 deleted paths matching
`blux`.

### 4.2 The merge landmine, reproduced [measured]

`CLAUDE.md:194` says: **cherry-pick, never `git merge starter/main`**, because
the merge applies #106's 178 deletions as clean, conflict-free removals with only
`README.md` conflicting. The surveying agent reproduced it in a throwaway
`--shared` clone (the real repos were never touched):

```
$ git merge --no-commit --no-ff ac7660f
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
$ git diff --name-only --diff-filter=U          → README.md          (1 conflict)
$ git diff --cached --name-only --diff-filter=D | wc -l   → 178       (silent deletions)
$ ... | grep -ic blux                            → 136
$ ... | grep 'tests/gate'  → frozen-fidelity.spec.ts, pointe-fidelity.spec.ts
```

**The documented claim is correct to the file.** Why it happens generalises: the
merge base is the snapshot point, the blux side had not touched those paths, and
the native side deleted them — three-way merge with "unchanged on ours, deleted on
theirs" is a clean delete by design. _Any_ repo pair created by "snapshot, then
delete a subsystem in the parent" has this property.

Run with today's heads the shape changes and the danger does not: 17 conflicts
now (blux#5 edited 9 of the deleted paths, making them modify/delete), 169 silent
deletions, 128 of them Blux, 54 under `src/lib/blux*`, both fidelity gates gone.
**It now looks like git is doing its job.** That is worse, not better.

### 4.3 The cherry-pick channel is already impaired [measured]

Commits since the split: native 16, blux 7. Blux has adopted five native
improvements by cherry-pick. Of the 118 files present in both repos but
differing, **50 differ on the native side by nothing except `af05a8f`** — the
canonical prettier reformat (80 files, `printWidth: 100`, double quotes) that
blux never adopted. Cherry-picking each unadopted native improvement onto blux
`main` in the sim clone conflicted **four for four**, and the `2377e9c` conflict
is provably formatting, not content.

**The cheapest thing that would restore the channel is to adopt `.prettierrc.json`
in the blux repo and run `prettier --write .` there once**, collapsing 50 of the
118 divergent files to zero. [inferred from the reformat commit's own
description; not executed]

### 4.4 What a new site actually inherits, and the stratigraphy [measured]

`gh repo create --template` produces a repo whose history is a single squashed
`Initial commit` (verified on `29-navy` and `vida-legacy-foundation`), so **a
generated site has no merge base with the starter** — which is why porting a
site's fixes back is "one PR per item", never a pick.

Across the 30 SvelteKit repos:

```
with the Blux layer (src/lib/blux*):    6 / 30
with package.json#reddoor.a11yRoutes:   3 / 30   reddoor-starter, 29-navy, vida-legacy-foundation
with pnpm verify:                       4 / 30   those three + reddoor-maintenance
with any prettier config:              21 / 30
with docs/STARTER.md:                   3 / 30
with docs/COMPONENTS.md:                2 / 30
with docs/workJournal.md:              28 / 30   (41/41 counting all checkouts)
```

`a11yRoutes` landed in the template on 2026-09-05 (#115) and exists on exactly
the sites created at or after it. **The one mechanism that propagates backwards
is the shared reusable CI workflow**, which every live site pins at the same SHA.

### 4.5 Two template-level gates that default to measuring nothing [measured]

- **Prettier is blind to `.svelte` in directory mode with no config.** Proven with
  a control: a badly-formatted `.ts` is reported (exit 1) while `Bad.svelte` in
  the same directory is silently skipped; adding `--plugin prettier-plugin-svelte`
  or a `.prettierrc.json` makes it appear. The org reusable CI runs
  `pnpm exec prettier --check .` — the raw binary, not the package script — so
  for `reddoor-starter-blux`, `canvas-starter`, `data-dynamiq`,
  `the-pointe-burbank` and `the-tower-burbank` **the CI formatting gate cannot see
  a single Svelte file.** All five keep the `--plugin` flag in their own
  `pnpm lint`, so a developer running it locally is covered; CI never calls that
  script. `canvas-starter/CLAUDE.md` documents this; `reddoor-starter-blux/CLAUDE.md`
  does not — which is the live hazard, because that repo's declared workflow is to
  cherry-pick from a native repo that removed the flag.
- **The a11y gate scans zero real pages on the blux track**, because neither blux
  nor canvas ships `reddoor.a11yRoutes`. See §5.4 for the fleet-wide version of
  this.

### 4.6 `canvas-starter` is a third lineage with no git relationship to either

[measured]

It was **copied, not forked**: 31 commits of its own beginning with a design
spec, then one `scaffold` commit that dropped the starter's files in. There is no
merge base with either starter, so nothing can be cherry-picked in or out
mechanically. Because it was copied 2026-07-24 — five weeks before the split — it
froze a snapshot of the pre-split library, and **eight slices survive only in the
blux and canvas lineages and exist nowhere in the native line**: `Carousel`,
`CollectionList`, `Gallery`, `GridBand`, `LocationMap`, `MediaFull`,
`SplitFeature`, `TitleBand`. It has had no code development since 2026-07-24 and
is `isTemplate: false`. Its stated purpose ("so this can be promoted to a template
later") is seven weeks stale.

### 4.7 Template thinking happens in the sites, not in the template [measured]

Zero agent sessions have ever been opened in the blux or canvas checkouts in the
window; the blux repo's 7 post-split commits were produced from elsewhere. Of 325
prompts mentioning starter/blux/template/new-site, the top project is **not a
starter** — it is `29-navy` (90), then `reddoor-starter` (54), `reddoor-website`
(40).

The clean example: the capability index was built in 29-navy on 2026-09-11
(#25/#26) and upstreamed to the starter the same day (#124). The
counter-example is `reddoor-starter#121` — **fourteen generic product-quality
fixes** Beachfront made 2026-08-07 → 2026-09-02 (noindex prefixes, reveal state in
markup, a focus-ring floor, live reduced-motion, modal scroll-lock, nav tap
response) that are still absent from the template a month later, and are already
propagating into new sites as re-work: Vida Legacy Foundation inherited five of
them on 2026-09-01 and independently re-fixed a sixth. The starter's own journal
calls it **"the largest per-site saving measured anywhere in this work (~18% of a
Beachfront-sized build, against ~10% for every conversion layer combined)."**
This is the single largest identified, unrealised win in the template dimension.

---

## 5. CI/CD and the gate layer

### 5.1 Two tiers [measured]

**Tier 1 — the central repo's 13 workflows + 1 reusable**, 2,334 lines of YAML,
the large majority of it prose explaining _why_. These files are the fleet's
best-documented artifact.

**Tier 2 — one shared reusable `ci.yml` in `reddoorla/.github`** that 22 of the 29
checkouts with a `.github/workflows` directory call. Every site's own `ci.yml` is
an 11–13 line caller. The callee runs, in order: `pnpm install --frozen-lockfile`,
`prettier --check .`, `eslint .`, `svelte-kit sync && svelte-check`, `pnpm build`,
`playwright install --with-deps chromium`,
**`pnpm exec reddoor-maint audit --only a11y --fail-on-violations`**, then two
conditional steps ("Test (if present)", "Smoke test (if present)"). A second job
posts the Netlify deploy-preview link as a PR comment — **it comments, it does not
gate**; nothing in the shared CI waits on or asserts anything about the Netlify
build.

Pin distribution: **20 repos on `8f9852c` (v1.4.1)**, `reddoor-website` on
`c714d9e` (v1.4.2, tagged 2026-09-09), `the-pointe` on `4a32c3d` (v1.3.0,
archived). The four repos not on the shared CI are `reddoor-maintenance`
(bespoke), `reddoor-md-pdf`, `reddoorla-dot-github` (whose own `ci.yml` is
`workflow_call`-only and emits no check runs at all — hence `validate.yml`), and
`Broken/` (not a Reddoor repo).

`prismic-models.yml` is the second reusable workflow, in **9 repos**. Its split is
the safety property: the `pull_request` job holds `pull-requests: write` and never
passes `--apply`; the `push`-to-`main` job holds `--apply` and no permission to
comment. Both halves of the branch guard are kept. Its source of truth is
`reddoor-maintenance/workflows/reusable/prismic-models.yml`, hand-copied into the
org repo — diffed during the survey and **byte-identical today**.

`reddoorla-dot-github/validate.yml` is the only `pull_request` check in the org
repo and does two things that matter fleet-wide: enforces 40-hex digest pinning on
every third-party `uses:`, and validates that the Renovate preset keeps
`platformAutomerge: false` on every automerge rule (the 2026-07-26 incident class,
encoded). A fleet-wide grep for unpinned `uses:` returns only
`changesets/action@v1` in `reddoor-maintenance/release.yml` and three `@v4` refs in
the non-Reddoor `Broken/` repo. [measured]

### 5.2 Run statistics, 3,437 rows / 24 repos, 2026-07-30 → 2026-09-12 [measured]

```
workflow                runs    ok  fail  canc  fail%   repos
renovate                1629  1626     3     0    0.2     23
ci                      1522  1389   132     0    8.7     22
lighthouse               103    86     1    16    1.0      1   (reddoor-website only)
validate                  46    46     0     0    0.0      1
release                   41    40     1     0    2.4      1
release-health / fleet-* / daily-reports / prismic-models / time-travel  — 0 failures
```

Events: 1,240 `schedule` / 894 `pull_request` / 419 `push` / 82 `workflow_dispatch`.

**132 of the 135 total failures are `ci`** — the gate doing its job on feature
branches. **Only two `ci` failures in the whole window were on `main`**
(`beachfront-dentistry` 2026-08-03, `vida-legacy-foundation` 2026-09-05).

`beachfront-dentistry` alone is half the fleet's CI failures (66/132, a 30.1%
failure rate over 219 `ci` runs), and **52 of those 66 sit on one branch**,
`feat/detail-templates-and-footer`, across two days (15 on 08-05, 37 on 08-06).
That is one PR iterating red 52 times in 48 hours. Nothing is broken about the
gate; it is a cost signal about how that work was driven. `reddoor-website` shows
the same shape smaller (9 of 19 on `design/report-by-control` on 2026-08-27).

### 5.3 The gate-design house style, and it is genuinely unusual [measured]

Worth naming precisely because §5.4 is about where it has not reached yet:

- **Gates key on machine-readable marker lines, not on the CLI's exit code**, and
  an **absent** marker is itself a failure: `FLEET_WRITE_SUMMARY`,
  `FLEET_SMOKE_UNMEASURED count=N`, `PROTECTION_AUDIT gaps=`,
  `DUMP_VERIFY loaded=true … mismatches=0`, `FLEET_DB_USAGE … verdict=ok`,
  `REPORT_RERENDER … status=rendered`. Four of six red on an absent line.
- **`FLEET_SMOKE_UNMEASURED` exists because the first marker could not see the
  failure it was built for.** `fleet-smoke.yml:118-138` says it outright: a site
  whose `test:smoke` blows its budget "still counts as written (it writes nothing
  new), and the Airtable writer deliberately preserves the prior value rather than
  record a false fail — so the row keeps serving its last GREEN result. reddoor
  and beachfront-dentistry sat like that for four nights while this workflow
  reported success every morning."
- **Gates are tested by execution, with the positive control first.**
  `tests/build/fleet-smoke-workflow.test.ts` extracts the workflow's own shell and
  runs it against a stubbed CLI across six cases; its header states the rule: "The
  clean-sweep case is first on purpose. A gate that has only ever been seen to fail
  is an untested assertion, not an instrument."
- **`tests/ci-gate.test.ts` derives the CI step list from `package.json#verify`**
  and asserts equality in content _and order_; a second block globs every workflow
  running the suite and fails any lacking `playwright install` — because `ci.yml`
  gained the browser install and `release.yml` did not, so a PR went green and
  `main` went red forty seconds after merge.
- **The backup verifies the artifact it keeps**, not the one it made: it verifies
  against an origin manifest embedded as the dump's first line (the earlier
  self-comparison would have verified a dump that collected 5 of 44 sites as
  clean), then **decrypts the .gpg it is about to upload and re-runs the same
  gate on the round-tripped copy**.
- **Alert machinery never changes a verdict** — every issue-filing and
  issue-closing step is `continue-on-error`.
- **`fleet-security.yml:237` refuses to close its tracking issue** without the
  positive `PROTECTION_AUDIT gaps=0 ` line, because "any path that exits 0 without
  auditing would otherwise convert into a false 'Recovered' close."
- **`reddoor-website/lighthouse.yml`** is the most hardened single gate in the
  fleet: it waits for Netlify's check-run **on the PR's head SHA** (HTTP 200 is not
  a readiness signal — the previous commit's preview serves the same alias),
  distinguishes "Checks API broken" from "deploy not done", hard-fails an empty
  `/portfolio` scrape, and since 2026-09-08 curls `/health` to prove the
  serverless function answers after a wasm dependency took every SSR route down
  while every prerendered page stayed green.

### 5.4 Gates that can be satisfied by an absence

Each item below was executed or quoted, with a **known-good input first**.

**(a) `fleet-form-e2e` goes GREEN on a night when nothing was probed. [measured]**
It is the only fleet sweep with no `wrote == 0` check and no unmeasured check.
`total = wrote + failed`, so a zero-site inventory prints `wrote=0 failed=0
total=0` and the sole remaining check (`failed*4 > total`) is `0 > 0`, false. The
surveying agent extracted the step's own `run:` block and executed it under
`bash -e` with `node` stubbed:

```
A  3 of 3 written (positive control)      EXIT=0
B  crashed before the summary             EXIT=1  ::error:: printed no write summary
C  fleet resolved ZERO sites              EXIT=0   ← the hole
D  13 sites, ALL self-skipped             EXIT=0   ← the worse half
E  4 of 13 failed to write (>25%)         EXIT=1

  same case-C input against fleet-lighthouse's extracted gate:
                                          EXIT=1  ::error::fleet Lighthouse wrote 0 of 0 site(s)
```

Case D matters more than C. The workflow's own comment (lines 66-70) says a site
that has not rolled out `testMode` forwarding self-skips via the `/health`
preflight and "counts as written, not failed, so the gate stays green during
rollout" — a deliberate accommodation **with no expiry and no counter**. If a
site's deploy stops declaring `forms.testMode`, it silently leaves the probe set,
its `Form E2E OK` keeps serving its last value, and the nightly reports success.
That is byte-for-byte the failure `FLEET_SMOKE_UNMEASURED` was invented to kill.
Contributing cause, named: `tests/build/` holds executable gate tests for
`daily-reports`, `fleet-db-backup`, `fleet-prismic-drift`, `fleet-security`,
`fleet-smoke`, `report-rerender` and the reusable prismic workflow — **none for
`fleet-form-e2e` or `fleet-lighthouse`**. The one nightly with an incomplete gate
is one of the two with no test.

**(b) The a11y gate scans two dev fixtures, not the site, in 24 of 27 repos.
[measured]** `pnpm exec reddoor-maint audit --only a11y --fail-on-violations` is
the strongest-looking line in the shared CI. Without `package.json#reddoor.a11yRoutes`
it scans only `configs/playwright-a11y.js`'s two design-system fixtures
(`/dev/a11y-fixtures`, `/dev/animate-in`). The source comment
(`src/audits/a11y.ts:186-199`) states the stakes without hedging: "This exists
because scanning only fixtures let a critical `image-alt` violation ship to five
production pages with CI green; it is opt-in because the audit runs with
`--fail-on-violations` and most of the fleet has pre-existing debt." Census:

```
opted in: 3     29-navy (1 route), reddoor-starter (1), vida-legacy-foundation (8)
fixtures only: 24   — including gallerysonder, the repo named in #770's changeset
                      as where the image-alt violation shipped
```

So for 24 repos **a PR that breaks accessibility on every real page passes a check
literally named `--fail-on-violations`**, because the pass condition is satisfied
by pages the site does not serve. (#770, merged 2026-09-11, fixed the _adjacent_
bug — the summary interpolated `a11yRoutes.length` while scanning `axePages`, so
vida-legacy-foundation added eight routes and was told "across 2 routes". The
counting bug is fixed; the coverage gap it obscured is not.)

**(c) Nothing on a schedule asserts that any repo requires a CI check to merge.
[measured, code-level]** `AUTONOMY.md:10-13` names three binding controls for
unattended agent merges, the second being "CI being required on `main`". The
nightly org-wide sweep judges every ruleset with `rulesetGaps(full, null)` —
**stage 1 only** — and the header says so: "Whether a covering ruleset also gates
on CI is reported as detail, not judged … (and reddoor-maintenance deliberately
has none pending release-path review)". A repo with no required status check is
therefore reported **covered**, with `— NO CI gate (refs rules only)` appended to
its detail line, `PROTECTION_AUDIT gaps=0` prints, and the tracking issue
auto-closes. `ACCEPTED_GAPS` is `[]`, so nothing is muted. Compounding it:
`checkContextObserved` (`src/github/gh.ts:607-628`) returns `false` on _any_
non-zero `gh` exit, so "the check wasn't observed" and "the check isn't required"
produce the same ruleset — the right trade (an unfireable required context with an
empty bypass list makes a repo permanently unmergeable) with an unmonitored cost.
**Live ruleset state could not be verified** — `gh api repos/reddoorla/caltex-landing/rulesets`
failed 5/5 with the sandbox TLS error. The claim is about what the code checks,
not about what the repos currently have. [the gap: measured; the live state:
unverified]

**(d) `release-health` auto-closes a real "Release workflow is failing" issue when
its own API call fails. [measured]** `release-health.yml:97-99` sets `red=no` when
the `gh api` query returns empty — correct for the _alarm_ direction. But `red`
also drives the **close** half at line 166. Executed with a stubbed `gh`: P1
failing → `red=yes`; P2 green → `red=no`; **P3 the call itself fails → `red=no`,
indistinguishable at the `if:`**, arming `gh issue close … "The release workflow
is green on main again."` on an issue that is not. Two sibling workflows already
solved this and are the fix template (`fleet-security.yml:237`,
`daily-reports.yml:270`).

**(e) The ANALYTICS credential proof only runs on a manual dispatch. [measured]**
`daily-reports.yml:144-161` is the gate built after #469 (every CI-drafted report
shipping with a blank ANALYTICS section) and repaired in #523 (`--preview` alone
does no IO, so the check could never pass; `--enrich` is what makes it a real
credential proof). It is sound now — and it is guarded by
`if: ${{ inputs.preview_site }}`. **The 09:23 scheduled run drafts, sends and
digests with no assertion at all that GA resolved.** The #469 failure class
remains green-by-default on the scheduled path.

**(f) "Test (if present)" cannot tell "no unit tests" from "someone deleted the
test script". [measured]** The shared CI shells out to a `package.json` probe and
prints "no test script — skipping" on a miss, passing green. Nine repos on that
workflow have no `test` script at all. (The smoke half is fine: every live site
repo has `test:smoke`.)

**(g) Seven repos carry a frozen `lighthouserc.json` missing the anti-squatter
fix. [measured, low blast radius]** Twelve repos have the one-line
`{"extends": "@reddoorla/maintenance/configs/lighthouse"}`; seven carry a
materialized snapshot whose `startServerCommand` is `pnpm vite:dev` without
`--port 5173 --strictPort`. `src/configs/lighthouse.ts:19` explains the cost:
`startServerReadyPattern` matches vite's "ready in" line whatever port it settled
on, so with a squatter on 5173 lighthouse audits the squatter and reports its
scores as the site's. Blast radius is limited because the nightly uses
`deployedLighthouse` whenever the row has a `deployedUrl`.

---

## 6. Dependency automation — Renovate

### 6.1 The configuration [measured]

One shared preset, `reddoorla-dot-github/renovate-config.json` (11,730 bytes),
extended by a three-line `renovate.json` in every repo. Verified byte-identical
across 25 checkouts; the **only** per-repo deviation fleet-wide is
`reddoor-website`, which adds `"baseBranchPatterns": ["staging"]`. The local
checkout was proven to be the live version by blob-oid comparison against
GraphQL (`d0c6610…`), not assumed — the checkout is 2 commits behind, but both are
CI fixes and the last change to the preset itself was **#29 `9b82c1d`,
2026-08-12**.

| key                                              | value                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `extends`                                        | `config:recommended`, `helpers:pinGitHubActionDigests`, **`group:allNonMajor`** |
| `schedule`                                       | `["before 6pm on monday"]`                                                      |
| `minimumReleaseAge`                              | `1 day` (emits a `renovate/stability-days` commit status)                       |
| `internalChecksFilter`                           | `strict`                                                                        |
| **`prCreation`**                                 | **`not-pending`** — added 2026-08-12 in .github#28 (`bcb9d5d`)                  |
| `lockFileMaintenance`                            | enabled, Monday, `automerge: true`, `platformAutomerge: false`                  |
| `vulnerabilityAlerts` / `osvVulnerabilityAlerts` | both on                                                                         |

Cron `0 */12 * * *`, running as the `reddoor-renovate` GitHub App with all three
actions digest-pinned (the job mints a repo-write token, so a retagged `@v46`
would run attacker code with it). **Platform auto-merge is off fleet-wide and
Renovate performs its own merges from inside the run**, so the `packageRules` —
not a per-PR GitHub flag — are the decision-maker. Verified by merge authorship:
lockfile and security PRs show `mergedBy: reddoor-renovate`; grouped non-major PRs
show `mergedBy: tucksravin`.

The nine packageRules, in order of what they actually do: (1) patch+minor →
automerge; (2) `lockFileMaintenance` exempt from the age gate; (3) **never
auto-merge graph-reshaping packages** — `@reddoorla/maintenance`, `sharp`,
`@zerodevx/svelte-img`, `vite-imagetools`, `imagetools-core`,
`@sveltejs/enhanced-img`; (4) majors never automerge; (5) **pnpm hold at 11.8.x**;
(6) `typescript < 7`; (7) `@libsql/client < 0.9`; (8) `cookie < 2`; (9)
**pnpm-override-key suppression** (`matchDepTypes: [overrides, pnpm.overrides,
pnpm-workspace.overrides]`, `enabled: false`).

The preset's `description` array carries its own falsified claims and forensics —
including the 2026-08-12 self-correction that "16 of those 17 PRs were never
automerge-eligible at all". It is the densest artefact in the fleet; read it
before touching anything.

### 6.2 The routine channel has shipped nothing for five Mondays [measured]

`group:allNonMajor` is the only channel that can move a caret-on-`0.x` manifest
range, and it **last produced a pull request on 2026-08-10**. On 08-17, 08-24,
08-31 and 09-07 Renovate ran on schedule, succeeded, created and updated the
branch, and opened no PR.

```
live GraphQL over refs/heads/renovate/* (2026-09-12):
  repos with a renovate/all-minor-patch branch: 23 of 24
  of which with NO associated pull request:     23
  every branch head dated:                      2026-09-07
  every head carries exactly one status:        renovate/stability-days = SUCCESS
  every head carries check runs:                0
```

Also sitting PR-less on 2026-09-07 heads: `renovate/lock-file-maintenance` in 22
repos, `renovate/pnpm-12.x` in 20, `renovate/major-vitest-monorepo` in 7, plus ~15
other majors — roughly **90 PR-less branches across the fleet**. The Dependency
Dashboards list these under **`## Awaiting Schedule`**, with group sizes from 5
(`reddoor-md-pdf`) to 16 (`reddoor-maintenance`). `reddoorla/.github`'s own group
is stalled too, so **the preset repo cannot update the Renovate action that runs
the preset.**

The run log is unambiguous (`reddoor-starter`, Monday 2026-09-07 01:57 UTC):
`Branch updated (branch=renovate/all-minor-patch)` … `Repository finished` — four
branches, zero PRs.

**Mechanism [inferred, explicitly labelled as such by the survey].** Five measured
facts constrain it: `prCreation: not-pending` landed 2026-08-12, two days after
the last grouped PR, and nothing else in the preset changed after; the grouped
head's only status is Renovate's own and is SUCCESS, so the age gate is not
pending and `internalChecksFilter: strict` is not the blocker; the head has zero
check runs; **no fleet repo runs CI on a `renovate/*` push** (all 23 site repos
are `on: pull_request` + `push: branches: [main, staging]`, and the central repo
adds exactly one bot branch, `changeset-release/main`); and the lockfile branch —
which carries no stability status — _did_ get a PR on 08-31 after sitting
untouched for a week. The inferred mechanism: `not-pending` treats Renovate's
internal checks as not-success (`internalChecksAsSuccess` defaults `false`), so a
branch whose only status is `renovate/stability-days` reads pending forever;
`prNotPendingHours` (default 25) would rescue it, but the grouped branch is
rebased every Monday, resetting the clock, and the Monday window is at most ~18 h
wide. That also predicts lockfile maintenance runs **every other week, not
weekly** — exactly the observed 08-03 / 08-10 / gap / 08-31 / gap pattern.

**Cheapest way to settle it, prove-the-instrument style:** pick one site repo as
a control and add `renovate/**` to its `ci.yml` push branches. If the grouped PR
opens on Monday 2026-09-14 in that repo and nowhere else, the missing-check-runs
theory is confirmed and the fix is a one-line change to the callers. A second,
non-destructive probe is a `workflow_dispatch` with `LOG_LEVEL=debug`, which
prints the `prBlockedBy` reason verbatim.

**Every existing instrument is green on this**, and that is the point.
`src/audits/protection-coverage.ts` has three Renovate surfaces — `renovateGaps`
(liveness: did the workflow run and succeed within 3 days? yes, 1626/1629),
`renovateBlockedGaps` (does the dashboard's "PR Edited (Blocked)" section name a
branch? no), `dashboardVocabularyGaps` (any unknown heading? no — and
`"awaiting schedule"` is already in `KNOWN_DASHBOARD_SECTIONS`). All three
verdicts are literally correct and jointly useless: the 2026-08-03 detector was
built for _"Renovate refuses to touch the branch"_, and this failure is
_"Renovate touches the branch every week and never opens a PR."_ **The parsed
dashboard type is `{present, blockedBranches, unknownSections}` — nothing reads
"Awaiting Schedule", nothing counts PR-less `renovate/*` branches, and nothing
measures days-since-last-merged-Renovate-PR.** The outcome check that would catch
both is one field away from the existing parser.

### 6.3 Volume, latency, and who merges [measured]

208 genuine Renovate PRs in the window (232 authored by the App minus 24
changesets "version packages" PRs on `changeset-release/main` — **`author ==
app/reddoor-renovate` is not the same as "Renovate opened it"**), 24% of all fleet
PR traffic.

```
FLEET Renovate: 208 PRs   merged=135  open=27  closed-unmerged=46 (22%)
time-to-merge (h): median 15.6   p25 12.3   p75 32.3   p90 66.1   max 76.0
```

The ~15 h median is the cron beat, not human latency. The ~66 h tail is the
grouped non-major PRs that a human must merge. Creation is bursty and has become
sparse: 78 PRs on Mon 08-03, 60 on Mon 08-10, then 2 / 0 / 16 / 0 on subsequent
Mondays, with off-Monday `[security]` waves on 09-02 (pnpm, 20 repos) and 09-09
(sharp, 32).

**46 closed-without-merge**, of which 34 are override-key misreads from
08-03/08-10. Rule 9 landed 2026-08-10 and **no non-security override-key PR has
appeared since** — that rule demonstrably works.

### 6.4 The `@reddoorla/maintenance` hold: still true, and what it costs [measured]

The never-automerge rule is present verbatim in the live preset, and
`@reddoorla/maintenance` appears in the all-non-major group of **24 of 26 live
dashboards**. Under `group:allNonMajor`, one held package makes the **entire**
grouped branch non-automergeable — so the grouped PR always needs a human plus a
green Netlify preview.

Cost on the last wave that actually happened (2026-08-10, 17 grouped PRs): median
time-to-merge **66–67 h**, max 76 h, `nReviews: 0` on **all 30** grouped PRs in
the window, `mergedBy: tucksravin`. So the hold buys ~50 h of latency and one
manual action per repo per wave **and delivers nothing in return, because the
human-review step it exists to force is not happening** — the merge is a click.

**Cost right now: zero**, because no grouped PR exists to be held. The binding
constraint has moved upstream, which is worth stating plainly so a meta week does
not spend its effort on rule 3 while the real blockage is §6.2.

### 6.5 Security updates bypass the `enabled: false` holds — twice proven [measured]

- **pnpm.** Rule 5 holds pnpm minor+patch at 11.8.x. On 2026-09-02 a `[security]`
  wave took **20 repos from 11.8.0 to 11.11.0 in three hours**, auto-merged by
  `reddoor-renovate` itself. Every default branch now reads `"packageManager":
"pnpm@11.11.0"` except the two archived repos. CI is green on it. **Rule 5 is
  now a stale hold** — its stated cause (`pnpm/action-setup`'s self-installer
  crashing on ≥11.9) no longer binds, since the action is pinned at v6.0.10 with
  no `version:` input and reads `packageManager` directly.
- **Overrides.** Rule 9 works for routine updates and was bypassed on 2026-09-09
  by 12 `sharp@<0.35.0 to ^0.35.4 [security]` PRs. **The preset documents the
  bypass for rule 5 and not for rule 9.** The next security advisory on an
  override key could arrive as a range-widening rewrite with automerge enabled
  and nothing in the config to stop it.

**One prior that was tested and falsified, and matters for the meta week.** The
standing fleet memory says never to merge a `pkg@<X to vY` Renovate PR because it
misreads pnpm override _keys_ (the brace-expansion/cookie class). The actual
diff on this wave preserves the key and bumps the value:

```diff
-  "sharp@<0.35.0": "^0.35.3"
+  "sharp@<0.35.0": "^0.35.4"
```

**That is correct — do not reject this wave on the strength of the title.** One
real collateral loss: the same diff silently deletes the file's leading comment
`# pnpm 11 reads settings from here (the package.json "pnpm" field is no longer
read).` — a comment that exists to stop an agent putting settings back in
`package.json`.

### 6.6 Housekeeping observed [measured]

- **17–18 orphaned pre-App Dependency Dashboards** are still open, one per repo
  that existed before the Renovate GitHub-App migration, authored by the old
  `tucksravin` self-hosted identity, last updated 2026-07-27 → 2026-08-12, still
  listing obsolete items (`typescript to v7`, `cookie@<0.7.0 to v2`). 42–44
  dashboards total for ~26 live repos. They inflate every per-repo open-issue
  count by one and are a trap for any dashboard-reading probe that does not pick
  the newest. `the-pointe#9` cannot be closed at all — that repo is archived.
- **`reddoorla/the-tower` is archived** and still on `pnpm@11.8.0` /
  `@reddoorla/maintenance ^0.80.0` with a live dashboard. `CLAUDE.md` and
  `scripts/fleet-repos.sh` name only `reddoor-mailer` and `the-pointe`;
  `the-tower` has no local checkout so the script cannot see it. See §10.3.
- **`composition-hospitality`** is an active org repo (`^0.80.0`, dashboard #15,
  4 open PRs) with **no local checkout** and no row in `repos.jsonl`. Any survey
  enumerating `~/Documents/GitHub` misses it.
- Two unwatched Renovate health warnings: `revogen`'s dashboard carries
  `## Repository Problems → ⚠️ WARN: Package lookup failures` (some dependencies
  are not being checked for updates at all, silently); `erp-industrial`'s carries
  `@prismicio/helpers` deprecated with `Replacement PR: Unavailable`.

---

## 7. The data layer and external integrations

### 7.1 Turso — live, healthy, backed up [measured]

The flip is `dadb0730` (2026-08-31), _"feat(db)!: THE FLIP — Turso is
authoritative; the hourly import retires with it (#612) (#643)"_.
`.github/workflows/fleet-db-sync.yml` was deleted in the same commit and the run
corpus contains zero `fleet-db-sync` runs. Recorded go/no-go evidence:
`FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`.

The whole fleet database is **929 rows across 11 tables**. This morning's backup
run (`34684089299`, 08:45 UTC):

```
DUMP_VERIFY loaded=true tables=11 rows=929 blob_bytes=7777769 mismatches=0   (plaintext)
DUMP_VERIFY loaded=true tables=11 rows=929 blob_bytes=7777769 mismatches=0   (decrypted .gpg)
FLEET_DB_USAGE plan=starter elapsed=37.33% … storage_bytes=0.67%
  worst=storage_bytes:0.67% threshold=50.00% blocked=none at_capacity=none verdict=ok
```

The plan has `overages: false`, so crossing a quota **blocks** reads and writes
rather than billing. At 0.67% of the worst ceiling that is a smoke detector, not
a concern.

**What is not wired:** `db parity`, `db sync` and `db import-airtable` still exist
as CLI actions but **no workflow, cron or script invokes any of them**. There is
no automated divergence check between the Airtable shadow and the authoritative
Turso. The last parity proof is the one recorded at the flip, now 12 days old.

**The nightly dump is not redacted** — per-site secrets (`mailchimp_api_key`,
`newsletter_webhook`) live in the database row, not an env file, and
`src/db/dump.ts` has no redaction path. `BACKUP_PASSPHRASE`/gpg is therefore
load-bearing rather than hygienic.

### 7.2 Airtable is not gone, and the operator believes it is [measured]

Base: **Websites** (113 fields, 45 rows), **Reports** (46 fields, 17 rows),
**Digest State** (3 fields, 1 row), **Submissions** (13 fields, 48 rows),
**Spam Screenouts** (5 fields, 0 rows).

Live status per table:

- **Websites — fully live**, the fleet roster. Written at **2026-09-12 13:41:45**,
  three hours before the survey.
- **Digest State — fully live.**
- **Reports — live-ish.** 17 rows, all `delivered`; newest `Sent at`
  2026-09-01T14:13:33 — i.e. the first post-flip send landed and the Resend
  webhook wrote its status back after the flip. A proven-once instrument.
- **Submissions — dead.** 48 rows, newest `2026-06-23`. Leads moved to Turso at
  the Option-C hybrid cutover; nothing has written this table in three months.
- **Spam Screenouts — empty.**

Where Airtable is load-bearing in code: **52 files import `reports/airtable/`**
(100 import lines, 39 of them `import type`, so **61 value imports**). The layer
is **2,300 LOC across 7 files**, `websites.ts` alone 1,204. **Seven Netlify
functions read `AIRTABLE_PAT`.** Env-var reads across `netlify/`: 19 ×
`TURSO_DATABASE_URL` vs 9 × `AIRTABLE_PAT`.

The hardest coupling is that **the Turso read path imports from the directory
Phase 6 deletes**: `src/db/fleet-state.ts:40-59` value-imports `canonicalizeStatus`,
`parseNotifyRouting`, `parseSecurityAdvisories`, `toFrequency`, `siteSlug` and the
report coercers from `src/reports/airtable/*`, and those run inside `rowFromJoined`
on **every lead read**.

**The naming lie.** Issue #698 counts **1,835 occurrences of "airtable"** across
~51 files and directories, including the user-facing flag `--write-airtable` on
four commands. The issue records the failure twice in one 2026-09-04 session and
the operator's own correction — _"why are you writing to airtable, we don't use it
anymore"_ — alongside the 2026-09-05 prompt _"yes, but airtable is no longer in
our stack"_. Both things are true at once: `--write-airtable` **is** how you write
Turso, and it still writes Airtable too. **The vocabulary overtook the code, and
the mental model followed the vocabulary.**

### 7.3 Phase 6 (#646) — the one large deletion, open and due [measured]

**OPEN. Created 2026-08-31T23:57:41Z. `updatedAt` identical. 0 comments, 0 labels,
no linked PR.** Nothing has touched it in 12 days. Its gate: _"Execute only after
a clean post-flip week — this ends the rollback window."_ The window closed around
**2026-09-07**; the week was clean; **the precondition is met and the work has not
started.** `src/db/freeze.ts:44-48` still describes the Airtable write as "kept as
the shadow for the one-week rollback window" — a comment that has outlived its own
claim by five days.

Walked step by step against the code:

| #   | step                                                   | state           | evidence                                                                                |
| --- | ------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------------- |
| 1   | relocate pure helpers out of `src/reports/airtable/**` | **not started** | `src/db/fleet-state.ts:40-59`                                                           |
| 2   | port `resend-webhook` to Turso                         | **not started** | `netlify/functions/resend-webhook.mts:69-73` still returns `500 "Airtable env missing"` |
| 3   | Turso-native `ensure-site`                             | **not started** | `src/reports/airtable/ensure-site.ts:80` creates in Airtable, then mirrors              |
| 4   | batch enumeration off Airtable                         | **not started** | all four sweeps pass `--fleet airtable`; no `src/inventory/turso.ts`                    |
| 5   | remove `form-ingest`'s Airtable hard gate              | **DONE**        | `8a4b0d73` (#669) — now gates on `TURSO_DATABASE_URL` only                              |
| 6   | delete shadow writes + the layer                       | **not started** | 2,300 LOC, 52 importing files                                                           |
| 7   | sweep stragglers                                       | **not started** | 39 type-only imports remain                                                             |
| 8   | docs + close #539/#612                                 | **not started** | both still OPEN                                                                         |
| —   | nightly Turso usage alarm                              | **DONE**        | `5b4befc5` (#634)                                                                       |

**2 of 10 done, both incidentally by other work.** The dependency-ordered
checklist proper has not been entered. Step 4 is why an Airtable quota event still
reds fleet-security, fleet-lighthouse, fleet-smoke and fleet-form-e2e — including
"the one instrument that catches a 404ing lead path" (#646's own words). The
fleet has already seen this exact failure once: one Airtable quota event reddened
six workflows, presenting as unrelated timeouts with nothing named Airtable.

### 7.4 The forms/lead pipeline, and where its coverage stops [measured]

Shape: site `/api/forms/+server.ts` → central `POST /api/forms/:slug`
(`netlify/functions/form-ingest.mts`, path-routed, rate-limited 120/60s
`aggregateBy ip`) → `verifyFormsToken` → `openDb` → `makeSiteLookup` (Turso-only)
→ screen-out beacon / Turnstile / `ingestSubmission` → `createSubmission`,
`classifySpam`, Resend notify, newsletter webhook, Mailchimp, `stampNotified`.

**`fleet-form-e2e` covers 6 of 13 maintained sites.** Run `34696929623`
(2026-09-12 13:37–13:42):

```
pass  msot · espada · vineyard-custom-homes · 1836dig · reddoor · beachfront-dentistry
skip  data-dynamiq · erp-industrials · la-homelessness-youth · revogen ·
      sonder · la-homelessness-initiative · caltex
      "site /health does not declare forms.testMode — probe refused"
```

Cross-checked independently against the local checkouts
(`grep -c testMode <repo>/src/routes/health/+server.ts`): **exactly the same 6/7
split.** Two of the seven are the accepted formless cases (CalTex, LA-H Youth,
per the operator's "no form, no Turnstile" ruling). **Five maintained sites with
real contact forms — data-dynamiq, erp-industrials, la-homelessness-initiative,
revogen, sonder — have no end-to-end lead-path coverage at all.** `sonder` is a
paying client channel; on `data-dynamiq` and `la-homelessness-initiative` the
fleet has never recorded a submission, so "working" has never been observed there
by any means. **There is no open issue tracking the `testMode` rollout.**

**Issue #645 — the lead-path gap — is open and verified unfixed item by item:**

1. **`ensure-site` resume gap.** The `exists` branch does no `getSiteBySlug`
   check and no mirror heal, so if the Turso insert failed on the first run the
   re-run reports `exists` and `/new-site`'s verification reads it as success.
   Post-flip that site's leads are unrecoverable, because `src/forms/site-lookup.ts:46`
   no longer falls back to Airtable when `strict` (which defaults to
   `TURSO_IS_AUTHORITATIVE === true`).
2. **`unknown-site` persists nothing.** `src/forms/ingest.ts:195` is
   `if (!site) return { status: "unknown-site", slug };`, and the docblock above
   defends it: _"A lookup that RESOLVES to null is still unknown-site — the store
   answered, and a junk slug is a rejection, not a lead to save."_ That reasoning
   was correct **before** the flip. It is now the sentence that loses the lead.
   The dead-letter path immediately above fires only when the lookup **throws**.
3. **`db replay-deadletters` resolves against frozen Airtable** — it imports
   `getWebsiteBySlug` from `reports/airtable/websites.js`, not `makeSiteLookup`.
   The recovery path and the live path disagree about what the fleet is.
4. **`sites.name` is immutable** — `EDITABLE_SITE_FIELDS` lists 21 fields and not
   `name`, so a badly-named bootstrap sends client lead notifications from
   `"acme-co Forms <…>"` forever. Spun out as #664.

**And nothing watches for any of it.** No alarm consumes `submission_deadletter` —
the attention-item kinds (`src/alerts/attention.ts:40-52`) are `analytics`, `ci`,
`delivery`, `lighthouse`, `notify-bounce`, `preflight`, `prismic-drift`,
`renovate`, `turnstile`, `vuln`. **No `deadletter`. No `form-e2e`. No
`unknown-site`.** A dead-lettered lead is visible only to someone who runs
`reddoor-maint db replay-deadletters` by hand — and the dead-letter table has
**never had a row**, which by this repo's own rule makes it an untested assertion
rather than an instrument.

### 7.5 Prismic [measured]

Nightly `fleet-prismic-drift` ran 2026-09-12 08:58 with **zero drift fleet-wide**:
9 checked, 0 failed, 4 skipped (no Prismic config), of 13 sites.

Credentials resolve by **Prismic repository name**, not directory name
(`src/prismic/models/token.ts:27-39`): `medical-solutions-of-texas` → `MSOT`,
`reddoor-website` → `REDDOOR_LA`, `beachfront-dentistry` → `48BB12D1`. Fleet mode
passes `allowGeneric: false` so a stray `PRISMIC_WRITE_TOKEN` cannot cross-wire 18
repos onto one credential. **Three naming schemes coexist and only one is read by
code**: the 16 `PRISMIC_TOKEN_*` Actions secrets ✔, the 11 in `credentials.env` ✔,
and **11 keys in the repo `.env` named `<SITE>_PRISMIC` that match nothing the
code reads** — seed material retained after its purpose ended.

**The coverage trap, already corrected in the journal:** the 16-line env block is
**not** a 16-site coverage list, because `--fleet airtable` resolves only
`maintained` sites. `alamo-anatomy`, `hedloc` and `the-pointe-burbank` all have a
minted secret and an env line and none is swept. The journal entry that records
this (2026-09-09, _"A minted secret nobody read, and the coverage it does not
buy"_) also notes the discipline worth copying: the issue claimed 11 env entries,
the real number was 15, _"confirmed twice"_.

### 7.6 Netlify, Resend, Turnstile, GA/Search Console, Discord

**Netlify [measured].** `Deploy status: ready` on 12 of 13 maintained sites.
Beachfront Dentistry's null `Netlify ID` (§3.4) means its deploy has never been
probed. The audit's failure semantics are well-designed: `{ok: false}` (couldn't
read) is a distinct type from `{ok: true, deploy: all-nulls}` (genuinely no
deploy), so a transient API blip cannot clear a real `error`. **Open trap:** #710
— _"`netlify env:set --site <id>` exits 0 and writes nothing — a false green in
every runbook that uses it"_ — unfixed, and directly upstream of the `testMode`
rollout work.

**Resend [measured].** Last real send 2026-09-01T14:13:33Z, `delivered`; all 17
Reports rows delivered, none stuck. Today's run printed `No reports due.` — which
is correct, not broken: next-due is anchored on the last `Sent at` plus the
frequency, and the six 2026-08-24 quarterly sends put the next batch around late
November. **Worth naming anyway: the send path will not self-exercise again for
~10 weeks, so if Phase 6 breaks it, the break will be discovered in November.**
`netlify/functions/resend-webhook.mts:69-73` still hard-gates on `AIRTABLE_PAT` —
the same shape #669 removed from form-ingest, and #646 step 2.

**Turnstile [measured + one unverified].** Central `TURNSTILE_SECRET_KEY`, `_2`,
`_3` tried in order; the retry is safe because `invalid-input-secret` does not
consume the single-use token (verified empirically 2026-07-28). #695 moved the
`Turnstile widget` verdict from an env-var truthiness check to `form-e2e`, which
drives real Chromium — a strict improvement. **But the column is now empty on all
45 Websites rows**: `function-health` writes `null` whenever the flag isn't
literally `false`, and `form-e2e` only opines for the 6 sites it can probe and
found no rendered widget on any of them. Consequence: **the red guardrail
(`requireTurnstile && turnstileWidget === "fail"`) currently cannot fire for any
site**, and the only site with `Require Turnstile: true` is Reddoor, whose verdict
is blank. Whether Reddoor's live widget renders is **[unverified]** — it needs a
browser against the live page. Separately, `TURNSTILE_SITE_KEY_1` in the repo
`.env` is an **active trap**: it is widget "Forms 1", full since before the
runbook existed (10-hostname free-tier cap), and copying it into a new site
produces the silent-110200 state — which it did on 2026-09-04 on
vida-legacy-foundation (#689).

**GA + Search Console [measured].** Service-account key + `GA_SUBJECT` failover.
Fill rate: `GA4 property ID` on **11 of 45** rows (8 of 13 maintained — missing on
1836dig, Data Dynamiq, LA-H Initiative, Revogen); `Search Console property` on
**1 of 45** (Reddoor). So Search Console enrichment is effectively a one-site
feature. The only GA credential proof is the dispatch-gated ANALYTICS check
(§5.4e), so **GA credentials are unproven since whenever the last manual preview
was run** — a date the surveys could not establish.

**Discord [measured].** **There is no code.** `grep -rln "DISCORD\|discord.com"
src/ netlify/ scripts/ .github/` returns zero files. The entire integration is a
paragraph of prose in `CLAUDE.md` telling an agent to curl
`https://discord.com/api/v10`. It works: the corpus pulled **109 channels and 688
messages** today with a zero-byte error log (2026-07: 41 messages, 2026-08: 441,
2026-09: 206; top authors `nicole_35266` 202, `timholmes_62898` 187, `tucksravin`
178). It is simultaneously the healthiest and the least-engineered thing in the
fleet: no code means no test, no version, no enumerated failure mode, and a
credential whose only documentation is a prose paragraph that has already been
wrong once. The standing gotcha: Discord **403s Python-urllib's default UA
silently** — a urllib scan of all 109 channels once returned "0 hits" with no
error.

### 7.7 Credential topology — what the disk actually shows [measured]

`~/.config/reddoor-maint/credentials.env` holds **26 keys** (mode 600, modified
2026-09-01). The repo `.env` holds **33** (modified 2026-08-31). No secret values
were read; these are key-name enumerations.

1. **The rule "credentials live in `~/.config`, Discord is the exception" is not
   what the disk shows.** The repo `.env` holds `AIRTABLE_PAT`,
   `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, `NETLIFY_PAT`, `CLOUDFLARE_PAT`,
   `FORMS_INGEST_TOKEN` and 11 Prismic tokens. **Discord is one of many
   exceptions, not the exception.**
2. **Nine keys are duplicated across both files** with no sync mechanism.
   `process.env` wins over the file, so which value is live depends on how the
   shell was started.
3. **Four repo-`.env` keys are consumed by nothing:** `DROPBOX_ACCESS_TOKEN` and
   `FIGMA_PAT` (0 references anywhere), `GOOGLE_SEARCH_API_KEY` (referenced only
   in two 2026-06 design docs that call it obsolete), `TURNSTILE_SECRET_KEY_1`
   (the code reads the unsuffixed name).
4. **Two names per service, repeatedly.** Netlify: code reads `NETLIFY_PAT` from
   the repo `.env`; `credentials.env` holds `NETLIFY_AUTH_TOKEN`, the name the
   Netlify CLI reads natively, which no code in this repo reads. Same pattern for
   Prismic and Turnstile.
5. **`TURSO_FLEET_USAGE`** — the _platform_ token, strictly more privileged than
   the database token and the only one that can read quota — exists **only** in
   the repo `.env`.
6. **Known-bad, open:** #650 — `credentials.env`'s `GITHUB_TOKEN` returns 401.
   Recipes that `gh api` with it fail.

---

## 8. Agent and automation tooling

### 8.1 There is no project-level agent tooling at all [measured]

This inverts the natural assumption and is the most surprising structural fact in
the survey set.

```
$ ls -la reddoor-maintenance/.claude/
settings.json          5210B   Jun 24
settings.local.json   14200B   Sep  1
.cc-writes/ (empty)    worktrees/ (empty, created Sep 1)

$ find ~/Documents/GitHub -maxdepth 4 -type d \( -name commands -o -name agents -o -name hooks \) -path '*.claude*'
(no output)
```

No `skills/`, no `agents/`, no `commands/`, no `hooks/` in any repo. `.claude/` is
gitignored, so `git ls-files .claude` returns 0 files. **The project's agent
configuration is one settings file, untracked** — while `CLAUDE.md` beside it was
deliberately moved _into_ version control in #699. The reasoning that won for
CLAUDE.md was never extended to the settings.

The real tooling lives in three places: **7 personal skills** symlinked from
`reddoorla/claude-skills` (version-controlled), **8 marketplace plugins carrying
64 skills** (vendored, pinned by SHA), and **11 repo scripts + 13 recipes + the
32-command CLI** (version-controlled, tested).

**There are no custom slash commands anywhere on this machine.** Ground truth from
3,581 raw transcripts: the only slash commands ever used are Claude Code built-ins
(`/compact` 291, `/model` 99, `/extra-usage` 3, `/update-config` 2). Where
`CLAUDE.md` and `MEMORY.md` write `/new-site` or `/markup-review`, those resolve to
_skills_. The three `superpowers` commands that do exist are all deprecation
tombstones, still advertised in every session's roster.

### 8.2 The usage instrument had to be fixed before it could be trusted [measured]

The corpus's `skills` array is **exact for what it measures** — Skill-tool loads,
336, matching the raw-transcript count exactly. It badly understates skills that
carry executable scripts, because those are driven by Bash path instead:

```
matching-a-page      2,467 path refs across 97 transcripts   — 0 Skill-tool loads in window
markup-review        1,599 refs across 38
new-site               409 refs across 62
rfp-analyze            258 refs across 23
svelte4-to-5-upgrade    71 refs across 21
figma-slices            61 refs across 23
evening-review          28 refs across 17
```

**`matching-a-page` is the most exercised tool on the machine and records zero
Skill-tool loads.** Any inventory reading only the `skills` array would declare it
dead.

Skill-tool loads over 34 days: `superpowers:brainstorming` 58,
`superpowers:writing-plans` 45, `superpowers:subagent-driven-development` 40,
`artifact-design` 37, `figma:figma-design-to-code` 31,
`superpowers:test-driven-development` 22, `evening-review` 19, the rest in single
digits. **23 distinct skills invoked out of 64 advertised**, and **only 53 of 872
top-level sessions (6.1%) load any skill at all.** Use is wildly uneven by repo:
`reddoor-website` 123 sessions → 84 skill loads; `caldea` 206 → 2; `the-bench`
49 → 0.

**Subagents:** 1,040 `general-purpose`, 249 `superpowers:code-reviewer`, 35
`Explore`, 20 `episodic-memory:search-conversations`, 3 one-off named agents.
Only three agent _definitions_ are installed and **none is Reddoor-authored** —
no fleet-triage agent, no site-onboard agent, no journal-writer — despite
"default to subagent-driven" being standing policy.

### 8.3 Per-skill verdicts, and two that have no job left [measured]

- **`svelte4-to-5-upgrade` — stale, no targets.** Its description scopes it to
  projects "still on Svelte 4 / Vite 5 / Tailwind 3". Measured across all
  checkouts: **27 sites on Svelte 5, zero on Svelte 4.** It also encodes a drifted
  pin (`svelte@^5.23.0` vs the starter's `^5.55.10`). 17.8 KB of roster with no
  live target and zero invocations in 34 days.
- **`rfp-analyze` — live but structurally odd.** The only skill whose working
  directory is a separate repo, and that repo is the one checkout with **no
  `origin`**. The skill source is safe in `claude-skills`; the estimates workspace
  it generates is backed up nowhere.
- The skills repo itself (`reddoorla/claude-skills`, created 2026-09-08) is **the
  healthiest thing in this dimension**: symlinks not copies, an idempotent
  `install.sh` that refuses to clobber a real directory, and a header explaining
  precisely why the plugin/marketplace layout was rejected (it namespaces to
  `reddoor:<name>` at a versioned cache path, breaking every hardcoded
  `node ~/.claude/skills/<skill>/x.mjs` in a SKILL.md). Because the repo is four
  days old, **git dates cannot measure skill staleness** — content tests were used
  instead.

### 8.4 The plugin layer, and one thing that is genuinely broken [measured]

| plugin                                 | version | skills | hooks                                                                        | MCP calls / 34d |
| -------------------------------------- | ------- | -----: | ---------------------------------------------------------------------------- | --------------: |
| context-mode                           | 1.0.166 |      8 | PostToolUse, PreToolUse ×9, UserPromptSubmit, PreCompact, SessionStart, Stop |       **4,006** |
| superpowers-chrome                     | 3.0.2   |      1 | —                                                                            |       **1,774** |
| figma                                  | 2.2.108 |     14 | —                                                                            |             502 |
| episodic-memory                        | 1.0.15  |      1 | SessionStart                                                                 |             139 |
| superpowers                            | 5.0.7   |     14 | SessionStart                                                                 |    n/a (skills) |
| superpowers-developing-for-claude-code | 0.3.1   |      2 | —                                                                            |               0 |
| claude-session-driver                  | 3.0.2   |      1 | PreToolUse(`*`), SessionStart, Stop, UserPromptSubmit, SessionEnd            |           **0** |
| **claude-mem**                         | 13.5.5  | **16** | Setup, SessionStart, UserPromptSubmit, PostToolUse, PreToolUse, Stop         |           **4** |

**`claude-mem` has been dead since the day after it was installed.** Its own log
says `Bun runtime not found`; independently verified (`which bun` → not found,
`~/.bun/bin/bun` → no such file). **71 of 73 daily logs carry the error, 282
occurrences, first on 2026-06-11.** Its data directory has never been written. It
recorded 4 MCP calls in 34 days, all searches that cannot have returned anything.
Meanwhile it installs six hook events including `PreToolUse` and `PostToolUse` — a
process spawn on essentially every tool call — and contributes **16 skills /
3,943 bytes** to the roster of every request. It is pure cost, and its 16 skills
duplicate things that work (`make-plan`/`do` vs `superpowers:writing-plans`/
`executing-plans`; `mem-search` vs `episodic-memory:search`; `smart-explore` vs
`context-mode:ctx_search`).

Three plugins compete for the same hook surface (`context-mode`, `claude-mem`,
`claude-session-driver` each register PreToolUse + SessionStart + Stop +
UserPromptSubmit; `claude-session-driver` matches `*`). **Two of the three have
zero measured usage.** Only `context-mode` earns its hooks, and earns them
decisively (4,006 calls, `ctx_execute` alone 3,119).

### 8.5 Five memory layers, and the fixed per-request cost [measured]

1. `~/.claude/CLAUDE.md` (1,239 B) — global machine notes
2. `reddoor-maintenance/CLAUDE.md` (11,261 B) — project rules, tracked since #699
3. `MEMORY.md` auto-memory (20,327 B index + **119 files / 884 KB**)
4. `docs/workJournal.md` — the durable narrative record
5. `episodic-memory` (works) + `claude-mem` (broken) + `context-mode` session DBs
   (828 files)

```
global CLAUDE.md      1,239 B
project CLAUDE.md    11,261 B
MEMORY.md            20,327 B
skill roster         18,452 B   (64 skills' frontmatter, enabled versions only)
                     ───────
                     51,279 B  ≈ 12,800 tokens before a single word of the task
```

The global CLAUDE.md opens by saying it is "kept deliberately short" because
"context loaded into every session on this machine is paid for on every request
whatever the task." **That discipline was applied to the 1.2 KB file and not to
the 20 KB `MEMORY.md` sitting beside it — 16× larger than the file whose header
states the rule.** Roster cost by owner: figma 6,197 B (of its 14 skills, 2 are
ever used), claude-mem 3,943 B (of 16, zero), personal 2,899 B, context-mode
2,423 B, superpowers 1,974 B.

### 8.6 Repo scripts and worktree hygiene [measured]

Of 11 files in `scripts/`, **7 are live** (2 imported by `smoke-dist.mjs`, 1 is
`test:dist`, `fleet-repos.sh` is mandated by `CLAUDE.md`, 3 are manual probes, 1
generates the match-harness template and is covered by a test) and **3 are
orphans with no caller anywhere** (`webflow-fixtures.mjs`,
`verify-header-fidelity.mjs`, `build-header-plate.mjs` — 290 lines). Two of the
three are orphaned _by design_ (the header-image plan annotates them "one-time,
offline … Not shipped") but nothing in the file tree marks that, so a future
session cannot tell an intentional one-shot from a regression. **No workflow calls
any script.**

`fleet-repos.sh` was proven working — and proving it caught a flaw in the
_probe_, not the script: the first attempt piped to `head` and read `head`'s exit
code as the script's. Re-measured without the pipe, the script fails loudly and
correctly under the sandbox (`mktemp: mkdtemp failed … Operation not permitted`,
exit 1) and unsandboxed produces exactly the documented table. **The real friction
is that under the project's own `sandbox.enabled: true`, `$TMPDIR` is not
writable, so the script cannot run at all and an agent gets a cryptic `mkdtemp`
error instead of the table.** `git *` and `gh *` are in `sandbox.excludedCommands`;
`scripts/*.sh` is not.

**Worktrees: four roots, no convention.** `git worktree list` in the central repo
shows sibling directories (`-e2ebudget`, `-turso-spec`), `.claude-worktrees/`,
`.worktrees/`, plus an empty `.claude/worktrees/` started and abandoned.
`.gitignore:31` ignores `.worktrees/` with a comment explaining that an untracked
worktree directory "was the ONLY entry in `git status`, which trains the eye to
ignore a dirty tree" — and **the `EnterWorktree` tool writes to
`.claude-worktrees/` instead, which is not ignored and reintroduces the exact
condition that comment was written to eliminate.**

**And it breaks `pnpm lint` in the main checkout right now** [measured].
Prettier 3 honours `.gitignore`, so an unignored `.claude-worktrees/` makes
`prettier --check .` re-lint a whole second copy of the repo and hard-**error** on
a Webflow fixture, because `.prettierignore`'s `tests/webflow/fixtures/` is a
relative path that does not match `.claude-worktrees/*/tests/webflow/fixtures/`.
A second untracked throwaway, `fmt.mjs`, is also not prettier-clean. CI is
unaffected (fresh checkout), so this is local-only friction — **but it means an
operator's `pnpm verify` reds on neither a type error nor a test, which is exactly
the signal that trains you to stop reading the gate.**

---

## 9. Documentation and the written record

### 9.1 What exists [measured]

```
docs/superpowers/specs/    56 files    804 KB    92,474 words   2026-06-01 → 2026-09-09
docs/superpowers/plans/    84 files    3.9 MB   482,367 words   2026-05-20 → 2026-09-09
docs/morning-reports/      16 files    400 KB   2026-05-22 → 2026-09-02
docs/runbooks/              6 files
docs/decisions/             1 file     (2026-06-09-mjml-supply-chain.md)
docs/workJournal.md        22 entries  20,244 words   2026-09-05 → 2026-09-11
docs/autonomy-journal.md   62 rows      4,043 words   2026-06-10 → 2026-09-09
AUTONOMY.md  161 lines (last touched 2026-08-14) · CLAUDE.md 213 lines (2026-09-08)
```

**The corpus is lopsided.** The plans directory is 3.9 MB — 24× the work journal
and 5× the specs. A single plan
(`2026-08-12-prismic-headless-model-delivery.md`, 249 KB) is larger than every
runbook combined. **The plans are where the thinking is written down; the journal
is where the outcome is. Thinking outweighs outcomes 24 to 1.**

### 9.2 The obvious instrument is dead, and two more lied [measured]

```
plans=84   ticked_boxes=81   unticked_boxes=3,572   total=3,653   (2.2% ticked)
plans with ≥1 tick: 9        plans with boxes but zero ticks: 70
```

`2026-07-01-forms-spam-defense.md` carries 108 unticked boxes and describes a
system live since #348. Plans are ticked in the executing agent's context and the
ticks are never written back. **A plan file cannot tell you whether it ran.**

The second instrument — "do the source paths this plan names exist?" — failed on
its first run and nearly shipped as a finding: it scored seven plans at 0%, all of
which resolve against a _different repo_. Re-run across all 41 checkouts,
`2026-07-05-blux-pipeline-plan1-slices.md` scores 21/21 in `the-pointe`. A third:
grepping `src/` for `autoreply|auto_reply|auto-reply` returned nothing and nearly
condemned a plan that shipped the same day it was written — the code calls the
feature `reply-copy.ts`. **Three instruments, three false FAILs, zero true ones
on first run.** The instrument that works is the git log, cross-referenced per
feature.

### 9.3 Status of the written intentions [measured]

- **DONE — 46 of 56 specs, ~72 of 84 plans.** The whole May–August arc is
  executed, spot-checked against commits.
- **IN FLIGHT — 3.** Report-edits plan B (landing right now in `reddoor-website`
  #181; the local checkout's `origin/main` ref is stale, which is what made it
  look unbuilt); Webflow pipeline plan E (partially landed via #725/#746/#750, 103
  unticked steps, no status line); **Turso Phase 6** (§7.3).
- **NOT EXECUTED — 2, and one is load-bearing.**
  **`plans/2026-09-08-webflow-pipeline-d-seed-sync.md` (154 KB, 73 steps) is not
  built**: there is no `src/prismic/seed/`, no `prismic-seed` CLI command, 15 of
  its 25 named files absent. **And downstream work was already built on top of
  it** — the live client site `29-navy` carries commit `fe87d1f5`, titled
  ``docs: `reddoor-maint prismic-seed` does not exist, in five files``, pulling
  the claim out of `src/lib/site-pages.js`, `slice-zone.test.ts` and
  `svelte.config.js`. **Plan D's existence made the command feel real to the
  sessions building the components around it.** The second is approve-loop UX
  proposal 2 (approve from cockpit + bulk approve), unbuilt and unrecorded for 10
  weeks while proposals 1 and 3 from the same document shipped.
- **ABANDONED — 0 found.** The closest calls are documented departures, not
  silent drops.
- **"No plan file" predicts nothing.** Seven specs have no plan; five of the seven
  shipped, two of them the same day the spec was written. Worth stating because it
  is the first proxy anyone reaches for.

### 9.4 The journal convention is working; the autonomy journal is not [measured]

`docs/workJournal.md` opened 2026-09-05 (#699). **Coverage since it opened is
complete**: every working day with merged work has at least one entry (09-05 2/2,
09-08 3 entries/12 commits, 09-09 9/9, 09-10 4/10, 09-11 2/6). The never-edit rule
holds — `git log -p` shows appends only. Entry titles are **defect-first**, which
makes the file greppable for exactly what is expensive to rediscover: _"The gate
said ALL DONE over runs that never happened (#744)"_, _"A minted secret nobody
read, and the coverage it does not buy (#746)"_. The first entry's explicit trust
boundary — _"detail below this line is trustworthy; detail above it is not"_ over
743 summarised commits — is the single best piece of epistemic hygiene in the
corpus.

The convention went fleet-wide on 2026-09-05: **41/41 checkouts have a
`docs/workJournal.md`, 32 adoption PRs merged that day.** Three repos hold it
**only on a local, never-pushed branch** — exactly the three `CLAUDE.md` names as
unpushable (`reddoor-mailer`, `the-pointe`, `rfp-analyze`). The rollout did the
right thing and stopped; **this document is the only place that fact is
recorded.** 29 repos are still at exactly one entry.

**`docs/autonomy-journal.md` is the one written contract not being kept.**
`AUTONOMY.md:118` makes it mandatory ("append what + why … so the whole run is
reviewable fast"). Measured: 44 rows for June, 11 for July, **0 for August**, 7
for September — against **135 merged PRs in August** (116 human) and 55 human
merges in September. The 51-day gap is the month of the `src/db` layer and THE
FLIP, a `feat(db)!` breaking change: the highest-risk merge sequence in the repo's
history, and the contract's "so any one change is easy to find and `git revert`"
index skips it entirely. The work is not undocumented — CHANGELOG, commit log and
the migration plan have it — but the specific artifact the contract requires does
not exist for that month.

### 9.5 Documents that are stale in a way that steers sessions [measured]

**`CLAUDE.md:206-213` is the highest-leverage stale paragraph in the corpus**,
because that file is loaded into every session on this machine. All three of its
claims are now false:

1. _"Scheduled for the weekend of 2026-08-22"_ — it flipped 2026-08-31 (#643).
2. _"Design and plan are on branch `docs/airtable-to-turso-spec`"_ — both have been
   on `main` since `efb73eb9` (2026-08-26). **Main's copies are longer**: 308 vs
   292 lines for the spec, 191 vs 127 for the plan; the branch copy is 175 lines
   behind. Following the pointer gets you the superseded text — the failure mode
   hardest to notice.
3. _"Do not start it early"_ — Phase 6 is now **overdue**, and this paragraph
   reads as an instruction not to touch it.

The dead branch is also **checked out in a live worktree**
(`reddoor-maintenance-turso-spec` @ `4f5f1a14`, 156 commits behind main) — the
exact "a stale worktree poisons archaeology" hazard already in memory, here
reinforced by a `CLAUDE.md` line that _tells_ a session to go read the stale one.

**The retracted merge instruction is still live in the spec and the plan.**
`CLAUDE.md:194` carries the corrected rule (cherry-pick, never merge) and closes
by pointing at `specs/2026-08-31-starter-track-split-design.md` — which still says
at lines 72-74 that shared improvements "are pulled into the Blux repo with
`git merge starter/main`", and at 79-82 predicts the conflict surface will be
"small and localized", which the 2026-09-01 verification falsified in the worst
possible direction (it was not small, it was _zero_). The companion plan repeats
the instruction twice. **Neither file carries a forward pointer**, although the
repo invented exactly that affordance (`> Superseded in part by …`) for journal
entries and has not applied it to specs and plans — which is where this particular
reader lands, because `CLAUDE.md` sends them there.

**A plan asserted a "verified" fact that was false when written.**
`plans/2026-09-08-webflow-pipeline-bc-harness.md:31` states, in an Assumptions
block, that `reddoor-maintenance` has "no `docs/workJournal.md` (verified)". The
file was created 2026-09-05; the plan was committed 2026-09-08. The line still
stands on `main`, and Task 17 of that plan therefore instructs a future agent to
journal into the wrong file.

Other freshness: `docs/SETUP.md` last touched 2026-07-31 (predates Turso, Google
sign-in, prospect audit); the strategic direction doc
(`specs/2026-06-02-fleet-scale-roadmap.md`) last touched 2026-06-10 with no `✅`
markers added in three months; **`docs/morning-reports/` has a 7-week gap
2026-07-06 → 2026-08-26** covering the entire Turso build — the evening-review
ritual that produces them stopped and restarted with nothing in between.

### 9.6 There is no hidden second backlog [measured, with the instrument proved]

```
$ grep -arnE '\b(TODO|FIXME|XXX|HACK)\b' src --include='*.ts' … | wc -l    → 0
$ grep -arnE '\b(TODO|FIXME|XXX|HACK|export)\b' src --include='*.ts' …     → 2,175
```

Same pattern, same flags, same 379-file set: 2,175 hits with `export` added, 0
with the markers alone. The grep is not blind (`-a` throughout, because BSD grep
on this machine goes silently binary-blind on em-dash files). Widening to
`src tests scripts` yields 5 hits, all false positives (Airtable record-id
placeholders). Across 22 site checkouts: 7 markers total.

**This is a real property of the system.** Deferred work here is externalised into
GitHub issues and the journal and never left as a code comment — which is why the
issue tracker _is_ the backlog, with no second channel.

---

## 10. Where the nine surveys disagree

Stated rather than reconciled, because in several cases the disagreement is the
finding.

**10.1 — Is the Renovate grouped channel broken, or waiting?**
`inv-03` calls `group:allNonMajor` **broken**: last grouped PR 2026-08-10, five
Mondays with none, 23 of 24 repos holding a PR-less branch, with an inferred
mechanism (§6.2). `inv-09` measured the **same branch facts** and deliberately
declined to assert a freeze: the dashboards list these under `## Awaiting
Schedule`, "so Renovate's own view is 'these are waiting for their window', which
is benign … I could not prove why a branch exists at all for an out-of-window
update." `inv-02`, reasoning about a different symptom (only 1 of 22 repos has
taken the shared CI v1.4.2 tagged three days ago), concluded **"normal Renovate
Monday-window latency, not drift."**

These are not the same claim, and the crispest test is `inv-02`'s: **v1.4.2 rides
the grouped non-major channel.** If `inv-03` is right, it will not arrive on
Monday 2026-09-14 either. **Both surveys independently propose the same
experiment** — re-run the ref scan on Monday and see whether the ~90 PR-less
branches convert. Until then: the PR drought is **[measured]**, the mechanism is
**[inferred]**, and "benign" is **[unverified]**.

**10.2 — How many open `sharp` security PRs, and how old?**
`inv-09`: **26 PRs across 14 repos**, opened 2026-09-10, from the local-checkout
corpus plus live `gh`. `inv-04`: **27 of 32 open fleet PRs**, created 2026-09-09.
`inv-03`: **31 sharp/imagetools-core PRs across 17 repos**, 34 open bot PRs
org-wide, age 3.6–3.7 days, from live org-wide GraphQL. The gap is **scope**:
`inv-03` enumerated the GitHub org (which includes `composition-hospitality`,
`the-tower` and other repos with no local checkout); the other two enumerated
`~/Documents/GitHub`. **Use `inv-03`'s org-wide figure when asking "how much
exposure is open" and the local figure when asking "how much is in front of me."**
The one-day date difference is unresolved and does not matter.

**10.3 — Should this wave be rejected on sight?**
`inv-04` reads the 13 override-key PRs as "the guard that was supposed to prevent
exactly this class of PR did not prevent it", with the bypass mechanism explicitly
labelled inferred. `inv-09` §7.3 **tested the prior and falsified it**: the diff
preserves the override key and bumps the value, which is correct; had it stopped
at the title, "the correct response would have been to reject 12 security PRs."
`inv-03` agrees the wave is benign. **The falsified reading wins** — but note that
all three agree the _bypass_ is real and undocumented for rule 9.

**10.4 — How many archived repos are there?**
`CLAUDE.md` and `scripts/fleet-repos.sh --skipped` say **two** (`reddoor-mailer`,
`the-pointe`) plus `rfp-analyze` with no origin. `inv-03` found
**`reddoorla/the-tower` is also archived** — no local checkout, so the script
cannot see it. `inv-04`'s `gh repo list` found **`reddoor-test`** archived as
well. So: the script's output is correct for what it can observe and **incomplete
as a statement about the org** — there are 3 archived repos under `reddoorla` plus
1 under `tucksravin`. The script maps by remote, not directory name (the checkout
`welcome-to-the-flower-court` is `tucksravin/invitations`), and it enumerates
local checkouts, so **an org-level question needs `gh repo list`, not this
script.**

**10.5 — Session counts differ by ~5×, and it is a denominator, not a conflict.**
`inv-04` reports per-`cwd` session counts from all 3,469 `sessions.jsonl` rows
over 2026-07-30 → 2026-09-12 (`reddoor-website` 701, `Broken` 642,
`reddoor-maintenance` 334). `inv-06` reports **872 top-level sessions** over
**2026-08-10 → 2026-09-12** — the corpus only retains transcripts back to 08-10 —
giving `reddoor-website` 123, `caldea` 206, `reddoor-maintenance` 108. Both are
right about different populations. **Never mix them in one sentence.** `inv-01`
adds that central-repo session attribution looks **under-counted** regardless (334
total but only 33 in September, against 101 September commits and 189 September
prompts for the same project key) and did not chase the cause — treat central
session counts as a floor. This is the same class of measurement hazard as the
prompt-replay correction the package README documents (5,692 raw → 2,693 unique).

**10.6 — Smaller discrepancies, listed so nobody re-derives them.**

- _Repos with no `test` script:_ `inv-02` says nine and names nine; `inv-04` says
  "seven" and names eight. The union is nine. Use `inv-02`'s list.
- _Labels on central open issues:_ `inv-01` says 16 labelled (14 `enhancement`,
  2 `bug`); `inv-09` says 8 of 57 (`enhancement` ×7, `bug` ×2). **Unresolved.**
- _match-harness issues:_ `inv-01` says 10 and lists 11 numbers; `inv-09` says 12
  of the 47 September issues **including other repos'**. Scope plus arithmetic.
- _CLI surface:_ 32 `.command()` registrations (`inv-01`) vs 31 command modules
  (`inv-06`). Both correct — one registration does not have its own file.
- _a11y:_ 3 repos carry `package.json#reddoor.a11yRoutes`; 4 carry a `test:a11y`
  script. Different keys, both measured, easily confused.
- _Workflow YAML:_ 2,334 lines including `workflows/reusable/` vs 2,151 for
  `.github/workflows/` alone.
- _Renovate's share of PRs:_ the package README says 27%; `inv-03` measured
  **24%** after removing the 24 changesets "version packages" PRs that the release
  workflow opens **using the same App token**, and which therefore appear under
  `author == app/reddoor-renovate`. Use 24%.

---

## 11. What is solid, what is partial, what is unverified

Every row carries the flag from the survey that produced it. **Nothing inferred is
presented as measured.**

### Solid — built well, evidenced, and worth not breaking

| thing                                                                                                                     | evidence                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| The gate-design house style: marker lines, absence-is-failure, gates tested by execution with a positive control first    | [measured] §5.3; `tests/build/*`, `tests/ci-gate.test.ts` |
| Turso itself — backup verifies the artifact it keeps, quota alarmed, 929 rows, mismatches=0 twice nightly                 | [measured] §7.1                                           |
| The consumer/central dependency seam, machine-enforced by a resolution hook that reproduces a consumer install            | [measured] §2.1                                           |
| `src/dashboard` and `src/alerts` test discipline (test:src 1.99–2.00)                                                     | [measured] §2.2                                           |
| The published-package export contract, pinned free of runtime imports by test                                             | [measured] §2.3                                           |
| `reddoor-website/lighthouse.yml` — the most hardened gate in the fleet                                                    | [measured] §5.3                                           |
| Digest pinning enforced by `validate.yml` in the one repo where a mutable tag is a fleet-wide hole                        | [measured] §5.1                                           |
| The Renovate preset's own `description` array, carrying its falsified claims                                              | [measured] §6.1                                           |
| The prismic-models reusable split (comment-only on PR, apply-only on main), byte-identical to its source of truth         | [measured] §5.1                                           |
| The work journal: complete coverage since 2026-09-05, never edited in place, defect-first titles, explicit trust boundary | [measured] §9.4                                           |
| `reddoorla/claude-skills`: symlinks, idempotent installer, the rejected-alternative written down                          | [measured] §8.3                                           |
| The CLI/recipe surface: 13 recipes, all 31 command files exercised, no dead surface                                       | [measured] §8.6 / `inv-06`                                |
| No hidden backlog — zero `TODO`/`FIXME` in 379 source files, instrument proved                                            | [measured] §9.6                                           |

### Partial — works, with a named limit

| thing                | limit                                                                                                                  | flag                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Turso authority      | authoritative for data, **not** for the roster; no `src/inventory/turso.ts`; no automated parity check since the flip  | [measured]                                             |
| The nightly sweeps   | cover 13 of 22 live-or-near-live sites; `Status = maintained` is the whole boundary                                    | [measured]                                             |
| `fleet-form-e2e`     | no `wrote=0` gate, no unmeasured gate, covers 6 of 13 maintained sites, rollout accommodation has no expiry or counter | [measured]                                             |
| The a11y gate        | 24 of 27 repos scan two dev fixtures instead of the site                                                               | [measured]                                             |
| Protection coverage  | judges stage 1 only; nothing on a schedule asserts CI is required to merge                                             | [measured] code-level; live ruleset state [unverified] |
| `release-health`     | the close half fires on its own API failure                                                                            | [measured] by execution                                |
| GA/Search Console    | credential proof is dispatch-gated; `GA4 property ID` on 8 of 13 maintained; Search Console on 1 of 45                 | [measured]                                             |
| Renovate             | liveness and merge machinery healthy (1626/1629); the routine PR channel has produced nothing for five Mondays         | [measured]; mechanism [inferred]                       |
| Coverage gate        | real at 90.51% measured, enforced at 78% — ~2,400 statements of slack                                                  | [measured]                                             |
| The README           | 5 of 11 audits, 12 of 32 commands, 9 of 13 recipes                                                                     | [measured]                                             |
| Templates            | two tracks, one landmine, an impaired cherry-pick channel, a third orphan lineage                                      | [measured]; the prettier fix is [inferred]             |
| Skills/plugins       | 23 of 64 skills used; 6.1% of sessions load one; usage instrument understates script-driven skills                     | [measured]                                             |
| Turnstile            | verdict column null fleet-wide, so the red guardrail cannot fire                                                       | [measured]                                             |
| Netlify deploy alarm | 12 of 13 maintained sites; the exception is the most active one                                                        | [measured]                                             |
| The autonomy journal | contract-mandated, zero rows for the highest-risk month in the repo's history                                          | [measured]                                             |

### Unverified — do not treat as settled

| question                                                                                       | why it is open                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does `la-homelessness-youth` actually carry an open Dependabot alert for `cookie@0.6.0`?       | The alerts API failed 3/3 through the sandbox; one attempt returned empty with exit 0. Override absent + lockfile vulnerable + audit reports zero is **three measured facts that do not reconcile.** Needs an unsandboxed shell. |
| Live ruleset state of any site repo                                                            | `gh api .../rulesets` failed 5/5 with the sandbox TLS error. §5.4c is about what the code checks, not what the repos have.                                                                                                       |
| Does Reddoor's live Turnstile widget render?                                                   | Needs a browser against the live page; the only `Require Turnstile: true` site has a blank verdict.                                                                                                                              |
| When were GA credentials last proven?                                                          | The only proof is dispatch-gated and no such run appears in the 9-day corpus window.                                                                                                                                             |
| Do the ~90 PR-less `renovate/*` branches convert on Monday 2026-09-14?                         | The one finding with a pending measurement rather than a conclusion.                                                                                                                                                             |
| Are `espada` and `gallerysonder`'s crons alive?                                                | Absent from `runs.jsonl` because the collector was reset; `hedloc` was verified alive live, these two could not be.                                                                                                              |
| Is `src/blux` intended substrate or dead weight? Is `src/webflow`?                             | **Nothing written down answers either.** Not a measurement gap — a decision gap.                                                                                                                                                 |
| Does adopting `.prettierrc.json` in the blux repo collapse the 50 formatting-only divergences? | Inferred from the reformat commit's own description; not executed.                                                                                                                                                               |
| Does the `--track blux` bootstrap actually work end to end?                                    | The new-site skill's steps 3b/3c are written against the native tree; no blux bootstrap was run.                                                                                                                                 |
| Central-repo session attribution                                                               | 334 sessions but 33 in September against 101 commits. Cause not chased; treat as a floor.                                                                                                                                        |

**Two standing caveats on every number in this document.** (1) `runs.jsonl` caps
at **300 runs per repo**, so the central repo's window is **2026-09-04 → 09-12**,
nine days, not six weeks — and three real repos are missing because the collector
was reset mid-fetch. (2) `gh` through the sandbox intermittently fails with
`tls: failed to verify certificate: x509: OSStatus -26276`; several sweeps had to
be re-run unsandboxed, and the corpus's own `gh-errors.txt` shows the same class
of failure during its build, so `prs.jsonl` and `runs.jsonl` **may be short**.

---

## 12. Consolidated open-loops register

Merged and deduplicated across all nine surveys. Grouped by what it takes to
close, because that is what a meta week actually allocates.

### A. Decisions only the operator can make

| #   | loop                                                                                                                                                                  | where                                                                                                              | why it is stuck                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **#646 — Phase 6: delete the Airtable layer.** 8-step dependency-ordered checklist, 2 of 10 items done incidentally.                                                  | `src/reports/airtable/**` (7 files, 2,300 LOC), `src/db/fleet-state.ts:40-59`, `src/cli/fleet/resolve-sites.ts:41` | Executing it **ends the rollback window**, so it needs an explicit go. The precondition (a clean post-flip week) was met on 2026-09-07; the issue has had zero activity in 12 days. It is the **only large deletion anywhere in a 58-issue backlog**.                                                                                                                     |
| A2  | **What is `src/blux` for?** ~20k lines, no workflow, no active consumer, first consumer archived.                                                                     | `src/blux/` (63 files), `tests/blux/` (77), `src/cli/commands/blux.ts` (977 lines)                                 | Nothing written down states whether it is substrate or dead weight. The largest single "decide what this is for" item available.                                                                                                                                                                                                                                          |
| A3  | **What is `src/webflow` for?** Cold since 2026-07-28, lowest test:src in the repo — while a 2026-09-08 design and five plans route _around_ it.                       | `src/webflow/`, `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`                             | Same shape as A2, smaller.                                                                                                                                                                                                                                                                                                                                                |
| A4  | **#545 / #623 — enforce feature → staging → main, and who may promote.**                                                                                              | GitHub issues; `reddoor-website` `staging` is **15 commits ahead of `main`** with no promote PR                    | Two directions of one decision. #623 is literally this week's charter.                                                                                                                                                                                                                                                                                                    |
| A5  | **`build` required in the central ruleset, `validate` in `.github`'s.**                                                                                               | `src/audits/protection-coverage.ts:270` — "reddoor-maintenance deliberately has none pending release-path review"  | Parked for the operator since the 2026-08-02 architecture review. **This is the single decision that would close the §5.4c gap**, and the central repo publishes the package the whole fleet consumes.                                                                                                                                                                    |
| A6  | **Promote `reddoor-website` staging → main.**                                                                                                                         | `origin/main..origin/staging` = 15 commits                                                                         | Releases a proven feature (report edit mode, #176–#181), a merged vitest security PR, and a Renovate config migration in one move. Second-order: Renovate reads config from the **default** branch, so #180's `baseBranchPatterns` fix cannot take effect until the promote — **the fix for the config warning is blocked behind the promote it is supposed to unblock.** |
| A7  | **Sit down once with the sharp security wave.** 26–31 PRs across 14–17 repos, all CLEAN/green, held open by design.                                                   | `renovate/npm-sharp*` branches                                                                                     | Merge the override-key-shaped one per repo (it subsumes the direct-dep one); **restore the `pnpm-workspace.yaml` header comment the diff deletes.** The largest single batch of human work sitting in the fleet.                                                                                                                                                          |
| A8  | **`canvas-starter`: promote, fold, or archive.** `isTemplate: false`, no development since 2026-07-24, the only holder of 8 slices from a deleted library generation. | `canvas-starter/`                                                                                                  | Its stated purpose is seven weeks stale.                                                                                                                                                                                                                                                                                                                                  |
| A9  | **Does `.claude/settings.json` join `CLAUDE.md` in version control?**                                                                                                 | `.gitignore:14`                                                                                                    | The argument that won for CLAUDE.md in #699 applies unchanged.                                                                                                                                                                                                                                                                                                            |

### B. Instruments that are green on a question they cannot fail

| #   | loop                                                                                                                                                                                                                      | fix shape                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **`fleet-form-e2e` has no `wrote=0` and no unmeasured gate** — proven by executing both gates on identical input (§5.4a).                                                                                                 | Port `fleet-smoke-workflow.test.ts`'s `runGate` harness to `fleet-form-e2e` **and** `fleet-lighthouse` — the only two nightlies with no `tests/build/` gate test — then add the missing check.                                                                                                           |
| B2  | **The `testMode` rollout has no counter and no expiry**, so an unfinished rollout and a regression look identical. 5 maintained sites with real forms have no lead-path coverage. **There is no open issue tracking it.** | A count of self-skipping sites in the summary line; file the rollout issue.                                                                                                                                                                                                                              |
| B3  | **Nothing on a schedule asserts a repo requires a CI check to merge**, though `AUTONOMY.md` leans on it as a binding control for unattended merges.                                                                       | Judge stage 2 in `protection-coverage.ts`, or accept the gap in writing. Blocked behind A5.                                                                                                                                                                                                              |
| B4  | **`release-health`'s close half fires on its own API failure.**                                                                                                                                                           | Copy `fleet-security.yml:237`'s pattern: refuse to close without a positive marker line.                                                                                                                                                                                                                 |
| B5  | **No Renovate instrument measures outcomes.** Three surfaces all green while the routine channel shipped nothing for five weeks.                                                                                          | Add "days since this repo last merged a non-security Renovate PR" **or** "count of `renovate/*` branches with no PR whose tip is older than 8 days" — one field from the existing parser. **Prove it FAILs on today's fleet and PASSes against the 2026-08-10 snapshot before trusting either verdict.** |
| B6  | **The a11y gate scans fixtures, not the site, in 24 of 27 repos.** Opt-in stalled at 3.                                                                                                                                   | The mechanism works (#481, counting fixed in #770). The missing piece is a per-site debt pass or a warn-then-fail ramp, because `--fail-on-violations` + pre-existing debt reds a site's PRs the day it opts in.                                                                                         |
| B7  | **The ANALYTICS credential proof only runs on manual dispatch.**                                                                                                                                                          | Remove the `if: inputs.preview_site` guard, or run the enriched preview on the scheduled path.                                                                                                                                                                                                           |
| B8  | **No alarm consumes `submission_deadletter`**, and the table has never had a row — so it is an untested assertion, not an instrument. The attention-item kinds have no `deadletter`, no `form-e2e`, no `unknown-site`.    | Add the kind; fire a known-good row through it once.                                                                                                                                                                                                                                                     |
| B9  | **No automated parity between the Airtable shadow and Turso.** `db parity` exists; nothing runs it. Last proof is 12 days old.                                                                                            | One cron line — but it becomes moot if A1 lands.                                                                                                                                                                                                                                                         |
| B10 | **The coverage floor has not moved in three months** (78/67/76/80 vs 90.51/84.79/89.45/91.53).                                                                                                                            | One-line change, paired with a decision about how much refactoring headroom to keep.                                                                                                                                                                                                                     |
| B11 | **"Test (if present)" cannot tell "no unit tests" from "someone deleted the test script."** 9 repos have no `test` script.                                                                                                | Record the expected state per repo, or accept and document.                                                                                                                                                                                                                                              |
| B12 | **The usage instrument for skills understates script-driven skills**, and would have condemned the most-used tool on the machine.                                                                                         | Fix before any future tooling audit.                                                                                                                                                                                                                                                                     |

### C. Mechanisms that have stopped without alarming

| #   | loop                                                                                                                                                                                                                                                                       | state                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **`group:allNonMajor` has produced no PR for five Mondays**; ~90 PR-less `renovate/*` branches; four production sites 14 minors behind `@reddoorla/maintenance`.                                                                                                           | [measured]; mechanism [inferred]. Control experiment: add `renovate/**` to one repo's `ci.yml` push branches, or dispatch with `LOG_LEVEL=debug` to read `prBlockedBy`. **Pending measurement Monday 2026-09-14.**                                                                      |
| C2  | **`reddoor-maintenance#716` (vitest `[security]`) is permanently frozen** — a human merge commit landed on the `renovate/*` branch, so Renovate's "manually edited" heuristic stopped touching it. `main` moves 6–12 commits/day, so it can never become CLEAN on its own. | Recovery is one checkbox (`rebase-branch` on dashboard #490). **Two of the operator's own conventions collide here**: "merge main in rather than rebase, because a dirty PR gets no CI" vs "never commit on a `renovate/*` branch." Write the collision down somewhere a session reads. |
| C3  | **Rule 5 (the pnpm 11.8.x hold) is dead.** A `[security]` wave took 20 repos to 11.11.0 and CI is green; the hold now only suppresses the signal it was meant to preserve.                                                                                                 | Delete it.                                                                                                                                                                                                                                                                              |
| C4  | **The `vulnerabilityAlerts` bypass of `enabled: false` is documented for rule 5 and not for rule 9.**                                                                                                                                                                      | Document it, and decide whether a security override-key rewrite may automerge.                                                                                                                                                                                                          |
| C5  | **The `@reddoorla/maintenance` never-automerge hold buys ~50 h latency and 0 reviews** (nReviews: 0 on 30/30 grouped PRs). Its cost right now is zero because no grouped PR exists.                                                                                        | Consider splitting it into its own branch so the other ~10 packages automerge on the cron and one small human-merge PR per week remains — which is what the hold was always for. **Do not spend the meta week here while C1 is unresolved.**                                            |
| C6  | **`docs/autonomy-journal.md`: 0 rows for August, 135 merged PRs.**                                                                                                                                                                                                         | Either resume it or amend `AUTONOMY.md`. A contract nobody keeps is worse than no contract.                                                                                                                                                                                             |
| C7  | **The morning-report ritual has a 7-week gap** (2026-07-06 → 2026-08-26) covering the entire Turso build.                                                                                                                                                                  | Same question as C6.                                                                                                                                                                                                                                                                    |
| C8  | **17–18 orphaned pre-App Dependency Dashboards** inflate every issue count and trap dashboard-reading probes.                                                                                                                                                              | Close them; `the-pointe#9` cannot be closed (archived).                                                                                                                                                                                                                                 |
| C9  | **Two unwatched Renovate health warnings**: `revogen`'s "Package lookup failures" (dependencies silently not checked) and `erp-industrial`'s deprecated `@prismicio/helpers` with no replacement path.                                                                     | Nothing reads `## Repository Problems`.                                                                                                                                                                                                                                                 |

### D. Documents and archaeology that actively mislead

| #   | loop                                                                                                                                                                                                                                          | why it matters                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **`CLAUDE.md:206-213` sends every session to a 175-line-stale copy of the Turso design and tells it not to start work that is now overdue.**                                                                                                  | Loaded into every session on this machine; points at the _older_ of two documents. **The highest-leverage stale paragraph in the corpus.**                                                                                 |
| D2  | **The retracted `git merge starter/main` instruction is still live** in `specs/2026-08-31-starter-track-split-design.md:72-74` and its plan (twice), with no forward pointer — and `CLAUDE.md` sends readers there.                           | The repo invented the `> Superseded in part by …` affordance for journal entries and has not applied it to specs and plans.                                                                                                |
| D3  | **`plans/2026-09-08-webflow-pipeline-bc-harness.md:31` asserts a "verified" fact that was false when written**, and Task 17 therefore sends a future agent to journal into the wrong file.                                                    | Still on `main`.                                                                                                                                                                                                           |
| D4  | **Two stale sibling worktrees**, both 156 commits behind: `-turso-spec` (superseded by main) and `-e2ebudget` (26-day-old `wip(form-e2e)` commit on **no remote**, not merged, carrying a considered fix with its own reasoning in comments). | The e2ebudget one needs a decision — PR it or delete it — not pruning by default. #641 shipped a _different_ form-e2e fix in the meantime.                                                                                 |
| D5  | **`.claude-worktrees/` is unignored and `fmt.mjs` is untracked**, so `pnpm lint` fails locally on neither a type error nor a test.                                                                                                            | Two lines plus a deletion. It degrades the one gate an operator runs by hand.                                                                                                                                              |
| D6  | **The README documents less than half the shipped surface**, and the gap is exactly the automated half.                                                                                                                                       | A derived test — in the shape of `tests/ci-gate.test.ts` — asserting that every `ALL_AUDIT_NAMES` and `ALL_RECIPE_NAMES` entry appears in the README would make this class of drift impossible rather than merely noticed. |
| D7  | **`docs/SETUP.md` predates Turso, Google sign-in and the prospect audit**; the strategic roadmap has had no status marker in three months.                                                                                                    | The README points at SETUP.md as the end-to-end walkthrough.                                                                                                                                                               |
| D8  | **The three repos the journal rollout could not reach are recorded nowhere but here** (`reddoor-mailer`, `the-pointe`, `rfp-analyze` — each holding the journal on an unpushable local branch).                                               |                                                                                                                                                                                                                            |
| D9  | **The design record for `reddoor-website`'s largest feature this quarter is stranded on an orphan branch** — an 847-line plan on `docs/prospect-report-route-plan`, never PR'd, while the feature shipped across ~15 PRs.                     |                                                                                                                                                                                                                            |
| D10 | **`docs/decisions/` holds exactly one ADR, from 2026-06-09.** The starter split, the "cherry-pick never merge" rule and its landmine live only in `CLAUDE.md` and a README.                                                                   |                                                                                                                                                                                                                            |
| D11 | **Three orphan scripts with no caller** (290 lines), two of them one-shots by design with nothing in the tree saying so.                                                                                                                      |                                                                                                                                                                                                                            |
| D12 | **`mjml to v5 [security]` sits in dashboard #490's `PR Closed (Blocked)` as a deliberate hold whose rationale lives in agent memory and the journal, not the repo** — which is why it keeps being re-raised.                                  |                                                                                                                                                                                                                            |

### E. Unpushed or data-loss exposure

| #   | loop                                                                                                                                                                                                                 | detail                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **`welcome-to-the-flower-court`: 33 commits / +4,962 lines on `feat/sigil-badges`, never pushed to any remote.** Written 2026-09-06/07, with real-world side effects already taken ("her email sent and delivered"). | **The only open loop in the survey set that is also a data-loss exposure.** One disk failure loses it. Note the remote is `tucksravin/invitations`. |
| E2  | `caldea` holds a complete 108-line work-journal entry, uncommitted.                                                                                                                                                  | A session that ended without writing its journal to disk — the exact failure the convention exists to prevent.                                      |
| E3  | `a-budget` holds 130 lines of new TypeScript untracked since 2026-09-03.                                                                                                                                             |                                                                                                                                                     |
| E4  | `beachfront-dentistry` HEAD is an unpushed branch carrying a 60-line journal entry (the code fix itself **did** land centrally as `9fe4c7e8`).                                                                       | Nine of 41 checkouts sit on a non-default branch — the collision state `CLAUDE.md` warns about.                                                     |
| E5  | `reddoor-mailer` carries **1,340 tracked `node_modules` files** and 2 unpushable commits on an archived repo.                                                                                                        |                                                                                                                                                     |

### F. Fleet-composition gaps

| #   | loop                                                                                                                                                                                                                                                                                                                                | detail                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F1  | **9 live-or-near-live sites are outside every sweep.** `hedloc` and `alamo-anatomy` were last security-audited 2026-07-08 — a **66-day gap with no alarm**.                                                                                                                                                                         | The boundary is `Status = maintained`, and moving a site off it silently drops every sweep.          |
| F2  | **`29-navy` has an Airtable row with no `Git repo` and no `Netlify ID`.**                                                                                                                                                                                                                                                           | Fill the `Git repo` cell **before** flipping `Status`, or the clone throws on the first swept night. |
| F3  | **Beachfront Dentistry has no `Netlify ID`**, so the fleet's most actively developed client site is outside the deploy alarm that feeds the cockpit's Broken band.                                                                                                                                                                  |                                                                                                      |
| F4  | **`composition-hospitality` and `the-tower` are org repos with no local checkout** and no row in the corpus. Any survey enumerating `~/Documents/GitHub` misses them.                                                                                                                                                               |                                                                                                      |
| F5  | **The starter's quality layer has never been backported.** `test:a11y` reaches 4 of 23 repos; unit tests reach 10 of 23; 11 of the 13 contract sites have none.                                                                                                                                                                     | The generation-1 sites are the ones with revenue attached.                                           |
| F6  | **`reddoor-starter#121` — 14 generic Beachfront fixes not upstreamed**, already costing re-work in new sites. The starter's journal measures it at **~18% of a Beachfront-sized build**.                                                                                                                                            | The single largest identified unrealised win in the template dimension.                              |
| F7  | **The security-pin layer is hand-written five different ways**, and `la-homelessness-youth` resolves `cookie@0.6.0` while its audit reports zero.                                                                                                                                                                                   | See §11 _Unverified_ — this one needs the Dependabot API before anyone acts on it.                   |
| F8  | **The most valuable single missing artefact** is a per-site drift report that diffs each site against `reddoor-starter` rather than against itself. Every gap in §3 and §4 was found by comparing repo to repo by hand; nothing in the fleet reports "this site is missing the a11y gate / the override block / the functions key." |                                                                                                      |

### G. The backlog itself

**58 open issues in the central repo, 47 of them filed in the last twelve days.**
By ISO week, opened/closed: W34 7/7 → W35 11/5 → W36 24/4 → W37 35/6. Two
clusters account for roughly half: **match-harness** (10–12 issues against a
recipe merged 2026-09-09, whose 2,506 lines of `.mjs`/`.md` live as TypeScript
template literals and whose real behaviour only exists once installed into a site,
so the generator's own tests cannot see it) and **dev-route / gate-honesty**
(#717 "54 of 55 /dev routes across the fleet ship unguarded to production",
plus #727, #723, #719, #700, #680). Issue #711 names the pattern in its own
title: _"A derived or cached view read as the state itself — five instances in
one day."_

**These are not scattered bugs — they are two new subsystems being reviewed
adversarially and producing findings faster than anyone fixes them.** Only 8–16 of
58 carry a label; none carries a milestone or an assignee. **The highest-leverage
action on open loops is a triage-and-cluster pass, not fixing any individual
item.**

### H. The one pending measurement

**Monday 2026-09-14: re-run the `refs/heads/renovate/*` scan** and check whether
the ~90 PR-less branches convert to PRs. That single observation decides between
§10.1's two readings, and with it whether the meta week's dependency work is "one
config line" or "nothing to do."
