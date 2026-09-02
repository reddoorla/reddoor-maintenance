# Morning brief — 2026-09-02

## One-line verdict

The 08-26 backlog cleared almost completely — nine of ten HIGH/CRITICAL findings genuinely fixed, verified by reading the code rather than the commit subjects. But **last night's report ships four wrong claims to prospects**, three of them in code I wrote and one of them a re-introduction of an overclaim this repo had already removed with a live counterexample on file; the fix-list guard I described in a commit message as running "either way" does not run on the default path at all; and a dead Airtable precondition in form ingest will 500 every lead across all 44 sites the moment the PAT is rotated — which Phase 6 plans to do.

## Top of stack (do these first)

1. **Fix the crawler-reach line, both halves** (HIGH-1). It prints "Yes — all **0** of the crawlers we checked are allowed in" on every report ever produced, and the word "Yes" is a claim robots.txt cannot support — [`render.ts:244-250`](../../src/prospect/render.ts#L244) already says so, with a live prospect whose CDN 403'd a crawler its robots.txt allowed. I re-introduced that claim last night and promoted it to a section headline. ~20 min.
2. **Make `reconcileFixes` run on the cold path** (HIGH-2). Both halves of the fix-list guard are gated on `opts.goal`, so the protection exists only where an operator already confirmed the goal and is absent on every ordinary audit. My commit message says the opposite. ~15 min.
3. **Delete the dead Airtable env check in form ingest** (HIGH-3). Five lines. It guards nothing post-flip and hard-500s the highest-value path in the system before the dead-letter can catch anything. ~5 min.

**Before you forget:** the two pnpm security PRs (maintenance#668, website#151) are open and green, and all 25 local repos including `reddoor-starter` are on the affected version.

---

## Findings — HIGH

### HIGH-1 — Every report says "all 0 of the crawlers we checked", and says "Yes" to a question robots.txt cannot answer

Two defects in one sentence, both shipped last night, both client-facing.

**The count.** [`model.ts:686`](https://github.com/reddoorla/reddoor-website/blob/staging/src/lib/report/model.ts#L686) reads `checks.agentAccess?.length ?? 0`. `agentAccess` is not on `ChecksResult` — it is on `CrawlResult` ([`types.ts:133`](../../src/prospect/types.ts#L133)). `runChecks` *reads* `crawl.agentAccess` to build `crawlerAccess` but never re-emits it, and nothing in `model.ts` reads `r.crawl` at all. So `checked` is `0` always. Verified live against staging on three shapes, including the report generated an hour before the merge:

```text
oldest shape (53 of 65 reports)   Yes — all 0 of the crawlers we checked are allowed in.
08-27 goalFit-era report           Yes — all 0 of the crawlers we checked are allowed in.
last night's full-shape report     Yes — all 0 of the crawlers we checked are allowed in.
```

The real count is `blockedAi.length + allowedAi.length` — and `allowedAi` is not even declared in `model.ts`'s structural type for the checks stage.

**The claim.** The eyebrow asks "Can the AI crawlers **reach** you" and the answer is "Yes". The measurement only answers the robots.txt question. [`render.ts:244-250`](../../src/prospect/render.ts#L244) removed exactly this sentence upstream and records why:

> "Every AI crawler can reach the site" was a claim robots.txt cannot support: a CDN's bot management enforces its own answer and can contradict the file without the owner knowing. Confirmed on a live prospect: its robots.txt blocked nothing relevant, and its CDN returned 403 to one named AI crawler on every request while serving a browser and two other crawlers normally. **The report said they were fine.**

The surviving upstream wording is deliberately narrow — *"Nothing in your robots.txt blocks the AI crawlers we checked."* Last night I restored the broad claim and made it the first statement in "What you control", in the slot the component's own comment describes as "when the answer is no it is the most important line in the report".

**The test is complicit, and I wrote it.** `model.test.ts:58` and `:232` hand-write `agentAccess` onto the `checks` stage, so `expect(checked: 2)` passes against a shape production never emits. A hand-authored fixture encodes the author's belief about the producer; mine was wrong in the code and the fixture identically. See MED-6.

**Fix:** count from `crawlerAccess.allowedAi.length + blockedAi.length`, and adopt the upstream wording verbatim rather than inventing a second one.

### HIGH-2 — `reconcileFixes` does nothing on the default audit path, and my commit message says it does

[`pipeline.ts:314-317`](../../src/prospect/pipeline.ts#L314) builds `operatorFit` **only** when `opts.goal` is supplied. It is passed to `analyzeSite`, and [`analyze.ts:520`](../../src/prospect/analyze.ts#L520) returns `fixes` untouched when it is null. But `goalFit` in the published result is computed regardless, from the model's inferred `primaryGoal`.

Both halves of the guard — the `## What we have already measured` prompt block and the post-filter — are gated on the same flag. So the protection exists exactly where it is least needed (an operator already confirmed the goal) and is absent on every cold audit, which is the normal dispatch.

Failure scenario, fully live: audit a dental site with no `--goal`. The model infers `book`. The goal section prints "A way to book without calling — **Yes**". The model, never shown that checklist, emits "Add an online booking link". Nothing drops it. The prospect reads both, three sections apart. That is precisely the contradiction I wrote the function to prevent.

My own commit message on `8818b44` claims: *"reconcileFixes then drops anything tagged with a requirement we measured as met, whether or not the model listened."* On the default path that is false.

**Fix:** keep the pre-pass operator-only, but run the post-filter against the *resolved* `goalFit` after analyze returns.

### HIGH-3 — A dead Airtable precondition will 500 every lead across all 44 sites

[`netlify/functions/form-ingest.mts:108-113`](../../netlify/functions/form-ingest.mts#L108) still hard-fails on missing `AIRTABLE_PAT` / `AIRTABLE_BASE_ID`. Post-flip that guard protects nothing: [`site-lookup.ts:46`](../../src/forms/site-lookup.ts#L46) returns `null` before ever calling `fromAirtable` when `strict` is true, so the Airtable client built below it is unreachable code. The env check is the only live thing left, and it sits in front of the highest-value path in the system.

Failure scenario: the PAT is rotated, expires, or is removed during the Phase 6 cleanup the freeze doc explicitly plans ("Phase 6 deletes the shadow and the Airtable client layer with it"). Every `POST /api/forms/:slug` returns 500 **before** `ingestSubmission` is entered — and the dead-letter lives inside `ingestSubmission`, so it never fires. `submitToIngest` has no retry. Every lead in that window is gone, and the tell is a log line, not an alarm.

[`fleet-homepage.mts:48-52`](../../netlify/functions/fleet-homepage.mts#L48) already removed this exact gate and states the reasoning — "the page cannot be degraded by an Airtable outage". The same reasoning was never applied to the one path where the cost is a lost client lead. Same vestigial guard, lower stakes, at [`submissions-page.mts:52-57`](../../netlify/functions/submissions-page.mts#L52), twenty lines above a comment saying the page "no longer touches Airtable at all".

### HIGH-4 — The emailed report prints our own missing measurement as a defect of the prospect's site

[`render.ts:336-353`](../../src/prospect/render.ts#L336). A question the model skipped comes back `answered: "unknown"`, `evidence: null`. This renderer prints the raw token in the verdict column and, because evidence is null, pairs it with the string **"no passage on the site"**.

So the row reads `UNKNOWN | no passage on the site` — a claim about their site for a question we never got a verdict on. It is the exact inversion the `unknown` state was introduced to prevent, and it ships: [`email.ts:244`](../../src/prospect/email.ts#L244) attaches `renderProspectReport(result)` to the outgoing mail. There is also no `.tag.unknown` CSS rule (`.yes`/`.partial`/`.no` are defined at `render.ts:68`), so it is visually indistinguishable from a measured verdict.

The web report was updated correctly (`ANSWERED_LABEL.unknown = "Not measured"`, excluded from the meter). The two renderers now disagree about what the same stored field means.

### HIGH-5 — The report contradicts itself about whether the engine named the client

[`SearchResults.svelte:19`](https://github.com/reddoorla/reddoor-website/blob/staging/src/lib/report/SearchResults.svelte#L19) and [`print/+page.svelte:183`](https://github.com/reddoorla/reddoor-website/blob/staging/src/routes/audit/%5Btoken%5D/print/+page.svelte#L183) re-derive "named" as `domainCited || brandMentioned`. `model.ts:663` and [`render.ts:204`](../../src/prospect/render.ts#L204) were both fixed to prefer `countedAsVisible`, which is strictly narrower: `domainCited || (brandMentioned && nameIsDistinctive)`.

Failure scenario, taken from the field's own docstring: a business whose name is not distinctive ("Creative Studio") is mentioned incidentally. Standing prints *"Creative Studio was not among them, in any of the 5 questions we asked"*; the disclosure directly below prints *"Creative Studio appeared in this answer."* The print sheet does both on one page.

A document that contradicts itself about the client's own visibility invites the reader to discount all of it — which is what `Standing.svelte` spends forty lines of comments guarding against.

---

## Findings — MEDIUM

### MED-1 — All 25 local repos, including the starter, are on a pnpm with a secret-exfiltration advisory

`GHSA-vx52-2968-3vc6`: pnpm expands `${VAR}` in `httpProxy`/`httpsProxy`/`noProxy` read from a repository-controlled `pnpm-workspace.yaml`, so a malicious manifest can route install traffic through a proxy whose hostname embeds an environment secret — during config loading, before any lifecycle script runs. Affected `>=11.0.0 <11.11.0`; every local repo is pinned at `pnpm@11.8.0`, including `reddoor-starter` and `reddoor-starter-blux`.

**Exploitability in our configuration is low, and I want to be precise rather than inflate it.** Both repos ship a `pnpm-workspace.yaml` and maintenance CI runs `on: pull_request` unfiltered, so a fork PR's manifest *is* installed — but GitHub gives fork PRs a read-only token and no repository secrets, and [`ci.yml:29`](../../.github/workflows/ci.yml#L29)'s install step has no `env:` block, so `GITHUB_TOKEN` is not in that step's process environment. The workflows carrying real secrets install our own manifest on `main`, and the private runner is pinned to `ref: main` since #618.

It is on this list because the scope is total, the patches are already green, and the starter propagates the pin to every new site.

### MED-2 — `quoteSupportsClaim` and `distinctive` are wrong in both directions, on ordinary copy

Both heuristics went in last night. I ran them rather than reasoning about them:

```text
quoteSupportsClaim("The company is based in Los Angeles.",
                   "Los Angeles has a lot of noise.")            → PASSES  (false confirm)
quoteSupportsClaim("The business opened in 2018.",
                   "The 2018 rebrand was our largest project.")  → PASSES  (false confirm)
quoteSupportsClaim("They accept Medicaid.",
                   "We are a Medicaid provider.")                → REJECTED (false miss)
```

Two causes, both in [`accuracy.ts:462-483`](../../src/prospect/accuracy.ts#L462). Sentence-initial capitalisation makes `The` a "proper noun", supplying a free shared token to any pair. And a two-word name is *one* fact but *two* tokens, so merely naming a place or a person clears the 2-token bar. The false-miss case is worse than a silent drop: `verifyQuotes` then writes *"The passage we found is about the same subject but does not actually say this"* — a false statement about a passage that does say it.

The same capitalisation flaw reopens the "employees" regression I fixed last night: `distinctive()` accepts any term starting with a capital, and `searchTerms` is free text the model writes, so `["Employees"]` passes where `["employees"]` does not. The gate closes only the lowercase spelling of the bug.

**Fix:** exclude sentence-initial capitals from the proper-noun test, and count a contiguous capitalised run as one token.

### MED-3 — The widened copyright regex is wrong in both directions too

Also last night. Measured, not reasoned:

```text
"Copyright law changed in 2019 and we updated our terms."  → [2019]   (false positive)
"© Acme Design Co. 2019"                                    → []       (false negative)
"© Reddoor Creative 2006-2026, All Rights Reserved"         → [2026]   (correct)
```

The 30-character window is four or five words of ordinary English, so any legal, licensing or publishing page can bind "copyright" to an unrelated year and report a site as stale by seven years. And `SENTENCE_BREAK` trips on `Co. ` / `Inc. ` / `Ltd. `, which is at least as common in a footer as the bare form the widening was added to catch — so a genuinely stale year on those sites now reports as *no copyright line at all*, which is what the widening was supposed to stop.

**Fix:** require the gap to look like a name rather than "anything without digits under 30 chars", and treat `[.!?]` followed by a capital as the break rather than any `[.!?]\s`.

### MED-4 — Anchor truncation at 300 is read as "these are all the links", inventing dead ends and off-template pages

[`extract.ts:8`](../../src/prospect/extract.ts#L8) caps `anchors` at 300 and records the true total as `anchorCount` **precisely so a truncated list is not mistaken for a complete one**. Neither consumer reads it: [`journey.ts:173`](../../src/prospect/journey.ts#L173) and [`consistency.ts:181`](../../src/prospect/consistency.ts#L181) both do `extract.anchors ?? []` and treat the result as the full link set.

Failure scenario: a shop's `/collections/all` carries 640 product links before the footer. The footer `/contact` and the shared nav fall past index 300. The page lands in `deadEnds` → the report says *"a visitor who lands here has no way to contact you"*; and it shares no nav hrefs → `pagesOffTemplate` → *"a visitor who lands there is in a different website with no way back"*. Both disprovable by scrolling.

`pages.ts` built the right vocabulary for this (`anchorsMeasured`) but handles only the *missing* case, not the *truncated* one.

### MED-5 — `pagesOffTemplate` compares raw authored hrefs while `journey.ts` canonicalizes

[`consistency.ts:181-197`](../../src/prospect/consistency.ts#L181) stores hrefs exactly as authored — query string, trailing slash and all — then does exact-string membership against `sharedNav`. [`journey.ts:78-87`](../../src/prospect/journey.ts#L78) already solved this with `canonicalizeUrl`.

Failure scenario: a homepage nav rendered with absolute URLs while templated inner pages emit relative ones. The two sets are disjoint; the majority threshold picks one spelling and every page using the other is flagged off-template. Same outcome from `?utm_source=nav` on one template, or `/contact` vs `/contact/`.

### MED-6 — No test anywhere uses real producer output, which is what let HIGH-1 ship

The website consumes this repo's JSON as `AuditReport = Record<string, unknown>`. **That is a documented, well-reasoned deferral** — the comment above it explains the real type ships at 0.87.0, that a caret range allows patch bumps only, and that taking four minors at once breaks CI's a11y job through the shared Playwright config. That reasoning is sound and I am not second-guessing it.

The cheaper mitigation needs no dependency bump: every report test builds its input **by hand** in `model.test.ts`. One captured `result_json` per stored shape, asserted through `toReportView`, would have failed the instant `agentAccess` was read from the wrong stage. There are exactly five distinct shapes in the live table:

| shape (assets·basics·goalFit·accuracy·setId·q.id·fix.addresses·consistency) | count | representative token |
| --- | --- | --- |
| `00000000` | 53 | 2026-08-25, reddoorla.com |
| `10000001` | 1 | 2026-08-27, beachfrontdentistry.com |
| `11000001` | 1 | 2026-08-27, ludlowkingsley.com |
| `11100001` | 10 | 2026-08-27, beachfrontdentistry.com |
| `11111111` | 1 | 2026-09-02, reddoorla.com |

Compounding it: **no smoke spec touches `/audit`** (19 specs, none the report route), and the a11y suite iterates `a11yRoutes` — the `/dev/*` fixtures — so the most content-dense page on the site, and the only one a prospect reads unaccompanied, has zero automated coverage of either kind.

### MED-7 — Four of six `<dl>`s on the report are structurally invalid

`ScoreBars.svelte:100`, `QuestionMeter.svelte:66`, `GoalFit.svelte:90`, `SiteHealth.svelte:363` all nest `dd` deeper than the group, order `dd` before `dt`, or put a `p` inside the group. The term↔definition relationship is therefore not computed, so a screen reader hears "Readability" and "82" as unrelated runs of text — on components whose entire job is pairing a label with a number. axe's `dlitem`/`definition-list` rules would catch all four; nothing runs axe on this route (MED-6). `SourceCheck.svelte`'s two lists are correctly formed and are the pattern to fix the others to.

### MED-8 — Three empty-state gaps that print our gap as their score

- **`QuestionMeter` renders nothing when every question is unknown.** `total = yes + partial + no`, and the whole component — including the unknown sentence — sits inside `{#if total > 0}`. A truncated analyze response yields the full set all-unknown, and the section then renders a heading, a red rule, and a blank gap. "That is a gap in our measurement" is suppressed at exactly the moment it is the only true thing the section has to say.
- **The print lede drops `unknown` entirely** ([`print/+page.svelte:212`](https://github.com/reddoorla/reddoor-website/blob/staging/src/routes/audit/%5Btoken%5D/print/+page.svelte#L212)): "3 answered clearly, 0 partly, 2 not at all" above a twelve-row table, and in the all-unknown case "**0 answered clearly**" — our measurement gap printed as their score, on the artefact that survives the meeting.
- **Print renders an empty accuracy section when every assertion is unverified.** The gate counts all assertions; the loop then filters `unverified` out. On any site over 14 pages / 120k chars — which `accuracy.ts:57` says turns every `absent` into `unverified` — print emits a heading and a footnote referring to "nothing above". The web version handles this correctly.

Also on the page: the accuracy lede ("We asked a live AI assistant… and took its answer apart") is unconditional, so on the 53 reports predating the stage it sits directly above "We could not check this on this audit". Two adjacent paragraphs, one of them a claim about work we did not do.

### MED-9 — `withCitations` cannot distinguish "same as above" from "no citations at all"

[`SourceCheck.svelte:73`](https://github.com/reddoorla/reddoor-website/blob/staging/src/lib/report/SourceCheck.svelte#L73) keys the run on the citation list rather than the answer, so a row whose answer cited nothing renders identically to a collapsed one. In the `absent` group — whose lede promises "That somewhere is named beside each one" — a row with no sources inherits the line above it in the reader's eye, attributing a competitor domain to the wrong claim. That is a factual error about who the engine read, inside the section whose whole argument is who the engine read.

I wrote this function twice last night and got the axis wrong both times: first collapsing per verdict-group (which did nothing), then per run. The correct key is the answer identity (`query + engine`).

### MED-10 — The dead-letter is write-only

Nothing replays it on a schedule, nothing reports its depth: `deadletter|dead-letter|DeadLetter` matches nothing under `.github/workflows/`, `src/alerts/`, `src/reports/digest.ts` or `src/dashboard/`. A Turso blip dead-letters three leads, each visitor is told "accepted", and the rows sit until someone remembers the CLI by hand.

Two defects in the replay path itself: [`replay.ts:76`](../../src/forms/replay.ts#L76) has no try/catch around the loop, so a throw after a successful re-ingest aborts the run with the row unmarked — the next run mints a duplicate submission; and [`deadletter.ts:62-69`](../../src/db/deadletter.ts#L62) `JSON.parse`s inside a `.map` over the whole result set, so one malformed payload wedges replay for every lead. That is the same shape as the `import-reap` incident where one deletion wedged the sync permanently.

### MED-11 — `/s/:slug` does three unbounded scans of `submissions` per load, and two gate justifications now assert the opposite

[`site-dashboard.mts:107-136`](../../netlify/functions/site-dashboard.mts#L107): `countNotifyBouncedBySite` (GROUP BY, no LIMIT), `listScreenOutsSince` (a second full traversal), and `listSubmissionsForSite` (`WHERE site_id` with no `site_id` index, served by the submitted-at index under LIMIT 200).

The query-plan gate is green because both allowlist entries say *"BATCH ONLY since MED-16 … no longer runs on a request path"* — true of `fleet-homepage.mts`, which was fixed, and false of `site-dashboard.mts`, which was not. **This is the exact failure mode the 08-26 brief named twice**: the allowlist is keyed on scenario name and its stated reason is never checked against reality. `mirror-write-freeze.test.ts` has a "no exemption is stale" test for precisely this; `ALLOWED_RAW_SCANS` has no equivalent.

### MED-12 — The nightly backup reads its manifest and its rows at different points in time

[`dump.ts:64-100`](../../src/db/dump.ts#L64) reads `tableCounts` at `:69`, then each `SELECT *` at `:93` — no transaction, separate HTTP round trips over a ~17 MB dump. `verify-dump` compares with strict equality and the workflow exits 1 before the encrypt and upload steps. One form submission landing in that window produces `submissions: origin=354 restored=355`, reds the job, files the tracking issue, and **uploads no backup that night**. 04:30 UTC is 21:30 PT, and visitor traffic is the only writer. Fail-safe in direction, but repeated false alarms on that issue title are how a real red gets ignored.

### MED-13 — Two markers built to catch a silent stop, that nothing reads

`DIGEST_STATE_WRITE` ([`digest.ts:378`](../../src/reports/digest.ts#L378)) exists because "a dual-write that silently stopped running looked identical to a healthy one for weeks" — and `grep -rn DIGEST_STATE_WRITE .github/` returns nothing. Every other machine marker in the repo is gated in its workflow. Rotate the token for the digest step and the email still sends, the workflow stays green, and the cockpit renders last month's rollup with a stale date nobody reads as an error.

Separately, **nothing runs `db parity` during the rollback window**. `freeze.ts:42-51` justifies keeping the Airtable write on the grounds that "a shadow you might roll back to is one you keep trustworthy", and `db.ts:35-38` deliberately leaves parity unguarded because that is "exactly the rollback-window question". The hourly sync that ran `FLEET_PARITY` retired with the flip and nothing replaced it, so for the whole week the rollback target is unverified — discovered at the moment you need it.

### MED-14 — The onboarding recipe pins new sites to pnpm 10.33.1, and its comment says otherwise

[`convert-to-pnpm.ts:16-18`](../../src/recipes/convert-to-pnpm.ts#L16) sets `DEFAULT_PNPM_VERSION = "10.33.1"` under a comment claiming it "matches the `packageManager` field of this package (kept in sync with package.json)". This package is on `11.8.0`. Nothing tests the claimed invariant — the constant appears in exactly one file. `convert-to-pnpm` is the **first step of the `init` chain**, so a site onboarded today is pinned a major behind the fleet, on a version also inside the MED-1 advisory range.

### MED-15 — The daily audit cap misses the path we actually use, and the cost per audit roughly doubled last night

`PROSPECT_AUDIT_DAILY_CAP = 25` is enforced only in the dashboard dispatch path. The CLI has no cap — #618 added the private-host guard there but not the count, and its own comment two lines above describes exactly this shape for the guard it *did* fix ("one layer at the far end of the chain… anyone running the CLI directly had none"). Every batch to date, including the 29-site corpus, went through the CLI.

And the cap counts audits, not spend. `analyze` sends 12 pages truncated at 1,500 chars; `accuracy` sends **14 pages untruncated, up to 120,000 chars**, both on Opus. That size is deliberate and well argued in its docblock — a claim past a cutoff would read as `absent` — but one audit is now roughly two Opus calls, one of them ~6× the other's input, against a ceiling sized for the old cost.

### MED-16 — `mixedContent.measured` is true when the data was never recorded

[`basics.ts:646`](../../src/prospect/basics.ts#L646) sets `measured: isHttps && usable.pages.length > 0`, but iterates `extract.imageSrcs ?? []` — an optional field absent on any report stored before it existed. On a replay over stored audits (a stated practice) the report says we checked for mixed content and found none, from a measurement never taken. Same class as `anchorsMeasured` and `crawlerAccessMeasured`, both of which got this right.

### MED-17 — `AnswerSpace.queriesAsked` counts answers received, not queries asked

[`answer-space.ts:176`](../../src/prospect/answer-space.ts#L176) sets it from `answers.filter(kind === "category").length` — only probes that returned. `probes.ts` records `categoryProbes: {attempted, answered}` separately *because this exact bug was already found and fixed for `visibilityScore`*, and `types.ts:329` documents it at length ("a flakier run scored HIGHER"). Not yet rendered, so this is pre-emptive — fix it before it reaches a page.

### MED-18 — Carried findings that did not move

- **Ingest rate limiting still keys on the fleet site's egress** ([`form-ingest.mts:60`](../../netlify/functions/form-ingest.mts#L60), `aggregateBy: ["ip"]`) — unchanged since 07-06, **4th brief**. Server-to-server traffic means it cannot throttle an abusive visitor at all, and a burst from one busy site can drop a real lead. Four briefs is the point to do it or retire it.
- **`DASHBOARD_PASSWORD` still grants full operator rights with no environment gate** ([`auth/require.ts:66`](../../src/dashboard/auth/require.ts#L66)), **2nd brief**. `process.env.CONTEXT` is still read nowhere in `src/dashboard/`. Google sign-in has been live since 08-25, so the fallback's stated purpose has expired. Still unverified whether the variable is set in production — one `netlify env:get`, which I could not run.
- **The unexecuted-browser-JS class is not closed.** #626 fixed four defects and added a gate that calls `new Function(src)` — which compiles without executing, so it proves parseability only. `AUDIT_SCRIPT` (~115 lines), `FLEET_BROWSE_SCRIPT`, `RUN_SCRIPT` and `SUBMISSION_STATUS_SCRIPT` are still executed by no test, and two of those shipped *after* #626. Coverage cannot notice: each is one string literal, so declaring it scores as one covered statement.

---

## Graded — the 08-26 brief's backlog

Nine of ten HIGH/CRITICAL closed in seven days. Each verified by reading current code, not commit subjects.

| 08-26 finding | Status |
| --- | --- |
| CRIT-1 backup verifier compares the dump against itself | **Fixed** — origin manifest (#620); gap noted at MED-12 is a race, not a repeat |
| HIGH-1 nested-sitemap SSRF | **Fixed** — `isSafeNestedSitemap(child, origin)`, [`crawl.ts:190`](../../src/prospect/crawl.ts#L190) |
| HIGH-2/3/7 defects in unexecuted browser JS | **Fixed** — #626; the underlying class is not, see MED-18 |
| HIGH-6 encrypted artifact never verified | **Fixed** — [`fleet-db-backup.yml:99-102`](../../.github/workflows/fleet-db-backup.yml#L99) decrypts and re-verifies what it keeps |
| HIGH-8 query-plan gate blind to predicate shapes | **Fixed for `submissions` counts** — `formType` scenario + `idx_submissions_form_type`; the *allowlist-reason* hole reopened elsewhere, MED-11 |
| HIGH-9 cockpit ships 1.17 MB of report HTML per load | **Fixed** — #624 |
| HIGH-10 nightly Turso usage alarm does not exist | **Fixed** — `FLEET_DB_USAGE`, [`db.ts:423`](../../src/cli/commands/db.ts#L423) |
| MED-5 private runner accepts arbitrary `ref` | **Fixed** — `ref: main` |
| MED-6 no spend cap on prospect audits | **Partial** — dashboard capped; CLI uncapped → MED-15 |
| MED-8 #539 design/plan not on main | **Fixed** — #629 |
| LOW-1 `.worktrees/` not gitignored | **Half** — done in maintenance, still missing in reddoor-website, which has five of them |
| MED-13 ingest rate limit keys on egress | **Open**, 4th brief → MED-18 |
| MED-4 `DASHBOARD_PASSWORD` ungated | **Open**, 2nd brief → MED-18 |

---

## Investigated — not a bug

- **All five stored report shapes render, and degrade honestly.** I fetched one token per shape against staging; all HTTP 200. On the 53 oldest, the new accuracy section says *"We could not check this on this audit… a gap in the measurement, not a finding about your site"* rather than implying nothing was wrong. `stage()` is correct for `undefined`, `{ok:false}` and `{ok:true}`-without-`data`. **HIGH-1 is a wrong field path, not a back-compat failure** — it is equally wrong on the newest report.
- **Schema parity between the API and subscription instruments holds.** `claude-code.ts` serialises the live zod schemas at both call sites, so last night's `AnalyzeSchema` and `AccuracySchema` edits reached both paths. There is no hand-copied twin. (One genuine drift does exist: `envAccuracyDeps` passes our crawler UA on the subscription branch and silently discards it on the API branch, which hard-codes a Chrome string — so ownership verdicts for a domain that 403s one UA can differ by auth mode.)
- **`site_key` is fully backfilled in production** — 66 rows, 0 nulls, 29 distinct keys. A reviewer flagged migration 0013 as having no backfill, which is true *of the repo*: I ran it by hand last night. A restore from the nightly dump, or any other environment, would come back with NULL keys and nothing to repair them. Worth a follow-up migration; not a live data problem.
- **Both local gates green on the merged branches** — maintenance `main`: typecheck, lint, 5,900 tests. website `staging`: svelte-check 0 errors, prettier clean, 319 tests.
- **`pnpm audit`** — website clean; maintenance 9 advisories, all dev-only behind `@lhci/cli`, unchanged from 08-26, none reaching production.
- **Token privacy holds through the new section.** No new outbound link or subresource; `SourceCheck` renders every domain as text, no anchors or favicons. `x-robots-tag`, `cache-control: private, no-store` and `meta_referrer: no-referrer` all still set on both routes.
- **`src/forms/ingest.ts` is sound** — persist-before-enrich, every swallow downstream of the durable row. Nothing there can cost a lead. The risk is upstream of it (HIGH-3).
- **The freeze-switch mechanism, the origin-manifest fix, and secret handling** all reviewed and clean. No credential-bearing file tracked; no token reaches a log; `db restore` refuses to inherit the production token.
- **The four website worktree branches are genuinely orphaned, confirmed the right way.** `merge-base --is-ancestor` says unmerged — the squash artefact that produced the 08-26 brief's withdrawn HIGH-4. Checking the PRs instead: #142, #143, #144, #145 all `MERGED`.
- **TODO/FIXME/HACK: still effectively zero** across both source trees.

---

## Open loops carried forward

- **Ingest rate-limit keying** (4th brief) and **`DASHBOARD_PASSWORD`** (2nd brief) — see MED-18.
- **#582 Svelte rework** — not started; two more unexecuted scripts have joined the surface since #626.
- **Branch and stash hygiene** — `stash@{0}` on `autotick-coverage-extension`, ~150 stale remote branches in maintenance, five orphaned worktrees in the website, and `.worktrees/` still ungitignored there.
- **`fix/form-e2e-budget-attribution`** — "finish or discard" since 08-17, still parked with a worktree.
- **Gate B of the audit roadmap** — `--goal` is validated but never required, so nothing enforces the decision that every client-facing audit sets one. HIGH-2 makes this more than a policy gap: without a goal, the fix-list guard is off.
- **`questionSetId` and `sameQuestionSet` are written and never read.** Forward-laid machinery; the first before/after feature has to remember to call it, and nothing will fail if it does not.
- **`staging` is missing `main`'s CI workflow change (#148)**, so PRs into staging and merges into main are not gated identically.

---

## Decisions deferred

1. **Does Findability stay a score on the internal surfaces?** *Provisional: demote everywhere.* The email, CLI and standalone HTML still print it as one; the reasoning that removed it is about the metric, not the audience. But the email has a different reader and that is your call.
2. **Fix the two heuristics (MED-2/MED-3) or revert them?** *Provisional: fix.* Both replaced something worse, and the copyright widening does correctly catch our own footer. But if they cannot be made right quickly, reverting is honest and reverting MED-3 costs only a missed stale year.
3. **Merge the pnpm PRs fleet-wide this week?** *Provisional: take the two open ones and the starter now, let the rest ride Renovate.* Exposure does not justify interrupting anything.
4. **Real-payload fixtures — one shape or all five?** *Provisional: all five.* The 53-report shape is the one most likely to break silently, since nothing new is ever tested against it.
5. **Is HIGH-3 urgent or merely latent?** *Provisional: latent but fix now.* It costs five minutes and it is armed by a cleanup already on the Phase 6 plan.

---

## What I did NOT do tonight

Read-only exercise. **No commits, no PRs, no pushes, no fixes, no live-service writes.** Both repos are exactly as you left them: maintenance on `main` at `d97c4cc`, website on `staging` at `0a75dbc`, both clean.

Local typecheck/lint/test and `pnpm audit` were run in both repos. Read-only queries were run against production Turso to enumerate stored report shapes and confirm the `site_key` backfill. Five report URLs were fetched from the staging deploy. Three heuristics were exercised in a scratch script outside the repo, deleted after.

The only files changed anywhere are this brief and the read-only permission entries added to `.claude/settings.local.json` in both repos during pre-clearance.

Three code-review subagents covered the audit pipeline, the report rendering, and the non-audit maintenance surfaces. **I verified their load-bearing claims myself rather than relaying them** — the two heuristics and the copyright regex by running them, the form-ingest and site-lookup code paths by reading them, and the `render.ts` reasoning by reading the comment it cites. One of their findings I corrected: `site_key` *is* backfilled in production.

**On my own objectivity:** HIGH-1, HIGH-2, HIGH-4, MED-2, MED-3, MED-9 and half of MED-15 are all defects in work I shipped last night, and HIGH-1 is a wrong claim in front of a prospect that I introduced, then failed to catch with a test I also wrote, then repeated in a commit message. I have graded them as I would anyone's. The uncomfortable pattern is that four of last night's five "honesty" fixes introduced a new honesty defect of their own — which is an argument for the real-payload fixtures in MED-6 rather than for more care.
