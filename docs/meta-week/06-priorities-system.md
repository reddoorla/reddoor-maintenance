# 06 — System priorities for the meta week

**Scope:** the fleet, the code, the data, the automation. Track `system` only.
The workflow/practice track (session shape, credential policy, continuity,
the rollback-window _decision_, backlog throughput) is a separate document;
where a system item is coupled to one of those, the coupling is named.

**Date:** 2026-09-12. Inputs: the 25-candidate slate, the three challenge
documents, and my own live re-derivation of every claim I put in the top five.

---

## The one thing

**Every instrument this fleet owns measures machinery, not outcomes — and the
proof is that the research package itself missed the largest live exposure on
the estate.**

The secret-scanning audit reads whether the _scanner is switched on_, never what
it found. The three Renovate audits read whether the _workflow ran_, never
whether an update landed. `fleet-form-e2e` reads whether the _job finished_,
never whether it measured anything. The tracking-issue channel reads the _first
page_ of open issues, not the list. Each of those is individually defensible and
jointly they produce a fleet that is green on every question it can answer and
blind on every question that matters.

The clearest instance is not in the 25 candidates at all. Right now there are
**35 open Dependabot alerts across 14 repos, 22 of them HIGH**, and the largest
cluster — `sharp` GHSA-rgj7-g3m4-5g8c, a **direct** dependency on **nine client
repos** — has a green, mergeable fix sitting in **18 open Renovate PRs filed
2026-09-09**. They are unmerged because `sharp` is in the never-auto-merge
packageRule, which is the rule _working_: it requires a human. Twenty-five
research candidates, five of which chased secret-scanning alerts whose worst
member is a browser key the site serves to every visitor by construction, and
not one of them ran `gh api orgs/reddoorla/dependabot/alerts`.

So the week's first act is not to build an instrument. It is to **clear the
outcome that is already measured, already fixed, and waiting on one hour of a
human's attention** — and then to close the outcome-blindness that let it sit
there, starting with the alarm channel that silently drops its oldest issue.

---

## How to read this

Evidence is tagged:

- **[M]** — measured by me today, with the command. Reproducible in minutes.
- **[M✓]** — measured by a challenge agent and independently reproduced by a
  second one. I did not re-run it; two independent routes agreed.
- **[I]** — inferred. A mechanism or a consequence argued from measurement,
  not itself observed. Treat every `[I]` as a hypothesis with a named test.

Ranking is (impact × confidence) / effort, reasoned per item rather than scored.
Two things outrank that arithmetic where they apply: an **external clock** the
week does not control, and **irreversibility** — because the collapse pattern
(a ~90% output drop within days of every peak, and this week is scheduled
directly after one) means instrument-building survives interruption and
deadline-bound work does not.

**A note on the security exposure in the brief.** It is real, it is correctly
described, and it is **item S3, not item S1**. The reasoning is in S3; the short
version is that a `VITE_GOOGLE_MAPS_KEY` is compiled into the shipped client
bundle and served to every visitor by construction, so the git-history leak adds
close to zero incremental disclosure and secrecy was never the control. The
part of that cluster that deserves urgency is not the Maps key — it is the
`whsec_` value in the central repo and the two public client repos with push
protection switched **off**.

---

# DO THIS WEEK

---

## S1 · Merge the 18 green `sharp` security PRs across nine client repos

**What to do.** Sit down once and merge the `sharp` wave. Nine repos, two PRs
each: one bumps the dependency, one bumps the pnpm override. Prove the bump on
one repo end-to-end first — merge both PRs on `reddoor-starter`, confirm the
build and that images still render on a deploy preview — then do the other
eight. `sharp` is a build-time image dependency; a green `ci` is good signal but
a rendered image is the real one.

**Why.** It is the largest genuinely-exposed security debt on the estate, the
fix is already written and already green, and the only missing input is a human
decision the packageRule deliberately requires. It costs hours, builds nothing,
and discharges no proof obligation. Nothing else on this list has that shape.
It is also `08-second-pass.md` §4 item **A7** — already parked for the operator
and still parked.

**Evidence.**

- `gh api "orgs/reddoorla/dependabot/alerts?state=open&per_page=100"` → **35
  open alerts**, severity split `{high: 22, low: 6, medium: 7}` across 14 repos. **[M]**
- Grouped by package, the `sharp` cluster is **9 alerts, 9 repos, all
  `relationship: direct`**: alamo-anatomy, caltex-landing,
  composition-hospitality, espada, gallerysonder, medical-solutions-of-texas,
  reddoor-starter, revogen, vineyard-custom-homes. **[M]**
- Open PRs, via REST (`/pulls?state=open`, title-matched): exactly two per repo
  on all nine, every one created **2026-09-09** — gallerysonder #96/#97,
  espada #70/#71, reddoor-starter #118/#119, revogen #75/#76,
  caltex-landing #62/#63, medical-solutions-of-texas #63/#64,
  vineyard-custom-homes #62/#63, alamo-anatomy #54/#55,
  composition-hospitality #26/#27. **[M]**
- gallerysonder #96 `chore(deps): update dependency sharp to v0.35.4 [security]`
  and #97 `chore(deps): update dependency sharp@<0.35.0 to ^0.35.4 [security]`,
  both `mergeable: true`, `mergeable_state: clean`, `ci / ci = success`
  on the head SHA. **[M]**
- They are held by the shared preset's
  `matchPackageNames: ["@reddoorla/maintenance","sharp",…], automerge: false`.
  That is the rule working as designed, exactly as the preset's own description
  records for the 16-PR misread of 2026-08-12. **[M✓]**

**Effort.** 2–4 hours, most of it waiting on CI after the second merge per repo.

**Done looks like.** Nine repos at `sharp@^0.35.4` in both the manifest and the
override; `gh api orgs/reddoorla/dependabot/alerts?state=open` no longer returns
a `sharp` group; one repo verified visually (images render on the deploy
preview), not just green.

**What would make it a mistake.**

- Bulk-merging all 18 without proving one repo first. Fleet memory records two
  separate override-key misreads (`brace-expansion`, `cookie@<0.7.0 to v1`) where
  a Renovate title about an override was read as a dependency bump. Read one
  diff per repo.
- Merging PR A and then rebasing PR B. Once A lands, B goes `dirty` — and a
  `dirty` PR gets **no** `pull_request` CI. Merge `main` **into** B; do not
  rebase.
- Extending this to the other 26 alerts without reading them. `extract-zip`,
  `js-yaml`, `ip-address`, `nanoid`, `joi`, `vitest` are all **transitive** and
  mostly dev-only, and this fleet has a documented `pnpm-workspace.yaml`
  override idiom for that class plus a documented **ghost-vuln** failure mode
  (GitHub keeps a manifest in the dependency graph after the file is deleted, so
  some alerts have nothing to fix). The `sharp` nine are direct, on client
  production repos, with a fix in hand. Those are the ones this item covers.

---

## S2 · Put `--limit` on all 24 tracking-issue queries, and make the close half match the gap set

**What to do.** Add `--limit 200` (or a server-side `--search` on the title) to
every `gh issue list` call in `.github/workflows/`. Close the orphaned #652 by
hand with a note saying what healed it. Change the close half so it closes only
the issue whose body matches the _current_ gap set, not every issue sharing a
title. Then write the gate test in the house style: extract the dedupe shell the
way `tests/build/fleet-smoke-workflow.test.ts` already extracts a gate's `run:`
block, and run it against a stubbed `gh` returning 40 open issues with the
tracking title at position 35 — **positive control first**, the same harness with
the title at position 2, which must find it.

**Why.** This is the delivery layer for every alarm in the fleet, including
every instrument the rest of this list proposes. It degrades as a function of a
number that is currently growing 20–35 issues per week. And it is not a code
smell — it has already fired, on a date, in production.

**Evidence.**

- `grep -ran "gh issue list" .github/workflows/` → **24** call sites;
  `grep -ran -A3 "gh issue list" .github/workflows/ | grep -c limit` → **0**. **[M]**
- Live today, the workflows' own dedupe query:
  `gh issue list --state open --json number,title --jq 'map(select(.title=="Fleet protection coverage gap"))'`
  returns **#754 only**. The same query with `--limit 200` returns **#754 and
  #652**. The truncation is live. **[M]**
- **59** open issues in the central repo today (`--limit 400`). **[M]**
- The firing, dated: #652 was created 2026-09-01 and commented daily
  09-02 → 09-09; on **2026-09-10** the dedupe returned empty and the sweep filed
  #754 with an identical title. Both are open; the close loop iterates the same
  truncated page, so #652 can never be closed by the machine. **[M✓]**
- The hazard is named and fixed one file over — `src/github/gh.ts:635-636`:
  _"the default page of 30 is exactly the trap that produced the 2026-07-31
  false 'queue is empty'"_ — and applied **nowhere else**. **[M✓]**

**Effort.** Hours. One sed plus review, one test, one manual close.

**Done looks like.** All 24 sites carry a bounded-or-unbounded query; a gate test
in `tests/build/` that passes on the title-at-position-2 control and fails on the
title-at-position-35 case; #652 closed by hand; the close step gated on a body
match rather than a title match.

**What would make it a mistake.**

- Shipping `--limit 200` and calling it fixed. At the current opening rate the
  list passes 200 inside a few months and this silently returns. Say so in the
  commit message, and prefer a title search where the call site allows it.
- Letting the widened close loop sweep a backlog of same-title orphans with an
  automated "Recovered" comment when they carry different gap sets. That would
  trade a truncation bug for a false green. Close #652 by hand **first**.
- Adding any new auto-filing alarm before this lands. Seven new instruments
  filing nightly into a channel that closes 4–7 items a week is not seven
  improvements; it is one guaranteed regression.

---

## S3 · Settle the five leaked-credential alerts, and make the posture floor read alert _outcomes_

This is the merge of five candidates into one item. The refuter's framing is
right: four proposals converging on one finding is evidence it is _real_, not
evidence it is _the most important_. Cap it at half a day plus console time.

**What to do — in this order, and the order carries the whole argument.**

1. **Read the Google Cloud console first (10 min).** For each of the three
   distinct `google_api_key` values, read the current **application restriction
   state** and the owning project's **billing cap**. Nobody has done this, and
   it is the only place the answer lives. GitHub cannot say — validity checks
   are off, so all five alerts read `validity: unknown`.
2. **Restrict by HTTP referrer (≈10 min per key).** Prod domain, the Netlify
   preview pattern (`*--<site>*.netlify.app`), and localhost; plus an API
   restriction to the Maps JavaScript API. Reversible, zero downtime, no client
   conversation, and it makes every leaked copy inert off-domain immediately.
3. **Compare the `whsec_` fixture against the live `RESEND_WEBHOOK_SECRET`
   (2 min).** If it matches: regenerate in Resend, update the Netlify env var.
   If it differs: dismiss the alert as `used_in_tests` with that note. Either
   way it stops being an unread line.
4. **Enable `secret_scanning_validity_checks` org-wide (one toggle).** It
   supplies the one fact — is this key still live — that decides
   restrict-vs-rotate for every future alert.
5. **Enable secret scanning and push protection on `vida-legacy-foundation` and
   `29-navy` (two API calls).** This is the gap #754 has been naming nightly
   since 2026-09-10, unactioned.
6. **Add the instrument.** One `GET /repos/{o}/{r}/secret-scanning/alerts?state=open`
   per public repo, folded into `secretScanningGaps` as a third clause, on the
   same `PROTECTION_AUDIT` marker line the gate already keys on. Prove it in
   both directions before trusting either verdict: it must return **1** for
   `beachfront-dentistry` (FAIL control) and **0** for `erp-industrial` and
   `espada` (PASS controls) — I confirmed all three today. Follow the file's own
   convention: a token that cannot read alerts produces `unverified`, never
   `fine`.
7. **Fix the alarm's false heal line.** #754's body says _"Heal: run
   `reddoor-maint self-updating <site>`"_, and that recipe contains no
   secret-scanning step. Either add the enable step to the recipe, or correct
   the text. An alarm prescribing a remedy that does not exist is its own
   unproven instrument.

**Rotation is the operator's call and it is not urgent.** Restrict-then-rotate;
rotate each key on that site's next scheduled deploy, when you are touching it
anyway. Rotate-first can break a client's live map with no rollback and buys
nothing restriction does not buy in ten minutes, because the replacement key is
published in the next bundle regardless.

**What the exposure actually is, in the meantime.**

| secret                                | worst case                                                                                                                                  | class                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 3 × `google_api_key` (browser keys)   | third-party Maps JS calls billed to the owning GCP project up to its quota/billing cap                                                      | billing/quota. **Not** client data, **not** site control, **not** leads   |
| 1 × `whsec_` in `reddoor-maintenance` | if live, a third party can forge Resend delivery-status POSTs into `resend-webhook.mts` and write false `Delivery status` onto Reports rows | integrity of the record that says whether a client's report was delivered |
| `vida-legacy-foundation`, `29-navy`   | a genuinely dangerous secret pushed there is neither blocked at push nor detected afterwards                                                | the only two repos with no first line of defence                          |

**Why the ranking is S3 and not S1.** Two of the three Maps keys are clients'
(the-pointe's, in the public template every new site is cloned from; and
beachfront's live key). But `VITE_GOOGLE_MAPS_KEY` is consumed in
`BluxWidget.svelte`, `LocationMap.svelte` and `FrozenPage.svelte` and injected
into a `<script src="maps.googleapis.com/maps/api/js?key=…">` — a Vite client
var compiled into the shipped bundle. The incremental disclosure from the git
history is close to zero. The 99-day-old alert is a real instrument failure and
a real 10-minute fix; it is not a data breach, and ranking it above 22 HIGH
dependency alerts with unmerged fixes would be the same over-dramatisation the
refuter flagged.

**Evidence.**

- Five open alerts today, every one `resolution: null`, verified by me in one
  loop that also returned genuine zeros for two controls: `reddoor-maintenance`
  #1 `stripe_webhook_signing_secret` 2026-06-09 (95 d); `gallerysonder` #1
  `google_api_key` 2026-06-05 (99 d); `reddoor-starter` #1 2026-07-24 (50 d);
  `beachfront-dentistry` #1 2026-08-06 (37 d); `reddoor-starter-blux` #1
  2026-09-01 (11 d); `erp-industrial` and `espada` → empty. **[M]**
- `src/audits/protection-coverage.ts:117-127` — `secretScanningGaps` takes
  `{secretScanning, pushProtection}` and compares exactly two status strings,
  nothing else. Read it today. **[M]**
- `grep -rain "secret_scanning|secret-scanning|secretScanning" src/recipes/` →
  **zero hits**. The `self-updating` recipe cannot do what #754 tells you to
  run. **[M]**
- Four distinct secrets, five repos: `reddoor-starter` and
  `reddoor-starter-blux` share one key (sha256 prefix `530de1c69475`) at the same
  path — the blux snapshot inherited the leak at the track split. **[M✓]**
- The leaked `whsec_` value is **byte-identical** to the repo's current
  `TEST_SECRET` at `tests/webhook/resend-webhook.test.ts:195`: `whsec_` + 32
  alphanumerics, no `test`/`fake`/`example` in it. **[M✓]**
- No `AIza`-shaped string exists in any _tracked_ file at HEAD in
  `beachfront-dentistry`; the value is reachable in history from `c10a05b`.
  Redaction at HEAD (`e30c756`) accomplished nothing on a public repo. **[M✓]**
- Nobody has established that any leaked key is still live. **[I — and it is the
  decisive unknown; step 1 exists to close it.]**

**Effort.** Half a day for steps 3–7, plus ~40 minutes of console time for
steps 1–2 which should happen before the week starts.

**Done looks like.** Three keys referrer-restricted and verified on a deploy
preview before prod; the `whsec_` question answered with an action either way;
validity checks on; scanning enabled on the two disabled repos; a third clause
on `secretScanningGaps` that names exactly those repos with open alerts and
nothing else, with both controls recorded in the test; #754's heal line true.

**What would make it a mistake.**

- A referrer list that omits the Netlify preview domain. It breaks the map on
  every future deploy preview, silently. Test on a preview before locking prod.
- Rotating before restricting. It breaks a client's live map with no rollback,
  and nothing in the fleet checks that a map renders.
- Shipping the new clause without proving the PASS control. #650 records that
  `credentials.env`'s `GITHUB_TOKEN` returns 401, and the alerts endpoint needs
  `security_events` scope — so a scope failure would read `unavailable`
  fleet-wide and become a third instrument that is green on a question it cannot
  fail. That is the exact failure this item exists to fix.
- Letting four converging candidates eat two days. The console work is minutes;
  the instrument is half a day; there is nothing else here.

---

## S4 · Prove the maintenance-report path on one quarterly site before 2026-10-05

**What to do.** Draft, approve and send **one** Maintenance report end to end,
for a quarterly site, through the real path. Use Reddoor's own row — it is
`maintained`, quarterly, carries explicit `Report recipients (To)`, and is the
only client in the fleet you cannot embarrass. Then run
`report <slug> --preview --enrich` against the five sites due 2026-10-05 and
**look at the ANALYTICS section of each**.

**Why.** The orchestrator exists to produce this report. In the entire recorded
life of the `Reports` table it has been produced for one site. Five quarterly
sites come due on the same day, three weeks after the meta week, on a path that
has never run for any of them — and on my own measurement, **three of those five
have no GA4 property ID at all**, which is the precondition for the exact
failure #469 already recorded once (every CI-drafted report shipping with a
blank ANALYTICS section). This is the only item on the list about the thing
clients pay for, and it has an external clock the week does not control.

**Evidence.**

- Airtable `Reports`: **17 rows** — `Announcement` ×15, `Maintenance` ×2, both
  the same site (periods `2026-07` and `2026-08`, sent 2026-07-31 and
  2026-09-01). No other site has ever had a Maintenance report drafted,
  rendered, approved or sent. **[M]**
- `Next maintenance at` across the 13 `maintained` rows: Sonder 2026-10-01;
  **Data Dynamiq, Espada, Vineyard Custom Homes, Revogen and LA Homelessness
  Initiative all 2026-10-05**; ERP Industrials and Reddoor 2026-10-25; 1836dig
  2026-10-31; Beachfront 2026-11-08; MSOT and CalTex 2026-11-21; LA Homelessness
  Youth null (portfolio copy, deliberate). **[M]**
- Of the five due 2026-10-05, `GA4 property ID` is **empty on Data Dynamiq,
  Revogen and LA Homelessness Initiative**, and populated on Espada
  (500044116) and Vineyard (495897320). `Search Console property` is populated
  on **exactly one row in the whole base** (Reddoor). **[M]**
- `point of contact` is populated on all 13 maintained rows, so the blank
  `Report recipients (To)` is not a blocker — `src/reports/preflight.ts:143-151`
  falls back to it. **[M]**
- `grep -rln airtable src/reports/` → **22 files**, and `src/reports/due.ts:1`
  types the due calculation itself on `./airtable/websites.js`. The scheduler,
  drafter, queue, preflight, send orchestrator, digest and Resend webhook are
  all Airtable-shaped — which is why the Phase 6 ordering question below is
  real. **[M✓]**
- `--preview` alone does no IO; the credential proof requires `--enrich`. This
  is the #523 lesson, in the workflow's own comments. **[M✓]**

**One correction to an existing candidate.** The rollback-window candidate says
the report send path "will not self-exercise until roughly late November."
Measured, it is **2026-10-01 and 2026-10-05**. Late November is MSOT's and
CalTex's — the last two of the batch, not the first. The available runway is
half what that candidate assumes, and it lands inside the window in which Phase
6 would execute.

**Effort.** A day. The send itself is minutes; reading five previews and filing
the GA-wiring gaps is the work.

**Done looks like.** One Maintenance report for a quarterly site in the `Reports`
table with `Delivery status = delivered`, and a human has read it. Five
`--preview --enrich` outputs inspected, with each site's analytics state written
down. A dated decision on the ordering question: either Phase 6 lands **after**
2026-10-05 so the quarterly path fires once on the store it was written for, or
it lands first and that path's first-ever execution is also its first on a
rewritten data layer. Today neither has been chosen.

**What would make it a mistake.**

- Sending a first-ever report to a real client without reading it first. Pick
  the recipient deliberately; that is why this uses Reddoor's own row.
- Treating `report --preview` as the proof. It never queues a draft, never
  writes a Reports row, and never exercises approve → send → webhook.
- Backfilling a measured analytics zero. Fleet memory: gallerysonder
  consent-gates GTM, so a zero there is real. A blank `GA4 property ID` cell
  means **unstarted setup**, not a broken report — and wiring GA immediately
  before a send is the documented way to produce a wrong number.

---

## S5 · Close the two gate holes: `fleet-form-e2e` zero-write, and release-health's close side

**What to do.** Port the `runGate` harness from
`tests/build/fleet-smoke-workflow.test.ts:50` to `fleet-form-e2e` — clean case
first. Add a `wrote == 0 → exit 1` check, copying `fleet-lighthouse.yml:106-108`
which already carries exactly that. Emit a `FLEET_FORM_E2E skipped=N` marker
line so an unfinished rollout and a regression stop looking identical, and ship
it as a **warning**, not a threshold. File the testMode rollout issue that does
not exist. Then the 20-minute rider: make `release-health`'s **close** step
require a positive marker, copying `fleet-security.yml:237`
(`if ! grep -q "PROTECTION_AUDIT gaps=0 "`), whose comment already says _"Step
outcome alone is not proof."_

**Why.** `fleet-form-e2e` is the only nightly with no zero-write check, so a
night on which nothing was probed exits 0 and reports success — byte-for-byte
the failure `FLEET_SMOKE_UNMEASURED` was invented to kill, reintroduced in the
one sweep with no gate test. Six of thirteen maintained sites are actually
probed; the gate cannot tell six from zero.

**Evidence.**

- `fleet-form-e2e.yml` has no `wrote=0` check and no unmeasured check; the
  self-skip accommodation at `:66-70` has no counter and no expiry. **[M✓]**
- `fleet-lighthouse.yml:106-108` does carry `if [ "$wrote" -eq 0 ] … exit 1`.
  The two gates executed on identical input: lighthouse exit 1, form-e2e exit 0
  — and form-e2e also exit 0 for "13 sites, all self-skipped". **[M✓]**
- The 6/7 testMode split reproduced by **two independent routes**: a per-repo
  `grep -c testMode src/routes/health/+server.ts` across the 13 maintained
  checkouts, and the Airtable `Form E2E OK` column being `pass` on exactly those
  same six rows. Declares: beachfront-dentistry, reddoor-website, MSOT, espada,
  vineyard-custom-homes, 1836dig. Absent: gallerysonder, revogen, erp-industrial,
  data-dynamiq, la-homelessness-initiative, caltex-landing, la-homelessness-youth
  — of which the last two are the accepted formless cases. **Five maintained
  sites with real forms have zero end-to-end coverage.** **[M✓]**
- `release-health.yml:97-99` sets `red=no` on an empty query and the same flag
  gates the close step at line 166. **[M✓]**
- No gate test exists for `fleet-form-e2e`, `fleet-lighthouse` or
  `release-health`. **[M✓]**

**Correction an implementer must carry.** The claim that _"the only `exit 1` is
the absent-summary case"_ is **false**: `fleet-form-e2e.yml:122` has a second one
(the >25% mass-flake gate), and the survey's own executed-gate table records that
case as `EXIT=1`. Someone reading the original candidate would add a gate that
already half-exists. **[M✓ — this is one of the five OVERSTATED numbers; see the
appendix.]**

**Scope note — this item is the hours-sized half only.** Running
`src/recipes/health-endpoint` against five live client sites means five
production deploys. That is scheduled client work, not a meta-week activity.
It goes in the next tier.

**Effort.** Hours, plus 20 minutes for the release-health rider.

**Done looks like.** A gate test for `fleet-form-e2e` that passes on the
all-clean case and fails on zero-write; the nightly emitting `skipped=N`; an open
issue naming the five sites needing the rollout; release-health's close step
refusing to close without a positive marker.

**What would make it a mistake.**

- Turning the skip count into a hard failure on night one. At today's 5-of-13
  that reds the nightly immediately, and a red everyone learns to ignore is
  worse than the false green it replaced. Warning first, threshold after the
  rollout.
- "Fixing" release-health's **filing** side. Staying silent on an empty query is
  a _documented deliberate_ design — _"a broken query must not masquerade as a
  broken pipeline"_. Only the close side is a defect: the same flag must not arm
  a "green again" close on an alarm that may still be true.

---

## S6 · Close the #645 lead-path gap — latent today, live the moment Phase 6 or `/new-site` runs

**What to do.** First ten minutes: establish whether any of the five
non-maintained sites with live central-ingest wiring is deployed and taking real
traffic — one `curl` of each `/health`, one `db row` lookup per slug. That
decides latent from live. Then #645's four items, in its own order: (1)
`ensure-site`'s `exists` branch checks for a Turso row and heals it; (2)
`unknown-site` writes a dead-letter row instead of returning empty-handed; (3)
`replay-deadletters` resolves through `makeSiteLookup` so recovery and live agree
about what the fleet is; (4) add a `deadletter` attention kind so a dropped lead
reaches the cockpit. Then the fifth item, which is the proof: POST a deliberately
unknown slug at a staging ingest, confirm a row lands, confirm the attention item
appears, delete the row, and confirm a known-good slug still ingests cleanly.

**Why.** Post-flip, a site whose Turso row is missing has every lead answered
`unknown-site` and **dropped** — no dead-letter, no alarm, no record, no
recovery. It is the only failure in the fleet that loses revenue-bearing client
data silently and permanently. And the one thing that currently notices an
Airtable row with no Turso row is `mirrorMissed` in the strict shadow write,
which **Phase 6 deletes**. The migration plan itself says #645 lands first.

**Evidence.**

- `src/forms/ingest.ts:195` is still
  `if (!site) return { status: "unknown-site", slug };`; the dead-letter path
  above it fires only when the lookup **throws**. `src/forms/site-lookup.ts:46`
  is `if (strict) return null;`. `src/reports/airtable/ensure-site.ts`'s
  `exists` branch has zero references to `getSiteBySlug` or `mirrorSiteInsert`.
  `src/cli/commands/db.ts:89,119` resolves `replay-deadletters` against the
  frozen Airtable. Every line number verified exact. **[M✓]**
- #645 open since 2026-08-31T23:57:40Z with **0 comments** and `updated_at ==
created_at`. **[M✓]**
- No `deadletter` / `form-e2e` / `unknown-site` kind exists in
  `src/alerts/attention.ts`; `grep -rain 'deadletter|dead_letter'` across
  `src/alerts/ src/dashboard/ .github/workflows/` → **zero hits**; the
  `submission_deadletter` table has never held a row. **[M✓]**
- Five non-maintained checkouts declare `testMode` in `/health` — 29-navy,
  hedloc, the-pointe-burbank, the-tower-burbank, vida-legacy-foundation — and
  both `vida-legacy-foundation` and `29-navy` post to central ingest. **[M✓]**

**The tense correction, which changes the scheduling claim but not the order.**
This is **latent, not live**. Run 34696929623 (2026-09-12) printed
`mirrored=13 mirror_failed=0 mirror_missed=0` — every maintained site has a Turso
row today. It becomes live the next time a site is created, a row is deleted, or
Phase 6 lands. So the correct framing is "must land before Phase 6 or before the
next `/new-site`, whichever comes first", not "leads are being lost now."
**[M✓]**

**Effort.** A day, including the round-trip proof.

**Done looks like.** An `unknown-site` lead produces a dead-letter row and a
cockpit attention item, demonstrated once on a test slug and then deleted; a
re-run of `ensure-site` on a partially-created site heals the Turso row;
`replay-deadletters` and the live path resolve through the same lookup.

**What would make it a mistake.**

- Doing Phase 6 first. That removes `mirror_missed` before a replacement exists
  and inverts the plan's own order.
- Letting a synthetic dead-letter row reach a client notification path. Test
  slug, delete afterwards.
- Loosening #695's Turnstile asymmetry to get a green verdict while you are in
  this area. That asymmetry is deliberate and correct; the fix is to earn the
  `pass`, not to let a configured sitekey claim one again.

**Coupling.** The rollback-window _decision_ (run `db parity`, write a dated
"closed as of X" or "open until Y") is a workflow-track item and lives in that
document. It is under an hour and it should happen in the same week, because the
code, the comments and the operator's own statements currently disagree about
which store is authoritative, and agents read all three.

---

## S7 · Renovate: tick the checkbox today; build the outcome metric; do not touch `packageRules`

**What to do.** Two separable things.

**Today (30 seconds).** On `reddoor-starter`'s Dependency Dashboard (#97), tick
the `unschedule-branch=renovate/all-minor-patch` checkbox. Reversible, touches no
config, and it answers the question on a Saturday instead of waiting for Monday.
If the PR opens, the blocker is the schedule/window interaction; if it does not,
it is `prCreation`. Monday 2026-09-14 is the free second observation — re-run the
`refs/heads/renovate/*` scan and see whether the PR-less branches convert.

**In the week (hours).** Add one outcome field the fleet does not have: **days
since this repo last merged a NON-SECURITY Renovate PR**, or **count of
`renovate/*` branches with no PR whose tip is older than 8 days**. Prove it in
both directions before trusting either verdict: it must FAIL on today's fleet and
PASS against a 2026-08-10 snapshot, when the grouped channel was demonstrably
delivering. A one-directional proof is worth nothing here, because a threshold
that fires on everything is indistinguishable from one that fires correctly.

**Why.** Three Renovate surfaces in the nightly audit are all green, all
literally correct, and jointly useless: they measure whether the workflow ran,
whether the dashboard names a blocked branch, and whether the dashboard uses
known vocabulary. None measures whether an update landed. The 2026-08-03
detector was built for _"Renovate refuses to touch the branch"_; the live
condition is _"Renovate touches the branch every week and never opens a PR."_

**Evidence.**

- `reddoor-starter` #97 carries, verbatim: `## Awaiting Schedule` … `- [ ]
  <!-- unschedule-branch=renovate/all-minor-patch -->fix(deps): update all
  non-major dependencies (@lucide/svelte, @playwright/test, @reddoorla/maintenance,
  eslint, globals, node, reddoorla/.github, renovatebot/github-action, svelte,
  typescript-eslint, vite)`. Ticking it delivers both the maintenance-package
  bump and the shared-CI pin to that repo. **[M]**
- 25 repos hold a `renovate/all-minor-patch` branch, **every one PR-less**,
  every head dated 2026-09-07; 103 PR-less `renovate/*` branches org-wide. **[M✓]**
- `@reddoorla/maintenance` resolves to 0.81.0 on four sites against npm latest
  **0.95.1**; the shared reusable CI is pinned at `8f9852c` (v1.4.1) on 21 repos
  and `c714d9e` (v1.4.2) on `reddoor-website` alone. **[M✓]**
- `grep -rain 'lastMergedRenovate|daysSinceMerged|prless|noPullRequest' src/` →
  **zero hits**. No outcome metric exists anywhere in the source. **[M✓]**

**Two corrections that must travel with this item.**

1. **Renovate is not dead — only the grouped non-major channel is.** It opened
   **78 PRs since 2026-08-31**, 32 on 09-09 alone, on
   `npm-*-vulnerability` and `lock-file-maintenance` branches. Any write-up
   saying "Renovate stopped" is falsified by one PR list and will discredit the
   real finding. **[M✓]**
2. **The grouped channel last opened a PR on 2026-08-10 and last merged one on
   2026-08-12 — 31 days, not 47.** The "47 days / three associated PRs" figure
   came from reading a branch-tip derived view as the state, and quoted three
   _creation_ dates as merges. Do not reuse it. **[M✓ — the exact failure #711
   is open about.]**

**Effort.** 30 seconds today; hours for the metric.

**Done looks like.** A dated observation recorded from the checkbox and from
Monday; one outcome field on the protection audit with both snapshots recorded in
its test; no change to `packageRules`.

**What would make it a mistake.**

- Rewriting the shared preset this week. The mechanism behind the drought is
  explicitly **[I]** — inferred, and partly contradicted by measurement (the
  branch's combined status reads `success`, not `pending`, and the
  zero-check-runs state is by design and was equally true while the channel was
  working). Building a preset change on it is precisely the "built on a
  mechanism without reading it" failure that shipped an overstatement into the
  fleet-wide preset on 2026-08-12.
- Mutating a client repo's `ci.yml` to add `renovate/**` as the control. It
  duplicates CI on every future Renovate PR and it waits a week. The checkbox is
  free and same-day.
- Framing this as security. The `sharp` PRs are open because of the
  never-auto-merge rule, not because the grouped channel is dead. This is
  **feature-version drift**, impact **medium**.
- Expecting automation at the end of it. `@reddoorla/maintenance` is itself in
  the never-auto-merge rule, and under `group:allNonMajor` one held package makes
  the whole grouped branch non-automergeable. Restoring the channel yields PRs a
  human must merge — real value, smaller than advertised.

---

## Five-minute riders — do these while you are in the file

- **Forward pointers on the two blux documents.**
  `docs/superpowers/specs/2026-08-31-starter-track-split-design.md:74` and
  `docs/superpowers/plans/2026-08-31-starter-track-split.md:146` and `:1525` all
  still instruct `git merge starter/main`. `CLAUDE.md` carries the corrected
  cherry-pick rule and then **points the reader at that exact spec**. The repo
  already owns the affordance (`> Superseded in part by …`). Two lines, and it
  protects an agent arriving today at a landmine: native-ize deleted the whole
  Blux layer, so that merge applies the deletions as clean, conflict-free
  removals with only `README.md` conflicting. **[M✓]**
- **One line in `CLAUDE.md`:** `reddoorla/the-tower` is a **fourth** archived
  repo with no local checkout, so `scripts/fleet-repos.sh` — which enumerates the
  disk — cannot see it. **[M✓]**
- **Ten minutes of credential residue** (the survivors of a refuted census):
  delete the four keys nothing reads (`DROPBOX_ACCESS_TOKEN`, `FIGMA_PAT`,
  `GOOGLE_SEARCH_API_KEY`, `TURNSTILE_SECRET_KEY_1`) and the eleven legacy
  `<SITE>_PRISMIC` names; fix or delete the 401 `GITHUB_TOKEN` (#650), because
  the rules point agents at that file and it hands them a dead credential;
  decide where `report-edit.env`'s two keys belong, since
  `loadCredentialsIntoEnv` reads only the canonical path and **nothing loads
  that file today**. **[M✓]**

---

# DO NEXT, NOT THIS WEEK

One line each. Each is real; none clears the bar against the seven above.

- **Measure the a11y debt across the 13 maintained sites, report-only** — fix
  **#680 first** so a fixture route that 404s fails loudly (that is the
  positive-control step), then run the audit against real routes per site and
  record one debt number. Multi-day, not a day: it spawns `vite dev` +
  Playwright per repo across 14 distinct npm script sets. Impact medium — the
  deliverable is a number, and the debt itself is out of scope.
- **Schedule `sync-configs --dry` as a standing drift report** — the engine
  already exists, is tested, has a `dryPlan` that delegates to the real recipe,
  and is scheduled by nothing. Ship it as a counted report with a
  **measured-count** gate (`FLEET_CONFORM measured=N drifted=M` whose _absence_
  fails), never a pass/fail on `drifted`. Needs to clone in CI: two org repos
  have no local checkout.
- **Backup resilience** — first check 1Password for `BACKUP_PASSPHRASE` (two
  minutes; it may collapse the item). If absent: one off-GitHub destination for
  the nightly `.gpg`, one artifact kept per month beyond the 30-day retention,
  and the restore procedure promoted into `docs/runbooks/` **including the step
  three rehearsals never needed** — `db restore` refuses a non-empty target, so a
  real recovery lands on a new database and `TURSO_DATABASE_URL` must be
  repointed across Actions secrets and the central Netlify site.
- **The testMode rollout to the five uncovered maintained sites** — five
  production deploys on client repos. Scheduled client work; stage them,
  gallerysonder first.
- **#646 Phase 6** — the single largest deletion in a 59-issue backlog, and it
  must land after #645 and after the ordering decision in S4. Putting it inside
  the meta week turns a meta week into a migration week.
- **The three roster decisions, by reading, not by building** — do `launching`
  sites with live URLs (hedloc, alamo-anatomy, both last security-audited
  2026-07-08, 66 days) join the security sweep? Fill 29 Navy's `Git repo` cell
  **before** anyone flips its status, or the clone throws on the first swept
  night. What are `#trinity-law-school` and `#roalson-interests`? An hour of
  reading four lists side by side beats a four-source reconciler over a
  population that is two-thirds legitimate absence.
- **`rfp-analyze` has no `origin`** — 24 commits, this disk only. **Narrowed by
  a measurement I ran today:** its last commit says _"this repo is now a subtree
  of reddoorla/claude-skills"_, and `reddoorla/claude-skills` (private, pushed
  2026-09-11) contains `skills/rfp-analyze` with a file list identical to the
  local working tree. **[M]** So the _content_ is published; only the 24-commit
  standalone history is local-only. That moves it from "the one real data-loss
  exposure" to "a history worth pushing when convenient."
- **Settle whether `src/blux` is substrate or dead weight** — a 30-minute
  operator decision, ~20k lines across 63 source and 77 test files, no workflow
  exercising it, first real consumer archived. Nothing downstream of that
  question should be built before it is answered.

---

# LEAVE ALONE

Things that look like problems and are not. Each has been checked by at least
one challenge agent; the citation says which.

1. **PR cycle time (p50 = 0.3 h, 62% merged inside an hour).** Auto-merge-on-green
   working as designed for a single operator with an explicit merge-authority
   policy — not an absence of review. The p99 five-day tail is where contested
   work actually goes. _Critic, leave-alone #1._
2. **CI at 8.7% failure / 95.5% fleet green.** A healthy failure rate. A gate
   that never fails is not measuring anything, which is the thesis of six
   candidates. `ci` failing 132 of 1,522 runs is the one workflow doing its job.
   _Critic #2._
3. **`release-health` staying silent when its query returns empty.** Documented
   deliberate design — _"a broken query must not masquerade as a broken
   pipeline."_ Reported as a detection failure; it is a rule working. Only the
   close-side asymmetry is a defect, and it is the 20-minute rider inside S5.
   _Refuter §4a._
4. **The empty `Turnstile widget` column and the red guardrail that cannot
   fire.** This is #695 working: it deliberately traded a signal proven wrong (a
   sitekey at Cloudflare's 10-hostname cap reported `turnstile: true` while the
   live widget threw 110200) for no signal. It is an open decision, not a
   regression, and framing it as a broken guardrail invites exactly the loosening
   the candidate itself warns against. _Refuter §5.5._
5. **`la-homelessness-youth`'s `cookie@0.6.0` with no override and a clean
   audit.** Killed by running its own decisive test: Dependabot alerts are
   **enabled** (HTTP 204), the API is demonstrably live (35 open alerts across 15
   other repos), and this repo has **zero alerts in any state, ever**. The
   advisory does not apply. The site is also one of the two documented formless
   cases — no form, no user input path. _Refuter §5.22._
6. **`Report recipients (To)` blank on 11 of 13 maintained sites.**
   `src/reports/preflight.ts:143-151` resolves it _else_ `point of contact`,
   which I re-verified is populated on all 13. Do not fill 11 cells.
   _Critic leave-alone #7._
7. **Airtable's plaintext `DNS password` / `cms password` / `site host password`
   columns.** Already cleared — empty on all 45 rows since the 2026-08-31 move to
   1Password. Optionally delete the empty columns so the next reader does not
   re-discover this. _Critic #8._
8. **The 12 `archived` and 9 `external` Airtable rows outside every sweep.**
   Correct by design. The live question is narrow: the 2 `launching` and 7
   `building` rows. A reconciler that reports 21 legitimate absences as gaps will
   be ignored inside a week. _Critic #5, refuter §5.15._
9. **`LA Homelessness Youth` as `maintained` with `freq=None`.** The documented
   idiom for "keep it in sweeps, send it nothing." Portfolio copy. _Critic #6._
10. **A machine-checked "prove the instrument" meta-test.** Refuted on its own
    terms: a workflow whose `run:` is `exit 0` satisfies every structural property
    it asserts, and so would the 2026-08-12 GA-credentials gate and the setup-node
    probe — every historical failure the house rule exists for. #711 already made
    this argument and the rebuttal concedes it. The rule resists mechanisation
    because what it guards is semantic. _Refuter §2._
11. **A new `site-conformance` audit.** It would be a second drift engine beside
    `sync-configs`, which is tested, idempotent, has a preview path and is simply
    never scheduled. Its four unique columns are four greps that can ride on that
    engine's marker line. _Refuter §4c._
12. **A four-source roster reconciler.** 15 of 45 rows legitimately have no repo;
    the expected-absence table the tool would need is hand-maintained, which
    reintroduces the hand-edited-cell problem one layer up. The boundary is
    already documented in fleet memory. What is missing is three decisions, not a
    detector. _Refuter §5.15._
13. **The ~103 PR-less `renovate/*` branches as an emergency.** Two of nine
    surveys read the same facts as benign "awaiting schedule" latency, and
    Renovate's own dashboard says exactly that. The checkbox and Monday settle it
    for free. _Critic #12._
14. **"159 unpushed commits."** Already resolved and already corrected in
    `08-second-pass.md` §2: the real branch figure was ~38, `Broken` and
    `welcome-to-the-flower-court` were pushed on 2026-09-12 (54 commits secured),
    and tracking issues were filed in the other eleven repos. Most of the
    original count was `refs/stash` and one deliberate archive tag. Do not
    re-open it; note only that the eleven new tracking issues are eleven more
    rows in the channel S2 is about.
15. **`octagonal-led-turn-counter`'s 50.9 session-hours at zero commits.** The
    repo sits at a nested path the top-level walk does not reach. "Zero commits"
    is a measurement artifact, not evidence of wasted time. Do not open a
    portfolio conversation on that number. _Critic #10._
16. **`general-purpose` at 1,040 spawns against `Explore` at 35.** No harm has
    been measured — no incident, no cost, no wrong answer traced to it. A
    `general-purpose` agent given a read-only prompt does the same work. If there
    is a harm, measure it first. _Critic #4._
17. **Blux prettier-collapse and canvas-starter work.** Investing half a day
    restoring a propagation channel for a track whose only real consumer is
    archived is the clearest cost-exceeds-benefit case on the slate — and it is
    gated on the 30-minute decision listed in the next tier. The forward pointers
    are five minutes and are in the riders. _Refuter §5.24._

---

# APPENDIX A — Proposed but unsupported

**Nothing in the 25-candidate slate was marked UNSUPPORTED.** The evidence
auditor's split was **18 CONFIRMED, 5 OVERSTATED, 0 UNSUPPORTED**: every
candidate's central claim survived independent re-derivation. That is itself a
result worth recording — the research was accurate about _what is true_ and the
disagreement between the challenge agents was almost entirely about _what
matters_ and _what a claim licenses you to do_.

What belongs in an appendix instead is the five numbers that did not reproduce,
because each would send an implementer somewhere wrong, and four proposals that
were refuted by reasoning rather than by evidence.

## A.1 — Five stated numbers that must not be reused

| claim                                                   | as stated                                      | as measured                                                                                                            | consequence if reused                                                              |
| ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `fleet-form-e2e`'s `exit 1` cases                       | "the only `exit 1` is the absent-summary case" | **two**: line 86 (absent summary) and line 122 (>25% mass-flake)                                                       | an implementer adds a gate that already half-exists                                |
| keys duplicated across the two main credential files    | nine                                           | **seven**, exactly the seven named; the "and others" is empty                                                          | a wrong count in a candidate whose entire deliverable is an accurate table         |
| `netlify.toml` build commands                           | `pnpm build` in 8, `pnpm run build` in 11      | **10 and 14** across 30 files (`functions = "functions/"` in 8 is exact)                                               | the drift is real, the denominator is not                                          |
| grouped Renovate PR history                             | "#51/#76/#87, last merged 47 days ago"         | **five** PRs (#51,#76,#87,#95,#100); last merged **2026-08-12 — 31 days**; the three quoted dates are _creation_ dates | a derived branch-tip view read as the state — the exact failure #711 is open about |
| `lighthouserc.json` files lacking `--port/--strictPort` | seven                                          | **19** files exist, **none** contains `strictPort`, and only **six** declare a `startServerCommand` at all             | the drift is larger and differently shaped; the number understates it              |

One more, from the other direction: the interruption concentration was
**understated** by better than half. "104 of 212 interruptions" mixes
denominators — 212 is fleet-wide including subagent sessions. Against main-thread
sessions it is **104 of 119, 87%**.

## A.2 — Refuted by reasoning, kept so the reasoning is not lost

- **"Make 'prove the instrument' a machine-checked property of every scheduled
  workflow."** The most interesting failure on the slate: the check it proposes
  passes on every historical failure the house rule exists for. Worth keeping
  because it establishes _why_ the rule stays prose — the property it guards
  ("does this check measure what it claims") is semantic, and the candidates
  that honour it best are the ones naming a specific PASS control and a specific
  FAIL control that both exist today, not the one trying to make the obligation
  structural.
- **"Reconcile the three contradictory facts about `la-homelessness-youth`'s
  cookie@0.6.0."** Budgeted a day for a measurement that took sixty seconds, and
  the measurement killed it. The candidate did the right thing by refusing to
  claim either reading before measuring — it just did not run the decisive query.
  The general lesson is the one the refuter draws: run the decisive measurement
  _before_ ranking the work that depends on it.
- **"Fire one known-good row through the lead-path alarms."** Half of it (the
  dead-letter round trip) survives inside S6. The other half read #695 working as
  designed as a broken guardrail. Kept because the distinction — _a deliberately
  absent signal is not a failed signal_ — is the one this fleet most often gets
  wrong in the opposite direction.
- **"Build one roster reconciler."** Kept because its underlying observation is
  true and important: `Status = maintained` is a hand-edited cell that gates
  every fleet sweep, with no expiry, no reconciliation and no alarm on either
  side of it. The tool is refuted; the finding is not, and it is why S4 and the
  roster decisions exist.

## A.3 — Two corrections I generated today

- **`rfp-analyze` is not a data-loss exposure.** Its content is mirrored in the
  private `reddoorla/claude-skills` repo as `skills/rfp-analyze`, with an
  identical top-level file list; only the standalone 24-commit history is
  local-only. The "one unambiguous item" framing should not survive into the
  plan. **[M]**
- **A `gh api … 2>/dev/null` returned an EMPTY result at exit 0 on a TLS
  failure**, and I very nearly reported "no open `sharp` PRs exist" on the
  strength of it. Re-run unsandboxed, the same query returned 18. This is the
  same swallowing the evidence auditor documented, and fleet memory already
  carries it (`gh api --jq 2>/dev/null` prints 404 bodies to stdout — gate
  presence checks on HTTP status). Any script in this week's work that greps a
  `gh` result must check the exit code, not the emptiness of the output. **[M]**

---

# APPENDIX B — If you have five working days

The week is scheduled directly after a peak, and the measured pattern is a ~90%
output collapse within days of every peak. Plan for it: front-load the
irreversible and the externally-clocked, because instrument-building survives
interruption and a deadline does not.

**Before the week (≈45 minutes, today or tomorrow).**
Three things with external clocks or no dependencies at all:

1. Tick the `unschedule-branch` checkbox on `reddoor-starter` #97 — 30 seconds,
   and it buys the Renovate observation without waiting for Monday.
2. GCP console: read the restriction state and billing cap on the three Maps
   keys, then add HTTP-referrer restrictions (test on a deploy preview first).
3. Compare the `whsec_` fixture against the live `RESEND_WEBHOOK_SECRET` and act
   on the answer either way.

**Day 1 — clear the outcome.**
S1 (merge the 18 `sharp` PRs, one repo proven end-to-end first) and S2
(`--limit` on all 24 call sites, close #652 by hand, the stubbed-`gh` gate test
with its positive control). Both are hours; both are done or not done by the end
of the day; neither leaves a half-built instrument behind. Add the three
five-minute riders here.

**Day 2 — close the reading gaps.**
S3's instrument half: the `openSecretAlerts` clause with both controls recorded,
enable scanning on `vida-legacy-foundation` and `29-navy`, fix #754's false heal
line, turn on org-wide validity checks. Then S5: the `fleet-form-e2e` gate test,
`wrote=0 → exit 1`, the `skipped=N` warning, the rollout issue, and the
20-minute release-health close-side rider.

**Day 3 — the external clock.**
S4. One Maintenance report for a quarterly site, all the way through to
delivered, read by a human. Then `--preview --enrich` against the five sites due
2026-10-05 and a written note per site — including the three with no GA4 property
ID. End the day with the ordering decision written down: Phase 6 before or after
2026-10-05.

**Day 4 — the lead path.**
S6. Ten minutes on the "are those five sites taking traffic" question first,
because it decides latent from live. Then #645's four items plus the
`deadletter` attention kind, and the synthetic round trip that proves the
dead-letter path has ever worked.

**Day 5 — the outcome metric, and the write-up.**
S7's metric with its two-snapshot proof, Monday's Renovate observation read and
recorded, and the work-journal entry — which is the one thing on this list that
is mandatory by the project's own rules and is written as the last act of the
session, not the first act of the next one.

**If the week gives you less than five days**, this is the order in which things
drop. **S7's metric** goes first (the checkbox already bought the observation).
**S6** goes second (it is latent, and it only becomes urgent when Phase 6 or the
next `/new-site` runs — neither of which is scheduled for this week). **S5's**
`skipped=N` marker can ship without the full `runGate` harness if it must.

Nothing above S4 should drop. S1 and S2 are hours and discharge more measured
risk than anything else on the list; S3's console half has a client on the other
end of it; and S4 has a date on it that the meta week does not control.
