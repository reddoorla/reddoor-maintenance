# Fleet-Scale Roadmap — re-evaluation toward ~200 self-maintaining sites

**Date:** 2026-06-02
**Status:** Strategy / re-evaluation (plan-only — no code written). For Tucker to react to.
**Supersedes the framing of:** [[road-to-1-0]] (the "internal stable, full monthly cycle" bar is now too small).

> This is a step-back document, written after a deep read of the whole repo. It's opinionated
> on purpose — you asked how _I_ would build toward the goals, what I'd change, what to do next,
> and how long. Specific implementation plans come later (one `writing-plans` doc per milestone),
> after you've reacted to this.

---

## 1. The honest reframe

What we've built so far is **an excellent manual operator's console**: a CLI + Airtable +
email pipeline where a skilled operator runs commands, reviews state in Airtable, and sends
polished reports. The pieces are clean, well-tested (574 tests), and the abstractions are
right.

What you just described is **a different kind of system**: an _autonomous fleet-maintenance
service_ that keeps ~200 sites current on their own, drafts its own reports on a schedule,
pings you when something matters, and reduces your involvement to (a) clicking "yes, send" and
(b) hands-on testing.

The gap between those two is **not more audit/report logic** — that layer is solid. The gap is
**orchestration, scheduling, git/CI integration, and a control surface designed around your
daily loop.** Almost everything below is about automating the _connective tissue_ around the
good pieces that already exist, not rebuilding them.

The single biggest mindset shift: **the central tool should stop being the thing that performs
every update.** At 200 sites, a tool that clones 200 repos nightly and runs `pnpm up` in each
is a fragile, expensive bottleneck. The scalable design pushes routine updates _into each repo_
(so sites genuinely "update on their own") and reframes the central tool as the **orchestrator
and observability layer** — it bootstraps, watches, drafts, alerts, and gives you one place to
act. More on this in §4.

---

## 2. The behavioral north star: design around _your_ loop

You said this project is behavioral — it encodes how you work, with Airtable as your control
plane. So the organizing principle for everything below is: **build around your steady-state
loop at 200 sites, not around a feature list.** Four roles, four surfaces:

- **Airtable = the control plane / source of truth.** Your knobs live here (frequency, status,
  recipients, overrides, commentary, and — new — copy and repo identity). You already live here.
- **Dashboard = the read-and-act cockpit.** "What needs me today?" Triage + one-click actions.
  Entirely yours, never client-facing.
- **Automation (CI/cron/recipes) = the executors.** They do the work: update, audit, draft,
  send, alert. Headless.
- **Email = the only client-facing surface.** The report _is_ the product the client sees.

Your steady-state loop, the thing every milestone should make smaller:

| Cadence                                                               | What you do                                                                  | What the system does for you                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Daily-ish glance**                                                  | Open dashboard / skim a digest. Act only on red.                             | Surfaces what's wrong: new vulns, a failed auto-update PR, a regression, a bounce.            |
| **Per report** (monthly/quarterly per site → continuous in aggregate) | Glance at the draft, hit **yes, send**.                                      | Audits on schedule, drafts the report, enriches GA + search, waits for your yes.              |
| **Testing** (periodic, hands-on)                                      | Work a checklist; make real repo changes (lighthouse fixes, major upgrades). | Presents the checklist, captures results, re-audits after.                                    |
| **Launch** (per new site)                                             | Onboard once.                                                                | Bootstraps CI + auto-updates, runs first audit, sends the launch email, flips to maintenance. |

If a proposed feature doesn't shrink one of those four rows, it's not on the path.

---

## 3. Where we are vs. where we're going (the five gaps)

A subsystem-by-subsystem read of the repo (audits, recurrence, recipes, dashboard, Airtable):

### Gap A — Sites don't update themselves

The update recipes ([bump-deps](../../../src/recipes/bump-deps.ts), [sync-configs](../../../src/recipes/sync-configs.ts), [svelte-4-to-5](../../../src/recipes/svelte-5/index.ts), …) are good, but they **stop at a local commit on a `maint/*` branch** — no push, no PR, no merge. There is **no git-remote/CI/GitHub awareness** in the tool at all ([Site.repoUrl](../../../src/types.ts) is even mis-populated with the production URL, not the git repo). So "updating a site" today = a human runs a recipe in a local checkout, then manually pushes and opens a PR. That does not scale past a handful.

### Gap B — Nothing runs on a schedule

[`due.ts`](../../../src/reports/due.ts) computes which reports are due, but **there is no scheduler** — every audit, draft, and send is a CLI command a human types. The audit→draft→approve→send loop has exactly one automated leg (the Resend delivery webhook). For "recurrence is entirely automated," a scheduler has to drive the pipeline.

### Gap C — Auditing 200 sites is a throughput wall

Lighthouse is **2–10 min/site** and a11y adds more; both spawn a local dev server today, which assumes a local checkout. Serial, that's ~a full day for one fleet pass. This gates everything downstream (reports need fresh scores). Audits must become **scheduled, parallel, and (where possible) run against deployed URLs** — and decoupled from the report cadence (audit continuously/rolling; draft monthly).

### Gap D — The dashboard is a read-only viewer with the wrong audience

It's static HTML over live Airtable reads, with a **client-shareable per-site token model** (`/s/<slug>?t=<token>`) that you've now decided to retire. It has no triage, no filtering, no pagination (200 cards on one page), and **cannot host actions** (no approve-send, no trigger). It's a window, not a cockpit.

### Gap E — Copy is frozen in code; no launch concept; no alerting

All email wording is **hardcoded in [template.ts](../../../src/reports/maintenance-email/template.ts)** (the six "Maintenance Checks" rows, the testing checklist, footer, contact, address) — zero of it is Airtable-driven. There is **no launch email** (only Maintenance/Testing report types; "launch period" is just a status). And there is **no alerting** — delivery status is tracked reactively, but nothing pings you when a vuln appears or an update breaks.

---

## 4. The one decision that matters most: how sites self-update

Everything in "sites update on their own and don't get behind" hinges on this fork. I'll state
the options, then my recommendation.

- **Option 1 — Centralized orchestrator.** A scheduled runner clones/pulls all 200 repos, runs
  `bump-deps`/`sync-configs` in each, tests, pushes branches, opens/merges PRs. _Cons:_ a giant
  stateful nightly job, 200 checkouts to manage, a central point of failure, and you're paying
  to re-derive "what's outdated" that GitHub-native tools already compute for free.
- **Option 2 — Decentralized, per-repo.** Each site repo gets a standard GitHub Actions CI
  workflow + **Renovate** (or Dependabot). Renovate opens dependency-update PRs _in each repo on
  its own schedule_; CI tests them; patch/minor auto-merge on green, majors wait for you. Sites
  literally update themselves. _Cons:_ 200 repos to bootstrap; you need real per-repo CI for
  auto-merge to be safe.
- **Option 3 — Hybrid (recommended).** Option 2 for _routine currency_ (Renovate + per-repo CI
  auto-merging safe bumps), **plus** the central tool as the **orchestration + observability
  layer** for everything Renovate can't do alone: bootstrapping that CI/Renovate config into
  each repo (a recipe — the framework is perfect for it), running the bigger codemods/config
  syncs (`sync-configs`, svelte upgrades) by pushing branches + opening PRs via the `gh` API for
  your review, and **aggregating every repo's update/CI status into Airtable + the dashboard** so
  you have one place to see "who's behind, whose update PR is failing, who needs a major bump."

**Recommendation: Option 3.** It's the only one that makes "update on their own" _literally
true_ (the work happens in each repo, continuously, without the central tool in the loop), keeps
the central tool small and stateless, and uses battle-tested free infrastructure (Renovate +
Actions) instead of a bespoke 200-repo runner. The central tool's superpower becomes
_orchestration and a single pane of glass_, which is exactly what a 200-site operator needs.

**What Option 3 requires that doesn't exist yet:**

1. **Real git/repo identity** in the model and Airtable (a true `Git repo` field; `gh` auth).
2. **A "bootstrap CI + Renovate" recipe** that writes a standard `.github/workflows/ci.yml`
   (lint, typecheck, build, and a lighthouse-budget check) + `renovate.json` into a repo and
   opens the PR. This is the keystone — it makes auto-merge _safe_ and turns onboarding into
   "make this repo self-maintaining."
3. **`gh` API integration** in recipes (push + open PR + optional auto-merge label).
4. **Status aggregation**: poll GitHub (open `maint/*` PRs, CI status, Renovate dashboard) →
   write to Airtable → render on the dashboard.

A note on your existing dep tooling: [`baseline-versions.ts`](../../../src/configs/baseline-versions.ts) + the `deps` audit answer a _different_ question than Renovate — "is this site on Reddoor's blessed stack?" vs "is it behind latest?". Keep both: Renovate keeps sites _current_; the deps audit + baseline keeps them _consistent with the Reddoor canonical stack_. They're complementary signals, not duplicates.

**Auto-merge safety policy (your call, but my default):** auto-merge **patch + minor** only,
and only when CI is green _including a build and a lighthouse-budget check_; **majors always
open a PR you review.** Sites with weak/no tests don't get auto-merge until the bootstrap recipe
gives them the standard CI. This is the guardrail that prevents "self-updating" from meaning
"silently shipping breakage."

---

## 5. What I'd change vs. the current road-to-1.0

1. **Raise the 1.0 bar to match the vision.** The current "1.0 = one fleet member, a clean
   monthly cycle" is really _0.x internal-stable_. The real 1.0 is "a meaningful fleet (say
   30–50 sites) running a full month where updates auto-merge, reports draft on schedule, and
   your only jobs are approving sends and doing testing." I'd re-label milestones accordingly.
2. **Promote the deferred items to the critical path.** "Click-to-trigger audit" and the
   scheduler were parked post-1.0; in this vision they're _central_. And the thing they both
   depend on — **git/CI/repo integration** — isn't anywhere in the current plan. It becomes
   step 1.
3. **Stop scaling the tool as a per-checkout CLI.** Reframe it as an orchestrator (see §4). The
   CLI stays (it's how you do hands-on testing work and one-offs), but the _fleet_ path goes
   through CI/cron, not your laptop.
4. **Decouple audit cadence from report cadence.** Audits run rolling/continuous and against
   deployed URLs; reports draft on the per-site schedule from whatever scores are current.
5. **Move copy out of code into a managed layer** (Airtable-driven, per-site-overridable). This
   is your "text/copy flow," and it's also what lets the wording stop lying at scale (not every
   site has a CMS; "Readability" vs "Accessibility"; per-site contact/footer).
6. **Reverse the dashboard audience** — ✅ DONE 2026-06-10: the client token model is retired.
   `/s/<slug>` and `/` are both gated by one operator password
   ([basic-auth](../../../src/dashboard/basic-auth.ts)); `verifyDashboardToken` and
   `src/dashboard/auth.ts` are deleted and the `?t=<token>` links are gone.
   [`dashboardToken`](../../../src/reports/airtable/websites.ts) is retained only as a
   fleet-homepage visibility flag (non-null = listed; no longer a secret).

---

## 6. Prioritized sequence (what I'd build next, and why)

Each milestone is a ~1–2 week part-time chunk that ships something usable. The ordering is
driven by dependencies: you can't automate recurrence until audits scale; you can't safely
auto-update until per-repo CI exists; you can't do any of it at 200 until repo identity is real.

**Research-first cadence (standing rule, added 2026-06-08).** Every milestone _opens_ with a
prior-art / verification research pass before any building — and so does every stage of a
milestone's implementation plan. This is internal tooling for a niche problem (fleet-of-separate-repos
maintenance), and the M7.1 pass proved the value: a one-shot research sweep confirmed the whole model
is the mainstream pattern, corrected one decision (SHA-pin reusable workflows, not a moving `@v1`),
and surfaced a free improvement (collapse per-repo `renovate.json` into one org preset). A research
step answers, for that specific milestone: **(1)** is there an established tool/pattern we should
adopt or borrow rather than hand-roll? **(2)** what does the authoritative source (vendor docs / spec)
actually say about the APIs/behaviors we're about to depend on — verified, not remembered? **(3)**
what's the failure mode others hit here? Use the `deep-research` skill for anything broad/ambiguous,
WebFetch/WebSearch for a targeted check. If a finding contradicts the milestone's assumption, STOP and
reconcile before building. The per-milestone `**Research first:**` riders below name the concrete
questions to start from (not an exhaustive list — the point is to look before building).

**M1 — Git/CI foundation + self-updating repos _(the keystone)_.**
Add a real `Git repo` field to Airtable + `gh` auth; build the **bootstrap-CI-+-Renovate recipe**;
make existing recipes push + open PRs. Result: onboard a repo → it starts keeping itself current,
auto-merging safe bumps. This is the highest-leverage thing — it's literally "sites update on
their own," and it's the prerequisite for safe automation everywhere else. _Doubles as the fleet
onboarding accelerator you flagged in [[fleet-onboarding-push-2026-05]]._

**M2 — Audits at scale.**
Move fleet audits to scheduled, parallel runs (GitHub Actions matrix), prefer deployed-URL
lighthouse to avoid 200 local checkouts, and stagger/roll them so scores stay fresh without a
single multi-hour batch. Write results to Airtable as today. Removes the throughput wall and the
"cd into 200 checkouts" problem. (Closes the old "trigger audit" gap as a byproduct — a dashboard
button just dispatches the same workflow.)
**Research first:** GitHub Actions matrix concurrency limits + minute cost at fleet scale; deployed-URL
Lighthouse options (self-hosted Lighthouse-CI server vs Google PageSpeed Insights API) and their rate
limits; how other teams stagger/roll scheduled audits so a subset runs nightly rather than one
multi-hour batch.

**M3 — Scheduled recurrence + the approval-only loop.**
A scheduler drafts due reports automatically (cron → the existing draft pipeline). Add a
**dashboard "ready for your yes" queue with one-click approve+send** (the dashboard's first
write action) and a digest email that lists what's waiting. Result: "the only thing I do is look
and hit yes" becomes literally true. Keeps your Airtable `Approved to send` gate as the safety
interlock.
**Research first:** scheduled-workflow reliability gotchas (GitHub cron can be delayed/skipped on
low-activity repos — what triggers do production schedulers use instead?); idempotency patterns so a
cron re-fire doesn't draft duplicate reports; one-click approve-and-send UX prior art (and how to keep
the send action auditable).

**M4 — Operator command center (dashboard reframe).**
Token retirement is ✅ DONE (2026-06-10 — one operator password gates everything; see §5.6).
Remaining M4 scope: triage ("3 critical vulns, 12 stale > 30d, 5 failing update PRs"),
filtering/sorting (by staleness, severity, due-this-week, onboarding %), pagination for 200, and
surface the M1 git/CI status per site. This is where you live day to day.
**Research first:** operator "command center" / triage-dashboard prior art at ~200 rows
(filter/sort/pagination patterns that don't melt down); single-password auth hardening for an
internet-facing ops view (session handling, brute-force protection); whether an existing fleet-status
surface (e.g. a Backstage-style catalog) is worth borrowing vs. a bespoke page.

**M5 — Alerting ("ping me when something big changes").**
A digest + urgent alerts over email (reusing Resend; you clarified the "text flow" is _copy_, not
SMS — so no Twilio for now). Define "big" as: new critical/high vuln, an auto-update PR failing
CI, a lighthouse regression past threshold, a delivery bounce/complaint. Thresholds are your call.
**Research first:** Resend bounce/complaint webhooks + suppression handling (we already use Resend —
verify the deliverability-event API); alert-fatigue / dedupe patterns (digest vs. urgent, grouping,
snooze) so "ping me" stays signal, not noise; what thresholds comparable monitoring tools default to.

**M6 — Launch flow + copy/templating flow.**
A first-class **launch**: onboard → bootstrap (M1) → first audit → a distinct **launch email** →
flip to maintenance, with a "launched" milestone tracked alongside the onboarding 4/4. And the
**copy flow**: extract the hardcoded email strings into a copy layer with Airtable-driven
per-site overrides (check names, intro/footer, contact), shared across launch + maintenance. This
is the "behavioral / how I use Airtable" integration for wording — copy becomes data you control.
**Research first:** copy-as-data / content-layer patterns (how i18n libraries and headless-content
setups model per-instance string overrides with a shared default); launch-state modeling (how others
represent a site's lifecycle transition) so "launched" composes cleanly with the onboarding 4/4.

**M7 — Shared PLUMBING package + fleet conformance: fix-once-apply-all** _(decided 2026-06-04; supersedes the recipe-deprecation brief's provisional "starter-as-canonical" lean)._
M1 is done (9/9 self-updating). The next structural move comes from a hard requirement Tucker
named: a fix made once must reach every site, with **minimal total work he personally does.**
Today it can't — shared code is copy-pasted and already divergent (`ContentWidth.svelte` is
**78 / 28 / 7 lines** across starter / reddoor-website / gallerysonder; the rfp/security docs and
configs are per-clone copies; the starter doesn't even depend on `@reddoorla/maintenance` while
every fleet site does). **Decision: the starter stays the clone skeleton; a shared package becomes
the "brain" that all sites — including the starter — depend on; Renovate + `self-updating` (already
live) propagate every fix.** Self-updating is the conveyor belt; this package is what rides it.

**Scope boundary — PLUMBING, not design.** The shared package carries only what every Reddoor site
must have _identically regardless of design_: configs, the CI workflow, the conformance test suite +
test helpers, security/CSP, the `/dev` a11y fixtures, Prismic/analytics plumbing, and the shared
docs/context. **Design components stay per-site, forever.** A shared UI/design-component library is
explicitly **PARKED** — Tucker tried one and it cost more than it saved (faster to write a new
component than to rewire against a shared one), and post-LLM that trade only got cheaper. Revisit
only if the _same design bug_ is fixed twice across sites. The principle: **shared plumbing,
bespoke presentation** (and its test mirror: **shared harness, bespoke cases**).

Sequencing, cheap/independent first:

- **M7.0 — Starter hygiene (quick wins, independent, ~1–2 hrs).** Add `pnpm.onlyBuiltDependencies`
  (sharp/esbuild), drop `@sveltejs/adapter-auto`, flip the `dev` script `npm:`→`pnpm:`, make the
  starter public, add Renovate + run `self-updating` so the starter dogfoods its own loop and is
  an always-green reference.
- **M7.1 — One CI (reusable workflow, ~half day). ✅ DONE 2026-06-08.** Author a canonical reusable
  GitHub Actions workflow (`reddoorla/workflows/ci@v1`) that runs the conformance suite (fast
  profile); repoint the starter + 9 fleet `ci.yml` to a ~3-line caller; Renovate pins `@v1`.
  Collapses the `verify`-vs-`ci` job-name mismatch into one definition; "fix CI once" becomes real.
  **Research: done (2026-06-08).** Prior-art pass + design + plan landed and revised this bullet: the
  reusable workflow lives in **`reddoorla/.github`** (not `reddoorla/workflows`), callers **SHA-pin +
  Renovate bumps the SHA** (not a moving `@v1`), scope extended to fold the org Renovate preset in, and
  the real risk is the `ci → ci / ci` check-context rename. See
  `docs/superpowers/specs/2026-06-08-m7-1-reusable-ci-and-renovate-preset-design.md` +
  `docs/superpowers/plans/2026-06-08-m7-1-reusable-ci-and-renovate-preset.md`.
  **Rollout complete:** `reddoorla/.github` v1.0.0 @ `78c4da6`; `@reddoorla/maintenance@0.28.0`
  ships the thin-shim `ci`/`renovate-config` templates; `self-updating` requires `"ci / ci"`. All
  self-updating site repos migrated to the thin caller + `ci / ci` protection — caltex, espada,
  medical-solutions-of-texas, revogen, vineyard-custom-homes, alamo-anatomy, erp-industrial,
  reddoor-website, gallerysonder, la-homelessness-initiative — plus the starter. (la-homelessness
  was onboarded at reddoor 0.23.0 before the thin-shim templates existed and carried the old inline
  CI; finished 2026-06-08 via PR #3.) Verified check context is `ci / ci` empirically across the
  fleet. The only non-onboarded repo left, `data-dynamiq`, is a separate stale-repo onboard (M7.6 /
  onboarding path), not an M7.1 swap.
- **M7.2 — Configs into the package (~half day).** Enrich `createSvelteConfig` to compose the
  starter's richness (CSP, the `$`-alias set, the placeholder-tolerant prerender handler) via
  options/defaults; starter adopts `@reddoorla/maintenance`. Retire `sync-configs`' svelte/eslint
  templates — configs propagate via the package, not a clobbering sync.
  **Research first:** how mature shared-config packages expose composable factory configs from npm
  (exports map, `createXConfig(options)` patterns) without a clobbering file sync; CSP-in-adapter
  approaches for SvelteKit/adapter-netlify; whether the package-shape decision (single
  `@reddoorla/maintenance`, settled 2026-06-05) still holds once Svelte-importable config ships.
- **M7.3 — Shared docs/context + plumbing components (~half day).** Move rfp-handbook /
  accessibility / security / migration docs into one versioned source the package exposes (the
  `export:rfp-pdf` script already points at `docs/`). Extract only true _plumbing_ components/routes
  that are identical everywhere — `/dev` a11y fixtures, a CSP-report endpoint, the Prismic
  client/preview plumbing, analytics wiring — NOT presentational components.
  **Research first:** shipping Svelte components/routes from an npm package (the peer-dep surface the
  CLI doesn't have, `exports` for `.svelte` files, whether consuming sites compile them); versioned
  docs distribution patterns (single source → PDF + in-repo); confirm what's truly identical fleet-wide
  before extracting (anything with per-site variance stays per-site).
- **M7.4 — Fleet conformance suite + site test harness (the testing model).** One **conformance
  contract** every site must pass, shipped in the package, run in two profiles: **`--fast`** (per-PR,
  against the local build) and **`--full`** (scheduled, against the _deployed URL_). Invariants:
  a11y on `/dev` fixtures + real routes, non-empty `<title>` + single `<main>` + `lang` + no
  `user-scalable=no`, sitemap/robots/canonical/OG/JSON-LD present-and-valid, CSP + security headers
  served, build/SSR/prerender clean, internal-link integrity, contact-form endpoint contract. Plus
  **test helpers** (`axeRoute`, `renderSlice`, a mock Prismic client, a route-manifest walker) so
  _site-specific_ tests stay thin — the package ships the harness, each site ships its own cases.
  Adding an invariant once → every site enforces it on the next Renovate bump.
  **Research first (the keystone — do a full `deep-research` pass):** conformance/contract-test prior
  art — the 2026-06-08 sweep already surfaced OpenSSF Scorecard (free, SARIF→Security tab) and Spotify
  Soundcheck (commercial); re-verify whether emitting our results as **SARIF to each repo's Security
  tab** is worth it, deployed-URL test-harness patterns (Playwright/axe against a live URL), and how
  others structure a shared harness + per-site cases without coupling.
- **M7.5 — Re-home the heavy audits → scheduled + deployed-URL (lever 3).** The conformance
  `--full` profile _is_ the audit: run it on a schedule against the live Netlify URL (rolling
  subset, not all N nightly), write results to Airtable → feed the monthly client report **and** an
  operator "what needs me" digest. Auditing the deployed URL instead of a spawned dev server
  **deletes the brittlest subsystem's whole bug class** (ports/zombies/specDir/webServer.cwd — the
  audit code is historically the repo's highest-fix-rate area, almost all of it server-spawn
  fallout). This is the rare change that _cuts_ upkeep while lighting up the client-reporting +
  don't-let-me-forget-a-site purpose. (Roadmap M2 + M5, re-grounded.)
  **Research first:** deployed-URL auditing tooling against live Netlify URLs (PageSpeed Insights API
  vs. Lighthouse-CI) and their rate limits; rolling-subset scheduling so a slice runs nightly rather
  than all N; reliable Airtable write patterns at fleet scale (rate limits, idempotent upserts).
- **M7.6 — Deprecate the migration recipes (cleanup, ~half day).** Archive (tag or `src/legacy/`,
  **not** hard-delete) `svelte-4-to-5` + its 8 step files, the 5 codemods, `convert-to-pnpm`,
  `a11y-fixtures-page`, `bump-deps`; prune `ALL_RECIPE_NAMES` + the `RecipeName` union together
  (type-test guards the drift); shrink `onboard`/`init` to a thin "adopt an external/legacy repo"
  path. Safe once nothing new needs migrating.
  **Research first:** the 2026-06-08 sweep flagged **multi-gitter** and **all-repos** as the standard
  tools for one-off fleet sweeps the package/template can't express — evaluate whether adopting one of
  them replaces the bespoke migration recipes outright (vs. keeping a thin `onboard` path); safe
  archival patterns (tag/`src/legacy/`) so history isn't lost.

**PARKED — shared design-component library.** Not on the path. Only revisit if the same design bug
is fixed twice across sites. (Tried before; didn't earn its keep.)

Dependency order: M7.0 + M7.1 are independent quick wins; M7.2 precedes retiring the config
templates; M7.6 can land any time; **M7.4 (conformance) is the keystone** and unifies "tests" and
"audits" into one contract with a fast and full profile. Open sub-decision for the package shape:
keep everything in `@reddoorla/maintenance` vs split a sibling for the Svelte-importable bits
(plumbing components/helpers have a Svelte peer-dep surface the CLI doesn't) — resolve via a short
brainstorm before M7.3/M7.4. Full rationale + pros/cons in
`docs/morning-reports/MORNING_REPORT_2026-06-05-recipe-deprecation.md`.

**Parallel track (data, not code): populate the fleet.** None of this is testable against a fleet
of one. Getting real sites in — with repo URLs, schedules, recipients — runs alongside M1–M2 and
gates the 1.0 "real fleet for a month" bar.

**Parallel track (fleet consistency): migrate all site contact forms Netlify Forms → Resend.**
_Added 2026-06-04._ Today each site's contact form rides Netlify Forms (the `data-netlify="true"`
hidden-form + honeypot machinery, and the `adapter({ edge: false })` constraint that exists
_solely_ because "edge functions don't support Netlify forms" — see espada/gallerysonder
svelte.config). Resend is already the fleet's email transport (`RESEND_API_KEY` in
`~/.config/reddoor-maint/credentials.env`, used by the report/mailer path), so moving form
submissions onto it gives **one email system fleet-wide**: consistent deliverability, sender
domain, and templating, and it drops the Netlify-Forms dependency. Scope per site: a SvelteKit
form action / `+server.ts` endpoint that POSTs to Resend, remove the `data-netlify` attributes +
hidden honeypot form, and **re-evaluate `edge: false`** (the forms constraint that pinned it may no
longer apply once forms leave Netlify). This is cross-cutting like onboarding — runs as its own
pass across the fleet, ideally folded into a recipe once the per-site shape stabilizes. Candidate
to schedule after the onboarding PRs land and M1 self-updating is wired (so each form-migration PR
flows through the now-green CI + auto-merge path).

---

## 7. Timeline (honest, part-time)

At your stated part-time / weeks cadence, with ~1–2 weeks per milestone and the fleet populating
in parallel:

- **M1 (git/CI + self-update):** ~2 weeks. Highest value; front-loaded.
- **M2 (audits at scale):** ~1–2 weeks.
- **M3 (scheduled recurrence + approve-and-send):** ~2 weeks.
- **M4 (command center):** ~1–2 weeks.
- **M5 (alerting):** ~1 week.
- **M6 (launch + copy flow):** ~2 weeks.

**Total: roughly a 2–3 month part-time arc** to the full vision, with a usable increment every
~2 weeks (you're never more than a milestone from something that shrinks your loop). **1.0 is the
whole thing — M6 complete, and only once you're consistently using the tool** (Tucker's call,
locked in §9). M3 is the point where the daily value lands (auto-updating + scheduled reports +
approve-only), but the 1.0 _label_ waits for the full M1–M6 vision plus real, sustained use.

The hard dependency to respect: **M1 before everything.** Auto-update safety (per-repo CI) and
repo identity unblock M2–M6. If M1's git/CI integration turns out gnarly (auth, 200-repo
bootstrap ergonomics), that's where the schedule risk lives — flag it early.

---

## 8. Risks & tradeoffs to keep an eye on

- **Auto-merge is only as safe as each repo's tests.** A dep bump auto-merged into a repo with no
  real test/build gate can ship breakage silently. Mitigation: the bootstrap recipe's CI must
  include build + lighthouse-budget, and auto-merge stays patch/minor-only until that CI exists.
- **GitHub Actions cost/minutes** at 200 repos × (CI per PR + scheduled audits). Manageable, but
  budget it; lighthouse-in-CI is the expensive part — consider deployed-URL lighthouse on a
  rolling subset rather than every PR.
- **Renovate noise.** 200 repos can generate a lot of PRs. Group updates, schedule windows, and
  auto-merge aggressively on safe ranges so the PR list doesn't become its own backlog.
- **Single-tenant assumptions stay.** Don't let "200 sites" tempt multi-tenant abstractions —
  it's still one operator, one Airtable base, one email domain. (Per [[road-to-1-0]].)
- **Copy-in-Airtable can over-engineer.** Start with a few override fields (check names, footer,
  contact, launch intro), not a full CMS. YAGNI until a real site needs more.

---

## 9. Decisions — LOCKED 2026-06-02

All six forks resolved by Tucker:

1. **Self-update architecture: Option 3** — Hybrid (Renovate-per-repo + central orchestration). ✅
2. **Auto-merge policy: majors → PR, everything else (patch + minor) auto-merges** on green CI. ✅
3. **Audit-at-scale substrate: GitHub Actions** (matrix). ✅
4. **Alerting: email digest.** (No SMS.) ✅
5. **Copy-flow depth: light — just the overrides.** A handful of Airtable override fields, not a
   richer copy system. ✅
6. **The 1.0 line: 1.0 = M6 — the entire roadmap, shipped, _when Tucker is consistently using the
   tool._** Not an earlier milestone. ✅

Next action: write the **M1 implementation plan** (git/CI foundation + self-updating repos).

---

## 10. TL;DR

We built the right _console_; the vision needs an _autonomous system_ around it, and the missing
layer is orchestration + git/CI + a cockpit, not more audit/report logic. The keystone is making
**each repo self-updating via per-repo CI + Renovate**, with this tool as the orchestrator and
single pane of glass. Build that first (M1), scale audits (M2), then automate recurrence down to
one-click approve (M3 — where the daily value lands). Command-center polish, alerting, and the
launch/copy flow (M4–M6) make 200 sites comfortable. **1.0 = all of M1–M6, once you're
consistently using the tool.** Roughly **2–3 months part-time**, usable every two weeks, M1
gating the rest. All six §9 decisions are now locked — next action is the M1 implementation plan.
