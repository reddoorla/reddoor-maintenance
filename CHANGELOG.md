# @reddoorla/maintenance

## 0.68.0

### Minor Changes

- 2e0206b: The dashboard's pending-report rows now tell the whole approval story: the
  resolved recipients exactly as the send path computes them (To override →
  point of contact, plus the forced ops CC), a draft-time preview link to the rendered
  email (labeled as such — send re-renders with current Commentary) (or "no preview yet"), and when an approval actually goes out — the next
  09:23 UTC daily run, with an hours countdown. Approve was the
  highest-stakes, most information-starved click on the dashboard (operator
  approve-loop UX memo, proposal 1); it now shows what it sends, to whom, and
  when.
- b506b48: Approve-time send-blocker gate. `approveReport` now blocks (with reasons) any
  report whose send is already known to throw — missing/malformed recipients,
  missing header image, or a null report-level Lighthouse snapshot — via a new
  pure `approveBlockers(site, report)` shared by three surfaces: the approve
  endpoint (closes the vacuous gate on Launch/Announcement, which have no
  checklist), the per-site dashboard's pending rows (a preflight chip: red =
  blocked + button disabled, amber = To resolves to operator addresses only,
  green = clear, reasons in the tooltip; the history-table approve action is
  gated identically), and a new daily-digest collector that surfaces
  approved-but-doomed reports as critical "will fail at send" attention items
  the evening before the 09:23 UTC run would go red.
- 0fa3b55: New `ensure-site <slug>` command: find-or-create the Airtable Websites row for
  a new site (Status "in development", Git repo default `reddoorla/<slug>`),
  fill-blanks-only on re-run so operator edits are never clobbered. Day-one step
  of the /new-site bootstrap workflow — the row makes audits, form-ingest slug
  resolution, and reports work from birth.
- 7a52ab4: New `preflight [site] | --all` command: read-only pre-send checks over the live
  Airtable rows. Fails on what would make drafting or `report --send-ready` throw
  (missing/malformed recipients, missing header image, missing Lighthouse scores
  for Maintenance/Testing drafts) and on RAW frequency cells the mapper would
  silently coerce to "None" (typos, trailing spaces — the site quietly drops off
  the schedule). Warns on what send-time validation can't see: operator addresses
  left in a client site's resolved To, unsent queued drafts that would race the
  new report (the current cycle's own payload is informational, not a warning),
  and truly stale schedule anchors (suppressed when a newer Sent-at supersedes
  them). Fleet mode mirrors the real pipelines: Announcement checks announce's
  maintenance-status targets; Maintenance/Testing check everything `report --due`
  schedules (eligible + null-status rows). Exit 0 = safe (warnings printed),
  1 = hard failure, 2 = bad args. Never writes, never sends.

  Also exposes `maintenanceFreqRaw`/`testingFreqRaw` on `WebsiteRow` (the literal
  Airtable cells behind the coerced frequencies) and exports `ELIGIBLE_STATUSES`
  from due.ts.

## 0.67.0

### Minor Changes

- 1cbff3a: Forms spam defense: restore the content-based spam filtering that was lost when the fleet moved off Netlify Forms (which ran Akismet) to the central token-gated ingest. Two free, complementary tiers now sit on top of the existing honeypot/timing screen:
  - **Heuristic classifier (central).** A pure `classifySpam` scorer folds content signals (link count, link markup, spam keywords, non-Latin script, disposable-email domains, URL-in-name, degenerate/all-caps content — scanned across `message` and site-specific free-text `extraFields`) plus the Turnstile verdict into a `spam_score`. Above `SPAM_THRESHOLD` the submission is stored as a distinct `spam_auto` status with `spam_score`/`spam_reason` recorded for tuning.
  - **Cloudflare Turnstile (edge, verified centrally).** Each site forwards a widget token in a stripped `_meta` envelope; `form-ingest.mts` verifies it against a single `TURNSTILE_SECRET_KEY`, so no per-site secret is needed. A per-site `Require Turnstile` Airtable flag hard-flags a genuine challenge failure.

  Auto-spam is a **recoverable** row, not a drop: it suppresses both the operator notification and the submitter autoresponder and skips newsletter fan-out, is hidden from the per-site lead strip, and is reviewable on `/submissions` (with a provenance badge and a "Not spam → new" button) plus a cockpit "auto-filtered" affordance. The operator-marked `spam` metric is untouched (distinct status).

  Everything fails open — a Turnstile timeout, unset secret, absent token, or a classifier throw never 502s an accepted lead; bots get no signal (`{ ok: true }`, no notify-status echo). Visitor IP/UA are used only transiently (Turnstile `remoteip` + scoring) and never persisted; the `_meta` token/IP/UA can never leak into stored lead data.

  Ships dark and useful: the classifier bites spam immediately with zero per-site changes; Turnstile activates per site as `reddoor-starter` rolls out the widget. Operator prerequisites before activation: set `TURNSTILE_SECRET_KEY` (dashboard env) + `PUBLIC_TURNSTILE_SITE_KEY` (per site), and add the `Require Turnstile` boolean column to the Airtable Websites table.

## 0.66.0

### Minor Changes

- b1750b2: Scheduling: the "next maintenance / next testing" dates are now owned by the code, not an Airtable formula + automation. A new shared `nextDueDate(site, reports, type, today)` (the same `lastSent ?? anchor) + frequency` logic the scheduler already uses — extracted so `findDueReports` and the display can't drift) computes each site's true next-due date, and the nightly `report --due` sweep writes them to Airtable `Next maintenance at` / `Next testing at` date fields (best-effort, per-site isolated, and run even when nothing is due so the dates stay fresh).

  This replaces the prior setup where an Airtable automation overwrote the `maintenance day` anchor with a `DATEADD(TODAY(), frequency)` formula value — which the scheduler then added the frequency to _again_, pushing the first post-announcement maintenance report a full cycle late. With the automation removed, `maintenance day` / `testing day` are clean operator-set anchors and the next-due dates shown in Airtable derive from the exact logic that drafts the reports. Operators should delete the old `next maintenance day` / `next testing day` formula fields (nothing in the code reads them).

## 0.65.3

### Patch Changes

- 6e5d3b1: fix(svelte5): the `dollarPropsClass` codemod no longer emits an invalid rest element

  When the `$props()` destructuring it extends already ended in a rest element (`...rest`, as produced by `exportLetToProps` or the official `svelte-migrate` pass), the codemod appended `class: className = ""` AFTER it, emitting `let { …, ...rest, class: className = "" } = $props()`. A rest element must be last in a destructuring pattern, so this was invalid JS — every site with a `$$props.class` pass-through plus a rest element failed to compile with "A rest element must be last in a destructuring pattern" / "Comma is not permitted after the rest element" (~12 files on hedloc's Svelte 5 migration alone).

  The codemod now inserts `class: className = ""` BEFORE a trailing rest element, producing the valid `let { …, class: className = "", ...rest } = $props()`. Bodies with no rest element are unchanged (class still appended), and a rest-only body becomes `{ class: className = "", ...rest }`.

## 0.65.2

### Patch Changes

- 81540af: Cockpit deps metric now surfaces the registry-major outdated count. The deps audit already computed `OutdatedCounts.major` (how many installed deps are a full major behind npm's latest), but it was dropped at `depsCountsFromResult` and never reached the dashboard — the cockpit only showed `X drifted (Y major) · Z outdated`, where `(Y major)` is drift vs the fleet baseline, easily misread as "majors available". The count is now plumbed through `DepsCounts` → the Airtable `Deps Major Outdated` field → `WebsiteRow.depsMajorOutdated` → the render, so the deps span reads `X drifted (Y major) · Z outdated (N major)` — the new `(N major)` being majors behind the registry, distinct from the baseline-drift major. The value is null-guarded end to end: it's only written/rendered when known (including a real 0), and absent on older Airtable rows it simply omits, so nothing is back-filled with a misleading count.

  Note: requires a Number field `Deps Major Outdated` on the Websites table before the audit writes a non-null value.

- 7f1e8f2: Maintenance email: refresh the "testing" placeholder. The blurred-tests teaser image is replaced with the new design (the frosted testing checklist behind a "Request Testing Upgrade" button + invitation copy), and the "Last Tested: <date>" line beneath it is removed. The new image is exported at 2× (1200×1362, ~470 KB — lighter than the prior 590 KB asset) and keeps the same `blurredTests.jpg` filename/cid, so the swap is asset-only. The underlying `lastTestedDate` field is still computed and stored on the Airtable Report row (and used by the dashboard); only the email line is gone.

## 0.65.1

### Patch Changes

- 08c966d: Fix: an announcement-time GA/Search outage now surfaces the per-site analytics-failure signal instead of silently hiding the traffic block. The `announce` recipe read only `.value` from the soft-failing GA/Search enrichment and never recorded `analyticsSoftFailAt` — so if Google errored during the monthly announcement run, the email's analytics block simply disappeared (reading identically to "site has no GA configured"), the operator got zero signal, and the client received a one-time onboarding email with the traffic section missing. `announce` now mirrors the `--due` draft path: when GA is configured for the site, a soft-fail stamps `Analytics soft-fail at` (driving the cockpit/digest alert) and a clean enrichment clears it so the signal self-heals. Best-effort write — the operator-added column's absence can't break the draft.
- f4dd1df: Email footers: the first contact line ("Just hit reply.") now renders as a red bold heading, matching the "questions, concerns or requests?" title directly above it — across all three report email types (announcement, launch, maintenance). Previously it was plain black body text, so the call to action read as a quieter footnote than the question prompting it. Following contact lines (e.g. "We're here to help in any way we can.") are unchanged.
- d5beaf8: Docs + health: document the dashboard's deploy env, and surface `TURSO_DATABASE_URL` in the webhook health check. The deployed Netlify functions read `DASHBOARD_PASSWORD` (the cockpit/per-site auth gate), `DASHBOARD_BASE_URL`, `RENOVATE_TOKEN` (the "Trigger Renovate" button), and `GH_TOKEN` (request-path GitHub REST), but the README "Set env vars" table listed none of them — so a by-the-book deploy produced an unauthable dashboard with dead action buttons. All four are now documented. The `resend-webhook` GET health check (the README's post-deploy smoke test) now also reports `TURSO_DATABASE_URL` presence, since its absence 500s the whole dashboard + forms surface — the most common fresh-deploy failure — and Netlify env vars are site-wide. Presence-only, never values.
- 84369b4: Fix: the "got through, marked spam" metric no longer double-counts when an operator re-marks a submission. It was an increment-only counter (`recordMarkedSpam`) bumped on every transition into `spam`, so toggling a submission spam → new → spam inflated the tally to 2, and un-marking never decremented — the per-site spam-through count on the cockpit could exceed the number of distinct spam submissions. `listScreenOutsSince` now DERIVES `markedSpam` from the rows themselves — a live `COUNT(*) FROM submissions WHERE status = 'spam'`, windowed by `submitted_at` — which is exact, idempotent under re-marks, and self-corrects an un-mark. It's also now arrival-dated like the honeypot/too-fast buckets (the old counter was mark-dated). No migration: the `recordMarkedSpam` increment is dropped from the status-change path and the legacy `marked_spam` column is simply no longer read.
- b08c3da: Fix: a transient Netlify API failure no longer clears a real "deploy errored" alarm from the cockpit's Broken band. The deploy probe previously used `null` as a single sentinel for both "couldn't read the API" and "site has no production deploy", so a network error / non-2xx / malformed response during the nightly sweep overwrote a genuine `error` deploy status to `null` — silently dropping a broken production site out of the Broken band ("all clear" while prod was down). The probe now returns a discriminated `NetlifyDeployFetch` (`{ ok: false }` for a read failure vs `{ ok: true, deploy }` for a real read), and on a read failure the audit returns no details so the Airtable writer leaves the prior `Deploy status` intact. A genuine empty deploy list still persists `null` (a real "none" verdict). The principle: an _alarm_ field preserves its prior value on an uncertain read, where a _pass-gate_ field clears.
- e002359: Fix: a single failing site no longer aborts a whole `--fleet` recipe run. The fleet commands `self-updating`, `sync-configs`, `onboard`, `convert-to-pnpm`, `bump-deps`, `svelte-codemods`, and `upgrade` each looped `for (const s of sites) results.push(await recipe(s))` with no per-site error handling. The recipes throw on a non-clean working tree (and on transient git errors), so the first site with a dirty checkout threw out of the loop and every subsequent site was silently never processed — surfacing as a crash rather than a per-site report. A new shared `runRecipeOverSites(recipe, sites, run)` helper runs the recipes sequentially (they do git/filesystem work) and isolates each site: a throw becomes a `failed` RecipeResult so the rest of the fleet still runs. The `init` command (which returns its own `InitResult` rather than a `RecipeResult`) gets the same per-site isolation inline. This mirrors the isolation `prepareFleetSites` already provides for the clone/prep phase, one layer up at recipe execution.
- fc02667: Fix: `self-updating` now corrects a present-but-STALE config, not just a missing one. Its gate was existence-only — it opened the bootstrap PR only when `ci.yml` / `renovate.yml` / `renovate.json` was absent on the default branch, and reported "already self-updating" for any repo that merely HAD the three files, however out of date. So drift it exists to repair (an old pinned reusable-workflow SHA, a stale Renovate schedule window — the exact class behind the months-long fleet auto-update regression) was invisible forever. The recipe now content-diffs each template against the canonical version via a new `GitHub.fileContentsOnBranch` (raw GitHub contents API), and opens (or notes an already-open) PR when any file is missing OR drifted. A trailing-whitespace/line-ending-only difference is normalized away so it can't open a needless PR every nightly run, and the existing `findOpenSelfUpdatingPR` dedup keeps drift from churning more than one open PR per repo.

## 0.65.0

### Minor Changes

- 8813bb2: Cockpit accepted Watch conditions. A new `Accepted Watch Conditions` Airtable Websites field lets the operator mark a watch condition (a Lighthouse category, stale repo, or no-custom-domain) as reviewed and accepted on a per-site basis. `assignTier` routes an accepted, currently-active condition out of the amber Watch band — an all-accepted site goes healthy and leaves the Needs-you feed + verdict count — while it stays visible as a muted "✓ accepted: …" chip on the Fleet-browse card. Acceptance is watch-only: a sub-floor (broken) Lighthouse score still alarms, so accepting "Best Practices 78" never hides a drop to 72. Ships dark until the Airtable field exists (`?? []` no-op).
- 840c43a: security audit: ingest GitHub Dependabot alerts as the source of truth

  The `security` audit now reads a repo-backed site's GitHub Dependabot alerts (prod **and** dev, from the GitHub Advisory DB) via the REST API and writes the severity counts + advisory list to Airtable — fixing a false-green blind spot where `pnpm audit --prod` reported 0 critical/high while Dependabot flagged real (often dev-scoped) criticals.
  - `securityAudit` prefers Dependabot when the site has a `gitRepo` and a `GITHUB_TOKEN` is available; it falls back to `pnpm audit` (then `npm audit`) for repo-less sites or any API error (403/404/network) — a Dependabot hiccup never fails a site.
  - All open alerts count toward the tallies; the cockpit's auto-patching (amber Watch) vs Renovate-exhausted (red Broken) bands decide urgency. Each advisory now carries its dependency `scope` (`"runtime"` | `"development"`), surfaced as a `(dev)` tag on the per-site dashboard.
  - New `makeGitHubRest().listDependabotAlerts()` — cursor pagination via the `Link` header (the endpoint has no numeric `page` param) with a per-request abort timeout so a hung connection falls back instead of stalling the sweep. `fleet-security.yml` passes the org PAT as `GITHUB_TOKEN`; it needs the **Dependabot alerts: read** permission on the fleet repos, otherwise it degrades gracefully to `pnpm audit`.

### Patch Changes

- db8e3e2: Lazy-load the libSQL/Kysely stack in `db/client` so the `audit` CLI command no longer eager-imports the central-only DB devDependencies. `reddoor-maint audit` (run in every fleet site's CI) crashed with `Cannot find package '@libsql/client'` because the `audit` entry transitively reached `db/client` (via `fleet-events-writer`), whose top-level `import` of `@libsql/client` / `kysely` / `@libsql/kysely-libsql` resolves to devDeps that consuming sites never install. Those values are now imported dynamically inside `openDb()`, keeping the module graph dependency-free until an actual DB connection is opened (the fleet-events writer already swallows the open failure best-effort). The dist smoke gate now also loads `cli/commands/audit.js` under the central-dep blocker — the `bin.js --version` check missed this because CLI subcommands load lazily.

## 0.64.0

### Minor Changes

- 6d2dcc7: Cockpit three-band severity. The fleet verdict bar goes from binary (green "All clear" / red "N need you") to four worst-band-wins states — green (all clear) / blue (waiting on your yes) / amber (watch) / red (broken) — with lower-band and healthy counts in the meta line. The Needs-you feed gains an amber **Watch** band between Broken and Waiting that surfaces self-patching vulns (a CVE Renovate is still auto-fixing, which previously hid under "All clear") and the whole former watch tier (degrading Lighthouse, stale repo, no custom domain). An exhausted vuln still escalates to red Broken.

## 0.63.0

### Minor Changes

- 65b668b: New `selftest email [site]` CLI command: preview any report email (announcement/maintenance/testing/launch) for a site — or `--all` maintenance sites — to yourself (`--to` to override; defaults to `OPERATOR_EMAIL`), with `--dry-run` to render to disk. No Airtable side effects. Faithfulness via a shared `renderReportEmail` seam used by both the real send path and the self-test, plus a shared `defaultReportSubject`.

## 0.62.1

### Patch Changes

- 91e79f3: Report emails now hide the ANALYTICS block instead of rendering an empty "— Users" placeholder when there's no traffic data. The block appears only when there's something real to show — a GA user count or a page-1 search callout; a GA-less site that still ranks shows just the search line (no user count), and a site with neither drops the block (and its data-contextual SEO call-to-action) entirely. The announcement template's alternating band colors stay correct when the block is hidden (the dropped band no longer consumes a color slot).

## 0.62.0

### Minor Changes

- 63d5ecf: Fleet activity feed: a recorded `fleet_events` log (libSQL) written by the nightly producers (auto-merged Renovate PRs, cleared vulns, recovered CI, renewed certs, launches, per-sweep rollups) and surfaced as a collapsed "Recently" lane on the cockpit. Ships dark until `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are added to the fleet workflows.

### Patch Changes

- 2f9ed6f: Announcement email copy/style tweaks: subject now reads "Your testing & maintenance report for {Site Name} ({domain})" (was "schedule for {name}"); the contact heading drops the leading "Any" ("Questions, concerns or requests?"); the cadence reassurance tail ("there's nothing you need to do.") renders in italics; secondary contact lines render in muted grey. Shared report sections gain two improvements that also reach the monthly maintenance report: the Lighthouse footnote links "Google's Lighthouse tool" to the Lighthouse docs, and the analytics trend names the concrete comparison window ("vs the previous N days") instead of the generic "last period" (announcements use a fixed 30-day window; other reports derive it from the stored period).

## 0.61.0

### Minor Changes

- 6272c64: Dashboard: reorganize the fleet cockpit around "check nothing's on fire". A glance
  verdict (✓ All clear / ⚠ N sites need you) leads the page, followed by a single
  per-site, navigation-only "Needs you" feed (Broken → Waiting on your yes → Slipping;
  every row opens the site page). The fleet card browser and the submissions/spam inbox
  move into collapsed lanes, and the card filters now work (one flat grid, no nested
  collapsed tiers). Vulns only enter the feed once Renovate's auto-fix is exhausted, so
  the verdict can read All clear while the fleet patches in the background. The fleet
  sweep button is relabeled Refresh → Audit.

## 0.60.1

### Patch Changes

- c6393d5: Dashboard: the fleet-refresh spinner now shows live detail for the long
  Lighthouse sweep — the current build phase (setting up → building → installing
  browsers → auditing the fleet…), elapsed time, a per-workflow ETA, and a
  view-run link while running. Adds `currentRunStep` to the GitHub REST client.

## 0.60.0

### Minor Changes

- 0680595: Dashboard: the "Refresh fleet state" button now follows its runs live. After
  dispatch the cockpit polls the actual fleet-security + fleet-lighthouse runs
  (per-workflow spinner → ✓/✗), auto-reloads onto fresh numbers when both succeed,
  links the run on failure, and resumes the spinner across a manual reload.
  Adds `GET /api/fleet/refresh/status`, a `listWorkflowRuns` REST method, and the
  pure `summarizeFleetRunStatus`.
- fa79c7d: feat(dashboard): add a "Refresh fleet state" button to the cockpit

  A fleet-level action (`POST /api/fleet/refresh`) that dispatches the `fleet-security` and `fleet-lighthouse` GitHub Actions workflows on demand, so vulnerabilities, auto-check signals, Lighthouse scores, and GitHub signals refresh immediately instead of waiting for the nightly cron. Reuses the authed-write gate chain and the `fetch`-based `makeGitHubRest` client. Dispatches each workflow independently (partial success is reported), confirms before firing (the sweeps are heavy fleet-wide runs), and needs `RENOVATE_TOKEN` in the dashboard Netlify env (already set).

## 0.59.1

### Patch Changes

- 2e92ae9: fix(dashboard): Trigger Renovate now dispatches via the GitHub REST API instead of the `gh` CLI

  The Trigger Renovate button (the dashboard's first request-path GitHub write) shelled out to the `gh` CLI through `makeGitHub`. That works in CI/dev but the Netlify Functions (AWS Lambda) runtime has no `gh` binary, so every live dispatch threw `ENOENT` and the endpoint returned 502. The handler now uses a new `fetch`-based `makeGitHubRest` client (default-branch lookup + `workflow_dispatch`), which is all the Lambda runtime needs.

## 0.59.0

### Minor Changes

- 15bbca5: Interactive cockpit. A "Trigger Renovate" button on repo-backed cockpit cards and
  per-site pages (authed `POST /api/sites/:slug/trigger-renovate` → dispatches that
  repo's `renovate.yml`; needs `RENOVATE_TOKEN` in the dashboard env, degrades to
  "not configured" without it). Plus an inline site-details editor on `/s/<slug>` for
  a safe-text + operational field allowlist (Status, cadences, recipients, point of
  contact, GA4 id, search query, git repo, copy overrides) via authed
  `POST /api/sites/:slug/details` — every field is column-allowlisted and validated
  before the Airtable write.

## 0.58.0

### Minor Changes

- 7ccbacc: Surface an "auto-fix failed" signal on the dashboard when Renovate has been
  auto-dispatched for the same critical/high vulnerability across 3+ nightly
  cycles without clearing it. A per-site `Security Auto-Fix Attempts` counter
  (owned by `renovate-dispatch`: incremented on each real dispatch, reset when
  the vuln clears) drives a distinct chip, filter, and summary tally so the
  operator can tell "Renovate's on it" from "Renovate couldn't fix this — it
  needs me". Inert until the Airtable Websites `Security Auto-Fix Attempts`
  Number field is added.

## 0.57.0

### Minor Changes

- b0871a1: `renovate-dispatch` now re-triggers a repo whose open Renovate PR is stuck (conflicting), instead of skipping it.

  The dedup guard previously skipped any repo with an open Renovate PR — which also skipped a PR that had gone **conflicting** (its branch fell behind the base after another PR merged the same lockfile), so a stalled security PR would wait for the weekly Renovate run to self-heal. Now the guard skips only a **healthy** (non-conflicting) open Renovate PR; a conflicting/stuck one is re-dispatched, which triggers Renovate to rebase it. `UNKNOWN` mergeability (GitHub still computing) is treated as healthy so we don't churn on uncertainty.

  Adds `mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"` to `PullRequestSummary` (populated from the `openPullRequests` GraphQL query) and a `hasHealthyRenovatePr(prs)` helper that reuses the existing `isRenovatePR` classifier.

- 6a5674e: CC `info@reddoorla.com` on every outgoing report.

  All report emails (Maintenance / Testing / Announcement / Launch) now carry the ops inbox on CC in addition to any per-site "Report recipients (CC)", so there's always an internal copy on file alongside the client recipients. The address is added only when it isn't already a CC or To recipient (case-insensitive), so a report is never double-addressed. `info@reddoorla.com` was already the reply-to; it's now also CC'd.

## 0.56.0

### Minor Changes

- d886ab1: Trigger Renovate on sites the nightly security sweep flags with vulnerabilities, instead of waiting for the weekly schedule.

  New `reddoor-maint renovate-dispatch --fleet` command: reads the Websites table, selects the active, repo-backed sites whose latest security audit found a **critical or high** vulnerability, and fires each one's `renovate.yml` `workflow_dispatch`. Renovate's OSV vulnerability alerts bypass its weekly schedule, so the remediation PR opens immediately and auto-merges per the shared preset — closing the detect→remediate gap from up to a week down to hours.

  A repo that already has an open Renovate PR is skipped (remediation is in flight), so a persistent vuln doesn't re-fire a dispatch every night while its fix PR waits. (A vuln with no available fix produces no PR, so it would still re-dispatch nightly — an idempotent Renovate no-op.)

  Wired as a best-effort follow-up step on `fleet-security.yml` (runs after the sweep writes fresh counts to Airtable). It reuses the existing `RENOVATE_TOKEN`, never fails the security job: a missing token clean-skips, and a per-repo dispatch failure (a repo without `renovate.yml`, or a token lacking `actions:write`) is surfaced as a warning. Moderate/low vulns are left to the normal weekly cadence.

  Adds `GitHub.dispatchWorkflow(repo, workflow, ref)`.

- 09ce7ec: Stop fleet sites from inheriting the server/report/audit dependency chain (and its transitive CVEs).

  The package shipped `mjml`, `resend`, `airtable`, `@google-analytics/data`, `google-auth-library`, the libSQL/Kysely stack, `sharp`, `svix`, and `@lhci/cli` as `dependencies`, so every consuming site installed them transitively — even though sites only import `./forms` + `./configs/*` and run `reddoor-maint audit --only a11y` in CI. That dragged in transitive vulnerabilities (`html-minifier` via `mjml`, `tmp` via `@lhci/cli`, …) fleet-wide.

  Those 11 packages are now `devDependencies` (this repo's CLI, Netlify functions, and audit pipeline still use them). To keep the CLI working for consumers without them:
  - The CLI (`bin.ts`) now lazy-loads each command (`await import("./commands/…")` inside the action) instead of eagerly importing every command at startup.
  - `tsup` builds with `splitting: true` and externalizes all node_modules deps, so each command becomes an on-demand chunk and `bin.js`'s startup graph stays free of the heavy chain.
  - A `smoke-dist` gate asserts every consumer-facing entry (`bin.js`, `./forms`, `./configs/*`) has a static import closure free of the central-only deps.

  Verified by a tarball-install simulation: a fresh consumer no longer has `mjml`/`airtable`/`@lhci/cli`/`html-minifier`/etc. in `node_modules`, while `./forms`, `./configs/*`, and the CLI still load and run.

  Note on the bare `.` entry: its report/audit/dashboard library exports now require the central-only packages, which a plain `pnpm add` no longer installs — so importing functions from the bare `@reddoorla/maintenance` specifier works only where the dev dependencies are present (this repo's CLI/Netlify functions, or tooling that installs them). Fleet sites never use that entry (CLI + `./forms` + `./configs/*` only), which is why this stays a minor; it is documented in the README "Library usage" note and enforced clean for the consumer-facing entries by the `smoke-dist` gate.

## 0.55.0

### Minor Changes

- 51d6da9: Fleet-wide GA/Search analytics-failure alerting + a role-account cutover runbook — closes the GA single-subject SPOF open loop (one impersonated `GA_SUBJECT` backs every site's analytics; if it loses access, all reports silently draft with blank analytics).
  - **Dedicated alert email** from `report --due`: when GA/Search enrichment soft-fails across a _majority_ of analytics-configured sites in a run (the signature of the shared subject losing access), the operator gets one alert email (`assessAnalyticsAlert` + `composeAnalyticsAlertEmail`; best-effort, daily-idempotent). A lone/minority failure stays a per-site issue and does not alert.
  - **Persisted per-site signal** on the cockpit + digest: drafting records a per-site `analyticsSoftFailAt` timestamp on the Websites row (set on a soft-fail, cleared on a clean enrichment), and a new `collectAnalyticsFailures` collector surfaces a `kind:"analytics"` Needs-attention item per failing site (self-healing, 45-day staleness). A fleet-wide outage surfaces it across many sites at once.
  - **Runbook**: `docs/runbooks/ga-search-role-account-cutover.md` — the ordered, grant-before-flip procedure to move the impersonated subject to the `reports@reddoorla.com` role account.

  ⚠️ The persisted signal is gated on a manual Airtable step: add an **`Analytics soft-fail at`** date field to the Websites table. Until it exists, the write is swallowed (drafting is unaffected) and the collector emits nothing — the dedicated email works regardless.

## 0.54.4

### Patch Changes

- a2164b0: Morning-brief LOW sweep (2026-06-23): a batch of small correctness, hardening, and test-fidelity fixes.
  - **Unknown `?site=` slug on `/submissions` now 404s** instead of silently returning the whole fleet (LOW-2).
  - **`/submissions` page-beyond-last** shows a clear "no submissions on page N" notice + a link to the last real page, instead of an empty list under a "120 submissions" header with an impossible "Page 5 of 3" pager (LOW-3).
  - **Dashboard handlers authenticate before the Airtable/Turso env guards**, so an unauthenticated probe gets a 401 rather than a differentiated 500 that discloses which backend env is unset (LOW-4; fleet-homepage / site-dashboard / submissions-page).
  - **`data-approve-url` is now HTML-escaped** on both the cockpit approve strip and the per-site approve button, matching the already-escaped `data-report-id` (LOW-5).
  - **Invalid `formType` is rejected** at the ingest normalizer instead of silently coercing to `contact` (which dropped the newsletter Mailchimp fan-out for a typo'd type); an absent/blank `formType` still defaults to `contact` (LOW-6) — matching `createIngestEndpoint`'s behavior.
  - **Newsletter webhook egress is restricted to PUBLIC https URLs** via a new `isPublicHttpsUrl` guard that blocks loopback/private/link-local/CGNAT hosts (SSRF defense-in-depth; LOW-7).
  - **Dynamic `.js/.mjs/.cjs` fleet inventories now scheme-allowlist `deployedUrl`** like the JSON/Airtable providers, so a module returning `file://` can't reach Chrome/lhci (LOW-8).
  - **`verifyFormsToken` hashes both inputs to a fixed-length digest before the constant-time compare**, removing the length-based early return (LOW-10).
  - Dropped an orphaned/misplaced JSDoc block on `parseExtraFields` (LOW-12).
  - Added tests for the `runMigrations` lost-marker re-run path (LOW-13) and for the `/submissions` date filter built from the UI's `YYYY-MM-DD` inputs (LOW-14).

## 0.54.3

### Patch Changes

- a37dc9e: More 2026-06-23 morning-review hardening:
  - **fix(db):** `listNewSubmissions` now caps at 200 (matching `listSubmissionsForSite`). The cockpit loads this whole array on every render — unbounded, it deserialized every unread submission fleet-wide.
  - **fix(db):** the `/submissions` text search now escapes LIKE metacharacters (`%`, `_`, `\`) with an `ESCAPE` clause, so a user's literal `john_doe` no longer also matches `johnXdoe` and a bare `%` no longer matches everything. (Already parameterized — this is a correctness fix, not an injection fix.)
  - **fix(audits):** the `browser` audit's plain `fetch()`es (route-discovery GET + link HEAD/GET) now use `AbortSignal.timeout(10s)`, so a host that hangs without erroring can't stall the sequential fleet audit indefinitely. An abort degrades to the existing null/network-error path.
  - **chore:** `release-health.yml` gains `timeout-minutes: 5` (a hung `npm view` would otherwise sit at GitHub's 6-hour default and, with `cancel-in-progress: false`, pin every later daily run). Added a `pretest` build step so local `pnpm test` runs the CLI tests against fresh `dist` rather than a stale build.

## 0.54.2

### Patch Changes

- 980ced9: Harden four issues from the 2026-06-23 morning review:
  - **fix(forms):** the timing-gate spam screen could be bypassed by a forged FUTURE timestamp. `elapsedMs` went negative, which the `>= 0` guard let skip the too-fast branch. `screenSubmission` now treats any numeric elapsed below `MIN_FILL_MS` (negatives included) as too-fast, and `elapsedMs` clamps at 0 (defense-in-depth).
  - **fix(audits):** the domain audit now writes `Cert days remaining` unconditionally, so a DNS/cert failure CLEARS a stale value. Previously a stale non-null number survived next to a freshly-stamped "Domain checked at", false-passing the Domain/DNS/SSL auto-tick for a site that was actually down.
  - **perf(db):** `openDb` migrations now run once per process per persistent database URL (a module-level cache), instead of two Turso round-trips on every warm Netlify invocation. `:memory:` is excluded (each is a fresh database), and a failed first run evicts the cache so the next call retries.
  - **fix(github):** `secretExists` and `findOpenSelfUpdatingPR` now request `per_page=100` instead of the REST default of 30 — preventing a false secret-miss (needless overwrite) and a duplicate self-updating PR on repos with many secrets/open PRs.

- 384206d: fix(report): a superseded draft no longer permanently blocks future Maintenance reports

  The pile-up guard skipped a new-period draft whenever an earlier-period draft for the same (site, type) was still unsent — but a draft that a higher tier _superseded_ (`draftReady=false`, never sent) also matched that condition, wedging every future Maintenance draft for the site forever (Reddoor's live failure: Maintenance + Testing both monthly). The guard now additionally requires `draftReady`, so only a genuinely pending-approval draft blocks.

## 0.54.1

### Patch Changes

- 768344b: Retire the Airtable-backed submission and spam-screen-out code paths now that the dashboard runs on libSQL. Removes the dual-write soak shadow, the one-off backfill/reconcile scaffolding (kept `reddoor-maint db migrate`), and the Airtable `Submissions`/`Spam Screenouts` modules. The row shape + enum validators live in `src/reports/submission-row.ts`.

## 0.54.0

### Minor Changes

- c909f96: Add a fleet-wide `/submissions` page (filter by site/type/status/date + text search, paginated 50/page, with per-row triage) and reorder the cockpit + per-site dashboards so attention content leads and the spam + submissions blocks sink to the bottom. The cockpit submissions strip and each site's submissions section now link into the new page.

## 0.53.0

### Minor Changes

- c3f8ca4: Cut the dashboard handlers over to the libSQL store: form ingest writes submissions and
  exact spam screen-out counters to libSQL (with an optional `DUAL_WRITE_AIRTABLE=1` soak
  that also shadow-writes to Airtable for rollback insurance), submission triage reads/writes
  libSQL, and the per-site page + cockpit read submissions and spam totals from libSQL.
  Requires `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` in the dashboard site env.

## 0.52.0

### Minor Changes

- 4c271e3: Add a libSQL-backed store for the two high-volume data sets — form submissions and
  spam screen-out counters — behind the existing dependency-injection seam, plus a
  `reddoor-maint db migrate|backfill|reconcile` CLI. Screen-out counters are now exact
  (atomic upsert) instead of approximate daily buckets, and per-site submission reads are
  indexed server-side. Airtable remains the human back office for Websites, Reports, and
  Digest State. Handlers are not yet switched — that lands in the cutover.

## 0.51.0

### Minor Changes

- dd0ff74: The per-site dashboard now shows **which** vulnerabilities a site has, not just the totals. The
  security audit already extracted a per-advisory list (module, severity, title, CVEs, link) but
  only the C/H/M/L counts were persisted — the detail was discarded. The audit write-back now also
  persists that list to a new Websites `Security advisories` field (severity-sorted, capped at 25;
  an empty array on a clean run clears a stale list), `WebsiteRow` parses it back defensively
  (malformed entries dropped; absent/unparseable → null = never audited), and the site page renders
  a "Vulnerabilities (N)" section grouped by severity with a link to each advisory. All
  Airtable-sourced text is HTML-escaped and advisory URLs run through `safeUrl`. The section is
  omitted entirely when a site was never audited or is clean.
- 0474c6e: Spam catch-rate is now observable. The honeypot/timing screen runs on each fleet site and silently
  drops bots before they reach the dashboard, so the catch count was invisible. The site form helpers
  now fire a best-effort, no-PII screen-out beacon (`{ screenOut: honeypot|too-fast }`) to the existing
  ingest endpoint when they reject a submission; the ingest routes it to a compact per-site/per-day
  `Spam Screenouts` bucket. Marking a submission "spam" increments the same bucket's `Marked spam`
  counter. The per-site page gains a "Spam screen (30d)" panel (caught honeypot/too-fast, delivered,
  marked spam) and the cockpit gains a one-line fleet roll-up (caught + through) — so you can tell a
  weaker screen (rising _through_) from more exposure (rising _caught_, steady _through_). Counts are
  approximate under high concurrency (the read side sums duplicate same-day buckets); the beacon never
  throws and is abort-bounded (~1.5s), so the real-human clean path is never delayed and a hung beacon
  on a screened submit waits at most the timeout.

### Patch Changes

- dd0ff74: Throttle all Airtable HTTP at its single funnel so paging bursts stop tripping the per-base
  ~5 req/s limit. Even fully sequential `eachPage` paging fires fast enough that one cockpit load
  scanning Reports + Submissions could exceed the cap and exhaust the SDK's 429-retry budget. The
  shared `openBase` now wraps `base._base.runAction` — the one method every list/create/update/destroy
  call funnels through — with a min-interval throttle (~220ms ⇒ ≤ ~4.5 req/s) that spaces request
  _starts_ while preserving order. The SDK's built-in 429 retry stays as a backstop. The throttle
  chain is fail-safe: a throw or rejection in one step can never stall the queue (which would
  silently hang every subsequent Airtable call in the process).
- dd0ff74: Cap the cockpit's "New submissions" strip at the 10 newest rows so it can't grow into a
  fleet-wide wall as submissions accumulate. The heading still shows the true total and a
  `+N more — triage on each site page` line links onward; per-site NEW-submission counts and
  badges are unaffected (the cap is at render only, not the fetch). The per-site form-submissions
  section (already capped at 25) now says `showing 25 of N` when it lists a slice, so the heading
  no longer implies every submission is on the page.
- 0474c6e: The per-site dashboard now lets you inspect a submission, not just triage it. Each submission is an
  expandable row revealing all stored fields — phone, full message, source URL, UTM, the per-site extra
  fields, notify status, Resend message ID, and submission number — all HTML-escaped, with the source
  URL run through `safeUrl`.

## 0.50.0

### Minor Changes

- 73be4c6: Checklist auto-tick gains three Testing signals from one new audit: **Desktop Browsers**,
  **Mobile Browsers**, and **Links & Navigation**. A new checkout-free `browser` audit drives
  Playwright against the deployed URL — chromium/firefox/webkit for desktop, mobile-emulated
  chromium/webkit, and an internal-link check — over a **representative route sample** discovered
  from the sitemap and **bucketed by path family** so CMS-generated templates (Prismic
  `[uid]`/`[slug]` pages) are always covered, not just static top-level pages. It joins the nightly
  sweep (`--only lighthouse,domain,browser`, all checkout-free; the runner now `playwright
install`s firefox/webkit) and persists `Crossbrowser OK` / `Mobile OK` / `Links OK` / `Broken
links` / `Browser checked at` to the Websites row. The three boxes auto-tick at draft time when
  fresh and green; stale → unknown, a failing verdict → fail (amber, with the broken-link count for
  Links), never-run → manual. Fail-safe throughout: empty/flaky observations never count as a pass.
  Honest scope: cross-engine render without JS errors + no mobile overflow + internal links resolve
  — not pixel-perfect visual correctness or real-device touch.
- a6b8c17: Checklist auto-tick gains its second signal: **Domain, DNS & SSL**. A new checkout-free `domain`
  audit probes each site's deployed URL (DNS resolve + TLS cert expiry via Node `dns`/`tls`, no
  repo clone) and persists `Cert days remaining` + `Domain checked at` to the Websites row; it
  joins the nightly `fleet-lighthouse` sweep (`--only lighthouse,domain` — both run against the
  deployed URL, so no extra clone). The `Maint: Domain, DNS & SSL` box then auto-ticks at draft
  time when the check is fresh, the domain is custom (not `*.netlify.app`), it resolves, and the
  cert has >14 days left. Fail-safe as always: stale → unknown, near-expiry / unresolved → fail
  (amber with the reason), no custom domain or never-probed → left manual. Honest scope: resolve +
  valid cert only — not registrar expiry, www↔apex redirect, or MX.
- 96d1559: Report checklist items can now auto-tick from verified signals. Phase 1 ships the engine
  (`autoTickChecklist`, a `Checklist auto-evidence` snapshot on the report row, and green/amber
  evidence badges on the dashboard beside each checkbox) and wires the first signal: **Google
  Indexed** auto-ticks when Search Console shows the brand query on page 1 at draft time.
  Fail-safe — a box auto-ticks only on fresh positive proof; a missing, soft-failed, or
  not-on-page-1 signal leaves the box manual (amber, with the reason). The per-report human
  approve gate and the operator's one-click override are unchanged.

  Operator setup: add a **`Checklist auto-evidence`** (Long text) field to the Reports table
  before the next draft run — drafts write the evidence snapshot there.

- baf2994: Checklist auto-tick gains the **Security Updates** signal (the last of the six automatable
  checks). The security audit now stamps a `Last security audit at` freshness timestamp alongside
  its vuln counts, and a new nightly **`fleet-security`** workflow runs `pnpm/npm audit` across the
  fleet (checkout-ful — it reads each repo's committed lockfile; kept a separate job so the
  lighthouse/domain/browser sweep stays checkout-free). The `Maint: Security Updates` box
  auto-ticks when fresh with **0 critical and 0 high** advisories; any critical/high → fail (amber,
  with the count), stale → unknown, never-run → manual. Honest scope: "no known critical/high
  advisories in the declared dependencies as of the last audit" (moderate/low advisory-only; does
  not prove the fix is deployed).

  Also relaxes `writeAuditsToAirtable`: a Lighthouse result is no longer _required_ — a standalone
  `--only security` (or any non-lighthouse) sweep now persists its audits instead of erroring. The
  Lighthouse-miss flag still fires when Lighthouse was actually run but produced no scores.

### Patch Changes

- b16088d: Report emails now attach only the inline images they actually render. The blurred-tests image
  (`cid:rd-blurred-tests-jpg`) is referenced solely by the Maintenance template, yet `sendOne`
  previously attached it — plus the green check — to every report type, leaving a dangling inline
  part that some mail clients surface as a stray downloadable attachment on Testing, Announcement,
  and Launch emails. The send path now gates each bundled image on its `cid` appearing in the
  rendered HTML: the header attaches always, the check on every type except Launch, and the
  blurred-tests image only on Maintenance. Self-correcting if a template's image usage changes.

## 0.49.1

### Patch Changes

- c18d960: The Maintenance report's "Last Tested" date now reflects the real last automated test. It reads
  the live `Last lighthouse audit at` timestamp on the Websites row — stamped every time
  `audit lighthouse --write-airtable` refreshes the scores — instead of the hand-set `testing day`
  scheduling anchor (which went stale and could show a date months out of date). `testing day` is
  unchanged; it remains the recurrence anchor used by the due-report scheduler. A site that has
  never been audited leaves the line blank, exactly as before.

## 0.49.0

### Minor Changes

- 0471dec: Only one report is queued for approval per site at a time, highest tier wins. Report tiers form
  a superset chain — Maintenance ⊂ Testing ⊂ {Announcement, Launch} — so a higher-tier draft makes
  lower ones redundant. A new shared `queueDraft` (src/reports/queue.ts), called by every draft
  path (`draftReportForSite`, `announce`, `launch`):
  - Supersedes lower-tier reports already pending approval for the site by **un-queuing** them
    (clears `Draft ready` — the row is kept, not deleted), then queues the new one.
  - Stands down (leaves the new draft un-queued) when an **equal-or-higher** tier is already
    pending — e.g. a queued Testing blocks a new Maintenance draft, and a queued Launch blocks a
    new Announcement (the existing one is kept rather than silently replaced).

  The `report` CLI surfaces the outcome ("drafted but NOT queued…" / "superseded N lower-tier
  drafts"); `draftReportForSite` returns `queued` + `supersededIds`, and `announce` results carry
  `queued`.

  The nightly `--due` run now distinguishes a draft `queueDraft` intentionally un-queued from one
  wedged half-made by a crash: if a higher-or-equal-tier report is still pending for the site, the
  not-ready row is skipped instead of re-completed — otherwise it would re-render and append a
  duplicate HTML attachment every run only to be re-blocked.

## 0.48.0

### Minor Changes

- 8ec20e1: The announcement email is rebuilt from the monthly report's own components so it reads as a
  testing report with extra explanation, not a lighter one-off. A new shared `email-sections`
  module (`checklistRowsSection`, `lighthouseScoresSection`, `analyticsSection`) is used by BOTH
  the report and the announcement, so they can't drift in design:
  - The announcement now renders MAINTENANCE CHECKS (first) then TESTING as real checklist rows,
    the full LIGHTHOUSE SCORES block, and the big ANALYTICS number + Google-position line.
  - Each pace's cadence is baked into its section's intro copy ("…We do this every month.") —
    the separate WHAT TO EXPECT block is gone.
  - The open-door invitation is reworded ("…just let us know.") and folded into the end of
    RECENT IMPROVEMENTS (no duplicate "reply" CTA right before the contact block).
  - Every alternating-background band carries equal top/bottom padding.

  Also: **Lighthouse "Ideal" bands now all top out at 100** (Best Practices was 80–92 → 80–100),
  in both the report and the announcement, since they share the component. Dead announcement copy
  keys removed (`announceScoreNote`, `announcePreviewLabel`, `announceCadenceHeading`,
  `announceTestingLabel`, `announceMaintenanceLabel`).

## 0.47.0

### Minor Changes

- 27f064d: The announcement email now shows the testing/maintenance checks as a **checkmark
  list** (a green ✓ per item under each pace, mirroring the report's checklist) and
  gains a **TRAFFIC & SEARCH** section — visitors for the last ~30 days with an
  up/down trend vs the prior window, plus the page-1 Google position — fetched live
  by the `announce` recipe via the report pipeline's soft-failing GA + Search Console
  enrichment (`fetchGaUsers` / `fetchSearch`, now exported) and stored on the Reports
  row (`ReportEnrichment`; `updateReportScores` extended for the reuse path).

  Also fixes a latent send-path gap: `sendOne` re-rendered a sent Announcement WITHOUT
  its cadence/improvements (they aren't stored on the row), silently dropping the whole
  "WHAT TO EXPECT" section from the delivered email. A new `announcementSiteExtras(site)`
  helper re-derives them from the Websites row and is shared by both the draft preview
  and the send re-render, so the sent email matches what the operator reviewed.

- 636cfd3: Announcement + report email polish:
  - The score-preview accessibility label is now **"Readability (A11y)"** (was
    "Readability") in both the announcement and the monthly report, so the parenthetical
    makes the meaning explicit.
  - The announcement's WHAT TO EXPECT checks now use the report's own green check image
    (`cid:rd-check-png`, attached inline at send) placed **after** each label, so the
    announcement's checks match the monthly report exactly (replacing the inline `✓` glyph;
    `alt="✓"` is the fallback shown in the attachment-less review preview).
  - New optional `announceScoreNote` copy field renders a thin-italic gloss under the
    Lighthouse scores ("These are independent Google Lighthouse scores, each out of 100 —
    higher is better."); a blank value omits it.
  - The Testing checklist item "Verified After Updates" is relabeled **"Tested After
    Updates"** (display-only — the Airtable checkbox column key is unchanged, so no
    live-base migration).

- b09bf20: Search Console brand matching is now robust to phrasing. The report/announcement
  "brand search position" no longer depends on the operator typing the exact query
  string: the `Search query` is treated as a case-insensitive **substring hint**
  (`contains` instead of `equals`). Among the matching user queries we report the
  position of the **exact-match query when present** (a precisely-configured brand query
  is honored verbatim — no longer-tail variant can hijack the number), otherwise the
  **most-searched** matching query (highest impressions, tie-break best position). New
  exported `pickBrandQuery` (most-searched) and `selectBrandPosition` (exact-first then
  fallback). So "red door creative" is honored exactly, "red door" still resolves to the
  brand's top query, and a near-miss like "reddoor creative la" no longer silently returns
  nothing. Backward-compatible — an exact string contains itself, so every currently-working
  site keeps its result.

## 0.46.0

### Minor Changes

- 19f4bd9: The announcement email's "WHAT TO EXPECT" section now spells out what each pace
  covers: under "Full site testing" and "Routine maintenance" it lists that pass's
  specific checks inline (middot-separated), pulled from the **same**
  `testingChecklist` / `maintenanceChecks` copy arrays the monthly report renders —
  so the announcement and the report can never drift. The now-redundant standalone
  "WHAT WE MONITOR" block is removed (its items are covered by the expanded section
  plus the score preview), and the unused `announceMonitorItems` copy key is dropped.

## 0.45.0

### Minor Changes

- 3d2f0df: `report <slug>` gains a `--type <Maintenance|Testing>` flag so the operator can
  draft a Testing report (not just the default Maintenance) for a single site on
  demand. Type parsing is case-insensitive and validated before any Airtable access,
  so a bad value fails fast without credentials; Launch and Announcement are
  rejected with a pointer to their own commands (`launch` / `announce`). Works with
  `--preview` too.
- bdc2813: A **Testing** report now gates on all 13 checklist items (the 6 maintenance items
  plus the 7 testing items), not just the 7 testing ones. A testing pass also
  performs the maintenance checks — and the Testing email already shows both lists —
  so `checklistFor("Testing")` returns maintenance-then-testing, the dashboard
  renders all 13 checkboxes, and approve/send stay blocked until every one is
  checked. Maintenance reports are unchanged (still gate on their 6 items);
  Launch/Announcement remain ungated.

## 0.44.0

### Minor Changes

- 698b097: Revise the maintenance and testing checklists (the operator gate + client-email
  lines, kept in sync). Maintenance stays 6 items but is sharpened: `Reviewed Logs`
  → "Deploy & Function Health", `DNS Checked` → "Domain, DNS & SSL" (absorbs SSL),
  `Reviewed Certificate` is cut (Netlify auto-renews — it overlapped), and a new
  "Uptime Checked" is added. Testing grows 6 → 7: `Package Updates` → "Verified
  After Updates", `Animation Functionality` → "Interactions & Animations",
  `Bottlenecks` is cut (overlapped automated Lighthouse Performance), and two items
  are added — "Page Titles & Meta" (catches the recurring empty-title regression)
  and "Links & Navigation". `ALL_CHECKLIST_FIELDS` is now 13; "Google Indexed"
  stays at maintenance index 3 so the email keeps injecting the live search
  position. The two cut Airtable columns are retired (renamed, no longer read) and
  can be deleted in the UI.

## 0.43.0

### Minor Changes

- 1908fba: Reframe the announcement email (shipped in 0.42.0) from "your new monthly report"
  to an ongoing site-care message. It now states each client's **testing and
  maintenance cadence**, read from the Websites row (`testing freq` /
  `maintenence freq`) and rendered as a "WHAT TO EXPECT" section (e.g. "Full site
  testing — every quarter"); a `None` pace is omitted so no cadence is over-claimed.
  The score preview is framed as the latest full site test. Adds `ReportCadence` /
  `ReportFrequency` types and `ReportData.cadence`; the `announce` recipe passes
  each site's frequencies and uses a "Your testing & maintenance schedule for
  <site>" subject.
- 6a08456: Maintenance/Testing reports now gate on a per-item operator checklist: 12 checkbox fields on the Reports row, flippable in Airtable AND as interactive checkboxes on the dashboard per-site page; the Approve button is disabled and the approve action + send path both refuse until every item for the report's type is checked. The client email is unchanged. Launch/Announcement reports are not gated.
- bbfedd9: Cockpit + per-site dashboard visibility: labels on Lighthouse scores, a setup (N/4) tooltip listing missing onboarding items + a setup section on the per-site page, GA/Search report-source data + a site-details section on the per-site page, and a Home link on the per-site page.

## 0.42.0

### Minor Changes

- 0eb0722: Cockpit now flags a live (`maintenance`) site that is still served from its
  default `*.netlify.app` host — i.e. it never got a custom domain. The site drops
  to the 🟡 Watch tier with an "on `*.netlify.app` (no custom domain)" reason and a
  new `no-domain` filter chip, surfacing a launch-completeness gap that was
  otherwise invisible. A `launch period` site on `*.netlify.app` is left alone (no
  domain yet is expected pre-launch). Adds a small `isNetlifyAppUrl(url)` URL
  predicate (sibling of `isHttpUrl`) that matches the apex and any subdomain of
  `netlify.app` without being fooled by look-alike hosts.
- d8b06f9: Add a one-time **monthly-report announcement** email, as a new `Announcement`
  report type riding the existing draft → approve → send pipeline. A new `announce`
  recipe + CLI (`reddoor announce` for all `maintenance` sites, or
  `reddoor announce <site>` for one) drafts a personalized email per client
  introducing the recurring monthly report: a live preview of the site's latest
  Lighthouse scores (using the same client-facing labels as the real report),
  recent-improvement callouts (forms now delivered via Resend; the Svelte 4 → 5
  modernization — default-on fleet-wide, with the per-client approve review as the
  relevance backstop), and a soft open door to expand scope. Pure-value framing, no
  pricing. `createDraft` gains an optional `subjectOverride`. The send path is
  reused unchanged — an Announcement renders by type and does not flip Status.

  Operational prereq: add an `Announcement` option to the Airtable `Report type`
  single-select before running (the API can't add select options).

### Patch Changes

- 7fa8e7a: Per-site submissions are now fetched with a server-side `{Site}` filter, a
  newest-first sort, and a bounded `maxRecords`, instead of paging the entire
  `Submissions` table on every site-dashboard load and filtering in JS. This
  removes the one unbounded full-table scan in the request path as the fleet's
  submission volume grows. Internal only — no public API change.
- 802e8a9: Lower the form timing-gate threshold (`MIN_FILL_MS`) from 2000ms to 800ms. A
  too-fast fill is dropped silently (the visitor still sees success), so the old
  2s bar risked silently losing a real lead from a quick-but-genuine human
  (autofill, a short form, a returning visitor). At 800ms a submit is effectively
  instant — which a script does and a human realistically never beats — so the
  gate still blocks instant bots while erring toward letting borderline-fast
  humans through. The honeypot remains the primary bot signal; this only affects
  the server form-action path (`createIngestAction`), as the modal/JSON path
  already screens honeypot-only.

## 0.41.0

### Minor Changes

- c79e8d5: Field-based notification routing for form submissions. A site can now set a
  `Notify Routing` JSON column on its Airtable Websites row
  (`{field, routes, default?, cc?}`) to address the submission notification by the
  value of a submission field (e.g. route a contact form's `interest` to a
  different recipient per option), with support for multiple recipients and CC.
  Recipients resolve server-side from Airtable only — the submitting site never
  supplies an address. The config is parsed defensively (bad/blank JSON → the
  site keeps its existing single-POC behavior) and is inert until set, so the
  change is a no-op for every current site. The verify guard is preserved:
  pre-launch sites still route to the operator with no routing or CC.

## 0.40.0

### Minor Changes

- bea8d7b: Newsletter submissions can now be added directly to a per-site Mailchimp audience
  (no Zapier hop) when the site's new `Mailchimp API Key` + `Mailchimp Audience ID`
  Airtable columns are set. The dashboard ingest upserts the subscriber
  (`PUT /lists/{id}/members/{hash}`, idempotent, `status_if_new: subscribed`)
  best-effort — never blocking or failing the submission. The generic
  `Newsletter Webhook` remains available for other integrations.

## 0.39.0

### Minor Changes

- f55a128: Submission notification emails now include the submission's `extraFields` — the
  site-specific context a recipient most needs (the artwork an inquiry is about,
  the event an rsvp is for, the company on a contact). Previously these were
  stored in Airtable but omitted from the email; now they render as labeled rows
  (HTML-escaped, empty values dropped, malformed JSON tolerated).

### Patch Changes

- 59da053: Add the reddoor mark as a favicon on the dashboard pages (fleet cockpit + per-site
  dashboard), inlined as a data-URI so the function-rendered HTML carries the brand
  with no static-asset request.

## 0.38.0

### Minor Changes

- 7a9eacd: Newsletter submissions now fan out to a per-site webhook (e.g. a Zapier Catch
  Hook) when the site's new Airtable `Newsletter Webhook` column is set. The
  dashboard ingest POSTs newsletter-formType submissions to that URL best-effort
  (https-only, never blocks or fails the submission). Sites without the column set
  are unaffected.

## 0.37.0

### Minor Changes

- 2624486: Add `createIngestEndpoint` — a JSON `POST`-handler factory for client-driven
  forms (modals/lightboxes/fetch), the sibling of `createIngestAction`. Screens
  the honeypot, validates `formType` against `SUBMISSION_FORM_TYPES`, forwards to
  the dashboard ingest, and returns `{ ok }`-shaped JSON.

## 0.36.1

### Patch Changes

- dabf724: Dashboard cockpit visibility is now derived from site `Status` (shown when `maintenance` or `launch period`) instead of the vestigial per-site `Dashboard Token` field. The `dashboardToken` field is removed from `WebsiteRow`; the Airtable `Dashboard Token` column can be deleted.

## 0.36.0

### Minor Changes

- d024497: Forms: `createIngestAction` gains an optional `redirectTo` (303-redirect on success/bot-screen, e.g. a dedicated `/thank-you` page). Submission notifications are now status-aware — sites not yet in `maintenance` (launch period, hosting, etc.) route leads to the operator (`OPERATOR_EMAIL` or `tucker@reddoorla.com`); sites in `maintenance` go to the client POC as before.

## 0.35.0

### Minor Changes

- 84a0126: Add `createIngestAction` to the `@reddoorla/maintenance/forms` subpath — a factory that builds a SvelteKit `default` form action (bot screen → forward to the dashboard ingest endpoint → SvelteKit-shaped results). Fleet sites now wire a contact form in ~12 lines by supplying only a per-form `buildPayload`. SvelteKit is added as an optional peer dependency (only this module imports it).

## 0.34.0

### Minor Changes

- 7f02928: Add the `@reddoorla/maintenance/forms` subpath: `submitToIngest` + `screenSubmission` (and `SubmissionPayload`/`FormType`) for fleet SvelteKit sites to forward contact-form submissions to the dashboard ingest endpoint.

## 0.33.0

### Minor Changes

- a568c1e: feat(cockpit): the fleet homepage is now a triage cockpit (M4 slice 1). Sites group into 🔴 Needs-attention / 🟡 Watch / 🟢 Healthy tiers (collapsible), with the approve queue pinned on top. Each card shows its live M5 signals — critical/high vulns, sub-75 Lighthouse categories, delivery bounces/complaints — badged NEW/WORSE to match the daily email digest (the Digest State snapshot is read read-only, never written from the page). A summary bar gives the tier counts + headline triage line and filter chips. Rendered entirely from already-persisted Airtable state (no request-path GitHub/Lighthouse calls) and rate-limited against brute-force. Renovate-failing / CI-red / staleness signals follow in slice 2.
- d77be27: feat(github-signals): nightly fleet sweep persists three GitHub-sourced signals per site to Airtable (M4 slice 2a) — count of Renovate update PRs failing CI, default-branch CI state, and last-commit-to-default-branch timestamp. New `github-signals --fleet --write-airtable` command (runs in the nightly cron with the fleet-read token), a `defaultBranchStatus` GitHub query, and `updateGitHubSignals` Airtable writer. The cockpit reads these (slice 2b) with no request-path GitHub calls.
- ddfdc6b: feat(cockpit): the cockpit now surfaces the GitHub-sourced signals (M4 slice 2b). Sites with Renovate update PRs failing CI or a red default-branch build join the 🔴 attention tier (chips + NEW/WORSE badges + new `prs`/`ci` filters), and the 🟡 Watch tier's staleness now uses the real last-commit-to-`main` timestamp (slice 2a) instead of the audit-age proxy. Pure collectors read the persisted Websites fields — still zero request-path GitHub calls. The summary bar gains "N PRs failing" / "N CI red" counts.
- 58ceba2: feat(alerts): the digest's "Needs attention" now flags Lighthouse categories below 75 (M5 slice 3). Each of a site's four deployed scores — Performance, Accessibility, Best Practices, SEO — that drops under the floor surfaces as its own NEW/WORSE-badged item linking the dashboard. The metric is encoded as the deficit (`100 - score`), so a category sliding further down badges WORSE, a first crossing below the floor badges NEW, and a recovery clears it from the snapshot (re-NEWing if it regresses again). Pure Airtable read — no new fetch, token, or workflow change.
- 911e412: feat(alerts): the daily digest now surfaces fleet problems (M5 slice 1). The "Needs attention" section — empty since M3 — lists every site currently carrying a critical/high security vuln and every report that bounced or complained, **grouped by site, severity-ordered (critical first), and badged NEW or WORSE** versus the prior run. The hybrid snapshot never silently drops a standing problem, while the badges land the eye on what changed. Prior state lives in a single "Digest State" Airtable record (one read + write per run); a resolved problem clears even on a no-noise skip day, so a recurrence correctly re-badges NEW. Two zero-infra signals ship here; Renovate-PRs-failing-CI and Lighthouse regression follow on the same framework.
- 290674e: feat(alerts): the digest's "Needs attention" now also flags Renovate dependency-update PRs that are failing CI across the fleet (M5 slice 2). The daily run sweeps each repo's open PRs (via the shipped `collectRenovateFailures` detector behind a fleet-read `RENOVATE_TOKEN`), surfacing each red Renovate PR as a NEW/WORSE-badged item linking the PR, plus a single roll-up note for any repos that couldn't be checked (gaps are never hidden). The sweep is isolated — a GitHub hiccup yields nothing for this signal and never blanks the vuln/delivery signals — and is skipped entirely when no token is present (local runs are unaffected).
- 83cbd6c: feat(copy): email copy is now data, not scattered literals (M6a). Every hardcoded string in the report template moves into one `DEFAULT_COPY` catalog (`src/reports/copy.ts`) — fleet-wide wording is a one-file edit. A site can override the three most client-facing narrative blocks — **intro · contact · footer** — via new Airtable fields (`Copy — Intro/Contact/Footer`), merged `override ?? default` like report recipients. A site with no overrides renders a visually-identical email (all copy — default and override alike — is now HTML-escaped for safety, so e.g. an apostrophe renders as its entity). Sets up the launch email (M6b) to reuse the same copy layer.
- adaefa4: feat(launch): first-class site launch (M6b — completes M1–M6). `launch <site>` bootstraps CI+Renovate, runs a first audit, and drafts a **purpose-built launch email** (a new `Launch` report type) into the dashboard approve queue. Approving it sends the go-live email and flips the site **Status → maintenance** with a **`Launched at`** stamp — no client email leaves without the one-click approval. The launch email reuses the M6a copy layer (per-site contact/footer overrides honored).

### Patch Changes

- 411fead: fix(digest): a same-day `report --digest` re-run whose content changed (e.g. a manual re-dispatch after new signals appeared) no longer fails. Resend returns a 409 when an idempotency key is reused within 24h with a different body; the digest now treats that as a graceful "already sent today" skip (exit 0, no duplicate email, no state write) rather than throwing — which previously reddened the daily run and opened a false tracking issue. A genuine send/network failure still exits 1 loudly.

## 0.32.0

### Minor Changes

- 6b0229d: feat(dashboard): one-click approve — the M3 loop closes. Each pending report on `/s/<slug>` (and a "Pending your yes" list at the top, plus a fleet-wide count banner on `/`) gets an Approve button that POSTs to the new basic-auth-gated `/api/reports/:id/approve` Netlify function. The click is a decoupled, audited flag-flip — `Approved to send = TRUE` + `Approved At`/`Approved By` stamped, never a send — and is idempotent (already-approved and already-sent rows are safe no-ops; nothing can un-approve). The next daily run's `--send-ready` step does the actual sending.
- 113145e: feat(reports): `report --due` is now idempotent — a re-run never double-drafts. Each due (site, type) is keyed by the UTC `YYYY-MM` of its due date (`reportPeriodKey`), stamped onto the new Reports `Period` field at draft time, and skipped when a row for that key already exists. Skips surface in the output and never trip a non-zero exit, so a cron re-fire is a safe no-op. The manual single-site `report <slug>` path intentionally still always drafts.

  Also fixes a pre-existing live-Airtable break this work surfaced: report queries filtered linked-record `{Site}` fields by record id inside `filterByFormula`, which Airtable renders as primary-field _names_ — so the filter matched nothing, `lastSent` was never found, and dueness was computed from fallbacks. Reports are now fetched unfiltered (one paged query instead of N) and matched by record id client-side, so `report --due` dueness is correct against the real base for the first time.

- a64cd04: feat(reports): `report --digest` — one daily "your fleet today" operator email. A "Ready for your yes" section lists every draft-ready, unapproved, unsent report with a link to its dashboard page; a typed "Needs attention" section ships as the M5 alerting seam (empty for now, renders "all clear"). Skips the send entirely when there is nothing to report (no-noise default), dedupes same-day re-fires via a `digest-<date>` Resend idempotency key, and sends to `OPERATOR_EMAIL` (fallback `info@reddoorla.com`). Dashboard origin from `DASHBOARD_BASE_URL` (fallback the live Netlify origin). Email-client-safe HTML (charset, table layout, https-only links).

## 0.31.0

### Minor Changes

- e6417c9: feat(configs): `createSvelteConfig` composes the starter's richness. It now always injects the fleet's canonical `$components/$utils/$stores/$assets` aliases (a site can override per key or add its own), and gains two opt-in options: `csp` (`true` for the baseline Prismic+Vimeo policy, or `{ directives }` to extend it per-directive) and `placeholder` (`true` tolerates 404s during prerender for an un-wired clone). CSP and prerender tolerance are opt-in so adopting the helper never silently changes a site's behavior; an explicit `kit.csp` remains an escape hatch.

### Patch Changes

- a236e87: fix(a11y): the audit's transient `.reddoor-a11y-spec-*` dir is now removed on every catchable exit (try/finally), and `.reddoor-a11y-spec-*/` is in the canonical gitignore — so a timeout-killed run never leaves untracked files in a fleet repo's tree.
- a236e87: fix(airtable): a Lighthouse miss no longer discards a site's a11y/deps/security results — those are written first, then the run still surfaces the Lighthouse failure (so the fleet gate keeps its signal without losing the other audits' data).
- a236e87: fix(lighthouse): deployed-URL audits get the same 5-minute spawn budget as the checkout path (was 3), so a slow site's three cold runs don't time out into a spurious "no scores".
- a236e87: fix(deps): the audit guards `JSON.parse` (a corrupt package.json now fails cleanly with a clear message) and skips non-semver specs (`*`, `latest`, `workspace:*`, `npm:`-aliases, git/URL) that previously parsed to NaN and produced bogus drift.
- a236e87: fix(airtable): `getWebsiteBySlug` narrows the fetch with a `filterByFormula` (replicating `siteSlug` on `{Name}`, capped at one record) instead of paging the whole table per request, and validates the slug to keep URL input out of the formula.

## 0.30.0

### Minor Changes

- 4a9fd77: feat(dashboard): retire the per-site token model — the operator password gates `/s/<slug>` and `/`. `verifyDashboardToken` is removed; `dashboardToken` is now a fleet-homepage visibility flag only.
- 4a9fd77: feat(deps): add a real outdated-install signal alongside the declared-range "Deps Drifted" number. The deps audit now also reports how many installs are behind the registry's latest (`pnpm outdated`, best-effort), written to a new `Deps Outdated` Airtable field and shown on the dashboard.

### Patch Changes

- 4a9fd77: fix(fleet): `cloneIfNeeded` derives a clone URL from `gitRepo` (`https://github.com/<owner/repo>.git`, strict-validated) when no `repoUrl` is set, unbreaking checkout-based `--fleet airtable` recipes. The JSON inventory provider now also carries `gitRepo`/`deployedUrl`.
- 4a9fd77: fix(fleet): the fleet write-back now emits a machine-readable `FLEET_WRITE_SUMMARY wrote=N failed=M total=T` line so the nightly workflow can gate on real outcomes (red on total/mass write-back failure, warn on a tolerated single flake) instead of a "wrote ≥ 1" heuristic.
- 4a9fd77: fix(audits): kill the whole process group on a spawn timeout (detached when a timeout is set + `process.kill(-pid)` with SIGTERM→SIGKILL escalation), so a timed-out audit no longer orphans vite/Chromium. Timeout-less streaming calls stay attached so Ctrl-C still works. Also caps captured stdout/stderr.
- 4a9fd77: fix(sync-configs): the canonical `netlify.toml` template now ships the baseline security headers, and a `[[headers]]`-aware carve-out stops `sync-configs` from stripping a site's own security config (a header-less file is backfilled; a hardened one is left alone).

## 0.29.0

### Minor Changes

- 953edf9: feat(a11y audit): hydration smoke-check on `/`

  The a11y audit now smoke-loads the homepage (`smokeRoutes`, default `/`) and fails
  on any uncaught client-side exception — catching the class of bug where build + SSR
  succeed but client hydration throws and blanks the page (e.g. a Svelte 4→5 `run()`
  referencing a `$state` declared after it → TDZ ReferenceError on hydrate, which axe
  over `/dev` fixtures never sees). No axe runs on smoke routes (real routes carry
  a11y debt we don't gate on), and HTTP/SSR errors don't fire `pageerror`, so a
  data-less CI homepage that renders empty-but-valid won't false-fail. Runs inside the
  existing `reddoor-maint audit --only a11y` step — no CI workflow change; propagates
  to the fleet on the next Renovate bump of `@reddoorla/maintenance`.

## 0.28.0

### Minor Changes

- 7c7c123: feat(M7.1): sync-configs `ci` + `renovate-config` templates become thin shims

  The `ci` workflow template is now a ~6-line caller of the org reusable workflow
  (`reddoorla/.github/.github/workflows/ci.yml@<sha> # v1.0.0`), and `renovate.json` is a
  3-line shim that `extends` the org preset (`github>reddoorla/.github:renovate-config`).
  The canonical CI gate and dependency policy now live once in `reddoorla/.github`;
  Renovate keeps the SHA current. `self-updating` requires the new `ci / ci` check context.

## 0.27.2

### Patch Changes

- b93590c: fix(audit/a11y): eliminate flaky color-contrast violation on animated routes

  The a11y audit sampled pages while CSS transitions were still running, so axe
  computed color-contrast against semi-transparent text mid-fade — producing a
  flaky "serious" color-contrast violation (~1/3 of runs on `/dev/animate-in`).
  The audit now disables transitions/animations before running axe, asserting the
  resting state users (and `prefers-reduced-motion` users) actually see. Verified
  8/8 clean over repeated runs that previously flaked ~1-in-3.

- 5420a09: fix(sync-configs): bump renovate workflow pin `renovatebot/github-action@v40` → `@v46.1.14`

  The `@v40` major tag no longer resolves (the action ships full-version tags only, now at v46.x), so the synced renovate workflow failed at action-resolution on every fleet repo. Pin to a current, resolvable version; Renovate self-maintains it going forward.

## 0.27.1

### Patch Changes

- e3f152d: `sync-configs` no longer clobbers a site's `svelte.config.js` customizations. The svelte template is now compliance-checked instead of exact-matched: a config already on the canonical pattern (imports `createSvelteConfig` **and** `@sveltejs/adapter-netlify`) is left untouched, so site-specific `kit.alias` and `compilerOptions` survive every sync. A missing or genuinely off-pattern config is still rewritten to the canonical template. Fixes the silent loss of custom path aliases (e.g. `$utils`/`$components`) on re-sync.

## 0.27.0

### Minor Changes

- 73c1aa7: Add a canonical `netlify.toml` to the `sync-configs` template set (new `netlify` config name). Standardizes the fleet's Netlify build: `command = "pnpm build"`, `publish = "build/"`, `functions = "functions/"`, `NODE_VERSION = "22"`, `COREPACK_INTEGRITY_KEYS = "0"`. Pins Node to latest 22.x — the older `22.12.0` pin is below `@eslint/js@10`'s `^22.13.0` engine and broke installs. Pairs with the adapter-netlify `svelte.config.js` template (#105) to make a synced site build on Netlify out of the box.

  Note: this template overwrites `netlify.toml` on sync. Sites with custom redirects/headers/plugins should keep those in `_redirects`/`_headers`/SvelteKit, or they'll be clobbered.

## 0.26.1

### Patch Changes

- e4c690d: `onboard` now ensures `@sveltejs/adapter-netlify` is declared, alongside `@reddoorla/maintenance` and the audit deps. The synced `svelte.config.js` template imports the adapter, so a freshly-onboarded site couldn't build without it — onboard previously left that gap to be patched by hand. Versions are sourced from `baseline-versions` (new `FRAMEWORK_DEPS`, same drift-guard as `AUDIT_DEPS`); sites that already declare the adapter are left untouched.

## 0.26.0

### Minor Changes

- c0bfc6d: The `sync-configs` `svelte.config.js` template now defaults to `@sveltejs/adapter-netlify` (`adapter({ edge: false, split: false })`) instead of `adapter-auto`. The whole Reddoor fleet deploys to Netlify, so the explicit adapter gives consistent `build/` output and avoids the adapter-auto resolution that left sites needing a manual override (caltex and erp both already use adapter-netlify). Sites must have `@sveltejs/adapter-netlify` installed.

## 0.25.0

### Minor Changes

- fb4532c: `self-updating` is now idempotent: it drives a repo to a known end-state (CI files on the default branch + auto-merge + branch protection requiring `ci` + the `RENOVATE_TOKEN` secret), checking remote state and acting only on what's missing. This fixes two gaps: `init`→`self-updating` no longer skips the GitHub wiring just because `sync-configs` already wrote the CI files, and a partial-failure run now self-heals on re-run instead of leaving a repo half-configured. New remote-read methods on the `GitHub` wrapper (`filesOnBranch`, `branchProtectionContexts`, `secretExists`, `autoMergeEnabled`, `findOpenSelfUpdatingPR`).

## 0.24.0

### Minor Changes

- 6954a9c: Add `.prettierignore` to the `sync-configs` canonical template set. The CI gate runs `prettier --check .`, which formats YAML — without a `.prettierignore`, `pnpm-lock.yaml` (and Renovate-updated lockfiles) fail the check. The new template excludes the lockfile and generated dirs (`.svelte-kit/`, `build/`, `.netlify/`, `dist/`) so the CI prettier step is green fleet-wide. New `ConfigName` `"prettier-ignore"`.

## 0.23.0

### Minor Changes

- 2206846: M1: self-updating repos. New `reddoor-maint self-updating [site]` recipe bootstraps a repo to keep itself current — writes a unified CI workflow (format+lint, typecheck, build, a11y via `audit --only a11y --fail-on-violations`; no lighthouse), a nightly self-hosted Renovate workflow, and `renovate.json` (patch/minor auto-merge on green, majors → PR); pushes, opens a PR, enables branch protection + auto-merge, and sets the `RENOVATE_TOKEN` secret. The three files join the `sync-configs` canonical set so the CI standard stays unified fleet-wide.
  - New `src/github/` (gh CLI wrappers + config); `GITHUB_TOKEN` + `RENOVATE_TOKEN` in credentials.env.
  - New Airtable Websites "Git repo" field → `WebsiteRow.gitRepo` → `Site.gitRepo` (falls back to the checkout's origin remote for local runs).
  - `audit --fail-on-violations` (a11y CI gate; exits non-zero on any a11y violation).

## 0.22.0

### Minor Changes

- 08cc2fe: Surface Google search presence in the report email, sourced from the Search Console Search Analytics API (reusing the GA service-account domain-wide delegation — added scope `webmasters.readonly`). The Custom Search JSON API path from the prior release is replaced (it is closed to new customers).
  - `src/reports/search/client.ts` — `fetchSearchPresence` queries the average position for a site's per-site query over the report period; `foundOnPage1 = avgPosition <= 10`, displayed rank is the rounded average. Resolves the Search Console property from the optional "Search Console property" Websites column, else auto-resolves (Domain or URL-prefix) from `sites.list`.
  - The report email's "Google Indexed" row becomes `Page 1 Google Result (#N)` when on page 1; otherwise unchanged. Positive-only — the negative is stored on the Reports row ("Search found page 1" / "Search position") for operator eyes, never shown to the client.
  - Soft-fail throughout: unconfigured / no query / API error leaves the draft unaffected.
  - Removes the obsolete `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_ENGINE_ID` env vars.

## 0.21.0

### Minor Changes

- a4e2528: Add a Google search-presence capability: given a per-site query and the site's domain, check whether the site appears on page 1 of Google's organic results.
  - `src/reports/search/client.ts` — `fetchSearchPresence({ apiKey, engineId, query, siteUrl })` → `{ foundOnPage1, position }` via the Custom Search JSON API (free 100/day; de-personalized national-ranking proxy). Hostname matching normalizes `www.`/scheme/path. Throws on non-OK responses so callers can soft-fail.
  - `src/reports/search/config.ts` — `readSearchConfig()` reads `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID`; null when unset → check skipped.
  - New Websites "Search query" column → `WebsiteRow.searchQuery`.

  This is the capability only. Surfacing it in the report email's "Google Indexed" line (and the draft-time fetch) lands as a follow-up, after the email's `escapeXml` helper merges. Operator setup (one-time): a Google Cloud API key with Custom Search enabled + a Programmable Search Engine ID in `credentials.env`.

## 0.20.0

### Minor Changes

- 70558e3: Report email polish — three client-facing improvements to the maintenance report:
  - **Analytics trend.** The ANALYTICS section now shows direction, rate, and raw change vs the previous period — `▲ 24% vs last period (549 → 679)` — instead of two bare numbers. Growth is green; a dip or flat is muted grey (a traffic dip isn't a failure). "New this period" when the prior period was a real 0. Pure presentation of data already fetched.
  - **GA "unavailable" vs "zero" are now distinct.** `ReportData.gaUsersCurrent/Previous` are optional; when GA is unconfigured / has no property ID / the fetch failed, the email renders "— Users" and "Last Period: —" rather than a misleading "0".
  - **Subject line carries the period.** `"{Site} — May 2026 Maintenance Report"` (UTC month/year from the report's completed-on date) for inbox scannability and archival. `Subject override` still wins.

  Also a correctness fix (was flagged in the 2026-05-29 review, never fixed, and widened by the recent header `alt`/`href` work): **site name, URL, and commentary are now XML-escaped before the strict MJML render.** Previously a client named with an `&` ("Brown & Co"), or a `<`/`"` in a URL or commentary, threw at render time and blocked the send. Added a regression test covering `&`, `<`, and `"`.

## 0.19.0

### Minor Changes

- 0da6913: Report drafts now auto-populate the analytics fields ("GA users (period)" / "GA users (prev period)") from the GA4 Data API, instead of requiring manual entry. At draft time, for any site with a "GA4 property ID" set, the CLI fetches `activeUsers` for the report period and the equal-length previous period and writes both into the Reports row (and into the rendered review HTML, so they agree).

  Auth uses the service account via domain-wide delegation (impersonating a Workspace user) proven out on 2026-06-01 — configured with `GA_SUBJECT` (the impersonated user) and the service-account key at `GA_SA_KEY_PATH` (defaults alongside `credentials.env`), scope `analytics.readonly`.

  Soft-fail by design: if GA isn't configured, the site has no property ID, or the API errors, drafting logs a one-line warning, leaves the fields blank for manual entry, and still creates the draft. GA is an enhancement, never a gate.

## 0.18.1

### Patch Changes

- 57c3b8c: Fix squished/distorted report header image. The reserve-space change in 0.18.0 set an explicit pixel `height` on the header `<mj-image>`, which MJML emits as `height:<px>` while keeping `width:100%` — so the height stayed locked while the width scaled, distorting the header at any rendered width other than the 600px design width (mobile, narrow reading panes). The header now stays `height:auto` (always proportional, never distorts) and reserves its vertical space via `aspect-ratio` in a head `<mj-style>` instead. Added a regression test asserting the header `<img>` uses `height:auto` and never a fixed pixel height.

## 0.18.0

### Minor Changes

- 7441bb8: Report header images are now downscaled, dimensioned, and given a loading placeholder before send. Per-site headers in Airtable are often multi-MB / 2400px+ (the ERP Industrials header was 3.55 MB / 2400×3200) while the email renders them at ~600px — so the email shipped ~16× more pixels than the display could use, loaded slowly, and reflowed when it finally painted (the `<mj-image>` had no height).

  The send path (`orchestrate.ts`) now runs each header through a new `prepareHeaderImage` (`src/reports/maintenance-email/header-image.ts`, backed by `sharp`): downscale to 2× the 600px display width for retina, re-encode JPEG q82 on a flat white background, never upscale. On the real ERP header this is a **93% byte reduction (3.39 MB → 239 KB)** with no visible quality loss — the cut is resolution the email can't display, not the quality compression that visibly degraded the paper texture and in-image text.

  It also returns the display dimensions and a dominant-color placeholder, which the template now applies to the header `<mj-image>` (`width`/`height` to reserve the box and stop reflow, `container-background-color` as the loading/blocked placeholder, `alt` for blocked-image clients). When dimensions are absent (e.g. the local preview path) the header falls back to today's bare image. Adds `sharp` as a dependency.

## 0.17.1

### Patch Changes

- a676921: `audit --write-airtable` now refuses to run when combined with `--fleet`, exiting with code 2 and a clear message before any audit work begins. Previously the combo silently overwrote one Airtable Websites row's dashboard tiles with results pooled across all fleet sites (cwd-derived slug + flat `AuditResult[]`) — dashboard-wrong, not crash-loud. Per-site writes are the supported path: `cd <site>/ && reddoor-maint audit --write-airtable`. Per-site batched fleet writes can return as a follow-up when there's actual demand.

  Also bundled in this patch: `src/reports/draft.ts` `daysAgo` now uses UTC accessors to stay TZ-consistent with `due.ts` (was the only non-UTC date math left in the reports pipeline; fires only on the first-ever report for a (site, type) pair). And `pnpm.overrides` to force `tmp@>=0.2.6` and `uuid@>=11.1.1`, clearing two transitive security advisories pulled in via `@lhci/cli`. Remaining advisories (mjml chain) have no upstream patch and are accepted with documented rationale in the morning brief.

## 0.17.0

### Minor Changes

- 08eba85: Per-site dashboard at `/s/<slug>?t=<token>` now shows a "Site Health" section with three tiles (Accessibility issues, Dependency updates, Security alerts) alongside the existing Lighthouse scores. Deps tile gains a "N major behind" sub-line when relevant; Security tile gains a `C/H/M/L` severity breakdown when total > 0. A "Last audited Xd ago" line under the URL completes the picture.

  Empty state surfaces a clear operator hint (`run reddoor-maint audit --write-airtable from the site checkout`) for sites that haven't been audited since Phase 2c shipped. Onboarding-status indicator stays operator-only — fleet page only.

## 0.16.0

### Minor Changes

- 8ecba98: CLI now auto-loads credentials from `~/.config/reddoor-maint/credentials.env` (respects `$XDG_CONFIG_HOME`) at startup, so `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`, `DASHBOARD_PASSWORD` etc. follow the operator into any cwd — no more `cd` back into the maintenance repo to pick up `.env`. Shell-exported env vars still win over file values; missing/unreadable file is a silent no-op.

  When `AIRTABLE_PAT` or `AIRTABLE_BASE_ID` is missing, the error now points at the file path: `AIRTABLE_PAT not set. Export it in your shell or put it in /Users/<you>/.config/reddoor-maint/credentials.env as AIRTABLE_PAT=...`

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
