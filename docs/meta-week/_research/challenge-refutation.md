# Adversarial refutation of the meta-week candidate slate

**Date:** 2026-09-12 · **Role:** adversarial refuter · **Input:** 25 candidates across five lenses
**Method:** every load-bearing claim re-derived against live code, the live `reddoorla` org, and
the local checkouts. Where a candidate proposed a decisive test, I ran it rather than ranking it.

**Headline result:** 25 candidates describe roughly **12 distinct problems**. Five candidates are
one finding. Three are another. Two pairs are two more. Eleven are refuted outright, two fold into
survivors, one survives intact, eleven survive only in narrowed form — and the slate has a hole in
it that none of the 25 candidates mentions.

---

## 0. What the slate missed (found while refuting candidate 22)

Candidate 22 proposed spending a day reconciling three facts about `cookie@0.6.0`, with step (1) —
"run the Dependabot alerts API from an unsandboxed shell against a control, then against
la-homelessness-youth" — as the gate on everything else. I ran it. It took under a minute:

```
gh api "orgs/reddoorla/dependabot/alerts?state=open&per_page=100" --jq 'length'
→ 35
gh api ".../dependabot/alerts?state=open" --jq '[.[]|.security_advisory.severity]|group_by(.)…'
→ {"high": 22, "low": 6, "medium": 7}
gh api "repos/reddoorla/la-homelessness-youth/dependabot/alerts?per_page=100"   (no state filter)
→ []                                   # zero alerts in ANY state, ever
gh api "repos/reddoorla/la-homelessness-youth/vulnerability-alerts" -i
→ HTTP/2.0 204 No Content              # alerts are ENABLED
```

Two consequences, and the second is the more important one.

**First:** candidate 22 is settled and dead (see §5.22 below).

**Second, and unprompted by any candidate: there are 35 open Dependabot alerts across 15 repos
right now, 22 of them HIGH, and not one of the 25 candidates mentions them.** The distribution:

| package                                           | advisory               | severity     | relationship | repos                                                                                                                                                          |
| ------------------------------------------------- | ---------------------- | ------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharp`                                           | GHSA-rgj7-g3m4-5g8c    | **high**     | **direct**   | 9 — alamo-anatomy, caltex-landing, composition-hospitality, espada, gallerysonder, medical-solutions-of-texas, reddoor-starter, revogen, vineyard-custom-homes |
| `js-yaml`                                         | GHSA-2883-xcg3-v3hh    | high         | transitive   | data-dynamiq, erp-industrial, reddoor-maintenance                                                                                                              |
| `extract-zip`                                     | GHSA-7pqw…, GHSA-jmr9… | high         | transitive   | hedloc, reddoor-maintenance, reddoor-md-pdf                                                                                                                    |
| `ip-address`, `nanoid`, `vitest`, `fflate`, `joi` | various                | high/med/low | transitive   | reddoor-maintenance, reddoor-website                                                                                                                           |

**And the fix for the largest cluster is already sitting in an open, mergeable PR on every affected
repo.** Verified on four:

```
gallerysonder        #97 MERGEABLE/CLEAN   #96 MERGEABLE/CLEAN   (both opened 2026-09-09)
espada               #71 MERGEABLE/CLEAN   #70 MERGEABLE/CLEAN
beachfront-dentistry #45 MERGEABLE/CLEAN   #44 MERGEABLE/CLEAN
reddoor-starter     #119 MERGEABLE/CLEAN  #118 MERGEABLE/CLEAN
```

They are unmerged because `sharp` is named explicitly in the shared preset's never-auto-merge
packageRule (`matchPackageNames: ["@reddoorla/maintenance","sharp","@zerodevx/svelte-img",
"vite-imagetools","imagetools-core","@sveltejs/enhanced-img"], automerge: false`). **That is the
rule working exactly as designed** — the same shape as the 16-PR misread the preset's own
description records. Nobody has called these stuck, and nobody should. But they are waiting for the
one thing the rule requires: a human.

So the slate spends **five of twenty-five candidate slots** on secret-scanning alerts whose most
severe member is a browser Maps key that the site serves to every visitor by construction (§1), and
**zero slots** on 22 open HIGH dependency alerts, 9 of which have a green PR waiting. Merging those
PRs is hours of work with no instrument to build and no proof obligation to discharge. It should
precede every candidate below.

_(Scope note: the `reddoor-maintenance` and `reddoor-md-pdf` alerts are transitive dev-only deps and
the fleet has a documented pnpm-11 override idiom for exactly that class; and fleet memory records a
"ghost vulns from deleted lockfile manifests" failure mode. Read each alert before acting — the
point here is that 22 HIGH alerts exist and no candidate looked.)_

---

## 1. The secret-scanning cluster: five candidates, one finding

**Candidates 1, 7, 8, 13, 19.** All five rest on the same measured fact, which I verified
independently and which is **true**:

- `secretScanningGaps()` at `src/audits/protection-coverage.ts:117-127` compares exactly two status
  strings, `repo.secretScanning !== "enabled"` and `repo.pushProtection !== "enabled"`, sourced from
  the org listing at `src/github/gh.ts:642`.
- `grep -ran 'secret_scanning' src/ .github/ scripts/ netlify/` returns **one** hit — the jq
  extraction on line 642. Nothing reads `/secret-scanning/alerts` anywhere.
- Live today, from an unsandboxed shell: five open alerts, every one `resolution=null`,
  `validity=unknown`:

```
reddoor-maintenance  #1 stripe_webhook_signing_secret 2026-06-09  (95d)
gallerysonder        #1 google_api_key                2026-06-05  (99d)
reddoor-starter      #1 google_api_key                2026-07-24  (50d)
beachfront-dentistry #1 google_api_key                2026-08-06  (37d)
reddoor-starter-blux #1 google_api_key                2026-09-01  (11d)
```

- Controls exist today in both directions: `erp-industrial`, `la-homelessness-initiative` and
  `espada` each return `0`. A PASS control and a FAIL control are both available, which is unusually
  cheap for this house's proof obligation.
- 28 public repos; `vida-legacy-foundation` and `29-navy` are `disabled/disabled` (verified in the
  live listing); `the-pointe` is archived, so a non-issue.

**So the instrument gap is real and one candidate should survive. Four should not.** Five slots on
one finding is 20% of the week's list.

### Which survives — 13, with two grafts

**Candidate 13 survives** as the spine. It is the only one of the five that gets the severity right
and the only one that finds a second, distinct defect:

1. **It prices the exposure correctly.** I verified the mechanism: the Beachfront key is
   `VITE_GOOGLE_MAPS_KEY`, read in `src/lib/blux-catalog/BluxWidget.svelte:57`,
   `src/lib/blux/LocationMap.svelte:19` and `FrozenPage.svelte:142`, and injected into a
   `<script src="https://maps.googleapis.com/maps/api/js?key=…">`. It is a **browser key compiled
   into the shipped bundle and served to every visitor**. The git-history leak adds close to zero
   incremental disclosure; secrecy was never the control. The exposure is _unrestricted third-party
   billing against the owning GCP project_, not data and not site control. The secret-scanning
   research file records the alert's paths as `matching/SPEC.md` and `matching/spec-sections/
contact.md` — documentation transcribing a value the live site already publishes.
2. **It finds the second defect nobody else does: the alarm's own heal instruction is false.** Issue
   #652's body (read live) says _"Heal: run `reddoor-maint self-updating <site>`"_.
   `grep -rain 'secret_scanning|secret-scanning|secretScanning' src/recipes/` returns **nothing**.
   The recipe cannot enable secret scanning. An alarm prescribing a remedy that does not exist is
   its own unproven instrument, and it is the reason #754 has sat unactioned since 2026-09-10.
3. **Its remediation order is right and its reasoning is right.** Restrict by HTTP referrer first
   (minutes, reversible, zero downtime, no client conversation); rotation alone is theatre because
   the new key is published in the next bundle anyway; restrict-then-rotate only if the alert needs
   a clean close. It also names the preview-domain trap: a referrer list that omits
   `*--beachfront*.netlify.app` silently breaks the map on every future deploy preview.

**Graft in two things from candidate 7**, which are the only genuinely distinct _actions_ in the
cluster:

- **The `whsec_` comparison, as step one.** `reddoor-maintenance` contains zero Stripe references,
  but Resend's webhook is svix-signed and svix uses the same `whsec_` prefix Stripe's detector
  matches. Comparing the fixture against the live `RESEND_WEBHOOK_SECRET` costs two minutes, has no
  client blast radius at all, and is the only item in the cluster that touches the orchestrator's own
  integrity. It resolves to either "regenerate in Resend" or "dismiss as `used_in_tests`". Note the
  fleet's own precedent: a real endpoint in a committed fixture failed every Netlify deploy for
  weeks. A fixture is not automatically safe.
- **Turn on `secret_scanning_validity_checks` org-wide.** I confirmed all five alerts report
  `validity=unknown`, so the checks are off. This is a settings toggle that supplies the single fact
  (is the key still live?) that decides restrict-vs-rotate for every future alert.

**Graft in one thing from candidate 19**, which is the only genuine _proof risk_ anyone raises: #650
records that `credentials.env`'s `GITHUB_TOKEN` returns 401, and the alerts endpoint needs
`security_events` scope. A new clause could therefore read `unavailable` fleet-wide and become a
third instrument that is green on a question it cannot fail. The existing file already states the
convention — _"'unavailable' means the listing couldn't read `security_and_analysis` … which must
read as unverified, not as fine"_ — and the new clause must follow it.

### Why 1, 7, 8 and 19 are refuted as candidates

- **Candidate 1 — REFUTED.** Pure duplicate. Its unique contribution is the sha256-prefix proof that
  starter and blux hold the same key, which is provenance, not action. And it asserts _"the largest
  measured false green in the system"_ — an unsupportable superlative that is, on the evidence in §0,
  simply wrong: 22 open HIGH dependency alerts with unmerged fixes outrank a public browser key.
- **Candidate 7 — FOLDED, not standalone.** Its two unique actions are grafted above. Its framing —
  _"four distinct live-shaped credentials sitting in public git history"_ with _"an external
  adversary"_ — over-dramatises three browser keys that were never secret.
- **Candidate 8 — REFUTED.** Duplicate. Its one novel observation (two identically-titled tracking
  issues, #652 and #754, both open) is not a secret-scanning finding at all — it is candidate 14's
  `--limit` bug, and it is correctly and completely handled there. Its proposal — _"add a `secret`
  attention kind so an open alert lands in the cockpit's Broken band"_ — is the one piece worth
  keeping, and it belongs inside candidate 13.
- **Candidate 19 — FOLDED.** Its unique contributions (the `unavailable` convention, the #650 token
  risk) are grafted above. Everything else is 13 with a different title.

**Defensible version of the whole cluster, as ONE item:** _Referrer-restrict the four Google keys in
the GCP console (≈10 min each, outside the week's budget); compare the `whsec_` fixture against the
live Resend secret and act on the answer; enable org-wide validity checks; add an alert-count clause
to `secretScanningGaps` proven against beachfront (FAIL) and erp-industrial (PASS); add the
secret-scanning enable step to `self-updating` so the alarm's heal line stops lying; enable scanning
on the two disabled repos._ Effort: half a day, plus console time.

---

## 2. Candidate 2 — "Make 'prove the instrument' a machine-checked property" — REFUTED

This candidate claims to be _"the generator of the rest of this list"_. It fails its own rule, and it
fails it on the exact class of defect it is built to prevent.

**The proposal is a check on the presence and shape of a check.** It asserts that a
`tests/build/<name>-workflow.test.ts` exists, that it spawns the workflow's `run:` block against a
stub, and that it contains at least one all-clean case asserting exit 0.

**None of those properties entails that the gate measures what it claims.** A workflow whose `run:`
block is `exit 0` satisfies every one of them perfectly. Apply it to the three failures CLAUDE.md
names as the reason the house rule exists:

- **The GA-credentials gate (2026-08-12).** Built on `report --preview`, which does no IO. It had a
  shell, it could be executed against a stub, and a clean case would have exited 0. **It passes the
  proposed meta-test.** The defect — the preview path could never touch credentials — is invisible
  to any structural property.
- **The setup-node v7 probe.** Printed `VERDICT: OK` for both versions because the line grepped the
  wrong command. Executable, stubbed, exits 0 on clean input. **Passes.**
- **The 16 "stuck" Renovate PRs.** Not a workflow at all. Untouched.

So the instrument proposed to enforce "prove the instrument" **cannot fail on the failure class it
exists for**. That is the definition of an untested assertion with a test runner attached.

Three further objections:

- **Issue #711 already refuted it, correctly.** Its argument — _"inventing an abstraction over five
  same-day instances is how the next layer of unearned confidence gets built"_ — applies here
  verbatim. The candidate's rebuttal ("this asserts an enumerable structural property, never that
  anyone reasoned well") concedes the point rather than answering it: the failure being prevented
  _is_ a reasoning failure, and the candidate says its check does not address reasoning.
- **Its own evidence argues against it.** §9.2 records three instruments built during the
  architecture survey, all three returning a false FAIL on first run, _"written by agents who had the
  rule loaded in context."_ Prose in context did not work. A red build that says "you are missing a
  file" produces a file, not a proof.
- **It is a wrapper around work already on the slate.** "Budget the three fixes alongside it" — the
  three fixes are candidates 16 and 3. The candidate is those items plus a meta-test that can't fail
  correctly, at half a day.

**Defensible residue:** the concrete half, which is already candidate 16's item (1) — _port the
`runGate` harness from `tests/build/fleet-smoke-workflow.test.ts` to the three scheduled workflows
that lack one._ I verified the gap: `grep -ral` across `tests/` finds no gate test for
`release-health`, and for `fleet-form-e2e` / `fleet-lighthouse` only a sibling's cross-workflow
assertion in `fleet-prismic-drift-workflow.test.ts`. That is a real, bounded, provable task. The
generalisation is not.

---

## 3. The Renovate cluster: three candidates, one question, and a wrong severity

**Candidates 6, 18, 20.** I spent the most measurement here because this is where the house's
documented "rule working as designed" trap lives.

### What is actually true

Verified live via GraphQL and `gh pr list` across six repos:

```
repo                    last merged GROUPED PR   last merged renovate PR (any)   open renovate PRs
reddoor-starter         2026-08-12               2026-08-31 lock-file-maint      #118 #119 sharp (09-09)
beachfront-dentistry    2026-08-13               2026-09-11 vitest-vuln          #44  #45  sharp (09-09)
gallerysonder           2026-08-10               2026-09-02 pnpm-vuln            #96  #97  sharp (09-09)
espada                  2026-08-12               2026-09-02 pnpm-vuln            #70  #71  sharp (09-09)
data-dynamiq            2026-08-12               2026-09-02 pnpm-vuln            —
reddoor-website         2026-08-12               2026-09-11 vitest-vuln          —
```

- **The grouped non-major channel is genuinely dead** — last merge 2026-08-10 to 08-13, so four
  missed Mondays (08-17, 08-24, 08-31, 09-07). Branch heads all rebased 2026-09-07 (a Monday).
- **The version drift is real.** `@reddoorla/maintenance` resolves to 0.81.0 (la-homelessness-
  initiative, data-dynamiq), 0.83.0 (reddoor-website, espada), 0.90.1 (beachfront-dentistry),
  0.93.0 (gallerysonder) against npm latest **0.95.1**. A caret range on a 0.x pins the minor, so the
  grouped channel is indeed the only thing that can move these. The shared-CI pin is `8f9852c`
  (v1.4.1) on 4 of 5 repos sampled, `c714d9e` (v1.4.2) on reddoor-website alone — and I confirmed the
  v1.4.2 bump is inside the grouped update on the starter's dashboard.
- **But Renovate is emphatically NOT dead.** The vulnerability channel is not schedule-gated
  (`vulnerabilityAlerts.enabled: true`) and it delivered as recently as 2026-09-11.

### Refutation 1 — candidate 6 is a duplicate of candidate 18

They propose the same metric ("days since this repo last merged a **non-security** Renovate PR", or
"count of PR-less `renovate/*` branches older than 8 days"), the same two-snapshot proof (today FAIL,
2026-08-10 PASS), and the same Monday control experiment. Candidate 18 is tighter (`hours` vs
`half-day`) and carries the live GraphQL evidence. **Candidate 6 — REFUTED.**

Both get one thing importantly right and should keep it: the metric must say **non-security**.
"Days since last merged Renovate PR" would read 1–10 days across the fleet and be green and wrong.

### Refutation 2 — candidate 20's control experiment is the expensive one, and a free one exists

Candidate 20 proposes _"add `renovate/**` to one repo's ci.yml push branches"_ as the cheapest
control, and to read the answer the following Monday. Objections:

- **It is a mutation to a client repo's CI to test a hypothesis**, and it duplicates CI on every
  future Renovate PR (`push` **and** `pull_request` both fire).
- **It waits a week.** The next Monday after 2026-09-14 is 2026-09-21, outside the meta week.
- **A free, same-day, config-free probe already exists in the dashboard and the candidate did not
  read it.** reddoor-starter's Dependency Dashboard (#97) carries, verbatim:

```
## Awaiting Schedule
 - [ ] <!-- unschedule-branch=renovate/all-minor-patch -->fix(deps): update all non-major dependencies (…)
 - [ ] <!-- create-all-awaiting-schedule-prs -->🔐 **Create all awaiting schedule PRs at once** 🔐
```

Ticking one `unschedule-branch` checkbox on one repo answers the question **today, on a Saturday**,
reversibly, touching no config. If the PR opens, the blocker is the schedule/window interaction;
if it does not, it is `prCreation`. That is the control experiment.

### Refutation 3 — the inferred mechanism is partly contradicted by measurement

Candidate 20 (and 6, and 18) lean on _"`prCreation: not-pending` reading Renovate's internal check as
pending forever, because the branch carries zero check runs."_ I measured the branch:

```
gh api repos/reddoorla/reddoor-starter/commits/refs%2Fheads%2Frenovate%2Fall-minor-patch/status
→ state=success  statuses=1  renovate/stability-days=success
.../check-runs → total=0
```

The combined status is **success**, not pending. Renovate's `isBranchNotPending` returns true on a
green branch, so on this evidence it _should_ open the PR. The zero-check-runs state is also expected
and by design: every site's `ci.yml` is `on: pull_request` + `push: [main, staging]`, so a
`renovate/*` push never triggers CI and never has. That has been true the whole time the channel was
_working_, which means it cannot by itself be the cause.

The surviving version of the mechanism is narrower and less certain: _immediately after Renovate
pushes the rebase inside the Monday window, the new commit has zero statuses, and GitHub's combined
status for a statusless commit is `pending` — so Renovate declines to create, and the window closes
before `renovate/stability-days` reports._ That is plausible and fits, but it is inference, and
building a preset change on it is precisely the _"built on a mechanism without reading it"_ failure
the house rule names — the failure that produced the 2026-08-12 "stuck PRs" overstatement which
shipped into the fleet-wide preset.

Also note the remedy is cheaper than claimed. Candidate 20 says _"a one-line change to the 23
callers."_ If the diagnosis is `prCreation`, it is **one line in one file** — `.github`'s
`renovate-config.json`, which every repo extends via `"extends": ["github>reddoorla/.github:renovate-config"]`.

### Refutation 4 — the impact framing is wrong

Candidate 20: _"it sits upstream of the maintenance-package spread, the CI-pin spread, **and the
whole manual sharp/cookie wave**"_, impact **high**. The sharp half is false: security PRs are
opening and merging on schedule; the sharp PRs are open because of the never-auto-merge packageRule,
not because the grouped channel is dead. This is a **feature-version drift** problem, not a security
exposure. Downgrade to **medium**.

And one further point no candidate makes: `@reddoorla/maintenance` is itself in the never-auto-merge
packageRule, and under `group:allNonMajor` one held package makes the whole grouped branch
non-automergeable. So restoring the channel yields **PRs a human must merge**, not automation. Real
value, smaller than advertised.

**Verdict:** 6 REFUTED (duplicate). 18 SURVIVES NARROWED — good metric, but "one field on the parser
that already exists" is wrong: counting PR-less branches needs a per-repo GraphQL ref scan, not a
dashboard parse. 20 SURVIVES NARROWED HARD — replace the ci.yml mutation with the dashboard
checkbox, do it today rather than budgeting Monday, downgrade impact to medium, drop the
security/sharp framing entirely, and if the diagnosis lands, fix one line in `.github`.

---

## 4. The remaining duplicate pairs

### 4a. Candidate 3 vs 16 (form-e2e) — 3 REFUTED

Both are true on the facts. I verified them:

- `fleet-form-e2e.yml:82-105` has exactly one `exit 1` (absent summary). No `wrote=0` check and no
  self-skip check. `fleet-lighthouse.yml:106-107` _does_ carry `if [ "$wrote" -eq 0 ]; then … exit 1`.
- The testMode census matches to the site: `grep -c testMode <repo>/src/routes/health/+server.ts`
  across all 13 maintained checkouts → declared by beachfront-dentistry, reddoor-website,
  medical-solutions-of-texas, espada, vineyard-custom-homes, 1836dig (**6**); absent from
  gallerysonder, revogen, erp-industrial, data-dynamiq, la-homelessness-initiative, caltex-landing,
  la-homelessness-youth (**7**), of which caltex-landing and la-homelessness-youth are the documented
  formless cases. **5 maintained sites with real forms have zero end-to-end coverage.**

Candidate 16 is better: it names those five, excludes the two accepted formless cases, and scopes
the deadletter rider correctly. Candidate 3 duplicates that and **bundles in release-health, which it
misdescribes**.

`release-health.yml:96-99` sets `red=no` on an empty query, and the comment says why:
_"No decisive run at all (fresh repo, or the API call failed) → nothing to judge. Stay silent rather
than alarm; **a broken query must not masquerade as a broken pipeline.**"_ For the _filing_ half that
is a deliberate, documented design decision — a rule working as designed, and candidate 3 reports it
as a defect ("cannot distinguish the pipeline being green from its own API call failing").

The genuine defect is narrower: the **same flag gates the close step** at line 163
(`if: steps.relstate.outputs.red != 'yes'`), so a failed query closes an alarm that may still be
true. `fleet-security.yml:237` already shows the correct pattern two files over — close only on a
positive `PROTECTION_AUDIT gaps=0` marker, with the comment _"Step outcome alone is not proof."_
That fix is ~20 minutes, and its blast radius is an issue about the central repo's own release
pipeline. Bundling it under an impact line that reads _"high — form-e2e is the only end-to-end proof
that a client's lead actually reaches the store"_ inflates it.

**Candidate 3 — REFUTED.** The release-health close-side asymmetry survives as a 20-minute rider on
16, described accurately.

**Candidate 16 — SURVIVES, SPLIT.** The gate work (port `runGate`; add `wrote=0 → exit 1`; add a
`FLEET_FORM_E2E skipped=N` marker; file the rollout issue that does not exist) is **hours** and
should happen. The rollout — running `src/recipes/health-endpoint` against five live client sites and
shipping five production deploys — is **not a meta-week activity**; it is scheduled client work, and
the candidate's own `effort: multi-day` concedes as much. Ship the count as a warning, not a
threshold, until the rollout lands, exactly as the candidate says.

### 4b. Candidate 4 vs 23 (a11y) — 4 REFUTED

Both rest on a verified fact: `grep -l a11yRoutes */package.json` returns exactly **three** repos —
29-navy, reddoor-starter, vida-legacy-foundation — and **none of them is one of the 13 maintained
sites**. The mechanism is stated in-source at `src/audits/a11y.ts:186-199`, and #770 (HEAD
`9f5fc898`) fixed the adjacent counting bug, not the coverage gap.

Candidate 23 is better scoped (13 maintained, which is the revenue and sweep boundary) than
candidate 4 (22 repos). **Candidate 4 — REFUTED as a duplicate with a worse scope** — but its step
(1) is genuinely distinct and should be grafted onto 23: **fix #680 first**, so a fixture route that
404s fails loudly instead of scanning nothing. That is the prove-the-instrument step, it is cheap,
and 23 lacks it.

**Both overstate in the same way, and the survivor must drop it.** "Satisfied by an absence" and
"passes on pages it does not serve" are not the same claim. The fixtures _exist_ and _are scanned_ in
almost every repo; the gate returns a real verdict on the design system in isolation
(`status = hasSerious ? "fail" : hasAny ? "warn" : "pass"`). It is a narrow instrument being read as
a broad one — which is bad, and is exactly how the gallerysonder `image-alt` violation shipped — but
it is not a gate measuring nothing. The 404-fixture case (#680) applies to **one** repo
(reddoor-website has no `/dev/animate-in`), not the fleet.

**Effort is understated.** Candidate 23 says `day`. The audit spawns `vite dev` + Playwright per repo
(#700 records that both browser gates run against `vite dev`, not a production build), across 13
repos with 14 distinct npm script sets and 8 of 13 lacking a `test` script entirely (verified: no
`test` in gallerysonder, revogen, erp-industrial, medical-solutions-of-texas, vineyard-custom-homes,
caltex-landing, 1836dig, la-homelessness-youth). Candidate 4's `multi-day` is the honest number.

**Candidate 23 — SURVIVES NARROWED:** scope 13, fix #680 first as the positive control, report-only,
effort **multi-day**, impact **medium** (the deliverable is a number, not a fix, and the debt itself
is explicitly out of scope).

### 4c. Candidate 17 vs 21 (drift reporting) — 17 REFUTED

Candidate 21 wins decisively because **the engine already exists**: `src/recipes/sync-configs.ts`
with 10 templated configs, a tested `dryPlan` that delegates to the recipe's own `planTemplateDiffs`,
and `--fleet <file.json>` roster support. I verified it is never scheduled:
`grep -rn 'sync-configs' --include='*.yml' --include='*.sh' --include='*.mjs' .` returns exactly one
hit, `scripts/smoke-dist.mjs:171`, the export smoke test naming the string. No workflow, no cron.

Candidate 17 proposes **building a second drift engine** (`site-conformance`) that diffs against the
starter. Its unique columns — `a11yRoutes` present, `test` script present, `overrides:` block
present, shared-CI ref — are four greps that can ride on candidate 21's marker line. Building a new
audit to carry four greps, when a tested, idempotent, preview-capable convergence engine is sitting
unscheduled, is the expensive path. **REFUTED.**

Candidate 17 also inherits the a11y overstatement (§4b) and duplicates candidate 22's cookie claim,
which is dead (§5.22).

**Candidate 21 — SURVIVES NARROWED.** Its design is right and its risk section is right: ship as a
counted report with a **measured-count** gate (`FLEET_CONFORM measured=23 drifted=N` whose _absence_
fails), never a pass/fail on `drifted`; prove it against reddoor-starter (must report no changes) and
against a repo with a known-missing config. Two corrections: (a) the prettier claim is soft — among
the 13 maintained, only `data-dynamiq` lacks a prettier config, and `erp-industrial` and `1836dig`
carry `.prettierrc` rather than `.prettierrc.json`, so "five repos have no prettier config" needs
re-deriving across the wider 23 before it is quoted; (b) the run needs 23 checkouts, and two org
repos (`composition-hospitality`, `the-tower`) have none locally — so it must clone in CI, which is
fine but not free.

---

## 5. Individual verdicts on the rest

### 5.5 Candidate 5 — "Fire one known-good row through the lead-path alarms" — REFUTED

**The Turnstile half is a rule working as designed being reported as a regression.** The candidate's
own evidence quotes the asymmetry at `src/audits/function-health-airtable.ts:60` and the comment
explaining it: on 2026-09-04 a site deployed with a sitekey already at Cloudflare's 10-hostname cap
reported `turnstile: true` while the live widget threw 110200 and minted no token. #695 therefore
made the verdict refuse to claim `pass` without live proof. The result — an empty column, and a red
guardrail that cannot fire — is **#695 working**: it traded a signal that was proven wrong for no
signal, deliberately. That is not a defect; it is an open decision ("nothing currently produces a
live Turnstile verdict for any site — accept, or wire the probe"). Framing it as a broken guardrail
invites exactly the loosening the candidate itself warns against.

**The deadletter half is real but is not a candidate — it is item (5) of candidate 9 and the final
paragraph of candidate 16.** I verified the gap:
`grep -rain 'deadletter|dead_letter' src/alerts/ src/dashboard/ .github/workflows/` → **zero hits**,
and `AttentionItem.kind` at `src/alerts/attention.ts:40-52` is exactly
`vuln | delivery | renovate | lighthouse | ci | analytics | preflight | turnstile | notify-bounce |
prismic-drift` — no `deadletter`, no `form-e2e`, no `unknown-site`. Correct, and already twice
represented on the slate.

### 5.9 Candidate 9 — "#645 before Phase 6" — SURVIVES NARROWED

Verified: #645 open since 2026-08-31T23:57:40Z with **0 comments**; `src/forms/ingest.ts:195` is
still `if (!site) return { status: "unknown-site", slug };`, with the dead-letter path above it at
`:181-194` firing only when the lookup **throws**; `src/db/freeze.ts:44-48` still describes the
Airtable write as _"the shadow for the one-week rollback window"_, twelve days past its own claim.
The ordering argument is mechanically sound: Phase 6 deletes the shadow, and `mirrorMissed` is
currently the only thing that notices an Airtable row with no Turso row.

**Narrowing — the tense is wrong.** _"this is the only failure in the fleet that loses a client's
revenue-bearing data silently and permanently"_ is present tense. Run 34696929623 (2026-09-12)
printed `mirrored=13 mirror_failed=0 mirror_missed=0`: every maintained site has a Turso row today.
This is a **latent** gap that becomes live the next time a site is created, a row is deleted, or
Phase 6 lands. That changes the scheduling claim from "a lead is being lost now" to "must land before
Phase 6 or before the next `/new-site`, whichever comes first" — still correct, still first in its
sequence, but not an emergency.

The candidate's own risk note names the right ten minutes: establish whether any of the five
non-maintained sites with live form wiring is deployed and taking traffic. Do that first; it decides
latent vs live.

### 5.10 Candidate 10 — "Declare the rollback window closed" — SURVIVES NARROWED TO ONE HOUR

Verified: #646 open since 2026-08-31 with **0 comments** and `updatedAt == createdAt`; #539 and #612
also still open; 58 open issues total; `db parity` exists at `src/cli/commands/db.ts:165` and
`grep -rn 'db parity|db sync|import-airtable' .github/ scripts/` returns nothing.

**Narrowing — the headline claim is overstated.** _"nothing has verified in 12 days that the shadow
is intact, so 'we can roll back' is an assumption"_ ignores a standing instrument the candidate
itself cites. `src/db/freeze.ts` documents that the Airtable mirror write is **deliberately still
allowed to fail its caller**: _"a shadow you might roll back to is one you keep trustworthy, so an
Airtable outage still reds writes until Phase 6 deletes the shadow."_ For everything the nightly
sweeps write, the shadow's integrity is enforced continuously — a divergence reds the run. The real
unverified surface is narrower: rows the nightlies do not touch (the 17 Reports rows, anything
outside the 13 maintained).

**What survives, and it is genuinely valuable:** run `db parity` by hand once and record the output
(under an hour), then write the dated decision — _"closed as of \<date\>, on this evidence"_ or
_"open until \<date\>, and here is the nightly job that keeps it honest."_ Three sources currently
disagree (the code, the comments, the operator's own statements) and agents read all three; #698
records that costing two wrong actions in one session.

**What does not survive:** _"then execute #646's eight dependency-ordered steps."_ Phase 6 is the
single largest deletion in a 58-issue backlog. Putting it inside a one-week window alongside 24 other
candidates is how a meta week becomes a migration week. The candidate's own timing trap makes the
case: the report send path will not self-exercise again until roughly late November, so step 2 needs
its own deliberate proof. That is a scheduled project, not a meta-week line item.

### 5.11 Candidate 11 — "Backup off GitHub, passphrase off the laptop" — SURVIVES NARROWED

Verified: `fleet-db-backup.yml:111-115` uploads via `actions/upload-artifact` with
`retention-days: 30` and there is no other upload target; `~/.config/reddoor-maint/` holds
`credentials.env` plus **three** `.bak` copies (2026-08-10, 2026-08-14, 2026-09-01) — all in the same
directory on the same machine — and `BACKUP_PASSPHRASE` is among the 27 keys there. The good half is
measured too: the candidate is right that recovery is proven, and fleet memory records the hosted-
target rehearsal with the real gpg artifact.

**Narrowing — the candidate flags its own gap and it is decisive.** _"I can see the passphrase is in
one file in `~/.config` but not whether a copy exists in 1Password."_ Fleet memory records six
DNS/CMS items already in the Personal vault. That check is two minutes and may collapse this
candidate to its retention half alone. Do it first.

**Impact medium, not medium-high.** Recovery is rehearsed three times; this is insurance on the
inputs to a proven restore. The best rider is the one the candidate buries: promote the procedure
into `docs/runbooks/` **including the step the rehearsals never needed** — repointing
`TURSO_DATABASE_URL` across Actions secrets and the central Netlify site, because `db restore`
refuses a non-empty target (`RESTORE refused=target-not-empty`, `src/cli/commands/db.ts:377`) and a
real recovery therefore lands on a _new_ database every consumer must be pointed at. That is the
untested half of a thrice-tested procedure, and it costs nothing to write down.

### 5.12 Candidate 12 — "Inventory every credential" — REFUTED

The facts are mostly right and one measured number is wrong.

Verified: `credentials.env` holds **27** keys (candidate says 26); repo `.env` holds **33**;
`~/.config/reddoor-maint/report-edit.env` exists (166 bytes, created 2026-09-11) and
`loadCredentialsIntoEnv` in `src/util/credentials.ts` reads only `defaultCredentialsPath()`, so
**nothing loads it** — confirmed. `process.env` wins over the file (lines 51-62), confirmed. Eleven
`<SITE>_PRISMIC` legacy names in `.env` against the `PRISMIC_TOKEN_*` names the code reads,
confirmed. #650 and #710 both open with 0 comments, confirmed.

**But: "nine keys appear in both main files" is wrong. It is seven** — `RESEND_API_KEY`,
`AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `FORMS_INGEST_TOKEN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`CLAUDE_OAUTH`. (`NETLIFY_PAT` and `NETLIFY_AUTH_TOKEN` are different names, which is the candidate's
own separate finding, not a duplicate.) A measured count that is wrong by two, in a candidate whose
entire deliverable is _an accurate table_, is the wrong opening.

**Three reasons it is refuted as a week item:**

1. **Much of the "sprawl" is designed.** The canonical-path-only loader and process.env precedence
   are documented and intentional. The repo `.env` exists because CLAUDE.md names Discord as a
   deliberate exception and because it is what a local dev shell loads. Calling this "two naming
   schemes for each of three services" describes real drift; calling the whole picture a failure of
   the rule reads a documented design as an accident.
2. **The deliverable is a table.** `effort: day` for "one sitting, one table" is the classic inventory
   project, and its own risk section concedes it is blocked on #710 (`netlify env:set` exits 0 and
   writes nothing) before it can be trusted.
3. **Every credential another candidate actually needs is a single lookup, not a census.** Candidate
   13 needs `RESEND_WEBHOOK_SECRET`. Candidate 11 needs `BACKUP_PASSPHRASE`. Neither is unblocked by
   a table.

**Defensible residue — three items, ten minutes each, not a day:** delete the four dead keys and the
eleven legacy `<SITE>_PRISMIC` names; fix or delete the 401 `GITHUB_TOKEN` (#650), because the rules
point agents at that file and it hands them a dead credential; decide where `report-edit.env`'s two
keys belong, since nothing loads them today.

### 5.14 Candidate 14 — "`--limit` on every tracking-issue query" — **SURVIVES INTACT**

This is the best-evidenced item on the slate and the only one where I found a **dated firing** of the
bug in production. Verified live:

```
gh issue list --state open --json number --jq 'length'              → 30   (the default page)
gh issue list --state open --limit 300 --json number --jq 'length'  → 58   (the real count)

# the workflows' exact dedupe query:
gh issue list --state open --json number,title --jq 'map(select(.title=="Fleet protection coverage gap"))…'
  → 754                       # only the newest
gh issue list --state open --limit 200 --json number,title --jq '…'
  → 754, 652                  # both

grep -ran 'gh issue list' .github/workflows/  → 24 call sites across 9 workflows
… | grep -c limit                             → 0
```

**And here is the firing.** Comment timestamps on the two identically-titled issues:

```
#652  created 2026-09-01   comments: 09-02 09-03 09-04 09-04 09-05 09-06 09-07 09-08 09-09  ← then stops
#754  created 2026-09-10   comments: 09-11 09-12
```

On 2026-09-10 the dedupe query returned empty, so the sweep filed a **new** issue rather than
commenting on the existing one. Both are still open, both carry the same title, and the close loop —
which iterates the same truncated page — can never reach #652 again. That is the truncation bug,
observed, on a date, in the alarm channel every other instrument on this slate depends on to reach a
human. The hazard is even named and fixed one file over, in `src/github/gh.ts:640-641`:
_"the default page of 30 is exactly the trap that produced the 2026-07-31 false 'queue is empty'."_

**Two small refinements, neither reducing the verdict:**

- `--limit 200` degrades again at 200 open issues, in a backlog growing ~24/week. The durable form is
  a server-side title search or a label filter; `--limit` is the right same-day fix.
- The candidate's parenthetical — _"consider whether the close half should close only the issue whose
  body matches the current gap set"_ — should be promoted from "consider" to "do." Closing every
  same-title issue with a "Recovered" comment when they carry different gap sets is itself a false
  green, and widening the query makes it reachable for the first time.

**This should be ranked above every instrument-building candidate on the slate.** Adding a new alarm
to a channel that silently drops its oldest issue past 30 is negative value.

### 5.15 Candidate 15 — "Roster reconciler" — NARROWED HARD

The disagreements are real. Verified from the corpus: Airtable `Websites` has **45 rows** with exactly
the claimed distribution `{maintained: 13, archived: 12, external: 9, building: 7, hosted-only: 2,
launching: 2}`; `Worthe` is `archived` while `#worthe` is the busiest channel in the corpus (100,
API-capped); `#trinity-law-school` (33) and `#roalson-interests` (13) have no matching row;
`29 Navy` is `building` with an empty `Git repo` cell while the repo exists locally and publicly;
`composition-hospitality` and `the-tower` are org repos with no local checkout.

**One measured claim is wrong.** _"four non-archived rows with an empty `Git repo` cell"_ — there are
**fifteen**. Four of them are `building` (29 Navy, Domaru, Williamson Homes, Williamson Construction
Co); the rest are `external` (9) and `hosted-only` (2), which legitimately have no repo.

**And that is the refutation of the tool.** The candidate's own risk section concedes the first run
_"will produce a long, noisy list"_ needing _"an explicit expected-absence table."_ That table is the
actual deliverable and it is hand-maintained — which reintroduces the hand-edited-cell problem the
reconciler exists to remove, one layer up. Fifteen of forty-five rows are legitimately repo-less. A
four-source diff over a population that is two-thirds legitimate absence is a noise generator unless
somebody first writes down what each `Status` value _means_, and that is prose, not code.

Second objection: **this re-discovers a documented constraint.** Fleet memory already carries
_"status=maintained gates ALL fleet sweeps — ⚠️⚠️ moving a site off `maintained` silently drops every
sweep."_ The boundary is known. What is missing is a decision, not a detector.

**What survives, and it is an hour:** read the four lists side by side once, by hand, and write down
three answers. (a) Do `launching` sites with live URLs (hedloc, alamo-anatomy) join the security
sweep? (b) Fill 29 Navy's `Git repo` cell **before** anyone flips its status, since a `maintained`
row with no repo makes the clone throw on the first swept night. (c) What are `#trinity-law-school`
and `#roalson-interests`, and should they exist anywhere in the tooling? Building an audit to
generate a list a human can read in an hour is the expensive route to the same three decisions.

### 5.22 Candidate 22 — "Reconcile the three cookie facts" — **REFUTED, by running its own test**

Every fact the candidate states is true. I verified all three: `la-homelessness-youth` has no
`overrides:` block in `pnpm-workspace.yaml`; its lockfile resolves `cookie@0.6.0` at lines 718/1803/
2052, arriving as `@sveltejs/kit`'s own dependency; its sibling `la-homelessness-initiative` pins
`"cookie@<0.7.0": "^0.7.2"` with an explanatory comment and resolves 0.7.2.

**But the candidate's decisive step (1) takes sixty seconds, not a day, and I ran it.** From an
unsandboxed shell (the sandbox TLS error the candidate hit is real and is the only reason this was
ever open):

```
repos/reddoorla/la-homelessness-youth/dependabot/alerts?per_page=100   (no state filter)  → []
repos/reddoorla/la-homelessness-youth/vulnerability-alerts             → HTTP 204  (ENABLED)
orgs/reddoorla/dependabot/alerts?state=open                            → 35 alerts, 22 HIGH
```

**All three facts reconcile with no defect anywhere.** Alerts are enabled. The API is demonstrably
live — it is returning 35 alerts across 15 other repos in the same org, including HIGH `sharp` on
nine of them. And `la-homelessness-youth` has **zero alerts in any state, ever**, not even dismissed
ones. GitHub simply does not raise GHSA-pxg6-pf52-xh8x against that lockfile. An override is absent,
a lockfile resolves 0.6.0, and no alert exists — that is an advisory not applying, not an instrument
being blind.

The candidate explicitly staked itself on this branch: _"high in a different direction if it says
zero alerts, because then the fleet's security audit is blind for the whole class and every green it
has ever printed needs re-reading."_ The org-wide positive control refutes that conclusion outright.
The audit is reporting what GitHub reports, and GitHub is reporting plenty.

Severity, for completeness: GHSA-pxg6-pf52-xh8x is a low-severity out-of-bounds-characters issue in
cookie name/path/domain, reachable only if attacker-controlled data reaches cookie serialization.
`la-homelessness-youth` is a portfolio copy and is one of the two documented **formless** sites — no
form, no user input path.

Items (2) and (3) survive only as riders elsewhere: templating `overrides` into `sync-configs`
belongs to candidate 21 and carries the candidate's own warning that it can clobber caltex-landing's
deliberate `@sveltejs/kit>cookie` parent>child pin; restoring the `pnpm-workspace.yaml` leading
comment is a one-line fix worth doing whenever someone is next in that file.

**The candidate did the right thing by refusing to claim either reading before measuring. It simply
budgeted a day for a measurement that costs a minute — and the measurement kills it.**

### 5.24 Candidate 24 — "Blux formatting debt + forward pointers" — SPLIT

**The forward-pointer half SURVIVES and is the cheapest real item on the slate.**
`docs/superpowers/specs/2026-08-31-starter-track-split-design.md:72-74` still instructs
`git merge starter/main`; CLAUDE.md:194 carries the _corrected_ rule and then points the reader at
that exact spec. The repo already invented the affordance (`> Superseded in part by …`) for journal
entries. Two lines, five minutes, and it protects an agent arriving today at the document CLAUDE.md
sends them to. Do it first, not as part of a half-day project.

**The prettier-collapse and canvas-starter halves are REFUTED as week items**, on the candidate's own
larger risk: _"blux has ~20k lines in the central repo with no workflow exercising it and its first
real consumer (the-pointe) archived."_ Investing half a day restoring a propagation channel for a
track whose only real consumer is an archived repo is the clearest cost-exceeds-benefit case on the
slate. The candidate concedes the prior question is worth thirty minutes — which means the real
candidate is _one thirty-minute operator decision: is `src/blux` substrate or dead weight?_ Nothing
downstream of that question should be built before it is answered. The prettier claim is also
explicitly inferred and not executed, so it would need its own throwaway-clone proof on top.

### 5.25 Candidate 25 — "Plan-phase boundary as session boundary" — REFUTED AS PROPOSED

The measurements are solid — 33 sessions holding 90% of operator turns, 111 of 116 attributable
auto-compactions inside them, median span 29.3h. The diagnosis (work is scoped by project, not by
deliverable) is plausible. **The proposed mechanism is the weakest part and the evidence supplied
argues against it.**

1. **It proposes a rule in CLAUDE.md enforced by nothing** — the exact enforcement model candidate 2
   correctly identifies as failing for the house rule. And this repo already has a _mandatory_ rule of
   precisely this shape: _"Never commit from the main checkout. Before your first commit, move to your
   own git worktree."_ The slate's own metrics report `using-git-worktrees` invoked **three times**
   across 3,469 sessions. A new mandatory CLAUDE.md rule, in a repo whose existing mandatory CLAUDE.md
   rule is honoured three times in 3,469 sessions, has a measured compliance prior near zero.
2. **The container problem is concentrated where the business value is lowest.** The two worst
   sessions are **Broken** (98.2h and 54.9h), and `octagonal-led-turn-counter` burned 50.9 session-
   hours for zero commits. Personal projects are ~a third of recorded session-hours. A handoff ritual
   for fleet work does not touch either of the top two offenders.
3. **The skill-count evidence is a derived view read as the state itself** — which is the failure
   #711 is open about. `writing-plans` 45 / `executing-plans` 4 measures _skill invocation_, not
   practice. "Plans are written then executed in the same swelling container" is one reading; "45
   plans were written and executed directly, and a ceremony-heavy skill was declined" is another, and
   nothing here separates them.
4. **Its single piece of hard evidence argues the opposite of its thesis.** The 2026-08-12 case:
   _"'The pixel-matching program has ENDED' was carried **inside** the compaction summary and violated
   ~30 minutes later — the instruction survived compaction and the behaviour did not."_ That is a
   compliance failure, not a lossy handoff. A better-authored handoff fixes nothing there.

**Defensible residue:** the work journal is _already_ mandated by CLAUDE.md and is already
correction-safe by rule, so the ritual largely exists. The one free, unclaimed practice the candidate
gestures at is smaller and does not need a rule: **29 of 33 heavy sessions auto-compacted and not one
of those summaries was reviewed** — when a compaction notice appears, read the summary and correct it
before continuing. That is worth writing down.

I flag explicitly that this is the only candidate about the operator's own working practice in a week
framed as working _on_ the system, and that refuting it leaves the slate 100% code. That is a
legitimate argument for keeping something in this lane. It is not an argument that _this_ mechanism
works, and the evidence offered does not support it.

---

## 6. Verdict table

| #   | Candidate                                      | Verdict                                | Why                                                                                                                                   |
| --- | ---------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `--limit` on tracking-issue queries            | **SURVIVES INTACT**                    | Dated firing observed (#652 → #754 on 09-10); 24 sites, 0 with `--limit`; the delivery layer for every other item                     |
| 13  | Read secret-scanning alerts, not the switch    | **SURVIVES** (spine of merged cluster) | Instrument gap verified; correct severity; unique finding that `self-updating` has no secret-scanning step                            |
| 9   | #645 before Phase 6                            | SURVIVES NARROWED                      | Real and correctly sequenced, but **latent**, not "losing leads today"                                                                |
| 16  | form-e2e self-skip counter + rollout           | SURVIVES SPLIT                         | Gate fix = hours, do it. Five client production deploys ≠ meta week                                                                   |
| 21  | Schedule `sync-configs --dry`                  | SURVIVES NARROWED                      | Engine exists and is unscheduled; counted report, measured-count gate only                                                            |
| 23  | Measure a11y debt (13 maintained)              | SURVIVES NARROWED                      | Graft #680 from cand. 4 as the positive control; effort multi-day; impact medium                                                      |
| 18  | Renovate outcome metric                        | SURVIVES NARROWED                      | Metric right (non-security); "one field on the existing parser" is wrong — needs a ref scan                                           |
| 20  | Settle the grouped channel                     | SURVIVES NARROWED HARD                 | Use the dashboard checkbox today, not a ci.yml mutation next Monday; impact medium, not high                                          |
| 11  | Backup off GitHub, passphrase off laptop       | SURVIVES NARROWED                      | Check 1Password first (2 min); add the `TURSO_DATABASE_URL` repoint step to the runbook                                               |
| 10  | Declare the rollback window closed             | SURVIVES NARROWED TO ONE HOUR          | `db parity` + a dated written decision. Phase 6 is not a meta-week item                                                               |
| 15  | Roster reconciler                              | NARROWED HARD                          | The audit is refuted; three written decisions survive, ~1 hour                                                                        |
| 24  | Blux + forward pointers                        | SPLIT                                  | Pointers: 5 min, do it. Prettier/canvas: refuted pending one 30-min decision on `src/blux`                                            |
| 7   | Five leaked-credential alerts                  | **FOLDED into 13**                     | Two unique actions grafted (`whsec_` comparison, validity checks)                                                                     |
| 19  | Restrict-then-rotate + posture floor           | **FOLDED into 13**                     | Two unique contributions grafted (`unavailable` convention, #650 token risk)                                                          |
| 1   | Read the alert list, not the switch            | **REFUTED**                            | Duplicate (1 of 5); unsupportable "largest false green" superlative                                                                   |
| 8   | Make an alert visible + clear posture alarm    | **REFUTED**                            | Duplicate; its novel observation is candidate 14's bug                                                                                |
| 2   | Machine-checked "prove the instrument"         | **REFUTED**                            | The meta-check passes on every failure it exists to catch; #711 already refuted it                                                    |
| 3   | Close the two gates                            | **REFUTED**                            | Duplicate of 16; release-health half is a documented design decision misread as a detection failure                                   |
| 4   | a11y gate scans the site                       | **REFUTED**                            | Duplicate of 23 with a worse scope; step (1) grafted onto 23                                                                          |
| 5   | Fire a known-good row through lead-path alarms | **REFUTED**                            | Turnstile half is #695 working as designed; deadletter half is inside 9 and 16                                                        |
| 6   | Renovate outcome instrument                    | **REFUTED**                            | Duplicate of 18, looser                                                                                                               |
| 12  | Credential inventory                           | **REFUTED**                            | Census is a project; miscounts its own headline number; three 10-min items survive                                                    |
| 17  | Per-site conformance report                    | **REFUTED**                            | Duplicate of 21; builds a second drift engine beside a tested unscheduled one                                                         |
| 22  | Reconcile la-h-youth cookie                    | **REFUTED**                            | Its own decisive test, run here in 60s: alerts enabled, 35 open org-wide, this repo has zero in any state. Facts reconcile; no defect |
| 25  | Plan-phase session boundary                    | **REFUTED AS PROPOSED**                | Enforcement model has a measured near-zero compliance prior; its own evidence argues the other way                                    |
| —   | **MISSING: 22 open HIGH Dependabot alerts**    | **ADD**                                | 35 open alerts / 15 repos; 9 client repos have a green, mergeable `sharp` PR waiting on a human                                       |

**Tally:** 11 refuted outright · 2 folded into a survivor · 1 survives intact · 11 survive narrowed ·
1 addition the slate missed.

---

## 7. What the refutation says about the slate as a whole

Three patterns, offered because they will recur next time:

**1. The slate mistakes agreement for corroboration.** Five independent lenses converged on
secret-scanning and each wrote it up as its own candidate. Convergence across lenses is evidence the
finding is _real_; it is not evidence it is _the most important thing_. The measure that would have
caught this is the one nobody applied: after finding the leaked browser key, ask what _other_ alert
channels exist and whether they are also unread. One `gh api orgs/reddoorla/dependabot/alerts` call
returns 35 open alerts, 22 HIGH, with ready fixes — a strictly larger, strictly more actionable
exposure that zero candidates found because every lens was looking at the same thing.

**2. Several candidates budget days for measurements that cost minutes.** Candidate 22 gated a day of
work on an API call I ran in 60 seconds, and the call killed the candidate. Candidate 20 budgets a
week to wait for Monday when a checkbox in a live GitHub issue answers the same question today.
Candidate 11 budgets half a day on a premise it can falsify in two minutes by opening 1Password. The
house rule's cheap corollary applies to the _diagnosis_ as well as the gate: run the decisive
measurement before ranking the work that depends on it.

**3. The one candidate claiming to be the generator of the others is the one that fails hardest.**
Candidate 2 would mechanise "prove the instrument," and the mechanism it proposes would have passed
every historical failure the rule was written for. That is worth keeping visible: the rule resists
mechanisation precisely because the thing it guards — _does this check measure what it claims_ — is
semantic. The parts of this slate that honour the rule best are the ones that name a specific PASS
control and a specific FAIL control that both exist today (candidate 13 has both; candidate 18's
two-snapshot proof is the right shape), not the one that tries to make the obligation structural.
