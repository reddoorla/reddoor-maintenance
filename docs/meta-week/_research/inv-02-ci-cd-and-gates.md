# inv-02 — CI/CD and the gate/alarm layer

Survey date: 2026-09-12. Read-only. Every claim below is either (a) a quotation
from a file at a named path and line, (b) an aggregate computed from the corpus
at
`/private/tmp/claude-501/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/28e83896-3f66-4bb2-86f0-612ee993fd98/scratchpad/corpus/runs.jsonl`,
or (c) the output of a gate script I extracted and executed against stubbed
input. Where I could not measure something, it says so.

---

## 0. Read this first — two honesty caveats about the evidence

**The corpus was still filling while I read it.** My first pass over
`runs.jsonl` saw 2,635 rows; my last saw 3,437. All numbers in this document
come from the 3,437-row read (`wc -l` = 3437, day range 2026-07-30 →
2026-09-12, 24 repos). If you re-derive them and get different figures, the
file grew again.

**`runs.jsonl` caps at 300 runs per repo, so the window is NOT uniform.** For
`reddoor-maintenance` the 300 most recent runs only reach back to
**2026-09-04** — nine days, not six weeks:

```
repo                    n   earliest    latest
beachfront-dentistry  300  2026-08-03  2026-09-12
reddoor-maintenance   300  2026-09-04  2026-09-12   <-- capped hard
reddoor-website       300  2026-08-22  2026-09-12
the-pointe-burbank    175  2026-07-31  2026-09-12
...
```

Consequence: the statement "every nightly has a 100% success rate" is true of
**2026-09-04..09-12 only** (9 or 10 runs each). It is _not_ a statement about
the six-week window, and nothing in this corpus can make it one. Do not quote
the nightlies' 0% failure rate as a six-week result.

**Three real repos are missing from `runs.jsonl` entirely** — `espada`,
`gallerysonder`, `hedloc` — and this is a _fetch_ failure, not silence.
`corpus/gh-errors.txt` contains, verbatim:

```
failed to get runs: Get "https://api.github.com/repos/reddoorla/hedloc/actions/runs?...": read tcp ...: connection reset by peer
```

I verified the gap is the collector's, not the fleet's, by querying live:
`gh run list -R reddoorla/hedloc --limit 5` returned five `renovate` runs,
`schedule`, all `success`, 2026-09-10 → 2026-09-12. So hedloc's cron is alive.
`espada` and `gallerysonder` I could **not** verify — every retry through this
sandbox died with `tls: failed to verify certificate: x509: OSStatus -26276` at
`per_page=100`. Treat them as unmeasured, not as dead.
(`reddoor-maintenance-e2ebudget` and `reddoor-maintenance-turso-spec` also have
no rows; they are git worktrees of the central repo, so that is correct.)

---

## 1. The central repo's 13 workflows

All in `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.github/workflows/`.
2,151 lines of YAML, the large majority of it prose explaining _why_ — these
files are the fleet's best-documented artifact.

### The nightly clock (all UTC)

| time          | workflow              | what it establishes                                                                                                      |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 04:30         | `fleet-db-backup`     | Turso dump + restore rehearsal + encrypted round-trip; second job checks plan quota                                      |
| 05:00         | `fleet-prismic-drift` | does each repo's content model still match its Prismic repository                                                        |
| 06:00         | `fleet-security`      | Dependabot/`pnpm audit` vuln counts + `deps` drift → Airtable; then Renovate dispatch; then org-wide protection coverage |
| 08:00         | `fleet-lighthouse`    | Lighthouse + domain + browser + netlify-deploy + function-health against **deployed** URLs; then GitHub-signals sweep    |
| 09:23         | `daily-reports`       | draft due reports → send approved → email operator digest                                                                |
| 10:00         | `fleet-smoke`         | clone each site, run its own `pnpm test:smoke` → `Smoke OK`                                                              |
| 10:15         | `fleet-form-e2e`      | drive each deployed `/contact` form with the `testMode` marker → `Form E2E OK`                                           |
| Mon 11:00     | `time-travel`         | run the whole suite on a clock +90 days                                                                                  |
| 14:30         | `release-health`      | npm-vs-main drift **and** release-workflow redness                                                                       |
| 00:00 / 12:00 | `renovate`            | PR creation **and** merge (platform auto-merge is off fleet-wide, so Renovate merges from inside the run)                |

Event-driven: `ci` (push to `main`/`changeset-release/main`/`staging`, plus
every `pull_request`), `release` (push to `main` + dispatch), `report-rerender`
(dispatch only).

### What each one would actually catch

**`ci.yml` (81 lines).** Runs `pnpm typecheck / lint / build / test:coverage /
test:dist` as five individually-named steps, plus a Playwright chromium install
and a working-tree-clean tripwire. The five steps are not a hand-kept list:
`tests/ci-gate.test.ts:44` asserts `ciRunSteps()` equals `verifySteps()` —
derived from `package.json#scripts.verify` — "in content or order". A second
describe block globs _every_ workflow for `- run: pnpm test|test:coverage` and
fails any that lacks `playwright install` (`tests/ci-gate.test.ts:75-85`). That
guard exists because `ci.yml` gained the browser install in `ec4ec55` and
`release.yml` did not, so the PR was green and `main` went red forty seconds
after merge. The `changeset-release/main` push trigger is load-bearing: a
`pull_request` run from the release bot is gated behind `action_required`, so
only the push event produces a mergeable `build` check.

**`release.yml` (114 lines).** Mints a repo-scoped `reddoor-renovate` App
token, checks out _with that token_ so the Version-Packages push is attributed
to the App (a `GITHUB_TOKEN` push is recursion-guarded and fires no CI), pins
`npm@^11.5.0` (npm 12 changed `npm info --json` to an array, which made
changesets re-publish every version and crash on E403), and publishes via OIDC
with no `NPM_TOKEN`. Catches: nothing by itself; it _is_ the publish path.

**`renovate.yml` (44 lines).** Twice-daily. Because platform auto-merge is
disabled fleet-wide, this cron is the **merge cadence**, not just the PR
cadence. All three actions digest-pinned, with the reason stated: this job
mints a repo-write token, so a retagged `@v46` would run attacker code with it.

**`fleet-smoke.yml` (172 lines).** The most instructive gate in the repo. It
keys on two machine-readable lines, not on the CLI's exit code:
`FLEET_WRITE_SUMMARY wrote/failed/total` and `FLEET_SMOKE_UNMEASURED count=N`.
The second exists because the first cannot see the failure it was built for —
lines 118-138 say it outright: a site whose `test:smoke` blows its budget
"still counts as written (it writes nothing new), and the Airtable writer
deliberately preserves the prior value rather than record a false fail — so the
row keeps serving its last GREEN result. reddoor and beachfront-dentistry sat
like that for four nights while this workflow reported success every morning."
An **absent** `FLEET_SMOKE_UNMEASURED` line is itself a failure; `count=0` is
the proof of a clean sweep.

**`fleet-lighthouse.yml` (192 lines).** Checkout-free. Gate: summary present,
`wrote>0`, `failed*4 <= total`. Mints its App token _after_ the ~48-minute
audit because installation tokens die at 60 minutes. The GitHub-signals sweep
is `if: always()` + `continue-on-error`, but explicitly errors when the minted
token is empty rather than clean-skipping.

**`fleet-security.yml` (280 lines).** Same write-summary gate, then two
best-effort follow-ons: Renovate dispatch for newly-flagged vuln sites, and an
**org-wide** protection-coverage audit that enumerates repos from the API
("Sweeps driven by a hand-maintained or Airtable-scoped list have already
produced two false 'all clear's"). Its close-the-issue step is the model to
copy: it refuses to close on step outcome alone and greps for
`PROTECTION_AUDIT gaps=0 ` — "any path that exits 0 without auditing would
otherwise convert into a false 'Recovered' close" (lines 236-240).

**`fleet-prismic-drift.yml` (254 lines).** Read-only by construction: `apply`
is not plumbed through fleet mode and asking for it exits 2. Unlike security
and smoke, **its exit code is a real signal** — drift never reds it, only an
inability to establish the fleet does. It carries 16 `PRISMIC_TOKEN_<NAME>`
env lines derived from each repo's Prismic `repositoryName`, not its directory
name (four differ; `beachfront-dentistry` → `48BB12D1`, a hash). The header
also documents the dead-cron backstop: `collectPrismicDriftAlerts` escalates
any verdict nobody re-established into a `prismic-stale:` attention item, so a
silently-dead nightly surfaces as staleness rather than a fleet of green ticks.

**`fleet-form-e2e.yml` (156 lines).** Drives each deployed `/contact` form.
Gate: summary present, partial-miss warning, prep-skip warning, ingest-budget
warning, `failed*4 > total` reds. **It has no `wrote=0` check and no
unmeasured check.** See §4.1 — this is the one measured hole.

**`fleet-db-backup.yml` (228 lines).** Dumps Turso, refuses a dump with no
`INSERT INTO sites` rows, rehearses the restore against the dump's own **origin
manifest** (it used to compare the dump to itself, "so a dump that collected 5
of 44 sites shrank both numbers together and verified clean"), then — the part
most backup jobs skip — **decrypts the .gpg it is about to upload and re-runs
the same verification on the round-tripped copy**, because "nothing had ever
decrypted the .gpg that actually gets uploaded". Second job checks plan quota
and reds on `verdict != ok`, including `no-token` ("an alarm nobody configured
is not a quiet alarm, it is no alarm").

**`daily-reports.yml` (279 lines).** Draft (continue-on-error) → send → digest
→ keepalive → an explicit "Fail the run if drafting failed" step so the
tolerated failure still opens the tracking issue. Both halves of the tracking
issue are scoped `&& !inputs.preview_site`, with the reason spelled out: a
passing credential probe must not auto-close a genuinely open daily-failure
issue — "a false all-clear on the one surface that exists to make failures
durably visible". That is the exact reasoning `release-health.yml` is missing
(§4.2).

**`release-health.yml` (180 lines).** Two deliberately independent guards:
npm-`latest` vs `main`'s version, and the `release` workflow's own newest
_decisive_ run on `main`. Guard 2 exists because guard 1 is "structurally
blind" — 2026-07-20..24 had four days of red release runs with zero version
drift and no alarm.

**`time-travel.yml` (102 lines).** Weekly, `REDDOOR_TIME_TRAVEL_DAYS=90`.
`tests/time-travel-guard.test.ts` asserts the clock actually moved, so a shim
that fails to apply reds the job instead of reporting a hollow green. The
issue-filing step is scoped to `steps.suite.outcome == 'failure'`, not bare
`failure()`, so a lockfile break cannot file an issue confidently asserting a
wall-clock diagnosis.

**`report-rerender.yml` (69 lines).** Dispatch-only, per-report concurrency,
and an absent-line guard: `grep -qE '^REPORT_RERENDER .* status=rendered '` —
"a run that exits 0 WITHOUT the line never actually rendered".

---

## 2. Run statistics since 2026-07-30 (3,437 rows, 24 repos)

```
workflow                runs    ok  fail  canc  fail%   repos
renovate                1629  1626     3     0    0.2     23
ci                      1522  1389   132     0    8.7     22
lighthouse               103    86     1    16    1.0      1
validate                  46    46     0     0    0.0      1
release                   41    40     1     0    2.4      1
rooms                     12    12     0     0    0.0      1   (Broken/, a non-Reddoor repo)
release-health            10    10     0     0    0.0      1
fleet-lighthouse          10    10     0     0    0.0      1
fleet-security            10    10     0     0    0.0      1
fleet-form-e2e             9     9     0     0    0.0      1
fleet-smoke                9     9     0     0    0.0      1
daily-reports              9     9     0     0    0.0      1
fleet-prismic-drift        9     9     0     0    0.0      1
fleet-db-backup            9     9     0     0    0.0      1
prismic-models             8     8     0     0    0.0      2
time-travel                1     1     0     0    0.0      1
```

Events: 1,240 `schedule` / 894 `pull_request` / 419 `push` / 82
`workflow_dispatch` (from the 2,635-row read; proportions held).

**Which workflow fails most: `ci`, and it is not close.** 132 of the 135 total
failures are `ci`. That is the gate doing its job on feature branches — only
**two** `ci` failures in the whole window were on `main`
(`beachfront-dentistry` 2026-08-03, `vida-legacy-foundation` 2026-09-05).

Failures by repo+workflow:

```
  66  beachfront-dentistry/ci      19  reddoor-website/ci        8  the-pointe-burbank/ci
   5  erp-industrial/ci             4  the-tower-burbank/ci      4  vineyard-custom-homes/ci
   3  canvas-starter/ci             3  medical-solutions-of-texas/ci
   3  reddoor-maintenance/ci        3  revogen/ci                3  the-pointe/ci
   2  alamo-anatomy/ci  2 caltex-landing/ci  2 la-homelessness-initiative/ci
   2  la-homelessness-youth/renovate            1  reddoor-md-pdf/renovate
   1  reddoor-maintenance/release (2026-09-08)  1  reddoor-website/lighthouse (2026-08-24)
   1  29-navy/ci  1 data-dynamiq/ci  1 la-homelessness-youth/ci  1 reddoor-starter/ci
   1  vida-legacy-foundation/ci
```

`beachfront-dentistry` alone is half the fleet's CI failures (66/132, a 30.1%
failure rate over 219 `ci` runs), and **52 of those 66 sit on one branch**,
`feat/detail-templates-and-footer`, over two days:

```
2026-08-05  15
2026-08-06  37
```

That is one PR iterating red 52 times in 48 hours. Nothing is broken about the
gate; it is a cost signal about how that work was driven. `reddoor-website`'s
second-place 19 shows the same shape at smaller scale — 9 of them on
`design/report-by-control` on 2026-08-27.

`renovate`'s three failures across 1,629 runs (la-homelessness-youth ×2,
reddoor-md-pdf ×1) is a 0.2% rate. The 16 `cancelled` runs are all
`reddoor-website/lighthouse`, which sets `cancel-in-progress: true` per PR — by
design.

---

## 3. The shared CI pattern, and how uniform adoption is

### The pattern

Every fleet site's `.github/workflows/ci.yml` is an 11-13 line _caller_:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main, staging]
jobs:
  ci:
    permissions: { contents: read, pull-requests: write }
    uses: reddoorla/.github/.github/workflows/ci.yml@8f9852c… # v1.4.1
    with:
      node-version: "24"
      netlify-site: "beachfront-dentistry-rd" # only when it differs from the repo name
```

The callee lives at
`/Users/tuckerlemos/Documents/GitHub/reddoorla-dot-github/.github/workflows/ci.yml`
and runs, in order: `pnpm install --frozen-lockfile`, `prettier --check .`,
`eslint .`, `svelte-kit sync && svelte-check`, `pnpm build`, `playwright
install --with-deps chromium`, **`pnpm exec reddoor-maint audit --only a11y
--fail-on-violations`**, then two conditional steps ("Test (if present)",
"Smoke test (if present)"). A second job posts the Netlify deploy-preview link
as a PR comment — it **comments, it does not gate**; nothing in the shared CI
waits on or asserts anything about the Netlify build.

`prismic-models.yml` is the second reusable workflow, present in 9 repos. Its
split is the safety property: the `pull_request` job holds `pull-requests:
write` and never passes `--apply`; the `push`-to-`main` job holds `--apply` and
no permission to comment. Both halves of the branch guard are kept — the
caller's `push: branches: [main]` **and** the callee's `if: … github.ref ==
'refs/heads/main'` — because an unfiltered `on: push:` fires on every branch
and every tag. Its source of truth is
`reddoor-maintenance/workflows/reusable/prismic-models.yml`, hand-copied into
the org repo; I diffed the two and they are **byte-identical** today.

### Adoption

22 of the 29 checkouts with a `.github/workflows` directory call the shared
`ci.yml`. Pin distribution:

- **20 repos** on `8f9852c…` (v1.4.1)
- **1 repo** on `c714d9e…` (v1.4.2) — `reddoor-website`
- **1 repo** on `4a32c3d…` (v1.3.0) — `the-pointe`, which is **archived** and
  last ran CI on 2026-08-02

v1.4.2 is `fix(ci): stop apt from reading Google's Chrome repo during browser
install`, committed **2026-09-09T18:47:57Z** — three days ago. Twenty repos on
v1.4.1 is not drift, it is Renovate latency inside its Monday window. Naming
the rule before calling it stuck: `renovate-config.json` extends
`group:allNonMajor`, and the org preset automerges `patch`/`minor` with
`platformAutomerge: false`, so the bump rides the ordinary path.

The four repos that do **not** use the shared CI are `reddoor-maintenance`
(bespoke, §1), `reddoor-md-pdf`, `reddoorla-dot-github` (whose own `ci.yml` is
`workflow_call`-only and therefore emits no check runs at all — hence
`validate.yml`, which exists purely so Renovate branches carry a green signal),
and `Broken/` (`smahre/Broken`, not a Reddoor repo).

`renovate.yml` is effectively uniform: 20 repos share one checksum, 6 share
another (the difference is **prettier quoting only** — site repos prettier-format
their YAML, the central repo does not; diffed and confirmed), `the-pointe` is
its own (archived), and `reddoor-md-pdf` is one patch behind on the Renovate
action (`v46.2.1` vs `v46.2.2`).

Digest pinning holds: grepping every `uses:` across all site workflows for
anything not pinned to 40 hex chars returns **only** `changesets/action@v1` in
`reddoor-maintenance/release.yml` and three `@v4` refs in the non-Reddoor
`Broken/` repo.

---

## 4. Gates that can be satisfied by an absence

This is the section the fleet's own top rule asks for. Each item below is
either executed or quoted; where I executed a gate I ran a **known-good input
first**, so that a FAIL is evidence rather than an untested assertion.

### 4.1 `fleet-form-e2e` goes GREEN on a night where nothing was probed — MEASURED

The other four fleet sweeps carry a `wrote == 0` check. `fleet-form-e2e.yml`
does not (compare `fleet-lighthouse.yml:105-109` with `fleet-form-e2e.yml:99-123`).
Since `formatFleetWriteSummary` computes `total = wrote + failed`
(`src/audits/write-audits-to-airtable.ts:291-293`), a fleet that resolves zero
sites prints `wrote=0 failed=0 total=0`, and the only remaining check —
`failed*4 > total` — is `0 > 0`, false.

I extracted the step's own `run:` block and executed it under `bash -e` with
`node` stubbed, exactly as `tests/build/fleet-smoke-workflow.test.ts` does for
its sibling:

```
=== A positive control: 3 of 3 written, a real probe ===
EXIT=0     | FLEET_WRITE_SUMMARY wrote=3 failed=0 total=3
=== B negative control: crashed before the summary ===
EXIT=1     | ::error::fleet form-e2e printed no write summary …
=== C: fleet resolved ZERO sites ===
EXIT=0     | fleet form-e2e write-back: wrote=0 failed=0 total=0
=== D: 13 sites, ALL self-skipped (nothing probed) ===
EXIT=0     | fleet form-e2e write-back: wrote=13 failed=0 total=13
=== E: 4 of 13 failed to write (>25%) — should RED ===
EXIT=1     | ::error::fleet form-e2e: 4/13 site(s) failed to write (>25%) …
```

A and E prove the harness fires in both directions. Then the identical case-C
input against `fleet-lighthouse.yml`'s extracted gate:

```
=== fleet-lighthouse, positive control: 10 of 10 written ===
EXIT=0
=== fleet-lighthouse, SAME zero-site input that form-e2e passed ===
EXIT=1     | ::error::fleet Lighthouse wrote 0 of 0 site(s) — total write-back failure …
```

Same bytes in; sibling reds, form-e2e greens.

**Case D is the worse half.** The workflow's own comment (lines 66-70) says a
site that has not rolled out `testMode` forwarding "self-skips via the /health
declaration preflight (counts as written, not failed), so the gate stays green
during rollout". That is a deliberate rollout accommodation, but it has no
expiry and no counter. If a site's deploy stops declaring `forms.testMode` in
`/health`, it silently leaves the probe set, its Airtable `Form E2E OK` keeps
serving its last value, and the nightly reports success. This is
_byte-for-byte the failure `FLEET_SMOKE_UNMEASURED` was invented to kill_ —
`fleet-smoke.yml:118-138` — and `fleet-form-e2e` has no equivalent line.

Contributing cause worth naming: `tests/build/` holds executable gate tests for
`daily-reports`, `fleet-db-backup`, `fleet-prismic-drift`, `fleet-security`,
`fleet-smoke`, `report-rerender` and the reusable prismic workflow. It holds
**none for `fleet-form-e2e` or `fleet-lighthouse`**. The one nightly whose gate
list is incomplete is one of the two with no test.

### 4.2 `release-health` auto-closes a real "Release workflow is failing" issue when its own API call fails — MEASURED

`release-health.yml:97-99` treats an empty query result as "nothing to judge"
and sets `red=no`. The comment defends the _alarm_ direction ("a broken query
must not masquerade as a broken pipeline") and is right to. What it does not
account for is that `red` also drives the **close** half, at line 166:

```yaml
- name: Close the release-failing issue once it goes green
  if: steps.relstate.outputs.red != 'yes'
```

I extracted the `relstate` step, stubbed `gh`, and ran three cases:

```
=== P1 release is FAILING on main ===  OUT | red=yes  concl=failure
=== P2 release is GREEN            ===  OUT | red=no   concl=success
=== P3 the gh api call FAILS       ===  log | no decisive release run on main — skipping guard 2
                                        OUT | red=no   concl=none
```

P1/P2 are the positive controls. P3 — a token problem, a transient reset, a
`--jq` change, a scope loss — produces `red=no`, indistinguishable at the
`if:` from "green", and arms `gh issue close … "The release workflow is green
on main again."` on an issue that is not. Whether the close _lands_ depends on
a second API call succeeding moments later, which is why I rate this medium and
not high — but the failures I hit myself in this session were per-request
resets, so non-simultaneity is the normal case.

Two sibling workflows already solved this and are the fix template:
`fleet-security.yml:237` refuses to close without the positive
`PROTECTION_AUDIT gaps=0 ` line, and `daily-reports.yml:270` scopes its close
half away from probe runs for exactly this reason, in exactly these words.

### 4.3 The a11y gate scans two dev fixtures, not the site, in 24 of 27 repos — MEASURED

`pnpm exec reddoor-maint audit --only a11y --fail-on-violations` is the
strongest-looking line in the shared CI. What it scans is
`configs/playwright-a11y.js`'s two design-system fixture routes, **plus**
whatever the repo opts into via `package.json#reddoor.a11yRoutes`
(`src/audits/a11y.ts:186-199`). The source comment states the stakes without
hedging:

> "This exists because scanning only fixtures let a critical `image-alt`
> violation ship to five production pages with CI green; it is opt-in because
> the audit runs with `--fail-on-violations` and most of the fleet has
> pre-existing debt."

Counting the key across every repo carrying the shared `ci.yml`:

```
opted in: 3   NOT opted in (fixtures only): 24
  29-navy                  1 route  ['/']
  reddoor-starter          1 route  ['/']
  vida-legacy-foundation   8 routes ['/', '/es', '/about', '/es/about', '/donate', …]
```

`gallerysonder` — the repo named in the changeset for `#770` as the one where
the image-alt violation shipped to five production pages — is still in the
not-opted-in list. So for 24 repos, a PR that breaks accessibility on every
real page of the site passes a check literally named `--fail-on-violations`,
because the pass condition is satisfied by pages the site does not serve.

`#770` (`9f5fc898`, merged 2026-09-11) is the _adjacent_ bug, already fixed:
the summary line interpolated `a11yRoutes.length` (2 fixtures) while scanning
`axePages`, so `vida-legacy-foundation` added eight routes and was told
"across 2 routes". Note the failure shape the changeset calls out — "conclude
the key is broken, revert it, lose exactly the coverage it exists to provide."
The counting bug is fixed; the coverage gap it obscured is not.

### 4.4 "Test (if present)" passes when there is no test script — MEASURED

`reddoorla-dot-github/.github/workflows/ci.yml:32-38`:

```yaml
- name: Test (if present)
  run: |
    if node -e "process.exit(require('./package.json').scripts?.test ? 0 : 1)"; then
      pnpm test
    else
      echo "no test script — skipping"
    fi
```

Nine of the repos on this workflow have **no `test` script at all**: `1836dig`,
`caltex-landing`, `erp-industrial`, `gallerysonder`, `hedloc`,
`la-homelessness-youth`, `medical-solutions-of-texas`, `revogen`,
`vineyard-custom-homes`. Their PRs print "no test script — skipping" and go
green. The step cannot distinguish "this repo has no unit tests" from "someone
deleted the test script".

The smoke half is in better shape: **every** site repo has `test:smoke`, and
the condition correctly skips only when `pnpm test` already chained it. (The
one exception, `the-pointe`, has `test` but no `test:smoke` — and is archived.)

### 4.5 No scheduled instrument asserts that any repo requires a CI check to merge — MEASURED (code-level)

`AUTONOMY.md:10-13` names three binding controls, the second being "**CI being
required on `main`**". Nothing checks it nightly.
`src/audits/protection-coverage.ts:307` judges every repo's ruleset with
`rulesetGaps(full, null)` — i.e. **stage 1 only** — and the header says so:

> "Whether a covering ruleset also gates on CI is reported as detail, not
> judged: each repo's required context differs (and reddoor-maintenance
> deliberately has none pending release-path review), so the CI-gate invariant
> belongs to the per-site heal".

A repo with no required status check is therefore `covered`, with the string
`— NO CI gate (refs rules only)` tacked onto its detail line, and the sweep
exits 0, and `PROTECTION_AUDIT gaps=0` closes the tracking issue. The floor it
does enforce is real (active enforcement, empty bypass, PR required, deletion +
non-fast-forward, secret scanning, live Renovate) — but the specific property
AUTONOMY.md leans on is the one not measured on a schedule.

The heal side has the mirror-image behaviour by design:
`src/github/gh.ts:607-628`, `checkContextObserved` returns `false` on _any_
non-zero `gh` exit, and `src/github/rulesets.ts:84-92` then builds the ruleset
with refs rules alone — because with an empty bypass list a required context
that never fires makes the repo permanently unmergeable by everyone. That is
the right trade. Its cost is that "the check wasn't observed" and "the check
isn't required" are the same outcome, and nothing alarms on the difference.

`ACCEPTED_GAPS` is currently `[]` (`src/audits/protection-coverage.ts:91`), so
nothing is muted.

I could **not** verify the live ruleset state of any site repo —
`gh api repos/reddoorla/caltex-landing/rulesets` failed on five consecutive
attempts with `tls: failed to verify certificate: x509: OSStatus -26276`
through this sandbox. The claim above is about what the code checks, not about
what the repos currently have.

### 4.6 The ANALYTICS proof only runs on a manual dispatch — MEASURED

`daily-reports.yml:144-161` is the gate built after `#469` (every CI-drafted
report shipping with a blank ANALYTICS section) and repaired in `#523`
(`--preview` alone does no IO, so the check could never pass — `--enrich` is
what makes it a credential proof). It is sound now. But it is guarded by
`if: ${{ inputs.preview_site }}` — it runs **only** when a human dispatches the
workflow with a site name. The 09:23 scheduled run drafts, sends and digests
with **no assertion at all** that GA resolved. The #469 failure class remains
green-by-default on the scheduled path and detectable only by someone choosing
to probe.

### 4.7 Minor: seven repos carry a frozen `lighthouserc.json` missing the anti-squatter fix

19 repos have a repo-root `lighthouserc.json`. Twelve are one line —
`{"extends": "@reddoorla/maintenance/configs/lighthouse"}`. Seven
(`beachfront-dentistry`, `canvas-starter`, `reddoor-starter-blux`,
`the-pointe`, `the-pointe-burbank`, `the-tower-burbank`, and the generated-copy
shape generally) are **materialized snapshots** whose
`startServerCommand` is `pnpm vite:dev` — without the `--port 5173
--strictPort` that `src/configs/lighthouse.ts:19` added, and whose comment
explains what its absence costs:

> "`startServerReadyPattern` matches vite's 'ready in' line whatever port it
> settled on, so with something already on 5173 vite comes up on 5174, and
> lighthouse then collects from 5173 — auditing the squatter and reporting ITS
> scores as this site's."

Blast radius is small: nothing in site CI runs `lhci` against these files
(`src/audits/lighthouse.ts:285` uses `deployedLighthouse` whenever the Airtable
row has a `deployedUrl`, and that path deliberately does **not** spread the
fixture collect block). It bites a local or deployedUrl-less run.

---

## 5. What is built well, and worth not breaking

- **Gates are tested by execution, with the positive control first.**
  `tests/build/fleet-smoke-workflow.test.ts` extracts the workflow's own shell
  and runs it against a stubbed CLI across six cases, and its header states the
  rule: "The clean-sweep case is first on purpose. A gate that has only ever
  been seen to fail is an untested assertion, not an instrument."
  `fleet-prismic-drift-workflow.test.ts` does the same across 14 gate cases
  plus 15 structural ones. Every `stepEnv` test carries an explicit
  "(positive control)" assertion proving the parser read a real block.
- **Machine-readable marker lines, with absence treated as failure.**
  `FLEET_WRITE_SUMMARY`, `FLEET_SMOKE_UNMEASURED`, `PROTECTION_AUDIT gaps=`,
  `DUMP_VERIFY loaded=true … mismatches=0`, `FLEET_DB_USAGE … verdict=ok`,
  `REPORT_RERENDER … status=rendered`. Four of six red on an absent line.
- **`set -o pipefail` is applied deliberately**, with the reason attached:
  `fleet-security.yml:197` notes "the review caught this alarm shipping DEAD"
  because `| tee` swallows the exit code in Actions' default `bash -e {0}`.
- **The backup verifies the artifact it keeps**, not the one it made.
- **Alert machinery never changes a verdict** — every issue-filing and
  issue-closing step is `continue-on-error`.
- **Digest pinning is enforced by a check**, in the one repo where a mutable
  tag would be a fleet-wide supply-chain hole (`reddoorla-dot-github/validate.yml:19-34`),
  alongside a preset check that rejects any `automerge: true` rule lacking
  `platformAutomerge: false` — the 2026-07-26 incident class, encoded.
- **`reddoor-website/lighthouse.yml`** is the most hardened single gate in the
  fleet: it waits for Netlify's check-run **on the PR's head SHA** (HTTP 200 is
  not a readiness signal — the previous commit's preview serves the same
  alias), distinguishes "Checks API broken" from "deploy not done", hard-fails
  when the `/portfolio` scrape yields no detail link rather than silently
  dropping a page class from the matrix, and — added 2026-09-08 after a wasm
  dependency took every SSR route down while every prerendered page stayed
  green — curls `/health` to prove the serverless function answers.

---

## 6. Open loops

| loop                                                                   | where                                                      | note                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build` required in the central ruleset; `validate` in `.github`'s     | `src/audits/protection-coverage.ts:270`                    | "reddoor-maintenance deliberately has none pending release-path review". Parked for the operator since the 2026-08-02 architecture review.                                                                                 |
| No `tests/build/` gate test for `fleet-form-e2e` or `fleet-lighthouse` | `tests/build/`                                             | The two untested nightlies; one of them (§4.1) is the one with the incomplete gate.                                                                                                                                        |
| a11y opt-in stalled at 3 of 27                                         | `package.json#reddoor.a11yRoutes`                          | Shipped in `#481`, counted correctly since `#770` (2026-09-11). Adoption is the remaining work; `--fail-on-violations` + pre-existing debt is the stated blocker.                                                          |
| `reddoorla/.github` local checkout is behind                           | `/Users/tuckerlemos/Documents/GitHub/reddoorla-dot-github` | Local `HEAD` and the stale local `origin/main` are both `25bab2c`; the real remote `main` is `c714d9e` (v1.4.2). `git ls-remote` also shows an open branch `harden/false-green-netlify` — unread, possibly relevant to §4. |
| v1.4.2 adopted by 1 of 22 callers                                      | site `ci.yml` `uses:` pins                                 | Tagged 2026-09-09; normal Renovate Monday-window latency, not drift. Re-check after the next Monday batch before treating it as stuck.                                                                                     |
| form-e2e rollout accommodation has no expiry                           | `fleet-form-e2e.yml:66-70`                                 | "counts as written, not failed … so the gate stays green during rollout". No counter says how many sites are still self-skipping.                                                                                          |
| Prismic token env list is wider than the swept fleet                   | `fleet-prismic-drift.yml:97-103`                           | Deliberate and documented: 29-navy, alamo-anatomy, hedloc, the-pointe-burbank carry a line and are not swept (`resolveSites` returned 13 on 2026-09-09). Not a gap — do not "fix" it.                                      |

---

## 7. Reproduction commands

```sh
# per-workflow run table
python3 - <<'PY'
import json,collections
p="…/scratchpad/corpus/runs.jsonl"
rows=[json.loads(l) for l in open(p) if l.strip()]
by=collections.defaultdict(collections.Counter)
for r in rows: by[r["workflow"]][r["conclusion"] or "none"]+=1
for wf,c in sorted(by.items(), key=lambda kv:-sum(kv[1].values())):
    n=sum(c.values()); print(f'{wf:22}{n:6}{c["success"]:6}{c["failure"]:6}{100*c["failure"]/n:7.1f}')
PY

# a11y opt-in census
python3 -c "
import json,os; b='/Users/tuckerlemos/Documents/GitHub'
for d in sorted(os.listdir(b)):
    p=os.path.join(b,d,'package.json')
    if os.path.isfile(os.path.join(b,d,'.github/workflows/ci.yml')) and os.path.exists(p):
        r=(json.load(open(p)).get('reddoor') or {}).get('a11yRoutes'); print(d, r or 'FIXTURES ONLY')"

# reusable-workflow pin distribution
grep -h -a 'reddoorla/.github/.github/workflows' \
  /Users/tuckerlemos/Documents/GitHub/*/.github/workflows/*.yml | sort | uniq -c | sort -rn

# execute a gate against stubbed input (the §4.1 / §4.2 method)
#   1. extract the step's `run: |` block to a file
#   2. stub the binary it calls onto PATH with a canned stdout + exit code
#   3. run `bash -e gate.sh` with RUNNER_TEMP pointed at a scratch dir
#   4. KNOWN-GOOD INPUT FIRST — a gate that has only ever failed proves nothing
```
