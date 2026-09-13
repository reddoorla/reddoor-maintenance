# 02 — The portfolio, project by project

Window: **2026-07-30 → 2026-09-12**, 45 days. Assembled 2026-09-12 from six
per-cluster research notes (`_research/proj-01` … `proj-06`), each written by an
agent with direct machine access, plus the derived corpus in `_data/`. Written
to the house style of `reddoor-maintenance/docs/workJournal.md`: why over what,
measured numbers exactly, defects named, beliefs corrected on contact, honest
accounting about which change actually produced a win.

**Two conventions, used throughout.** Every number is MEASURED unless it says
otherwise; where a research agent inferred a mechanism rather than observing it,
the word INFERRED appears. And **transcripts retain only back to 2026-08-10** —
everything about 2026-07-30 → 2026-08-09 is RECONSTRUCTION from git, pull
requests, Actions runs and Discord, and is labelled as such at every use. That
eleven-day blind spot is not incidental: 2026-08-03 alone carries **173 commits
and 78 merged PRs with no transcript behind it**, and it is the biggest single
day in the window.

---

## The shape of the portfolio

**41 checkouts are in the corpus and 40 of them received at least one commit.**
The exception is `octagonal-led-turn-counter`, which received none because it
stopped existing mid-window: its history was carried into `the-bench` by
`git subtree` on 2026-09-04 and the standalone directory was deleted. It still
shows 104 transcript files and 56 unique operator prompts against zero commits,
which makes it the single most misleading row in the corpus if read cold.

The window produced **2,622 commits, 857 pull requests, 3,437 Actions runs,
3,469 session transcripts, 2,693 unique operator prompts and roughly 160,000
tool calls.** By commits the split is:

| cluster                                      | repos | commits | share |
| -------------------------------------------- | ----- | ------- | ----- |
| Personal and side projects                   | 11    | **880** | 33.6% |
| Active client sites                          | 7     | 553     | 21.1% |
| Central orchestrator (`reddoor-maintenance`) | 1     | 413     | 15.8% |
| Quiet / dormant client sites                 | 16    | 267     | 10.2% |
| Infrastructure and templates                 | 6     | 255     | 9.7%  |
| The studio's own site (`reddoor-website`)    | 1     | 254     | 9.7%  |

Reddoor commercial work is **1,742 commits (66.4%)**; personal work is **880
(33.6%)**. On the package metrics appendix's prompt basis, personal projects
take a larger share of attention than of output — **1,015 of 2,693 unique
prompts, 38%** — and `Broken`, a physics game, ranks second in the entire corpus
for operator prompts (438), ahead of the central orchestrator (344).

The two halves are not separated in time. **Of the 44 days in the window
carrying any commit at all, 32 carried both personal and Reddoor commits.**
Seven were personal-only, five Reddoor-only, and all five of those fall inside
the pre-transcript reconstruction window. This is not someone who blocks out
evenings; the two tracks are braided through the same days, and every
operational instrument Reddoor runs — Airtable, the nightly audits, the cockpit,
Discord — is blind to a third of the work. Grepping 688 Discord messages for the
personal projects returns three hits.

**The single clearest shape in the data is that this is not a portfolio of 41
projects. It is six projects, a maintenance apparatus, and a tail.** Six repos —
`reddoor-maintenance` (413), `Broken` (359), `reddoor-website` (254),
`beachfront-dentistry` (249), `dont-lose-your-head` (178) and `songbook` (117) —
carry 1,570 commits, 60% of the window, and every one of them is either a
ground-up build or a platform. Against that, the sixteen-repo quiet client
cluster produced **267 commits of which 34 (12.7%) are site-specific product
work, and 19 of those 34 are in one repository on one evening.** 108 of its
commits (40.4%) were authored by `reddoor-renovate[bot]`, and another 112
(41.9%) are the same sweep commit landed in eleven or twelve checkouts inside an
hour. Eleven of those sixteen repos received **zero** site-specific commits in
45 days.

The widest single event in the window is a sweep, not a feature. On **2026-09-05**
one operator sentence — _"add to the starter CLAUDE.md and all the other repos I
have on this machine, I want every repo to maintain a workJournal"_ — produced
identical pairs of commits in **at least 34 of the 41 checkouts**: 16 of 16 quiet
client repos, six of seven active client repos, eight personal repos, four of six
infrastructure repos, with both platform repos opening journals the same day. It
is also the sweep that ran head-first into the three checkouts that cannot take a
push, which is where `scripts/fleet-repos.sh` comes from.

---

## 1. Central orchestrator — `reddoor-maintenance`

**What it is.** `reddoorla/reddoor-maintenance`, published to npm as
`@reddoorla/maintenance`, is the brain of a ~45-site studio in which the sites
themselves are deliberately thin. It holds the fleet audits (accessibility,
smoke, Lighthouse, security posture, form end-to-end), the pipeline that drafts
and sends client maintenance reports and their PDFs, the cockpit dashboard the
operator approves those reports from, the central forms-ingest every client
contact form posts to, the versioned "recipes" that install and upgrade shared
machinery inside site repos, and a Blux/Webflow render-conversion layer. Three
things inside it did not exist on 2026-07-30: a database, a headless CMS-model
delivery pipeline, and a saleable external SEO/AEO audit product.

**Scale.** 413 commits (369 Tucker, 43 Renovate, 1 github-actions) over 27 of 45
days; 219 PRs, #469 → #771, of which 211 merged; **+148,777 / −4,661 across
human PRs**; base→HEAD diff 589 files, **+143,398 / −2,454**; 29 npm releases
taking the package **0.75.1 → 0.95.1**; `src` TypeScript files 274 → 379 and
test files 312 → **484**. 18,846 tool calls, 71.5% of them Bash. Three days
carry the load: **2026-08-24 / 25 / 26 produced 198 commits and 74 opened PRs —
48% of the window's commits in 6.7% of its days.**

### What happened, in four movements

**(A) 2026-07-30 → 08-09 — RECONSTRUCTION.** The window opens mid-stride. The
header-image generator ships (#476, +3,474 across 27 files): screenshot a
client's live homepage, composite it into a bundled device plate, stamp it into
the report email. The commit sequence is unusually legible for a day with no
transcript — design doc, implementation plan, `docs: correct the screen rect —
derive it from the bezel`, measured plate geometry, capture behind injected
browser IO, a plate-fidelity verifier, then `fix: capture with load +
best-effort idle, not networkidle` because `networkidle` broke 4 of 14 live
sites. Then three days of fleet governance: platform auto-merge disabled
fleet-wide (#478), Renovate moved off the operator's personal token onto a
GitHub App (#484), a nightly org-wide protection-coverage alarm with ruleset
self-healing (#483, +1,459). #503's title is the best in the run — _"catch a
Renovate that runs green but is forbidden to act"_ — a gate built because green
had already meant nothing once: nine repos had been silently frozen by stale
old-identity branches with green CI after the App migration.

**Then the repo goes dark 2026-08-04 → 08-09: zero commits, zero PRs.** Discord
covers the period and explains it — the Beachfront Dentistry Webflow→SvelteKit
cutover was in flight. INFERRED, from Discord only: the central repo pauses when
a launch is running.

**(B) 2026-08-12 → 08-17 — headless Prismic model delivery, #526.** The largest
PR of the window, **+24,211 / −16 across 66 files**, produced by **156 sessions
in one worktree, 150 of them subagent transcripts**, executing a 33-task written
plan. Content-model changes now ride a normal PR, CI comments the delta, and
merging pushes to Prismic through the Custom Types API.

Two things about it are worth carrying. The credentials the plan assumed had to
be provisioned **were never missing** — eleven sat in this repo's own `.env`
under `<SITE>_PRISMIC` names the whole time. And ownership was _proven, not
inferred_: all 13 distinct tokens were probed against all 15 repositories,
**195 calls** to `GET customtypes.prismic.io/customtypes`, and three labels
turned out to lie (`POINTE_PRISMIC` is `the-pointe-burbank`, `REDDOOR_PRISMIC`
is `reddoor-la`, `BEACHFRONT_PRISMIC` is `48bb12d1`). That probe is the single
best instance in the window of the repo's governing rule applied to a credential
rather than to a test. The operator also corrected the schedule belief: waiting
for Renovate's Monday window was a cadence, not a constraint; all 12 site bumps
went out the same day and the feature went live on 8 sites.

**(C) 2026-08-17 → 08-31 — the Airtable quota, and the migration it caused
(#539).** The spine of the window, and it starts with one prompt at 02:02:

> _"hit my api limit for airtable and we're only halfway through the month, does
> not seem scalable… do research and give me your thoughts."_

The same day the outage produced a live incident — _"I just sent a test
submission and don't see anything in the cockpit or on my phone"_, then _"wait,
lead loss? are emails not getting to clients?"_ — and a client-visible one: a
9.6-hour form outage on `beachfront-dentistry` (widest possible bound 22.1h),
reported by the practice owner through Tim, not by any alarm.

The operator then did something worth naming. He **paid to remove the urgency
and deferred the fix**: _"let's save the full turso migration for next weekend…
I want to save tokens for a game jam and we've time now that i paid for
airtable."_ Six days later he lifted the deferral explicitly: _"no need to
conserve tokens this week."_

What shipped, 08-23 → 08-31, in six numbered phases each with its own PR: Phase
0 dead-letters a lead whose site lookup fails (#553 — the incident became a
durable guarantee before any schema work began); Phase 1 the schema, importer,
parity harness, nightly encrypted backups and an EXPLAIN query-plan gate; Phase
2 every request path reading Turso; Phase 3 dual-writing writers; Phase 4
rebuilding Airtable's UI inside the cockpit plus a three-stage status-vocabulary
migration; **Phase 5, the flip, merged by the operator on 2026-08-31 (#643)**.
Post-flip evidence: parity mismatches **0 across all 52 green hourly runs** of
the rollback week, backups 8/8, dead-letter 0 rows ever.

Two details from the vocabulary stage are the most transferable thing in the
migration. **Deleting a single-select option in Airtable clears the cells using
it**, and a blank status is _eligible-by-default_ in the due/preflight path — so
one stray cell would have silently activated a site for client reports. All 44
cells were counted for blanks after the 7 old options were deleted; zero. And a
branch sitting unpushed since 08-17, `fix/skip-spam-for-in-development`, gated
on a status string the migration had deleted; merging it would have shipped a
permanent no-op **with green tests**, because its own fixtures constructed rows
using the dead value. Check unmerged branches against schema changes that landed
after them.

The pre-merge review of the flip found three regressions, and one generalises:
`stampSent` never mirrored `sent_at`/`resend_message_id`, and the exclusion's own
comment justified itself by citing _"the hourly sync converges those"_ — the
exact mechanism the PR deletes. Four Netlify handlers had the same shape, and
grep could never have found them, because **not mentioning** `TURSO_IS_AUTHORITATIVE`
is the defect. When retiring a converger, grep the comments for its name.

**(D) 2026-08-24 → 09-12 — `src/prospect`, the biggest new thing in the
window.** `prospect` is the top commit scope at **75 commits**, and
`src/prospect` is 30 files and **15,598 lines** that did not exist on 08-23. It
crawls a stranger's site, runs a deterministic check battery, asks the AI
engines what they say about the business, scores it, renders a branded report at
a tokened public URL, and emails a PDF.

The correction commits are the story. In order they read as a tool being argued
out of overclaiming: _never fake a measured zero_; _do not score findability when
no page was readable_; _fail the lighthouse stage when nothing was measured_;
_divide visibility by the probes sent, not the ones that returned_; _a check
reports an answer, and our missing data is never their defect_; _kill the 93%
hallucination stat, keep the mechanism it borrowed_; and finally _let the
operator pick the goal, and prove every check can pass_ — the house rule applied
to a whole battery at once. **A check that can only fail is not a check.**

The operator became the tool's best adversarial reviewer on his own company. On
2026-09-09 at 01:04 he pasted back the report's "what the AI says about you that
is not on your site" section with one line: _"several of these things are on our
site…"_. Then, after a first fix split it in two, he **rejected his own approved
fix**, on the grounds that the hedging was _"honest and necessary"_ — Tim and
Erik are both listed on the site, so calling a LinkedIn-sourced claim
unsupported was overblown even though it flagged real misleading information.
The wording that shipped is _"These are claims that seem not to be sourced from
your site."_ The defect was epistemic, not a bug: the tool was stating as fact a
relationship it could only infer.

Validation runs against a stored corpus of **29 sites (~40MB of crawls)**, and
the scale of what it caught is worth recording exactly. Allowing any namespace
prefix on `<loc>` counted image-sitemap entries as listed URLs, and **11 of 29
corpus sites emit them**: compositionhospitality went **8,149 → 573** listed URLs
(93% of its "sitemap" was its own images), salonsbyjc 11,346 → 8,659,
foodallergyinstitute 1,138 → 105, thepointeburbank 52 → 1. Separately,
sapidyne.com declares `/` as canonical on 19 of its 20 pages, and folding pages
on the _declaration_ collapsed the whole site to one page, reading
`description-length` as _"all 1 are between 40 and 200 characters"_ — hiding the
exact defect `canonical-self` exists to report. **A page that says it is another
page is not therefore that page.** And counting every anchor as a page a sitemap
must list told sapidyne it was missing 37 pages (33 PDFs under `/uploads/`) and
theburbankstudios 90 (stage plans under `/api/media/file/`); the replacement is
an allow-list of page extensions, never a deny-list of file ones, because
**missing our own gap beats printing their fault.**

**State now.** `main` at `9f5fc898`, last human commit 2026-09-11, one untracked
file, **five worktrees across four different path conventions**. Three PRs open:
**#769**, a journal correction retracting two invented defects; **#771**, the
pending release, human-only by policy; **#716**, a Renovate vitest bump. Nine
nightly/daily fleet workflows green on every run in the nine days the Actions
API still retains — and remember what a green `fleet-smoke` means here: _all
measured_, not _all passed_. Turso authoritative since 08-31. **Phase 6 (#646)
is due, requires the operator's explicit go because it ends the rollback window,
and had not run by 09-12.** Two known defects carried forward: **#645**, a site
with no Turso row 404s _all_ its leads with no dead-letter, and the Sonder
cookie-banner screenshot. Package at **0.95.1**.

---

## 2. The studio's own site — `reddoor-website`

**What it is.** `reddoorla.com` — SvelteKit 2 / Svelte 5 / Tailwind v4 / Prismic
on Netlify, 597 total commits since 2024-07-29. In this window it stopped being
a portfolio site and became the studio's **sales apparatus**, along two tracks
that share only a deploy pipeline.

**Scale.** 254 commits (239 Tucker, 15 Renovate) over 25 active days; 65 PRs (58
merged, 7 closed), **+84,760 / −8,841 across 844 files, and 0 code reviews on any
of them**; 36,914 tool calls, 66% Bash; 55 interruptions. CI from 08-22: 153 `ci`
runs with **19 failures (12.4%)** — the worst rate of any repo in the corpus.

Note one corpus disagreement in place: `repos.jsonl` reports 286 window commits
for this repo while `commits.jsonl` holds 254 rows. The 32-commit gap is almost
certainly work on unmerged branches — the checkout carries 38 local branches and
8 worktrees. All figures above use the 254.

### Track one: `/medtech` and the inquiry-to-booked-call funnel (08-11 → 08-24)

The ask, verbatim, and it sets the constraint for the next two weeks: _"want to
add this (board v2 only)… should be at /medtech, with the ability to make more
of these for different industries with the slice model. reuse slices we already
have if possible."_ An industry landing page must be a repeatable Prismic
composition, not a bespoke page.

**The branch was opened as a PR three times.** #128 (+10,147 / −639 over 70
files) closed; #132 (+14,269 / −643 over 89 files) closed; **#133 merged 08-20
at +25,026 / −650 across 155 files, with zero reviews and — because the corpus
has no Actions runs for this repo before 08-22 — no CI record in evidence at
all.** The reason for the re-cut is in the prompts: on 08-18 the scope changed
from "a landing page" to "a landing page plus the entire lead funnel behind
it" — _"alright, scope is growing, I own this now not Tim."_ No work was lost;
two review surfaces were thrown away.

The funnel's institutional memory is `docs/inquiry-funnel.md`, **1,843 lines /
15,239 words**, and it is the only document in the portfolio that **grades every
claim** verified / documented / inferred. It is also where the cleanest
"prove-the-instrument" episode in this cluster lives, and it caught itself
**four times in three days on one error shape: reading an empty render as
evidence that the field does not exist.** Namespaced outcome tags claimed as a
ready-made hook exist on zero contacts and are absent from the location's
complete 44-tag list. Z-004 workflows claimed to send review requests on a dead
link do not exist — the workflow list is 37 entries and its numbering runs
Z-002, Z-003, Z-015, Z-016. `{{appointment.id}}` was declared broken and a
`/reschedule` fallback shipped on the strength of an SMS the operator had sent
_directly_ rather than through the no-show workflow, so every appointment field
would have rendered empty regardless — and **the message carried its own control
and the first read missed it** (`contact.first_name` resolved to "Tucker" and
both `custom_values` resolved). The rule the doc eventually writes down: _an
empty render is only evidence about the field when something else proves the
source had a value to give._

Two genuine external defects were found by measurement, not reading:
`POST /contacts/upsert` **dedupes on phone and silently overwrites the email**
(two throwaway contacts with the same number collapsed to one record,
`jWap2a96VWPiW3G16PtC`, and the first address is gone) — so a company mainline
or a receptionist booking for someone else merges two leads.

And one workflow defect worth naming for its own sake: §6.16 of that document
exists only because _"should the add-to-calendar links stay on GHL?"_ was raised
**three separate times**, until the operator said _"the calendar is fine, we've
talked about this three times."_ A completeness-oriented agent has no memory of
settled scope and re-surfaces closed decisions as findings on every sweep.

### Track two: the prospect audit report (08-25 → 09-11)

94 commits, and mostly an argument about honesty. The engine lives in
`reddoor-maintenance`; this repo renders it, prints it for the PDF leave-behind,
and — as of 09-11 — lets an operator click any uniquely-resolvable line and
retype it.

Four operator prompts drove most of it:

> _"you're saying things are universal based on 13 sites. This is not the
> ironclad corpus of data you're presenting it as, it is heavily cherrypicked"_

> _"I also want it greenable, if a test can never come back 'this is right' or
> only have minor nits, it's a bad test"_

> _"we just can't should never make promises we don't know we can keep"_

> _"as an ex-leukemia researcher, in future, always read the methods please."_

The "greenable" line is the repo-wide rule stated from the other direction, and
it is why **the AI-visibility score was deleted after roughly a week of work**:
it scored zero for **six of the eleven sites audited so far, including Reddoor's
own**, and nothing in the audit reliably moves it. The replacement is more
informative, not less — Beachfront's citation field is **29 citations to listing
sites and 16 to the sites of local practices**, and the second kind is reachable
while the first is not, _"and the old lede printed the same zero for both."_

The denominator bug in the same file is the cleanest false-green in the cluster:
`total = categoryProbes.length` — the probes that _answered_ — under a comment
claiming it was the number of searches run. Five asked with three failures read
_"named in 1 of 2"_ and implied 50 where the truth is 1 of 5. The commit body's
own summary: **"A flakier run looked better."** Honest accounting is recorded in
the same commit: this is the same defect fixed in the audit itself in
`reddoor-maintenance#631`, and it existed here separately because the renderer
re-derives what the scorer already decided.

**Calibrating against known-good subjects is the single most transferable
practice in this cluster.** Every check in the Tier 0–4 battery had to survive
`apple.com` and other deliberately-chosen good sites, and a check apple.com
failed was treated as evidence **against the check**: _"would any of these
provide actual value to apple to know? I suspect these things would've been
flagged if they were a real issue with the budget behind that site."_ It
produced a second guardrail too — _"add the probe forms false switch and use it,
we don't need to be sending off a load of chaff to potential clients"_ — because
the audit had been submitting real contact forms on prospects' sites.

**Process changes, all operator-initiated.** `staging` → `main` with promotion
reserved to a human was proposed 08-17 and enforced 08-26: _"I want a safe space
to push wildly to with AI, but you need my eyes and review on anything that goes
out into the wild."_ Then squash-merging the promotions **permanently diverged
the branches**, so every subsequent staging PR re-carried the whole accumulated
diff — visible as **#147 opened at +2,353 / −283 and closed, the same change
landing as #149 at +28 / −8** once the divergence was repaired on 09-02.

**State now.** Shipped and live. `main` last promoted 2026-09-10 (#178, +6,058 /
−404 over 71 files); `staging` carries edit mode (#181, merged 09-11) and is not
yet promoted. Airtable has the site at `maintained`, rScore 100, Lighthouse
pScore 99 / seo 100 / bp 100. The repo **cannot move past
`@reddoorla/maintenance@^0.83.0`** because 0.87 breaks CI's a11y dev server,
which is why `x-reddoor-edit-session` is documented as a cross-repo contract that
degrades silently. Three length-leaking token comparisons remain live,
deliberately. Why Netlify appends the query string to a 303 to a bare path is
**still unexplained** — _"someone should still find out why."_

---

## 3. Client sites with real activity

Seven repos, and they split into two populations. Three ground-up builds —
`beachfront-dentistry`, `vida-legacy-foundation`, `29-navy` — account for
**415 of the cluster's 553 commit rows (75%)** and all but 135 of its operator
prompts. `gallerysonder` sits apart: almost no code, and the sharpest analytics
failure in the portfolio. `revogen` had one compliance event. `alamo-anatomy`
and `espada` had **zero sessions in their own directories for the entire
window**.

### beachfront-dentistry — the pixel-match rebuild, and the gates that had to be taught to refuse

**What it is.** A Redondo Beach dental practice. A from-scratch rebuild of the
client's Webflow site in SvelteKit 2 / Svelte 5 / Tailwind v4 / Prismic, forked
from `reddoor-starter`; first commit 2026-07-28, two days before the window
opens. Airtable: `maintained`, quarterly.

**Scale.** 249 commit rows (225 distinct subjects after stripping squash twins),
23 active days; 45 PRs, **+79,473 / −7,199**, 0 reviews; 300 Actions runs (the
collection cap, so a floor) with **66 failures, 52 of them on two days — 15 on
08-05 and 37 on 08-06**; 14 distinct session ids across 95 transcript files,
7,980 tool calls, 200 deduped prompts.

**Phase one, 07-31 → 08-09, RECONSTRUCTED from git only.** The matching
campaign, and there is no transcript for any of it. **44 commits on 2026-08-05
alone**, each carrying its score in the subject: `rebuild the review band from
live's rules — 19/27 -> 21/27`, `Phase 3 CLEAN — 0 undeclared type mismatches,
from 192`. A style census went **192 → 124 → 100 → 57 → 48 → 0** undeclared type
mismatches in one day. The repo's own five matching rules were written
mid-campaign, not up front, and each is a drift that had already happened.

**The cutover, and the first instrument to lie.** The site went live 2026-08-07
with the fidelity campaign unfinished, specifically so the Webflow subscription
could be cancelled before it renewed on 08-08. That silently broke the gate, and
the repair commit names it exactly: `fix(gate): production cut over to our
build — REF repoints at the webflow.io original`. **The harness had been diffing
the new build against the production domain; once the domain served the new
build, the gate was comparing the site to itself and could only ever agree.
Nothing about its output changed shape.**

**The goal changed and the agent did not notice.** 08-12: _"yep we're no longer
chasing matching."_ 08-13, after the gate was invoked again: _"what are you
checking right now? I've said three times now we're not matching anymore."_ The
durable fix, on 09-01, is a **file-existence pause switch with an exit code**,
not a paragraph in `CLAUDE.md` — because a rule already in the context ("a commit
is a checkpoint, not a stopping point") was actively overruling the prose
instruction to stop. `matching/PAUSED` records the frozen state: **109/153
regions passing, 24 open failures, 18 declared floors, 1 operator-accepted
failure, worst page `our-team`.**

**The 2026-09-09 harness audit is the highest-value episode in the cluster.**
Four days after the journal convention arrived, the matching gates were audited
against the repo's own rule and three vacuous greens fell out.

`census.sh` granted a green from a census that never ran. Point
`MATCHING_SKILL_DIR` at a directory with no `style-census.mjs` and it prints a
table of zeroes and `Phase 3 CLEAN — 0 undeclared type mismatches`, exit 0.
Every run died on module resolution; `census-count.mjs` counts rows matching
`^  y=` and a stack trace has none, so each crash log read as `0 0 0`, and the
shell summed three zeroes into a pass. **Nine pages × three viewports = 27 such
runs, and the operator sees one word.** The belief corrected on contact: the
obvious repair — check the exit status — **could never have worked**, because
`style-census.mjs` exits 1 on findings and node's uncaught-exception code is also

1. One number meaning both _there is a finding_ and _I died before I looked_.
   Enumerating the class rather than the instance turned one reported case into
   **seven**, each printing CLEAN and exiting 0 on `main`.

Then **the fix was itself wrong one step along, and the journal says so.** A
_complete_ census reporting `mismatches: 3` still printed CLEAN, because the new
guard matched the counts line with `grep -qE` — answering _is it there_ — and
threw the numbers away, while the count actually reported came from a different
parser in a different repository. Two readers of the same artefact, no
cross-check, and one leading space was enough.

And `next.mjs` scored pages it could not score. With `anchors: []` — the shape
every new site starts in — the numerator counted real grid regions and the
denominator counted an imaginary anchor cut: **`SCORE 12/3 regions passing`,
then `No open geometry failures`, then `Backlog is empty`, exit 0.** The
journal's own reading is the line to keep: _"The absurd fraction is the harmless
half: someone would question 12/3. Nobody questions 'Backlog is empty', and it
prints from the same run."_ Worse, an unanchored ratio is not bounded by 1, so
the one page whose Phase 1 was never done **sorted best and could never be
named.**

**State now.** Site live and on maintenance; GA4 `G-51J638HZPL` mounted 08-24,
Search Console verified. Matching PAUSED since 09-01; resumption is an operator
decision. `main` current, local HEAD `fix/p751-unanchored-score`, four branches,
two Renovate `sharp` security PRs open since 09-09.

### vida-legacy-foundation — a bilingual site built from a Figma comp in four days, already over budget when it started

**What it is.** A San Antonio organ-donation and transplant-support nonprofit,
translated from a Figma comp by Nicole, shipping English and Spanish at launch.
`Initial commit` 2026-09-01. Airtable: `building`.

**Scale.** 100 commit rows (86 distinct), 11 active days; 64 PRs (60 merged),
+26,328 / −4,221, 0 reviews; **168 Actions runs, 167 success and exactly 1
failure** — the cleanest CI in the cluster by a distance; 18 distinct session ids
across 452 transcript files, **17,246 tool calls**, and **56 interruptions, by
far the highest in the cluster.** The repo's own retrospective puts the core
build at **51 commits, 49 PRs, four days, 22 agent sessions, three models**.

**This is the only project whose commercial frame is visible.** Erik in Discord
on 09-02: _"We're already into overages on this site, so as efficiently as
possible, pretty please"_ and _"I have an overage bill heading their way."_ The
site had been in design since at least 2026-07-30 and had consumed its budget
before a line of code existed.

**The donation page is the sharpest product decision in the cluster.** The
client's donor platform (LGL) has no API, and the operator's standing rule is
_"I'm not going to ever build something by hand that takes financial
information, we don't want that liability."_ So the page shipped **built to the
comp and behind a `show_form` switch**, linking out to LGL and PayPal. The
design was honoured, the liability was not taken, and the work is recoverable if
the client changes platforms.

**The gates were pointed at fixtures for four days.** From the repo's own
retrospective: _"the axe gate audited `/dev/a11y-fixtures` and `/dev/animate-in`
and nothing else, and the smoke suite covered three of eight routes. Every slice
PR said axe 0 violations; all of them meant the fixture passed."_ And **it was a
repeat**: the fleet's own comment on the `a11yRoutes` key records that the key
exists _"because scanning only fixtures let a critical `image-alt` violation
ship to five production pages with CI green"_ — a lesson already paid for on a
prior site and re-paid here because the key is opt-in and **nothing in
`/new-site` sets it.**

A second rule came out of the same review and is the most portable sentence in
the repo: **"a pass must require positive evidence, never the absence of an
error."** `/health`'s `forms.turnstile` was a truthiness check on an env var
allowed to mean "the widget works", and `rendered` meant "the mount point is in
the DOM", which the starter emits whenever the env var is set. _"Each time, the
fix reintroduced the same shape one step along — the last one survived by exactly
one error code."_

**Two beliefs corrected, with numbers.** The brand palette was taken from the
client's own PDF cheat sheet and was **wrong by one value per channel** —
`#fef5e9` → `#fdf5e8`, `#00263f` → `#01263f`, `#f1e9dd` → `#f2eadd`. Not
academic: the Figma-exported logo bakes the Figma value, so the shipped lockup
showed a **visible seam**, and the favicon and OG card had to be regenerated.
_"The variables were one `get_variable_defs` call away the whole time."_ And a
**fabricated design fact shipped into `CLAUDE.md` and lived there a day**: an
assertion that white-on-green at 2.10:1 was the primary donate button and a WCAG
problem to design around. Measuring all three buttons in the comps found **no
white-on-green anywhere** — every button is `#263b02` on `#9cbf5b`, **5.86:1 both
directions.**

The comp-measuring harness was built on day three, _after_ all 17 slices had
merged, and immediately cost three PRs re-doing pages already called done plus
nine PRs on a sticky-band mechanism it should have specified once. The
self-correction two days later is the better lesson: building it early still
holds; **building it ourselves did not survive contact** — three off-the-shelf
tools do this, one free.

**State now.** Not launched. Staging at `vida-legacy-foundation-rd.netlify.app`
shared with the client; Erik green-lit photography 09-10; hero video landed
09-11. `main` current, local HEAD `fix/person-card-clipping`, **eleven branches**
in the checkout, PR #74 open plus two Renovate `sharp` PRs.

### 29-navy — the second Webflow conversion, and the harness that had learned to refuse

**What it is.** `www.29navy.com`, a residential building site currently on
Webflow. Bootstrapped from `reddoor-starter` 2026-09-08. Airtable: `building`,
yearly.

**Scale.** 66 commit rows (50 distinct) over 5 active days; 23 PRs, +26,105 /
−609, 0 reviews; 71 Actions runs, 70 success. **2 distinct session ids across 85
transcript files, 8,730 tool calls, 134 general-purpose subagent dispatches, 1
interruption.** Effectively one long run, started with _"i'm going to sleep and
want you to run as autonomously as possible"_ and checked in on.

**The most encouraging fact in the portfolio is here: the lesson transferred.**
Before the first gate run, the installed matching harness was upgraded in place
past the beachfront census and unanchored-score fixes — the journal entry is
titled _"The installed harness was the one that could lie, upgraded in place."_
That is the difference between a journal and a changelog.

The bootstrap session also found a hatch that **ships in the starter to every
clone**: setting `VITE_PRISMIC_ENVIRONMENT` to the sentinel makes `entries()`
return `[]`, so `/` is never prerendered — measured `build exit=0`,
`build/index.html: ABSENT`, `files in build/: 5` — and the smoke suite reads the
_same_ variable and flips its expectation for `/` from 200 to 404, so it passes
too. _"It is the fastest available fix for the exact failure this repo is
sitting in right now, which is precisely when someone would reach for it."_

**The measurement was reading two different pages for a phase and a half.**
Creative Lofts failed 34–38% across five phases. `capture.mjs:42` sets
`reducedMotion: "reduce"` on every capture; this build honours it and does not
autoplay, while **Webflow's slider ignores the media query and keeps
advancing** — so the gate shot this build on slide 1 and the reference on slide
5 of 6, `gallery_roof1.jpg` against `gallery_29navy_interior.jpg`.
`heightDeltaFraction` was **exactly 0**, the anchors were identical, and the band
below matched pixel for pixel: everything measurable said the geometry was right,
and it was. The evidence that settled it was the fail crop showing a kitchen on
the left and a rooftop in the middle, **an image that had been sitting in
`matching/out-phase5b-home/` for a phase and a half.** The line worth carrying:
_"Four viewports of consistent arithmetic got more attention than the picture of
the thing failing."_ One `pinState` config line took the page to **0.0% at all
four viewports.**

The honest accounting on that is unusually clean, and it is the model for the
whole portfolio: _"The gate did not move because of anything drawn or restyled
this session… The slider motion work in #18 and the preload/modal work in #17
were both real, but neither moved this number, and anyone reading the score jump
as evidence that they did would over-invest in exactly the wrong place."_ Score
arc, measured: **4/20 → 16/20 on 09-10, then 20/20 at all four viewports with
zero floors and zero masks at threshold 0.1 on 09-11.**

**The operator corrected the shape of a fix, and it is the best process moment in
the cluster.** After three component re-inventions in one day — a slice-local
carousel when `Slider.svelte` exists, a hand-rolled focus trap when
`$lib/actions/trapFocus.ts` exists _with a docblock describing that exact case_,
and `prefersReducedMotion` declared verbatim in two slices — the first proposal
was a CI audit. Tucker rejected it on shape: _"this feels retroactive… by the
time you've run the check the cost of failing has already ocurred."_ What shipped
is `scripts/capability-index.mjs` generating `docs/COMPONENTS.md` — **50 modules
with their real prop names** — wired into `CLAUDE.md`'s orientation table. The
diagnosis is the transferable part: _"CLAUDE.md already said to check for
existing work. I read it at session start and re-derived three things anyway. The
instruction was never missing; the DATA was… Recognition is a different mechanism
from recall, and only one of them had been tried."_

**State now.** Not launched but declared show-ready 09-12; the matching gate was
accepted and flipped off (_"gate is accepted we are past matching"_). `main`
current, 4 branches, 2 PRs open. Last operator prompt in the corpus: _"published,
anything outstanding that doesn't have an issue attached to it?"_

### gallerysonder — almost no code, and the most instructive analytics failure in the portfolio

**What it is.** An art gallery (`gallerysonder.com`), Airtable `maintained`,
**monthly** — the most frequent cadence in the fleet. Josh is the client; Tim and
Nicole are internal; Carlo Valentino is the gallery's part-time digital marketer.
455 commits total since 2024-03-22.

**Scale.** 53 commit rows (45 distinct) over 19 active days; 40 PRs, +5,631 /
−3,122; 10 distinct session ids, 1,021 tool calls, 104 prompts. **CI health is
UNKNOWN, not clean — zero rows in `runs.jsonl`, a collection failure.** Unusually,
the sessions are mostly _not about code_: Gmail MCP calls (`search_threads` 20,
`get_thread` 11, `get_message` 8) outnumber `Edit` calls.

**The feature: CMS-authored RSVP confirmations, 09-03.** Notable for how scope
was handled — _"could we possibly do rich text for the body instead of plain
text? I know that's harder but this is reusable tech for the whole fleet"_, then
_"the fleet stuff is investment in our stack, don't worry about scope any more,
I'll deal with that side of things, you just do the work."_ It shipped as two
`@reddoorla/maintenance` releases (0.92.0, then 0.93.0 for the rich-text
renderer) with the site as first consumer. Client work deliberately converted
into fleet infrastructure — and, per the coverage note in §1, built from this
repo's chair while the commits landed centrally.

**The analytics episode, 09-10 → 09-11.** Carlo published a GA4 event tag,
`rsvp_submit`, firing on _Click – All Elements_ where click text contains "Submit
RSVP". It looked completely healthy in the GTM UI and was verified live rather
than from screenshots — fetching the served container returned **460,815 bytes**
containing both the event name and the predicate. It was still wrong twice over.
The POST is awaited **inside** that click handler, so GTM fired ahead of
Turnstile, ahead of the network, ahead of any knowledge of the outcome — failed
posts, spam-blocked posts and double-taps all became conversions. And the sharper
edge, invisible from inside the container: **the visible RSVP inputs are not
inside a `<form>` at all.** The page has zero `<form>` tags; the real one is
hidden and populated field-by-field at submit, so the `required` attributes are
decorative and a visitor mashing Submit with three empty fields _"registered a
GA4 conversion and no database row."_ Net effect: **GA4 read above the truth, the
opposite direction from the consent-gating undercount everyone on the thread was
braced for.**

Then the verification harness lied too. A Playwright route of
`**://*.google-analytics.com/**` **matches nothing**, because GA4 collection goes
to `analytics.google.com/g/collect` and `www.google.com/g/collect`. _"It fails
silently in the worst possible direction: the run looks clean, reports zero hits
captured, and concludes the tag did not fire, while every hit sails through
undisturbed."_ The honest accounting is recorded rather than buried: that first
run delivered **one real `rsvp_submit` (guests=4, exhibition_uid=euphorbia), a
page_view and a Google Ads conversion ping into the client's live property**
around 21:30 PT on 10 Sep. Derived rule: for verifying tracking, **always push;
never submit.**

**One operator-voice correction worth carrying to any drafting task**, stated
three times across 09-01 → 09-02 and then generalised: _"overall note, I like to
have the data and write my own emails, when I paste one in, I'm asking for
feedback and not a rewrite."_

**State now.** The dataLayer chain is measured end to end **for RSVP only**;
inquiry and contact have never been exercised live. GA4 custom definitions
unregistered pending Carlo's access to the right property. Hotjar removal
awaiting Josh's decision since 09-02. A Salesforce integration scoped at **$750**
(Tim's number), not started. Local HEAD `docs/journal-2026-09-11`, 4 branches, 2
worktrees, 3 PRs open.

### revogen — one compliance takedown, one image fix, one belief corrected by pixel diff

**What it is.** Revogen Biologics (`revogen.com`) — regenerative biologics plus a
password-gated distributor hub. Built from Tucker's _own_ SvelteKit+Prismic
starter rather than `reddoor-starter`; 163 commits total since 2025-08-08.
Airtable `maintained`, quarterly. The Discord channel for this account is
overwhelmingly **print and packaging** design; the website is a small part of the
engagement.

**Scale.** 34 commit rows (28 distinct) over 15 active days; 28 PRs, +2,538 /
−1,808; 162 Actions runs, 3 failures, all on 2026-08-03 (the fleet-wide Vite 8
day). **Only two transcript days in the whole window**, 09-01 and 09-02.

**The takedown, 2026-08-10 (RECONSTRUCTED from git + Discord).** The client asked
for all brochures pulled and all product narrative copy removed while the
language was rewritten for approval. Three commits land it. The finding that
matters: **the category descriptions and hero headline were hardcoded in
components rather than in Prismic, so a client content decision required a code
change** — exactly the coupling the fleet's CMS-first posture exists to avoid,
sitting in a repo built before that posture existed.

**A belief corrected by pixel diff within two days.** PR #69 put each product's
still image behind its Rive canvas as a fallback, **assuming the canvas would
paint over it**. Rive artboards are transparent outside their artwork and the
canvas is 12px taller than the still, so the still's baked-in labels ghosted
through every product Rive. Tucker: _"the fallbacks we added are visible behind
the rives, please fix and make sure to check in future that the pixels don't
change if you promise a change of this nature."_ #73 renders the still only after
`onLoadError`, **verified by pixel diff against a build of #69's parent — slice
1, 0 pixels changed.**

**And one not-a-defect, recorded so it stops being re-opened.** The distributor
gate offers no protection in two independent ways: the password is a literal
compiled into the client bundle, _and_ the server route fetches every gated
document into the SSR payload regardless. Operator ruling, 09-05: _"the revogen
password is a fake lock, there's nothing actually sensitive behind it."_ The
journal explicitly retracts its own earlier framing of this as an open critical
finding and leaves the retraction visible.

**State now.** `main` current, 3 dirty files, 4 branches (three unmerged), 2 PRs
open. No web work after 2026-09-05.

### The two with no sessions at all — `alamo-anatomy`, `espada`

Both are pure fleet maintenance and both had **zero transcript rows and zero
operator prompts** in 45 days: every change arrived through a sweep driven from
`reddoor-maintenance`. `alamo-anatomy` (San Antonio anatomy training lab,
Airtable `launching`, still on `alamo-anatomy.netlify.app`) took 23 commits — 12
Renovate, 11 Tucker, of which **exactly one is site behaviour**, and that one came
down from the starter. Its own journal states the finding plainly: _"After
2026-05-26 the log contains no design or content work at all"_ — a site at
`launching` status with no launch work in three and a half months. `espada`
(commercial real estate, `maintained`, quarterly) took 28 commits, every human
one fleet plumbing, **no site behaviour changed at all**; and it carries the
largest corpus gap in the cluster — **zero rows in `prs.jsonl` and zero in
`runs.jsonl`** while its own commit subjects cite `(#46)` through `(#69)`. That
is a collection failure consistent with the connection resets in `gh-errors.txt`,
not a quiet repo.

---

## 4. Quiet and dormant client sites

Sixteen repositories: eleven client sites, one hosted micro-service, two RFP
repos, two dead ones. **Not one Claude Code session in the entire corpus ran
inside any of them.** Every session that changed these repos ran from somewhere
else. This cluster is operated remotely, and that single fact organises
everything about it.

**The numbers.** 267 commits, of which **108 (40.4%) are Renovate** and another
**112 (41.9%) are the same sweep commit landed in eleven or twelve checkouts
inside an hour** — the 08-20 `ci: run on pushes to staging` sweep was authored
across twelve repositories in **86 seconds**. That leaves **34 commits (12.7%) of
genuinely site-specific work, and 19 of those 34 are in one repository, 17 of
them on a single day.** 197 PRs opened, 159 merged, **`nReviews` is 0 on every
single one.** Human PRs merged at a median of **0.2 hours**; Renovate's at 14.2
hours because it merges itself on its own cron. CI ran 1,495 times at 97.6%
pass — and **985 of those 1,495 runs (66%) are the Renovate workflow polling on a
schedule** rather than verifying a change.

### the-pointe-burbank — the one repo here where somebody built something

A frozen-Blux-artifact site: a Webflow-era design captured as committed HTML/CSS
and rendered by a SvelteKit route with Prismic supplying slot values. Airtable
`building`. **19 of the cluster's 34 site-specific commits are here, 17 of them
on 2026-08-03** — seven PRs (#14–#20) opened and merged between 20:39 and 23:59
UTC, each scoped to one defect. Merged totals **+8,045 / −2,127**, 39% of every
line added across the cluster's 159 merged PRs. All of it is inside the
reconstruction window, with no session record.

The work is a Figma design review answered with measurements rather than
adjustments, and the commit bodies are the only evidence that exists: rule-mark
spacing swept `margin 0 → 18/45.5`, `8 → 26/37.5`, `12 → 30/33.5`, `14 →
32/31.5 ← even`, landing all four eyebrow marks within 3.5px from 27.5px apart;
carousel arrow contrast measured as WCAG against the arrow's own box excluding
the glyph, **2.53:1 median and 1.17:1 across its brightest tenth** against the
3:1 that 1.4.11 asks; the dissolve fixed because _"two opacities meeting at .5
composite to .5 + .5 × .5 = .75: a quarter of the page's own light background
showed THROUGH the middle of every transition"_; image weight cut twice, first
the carousel (three slides at 3960×2640 into a 1425×760 box, 3.4MB even as AVIF)
then all 50 images (**5.06MB of Prismic imagery, 4.03MB of it in files far larger
than their box**), with 24 of the 50 deliberately left alone because their source
was already below what the box needed.

**Its instrument episode is the mirror of the repo rule.** On 2026-07-31,
`refactor(frozen): offline gate renders the production artifact, not a copy`:
`/dev/blux-frozen` imported its own `the-pointe.{html,style.css}` from beside the
route rather than the `frozen/` artifacts the real page renders, and the two had
drifted — the route's copy was a three-minutes-older freeze run missing five
media bands' attributes. **Every guard that drives that route, the fidelity gate
and the a11y suite included, was measuring markup production does not serve.**
The standing rule says a gate that has only ever _failed_ is not evidence; this
is a gate that had only ever _passed_, on a subject three minutes stale from the
one it names. Both are the same defect.

Two more, from one commit on 08-03 under a heading of its own — _"Two defects
found while testing this, both of which had a green test over them"_: dropping a
pipeline step from `steps()` failed nothing, because every end-to-end assertion
ran against CloudFront defaults the step deliberately ignores; and `substitute`
emits `url('…')` **with** quotes, so appending put the parameter after the
closing quote — a URL no browser would fetch, on which `toContain("&w=2400")`
passed happily. Both were caught by deliberately deleting the step and re-reading
the output, not by the suite.

**State now.** Last change 2026-09-05 (the journal sweep). One open Renovate PR
since 09-09. Everything after 08-03 in this repo is sweep traffic.

### hedloc — the only repo here with live client traffic

An oil-and-gas family investment site (Midland, Permian Basin), Airtable
`launching`, maintenance frequency `None`. 25 commits over 11 active days. **PR
and CI data are missing from the corpus — a documented scrape failure, not an
empty repo** (its own commit trailers cite up to `#44`).

The client-facing loop on **2026-08-10** is measurable end to end from Discord
timestamps against commit author times, and it is fast: Erik asks at 19:31 for
the hero CTAs above the fold with a 100px rhythm; the commit lands at 19:56 and
the reply goes out at 20:01 — **30 minutes request to reply**. The next one runs
20:05 → 20:12, **seven minutes**. The interesting pair is the last: the client
delegated the choice (_"whichever one is more pleasing"_), the first answer was
tried and shipped at 20:41, and **replaced ninety minutes later** at 22:12 — with
#36's body recording the reasoning for the road not taken and #37 generalising
the mechanism (`ScreenWidthImage`'s anchor prop now takes a 0–100 percentage)
rather than re-hardcoding. **None of this has a transcript**; 2026-08-10 is the
retention boundary and only `beachfront-dentistry` sessions survive it.

Hedloc is also the repo that **merged** the Renovate override-key trap. On
2026-08-03 Renovate opened `chore(deps): update dependency cookie@<0.7.0 to v2`
in nine cluster repos simultaneously. Eight closed it; hedloc merged it and
needed a corrective the same day, because Renovate had **misread a pnpm override
KEY as a dependency version** and widened the vuln-wave target to `'>=0.7.0 <3'`,
so any fresh resolution would jump to cookie 2.x — whose removed
`parse`/`serialize` exports break every current `@sveltejs/kit` server build.
Measured across the cluster: **20 of these PRs, 3 merged, 1 needing a same-day
repair.** What makes the class expensive is that the title of a dangerous one and
a correct one differ by a single character: `cookie@<0.7.0 to v2` is wrong,
`cookie@<0.7.0 to v1` — the 08-10 round, aligning with the org preset — is right.
The durable fix was not in any of these repos; it was the org preset holding
`cookie <2` centrally.

### caltex-landing — the fleet's proving ground

A maintained client site (`caltexmedical.com`, quarterly). 21 commits, and two of
its three site-specific commits exist **only to test other machinery**. On
2026-08-16: `test(prismic): temporary probe field to prove headless model
delivery (#54)`, then `Revert "…" (#55)` the same day — one throwaway Boolean
field pushed through the entire delivery path on a live client site and then
removed, _"the end-to-end proof that a model edit rides code review and reaches
Prismic on merge, run against a real repository rather than asserted."_ This is
the instrument rule applied correctly and deliberately, and caltex is the only
repo in the cluster with `prismic-models` runs (4, all success).

It also carries the cluster's one instance of the audit loop working end to end:
`fix(seo): give each page a distinct document title (#51)` — all five routes
served the identical `<title>Caltex Medical</title>`, a nightly audit found it, a
one-PR fix cleared it, Airtable now reads `Titles & Meta OK: pass`.

**State now.** All green, GA4 wired, **one persistent `Security Vulns High: 1`**
and two open Renovate `sharp` PRs untouched since 2026-09-09.

### 1836dig — the only launch inside the window

A Webflow conversion, `Launched at: 2026-07-31`. Its four site-specific commits
are all on launch day and all infrastructure — a smoke suite, the org Renovate
preset, and `fix: run svelte-kit sync on install so the smoke suite can load its
config`, **the cold-clone breakage that has bitten this fleet repeatedly** (an
absent generated `.svelte-kit/tsconfig.json` on a fresh checkout), discovered
here at launch in a repo nobody has opened since. It is also the single repo that
_merged_ a `cookie@…to v2`-class PR from the 08-03 round while eight others
closed theirs. **State now:** perfectly clean — 0 vulnerabilities of any
severity, smoke pass, form e2e pass, next maintenance 2026-10-31.

### The rest of the quiet cluster — a roll-up

**`vineyard-custom-homes`** (maintained, quarterly): 21 commits, **zero
site-specific**, and the clearest demonstration of the cost of Renovate landing
majors one at a time — Renovate's separate `vite-plugin-svelte v7` and
paired-majors PRs were both closed in favour of a hand-assembled
`vite 8.2 + plugin-svelte 7.2 + svelte 5.56 + tailwind 4.3` quadruple, because
_"the audit's dev-server was exactly what plugin-7-without-vite-8 broke"_.
**`medical-solutions-of-texas`** (maintained): zero site-specific commits, and a
pattern worth flagging — its real activity happened outside its own repo, both as
a bug report that turned out to be about _Reddoor's_ portfolio page (_"Sorry,
MSOT portfolio page on Reddoor's site"_) and as a design precedent other projects
cite by name. **`erp-industrial`** (maintained): zero site-specific commits, the
most bot-dominated repo here (12 of 21), five CI failures all of the formatting
or override-key class, and **the largest un-landed major-version backlog in the
cluster** (pnpm v12, `@prismicio/svelte` v2, `slice-machine-ui` v2,
`svelte-gestures` v5 sitting on Renovate branches off `main`).
**`data-dynamiq`** (maintained): zero site-specific commits; its distinguishing
fact is an absence — _"data dynamiq has no prismic"_ — and Airtable's drift alarm
correctly declining to fire. **`la-homelessness-initiative`** (maintained): zero
site-specific commits, 0 vulnerabilities, all green; nothing to report is the
report. **`la-homelessness-youth`**: zero site-specific commits and a deliberate
anomaly — _"the original version of the site we liked better before the client
asked to generalize the content, we prefer linking to it as part of our
portfolio"_ — kept alive as a portfolio artifact by setting maintenance frequency
to `None` rather than dropping `status=maintained`, which is what gates every
sweep. **`the-tower-burbank`** (`building`): zero site-specific commits; its only
distinguishing event is being the one repo where the 09-05 journal sweep reddened
CI on prettier, twice, and needed a third commit. **`reddoor-md-pdf`**: not a
client site and has **no Airtable row at all** — infrastructure living outside
the fleet record; its whole window is one day, clearing 24 Dependabot alerts by
full lockfile regeneration with **no direct dependency ranges changed**, while
explicitly declining the `brace-expansion@<X to v5` override-key misread.
**`reddoor-rfp-analyses`** and **`rfp-analyze`**: the estimates archive and the
skill that feeds it; their only window activity is the journal sweep, plus
`rfp-analyze`'s 2026-09-08 decision to become a subtree of
`reddoorla/claude-skills` — **the single latest activity anywhere in this
cluster**, everything else having stopped on 09-05.

### The three that cannot take a push

All three of the fleet's unpushable checkouts are in this cluster, and the 09-05
sweep left residue in every one. **`the-pointe`** (archived on GitHub):
`chore/work-journal` is ahead 2 and unpushed, `feat/prismic-capped-image-widths`
holds the 09-01 srcset fix ahead 1 and never merged, and `main` itself is behind
4 — it received 6 commits in the window and **all three human-authored ones
landed nowhere**. **`reddoor-mailer`** (archived, absorbed into
`reddoor-maintenance` long ago): 2 unpushed commits, **1,341 dirty files** which
on inspection is a committed `node_modules` being half-deleted, and no README.
**`rfp-analyze`**: no `origin` at all.

What makes this recur is stated in the fleet's own `CLAUDE.md` and is worth
repeating cold: **archived is invisible from inside the clone.** `git remote -v`
shows an ordinary URL, `git ls-remote` succeeds, `git fetch` succeeds, and only
`git push` fails — after every commit already exists. Three separate sessions ran
a fleet change to completion before finding out, and one reported the cause
wrongly as "dead remote". The operator's own framing on 09-05 — _"i feel like you
consistently get hung up on archived repos, is there a way we can fix that?"_ —
is the direct ancestor of `scripts/fleet-repos.sh`.

### Two things in the fleet record that must not be read at face value

**The persistent high vulnerability.** Five sites read `Security Vulns High: 1`.
Four have open Renovate `sharp 0.35.4 [security]` PRs untouched since 09-09,
usually **two per repo** proposing the same fix by different routes. Nine such
PRs are open across the cluster and they are the **only** open PRs in it. ERP and
Data Dynamiq carry the alert with **no** open sharp PR — INFERRED, and consistent
with the standing finding that **GitHub keeps a manifest in the dependency graph
after the file is deleted**, producing high alerts that no bump can ever clear.
If that is what these are, the count will never reach zero and the number is
decoration.

**The two frozen Airtable tables.** `airtable-Submissions.json` holds 48 rows and
every one is from 2026-06. This is **not** evidence that no lead reached these
sites in 45 days; submissions moved to Turso and Turso became authoritative on
2026-08-31. A reader who treats that table as the lead record will conclude the
forms are broken. They are not — MSOT, Vineyard, 1836dig and CalTex all read
`Form E2E OK: pass`. `airtable-Reports.json` holds 17 rows and **no report was
sent to any site in this cluster inside the window**, which is the schedule
working: the six quarterly sites have next-maintenance dates of 2026-10-05,
10-25, 10-31 and 11-21, and **no quarter turned over during these 45 days.**

---

## 5. Infrastructure and templates

Six repos, none of which serve a client and all of which are load-bearing for
every repo that does. 255 commit rows — but **242 distinct SHAs**, because
`reddoor-starter` and `reddoor-starter-blux` share 13 identical SHAs across all
branches (14 counting `main` only): blux is a full-history snapshot of the
starter taken at `82d93b0`. **Any per-repo count that adds those two together
double-counts them.** 82 PRs, 71 merged, **0 GitHub reviews**, median merge
latency **0.53 h**. Only **7 operator-bearing sessions in the whole cluster**,
all of them in two of the six repos.

**A second, narrower transcript gap sits inside the visible period and is not the
brief's.** No session covers **2026-09-08 between 00:00 and 16:29 local**. In
that span ~45 commits landed across five repos, including **20 of
`claude-skills`' 52 window commits — the entire creation of the repo.** Checked
rather than assumed: `~/.claude/projects/` holds 39 directories and none is
`claude-skills`. The gap is in what the machine recorded, not in how the corpus
was extracted.

### reddoor-starter — the native template

The GitHub template every client site is generated from. 30 commits on `main`
(24 human, 6 Renovate) over 12 active days, 29 PRs, 167 Actions runs with 1
failure. **Two operator-bearing sessions only**, both of which ran across a model
switch mid-session.

**2026-09-01 was triggered by a client, not a plan**: _"it happened, we have our
first new site to add to the fleet!"_ The template had never been run for a
genuinely new client, and reviewing it _before_ that run produced seven merged
PRs in one day and **three defects that had been green the whole time.**

- **`prettier --check .` had never checked a single Svelte file.** The repo had
  no `.prettierrc.json`; without one, prettier cannot resolve
  `prettier-plugin-svelte` and **silently skips `.svelte` rather than failing** —
  and the reusable CI workflow's command is exactly `pnpm exec prettier --check .`
  with no `--plugin` flag. **Proved with a control**: a deliberately mangled
  component _passed_ CI's command and _failed_ the local one.
- **`catch { error(404) }` in both content loaders** turned every Prismic failure
  — outage, bad token, wrong repo name, parse error — into a clean 404. Narrowed
  to Prismic's `NotFoundError`.
- **`reducedMotion` in `playwright.config.ts` had been inert since ~June**, set
  at top-level `use` instead of `use.contextOptions`, where Playwright silently
  drops it.

**#106 is the largest single change in the cluster and its most consequential
decision.** `refactor(template): native-only starter` — **242 files changed,
+1,453 / −29,941; 178 files deleted, 9 added.** The slice library went 28 → 9 and
custom types 7 → 1. What came out was the Blux frozen-render layer, which had
been baked into the template so that every clone inherited a catalog probe on
every page load plus 19 slices no client would use. The operator's framing is the
rule the cluster now runs on: _"I don't want to carry bloat into a new site, we
jsut spent a lot of work breaking out the blux site before working on vlf since
baking it in corrupted the starter."_

**2026-09-08 started as a question and never became a template change at all.**
Asked whether more Webflow conversions justified a third template fork, the
session argued it out over eight exchanges and the answer was no — and the
operator's own challenge changed the design: _"Shouldn't slices be able to get
that data through content relationships, or if it's necessary site wide, in a
store that we load in layout.ts?"_ The proposed three-line seam was rejected as
the same species as the two document-type probes #106 had just deleted, and the
rule was generalised: **the template ships no hook whose default does work, and
no field an editor cannot fill.**

**Honest accounting, from the repo's own journal.** Its `CLAUDE.md` is now **255
lines**. The 09-05 entry argued — citing Gloaguen et al., ETH Zurich,
arXiv:2602.11988, 138 tasks, four agents — that developer-written context files
buy **+4% task success for +19% inference cost**, and that the file _"should stay
closer to [194 lines] than to 963"_. Six days later #124 added to it. **The file
has moved in the direction the entry warned about.**

**State now.** `main` at `310df15`, clean, CI green. Two open PRs, both `sharp`
security bumps, both **correctly held** by the preset's never-auto-merge rule.

### reddoor-starter-blux — the frozen render track, and the adoption lag nobody measures

A full-history snapshot of the starter taken 2026-08-31 at `82d93b0`, kept alive
solely because it carries the Blux render layer the native template deleted the
next day. 139 tracked files match `blux`. **Zero sessions, zero operator
prompts** — every change here was made from another repo's session. 21 commits on
`main`, but **only 7 of the 21 are this fork's own**; the other 14 are shared SHAs
inherited from pre-split history.

**The landmine is the reason the repo exists in this form.** The fork was created
with an instruction that `git merge starter/main` was the way to take shared
improvements. Verified 2026-09-01 and reversed the same day: **that merge applies
the native template's 178 Blux deletions as clean, conflict-free removals.** Only
`README.md` conflicts, so nothing warns you — `src/lib/blux*`, every `Blux*`
slice and the fidelity gates are silently stripped. The rule is now cherry-pick,
never merge, and it is stated in three places.

**The cost of making adoption manual is visible seven weeks in, and nothing
measures it.** Since the split the native starter has merged #107, #110, #111,
#115, #117, #122 and #124; **none has been cherry-picked here.** Two of those are
the false-green fixes above, and **both defects are still live in this repo**:
`.prettierrc.json` is ABSENT while `package.json`'s local `lint` script still
carries `--plugin prettier-plugin-svelte` (so it works locally and not in CI),
and `reddoor.a11yRoutes` is ABSENT while `src/routes/dev/a11y-fixtures/` is
present. The research agent labels this **INFERRED from a mechanism proven
elsewhere** — the preconditions are measured, the mechanism was proven with a
control in #107 and #115, but neither suite was run here. `canvas-starter` is in
exactly the same state on both counts. **A one-line diff of those two files
across the three template repos would have surfaced it in seconds, and nothing
runs it.**

### reddoorla-dot-github — the org preset, and the correction that made it honest

GitHub's org-level `.github` repository: reusable workflows every site repo calls
by 40-hex SHA, and the Renovate preset every repo extends. 117 lines of YAML and
JSON that run in other people's repositories. 21 commits, **22 PRs all merged,
129 Actions runs and 0 failures** — the only perfect record in the cluster, which
is what you expect of a repo whose CI only validates JSON.

Its August work is almost entirely **version holds learned from breakage**, five
of them on 2026-08-03 alone (RECONSTRUCTED): TypeScript below 7 _"until
typescript-eslint supports it"_, `cookie` below 2 _"until @sveltejs/kit supports
it"_, `@libsql/client` at 0.8.x, `vite-plugin-svelte` below 7 — and then **#21
removing that last hold the same day**, three weeks early relative to its own
stated condition, because the wave landed. **A hold that names its exit condition
gets removed; one that does not becomes permanent.**

**#28 and #29 are the portfolio's canonical false claim and its retraction.** #28
fixed a real defect: the preset's Monday-only schedule means Renovate can only
create, rebase or merge inside that window, so an automerge-eligible group paired
with a top-level `minimumReleaseAge` can miss its own window — the PR opens
Monday with a pending `renovate/stability-days` status, the status clears
Tuesday, and Renovate will not touch the branch again until the following Monday.
Observed on `reddoor-maintenance#509`, green, `CLEAN` and unmerged across four
Renovate runs including two manual dispatches.

**#28 also shipped a wrong blast-radius claim, and #29 retracted it 19 minutes
later** (created 18:31:49Z, corrected 19:23:03Z, merged 19:25:38Z). #28 said 18
non-major PRs across the fleet sat CI-green and unmerged. **16 of those 17 site
PRs were never automerge-eligible at all**: under `group:allNonMajor`,
`@reddoorla/maintenance` was grouped into each one, and the never-auto-merge
`packageRule` therefore applied to the entire grouped branch. They were correctly
awaiting a human and a green Netlify preview, exactly as designed. The
generalised invariant now sits in the preset's own `description` array: **"A PR
that is green, CLEAN and unmerged is far more often a rule working than a rule
broken."**

That rule is presently load-bearing and demonstrable: packageRule 3 names
`@reddoorla/maintenance`, `sharp`, `@zerodevx/svelte-img`, `vite-imagetools`,
`imagetools-core` and `@sveltejs/enhanced-img` with `automerge: false`, on the
stated grounds that an `@reddoorla/maintenance` minor bump once silently broke
Netlify builds via an undeclared transitive `sharp` — _GitHub Actions built green
while Netlify failed_. **All five PRs open in this cluster at 09-12 are `sharp`
security bumps. They are not stuck; they are that rule working.**

**One corpus defect to flag.** `commits.jsonl` was built from local checkouts and
this checkout is behind origin: **PR #33 was merged 2026-09-09 and its commit is
absent from the corpus**, as are the tags after v1.4.1. Any count of this repo's
September activity taken from the corpus alone is short by at least one commit
and one tag.

### claude-skills — seven skills stop being loose directories

The seven Claude Code skills the fleet runs on, given a remote and a version on
2026-09-08. 52 commits, **100% human, 0 bot**; **0 Actions runs — the repo has no
`.github/` directory at all**, which its own README states as an open item. Note
the counting trap: **30 of the 52 predate the repo** — they are the original
history of `~/.claude/skills/matching-a-page` plus `rfp-analyze`'s, imported by
`git subtree` with SHAs and paths preserved. A reader who sees "first commit
2026-07-30" and concludes the repo existed in July is wrong; it existed for four
days.

**The reason is not tidiness.** The matching harness a site-bootstrap plan
installs has to locate `page-diff.mjs` somewhere, and until 09-08 "somewhere" was
a directory on one laptop with no remote, no version, and no way for a site to
say which report-format version it was scoring against. **Five of the seven
skills existed in exactly one place on earth.**

The import found three defects that would all have shipped silently. The
**symlink entry-point bug**: reached through a symlink, `process.argv[1]` keeps
the symlink path while `import.meta.url` is the real one, so the idiomatic
`import.meta.url === pathToFileURL(process.argv[1]).href` is false — **and the
CLI exits 0 having done nothing, with no error.** **Machine dependence**: exactly
one absolute `/Users/…` path existed across 83 tracked files, but the
`~/Documents/GitHub` references were a different class the search did not catch —
**32 of them**, against a plan that predicted ~25. And **the repo's own gate could
never have run**: `node --test test/` does not scan a directory on Node 22+
(positional arguments became glob patterns), so the script was **red on a
completely green tree from the moment it was written**, and would have stayed red
until someone ran it — at which point the obvious reading is "the tests are
broken", not "the runner never found them".

**The evidence discipline here is the best in the portfolio and is worth copying
whole.** One piece of evidence was **rejected before it was used**: running
`bash matching/gate.sh` to ask "does it still load?" proves nothing, because
`gate.sh:31`'s `PD=…` is a bare shell assignment that succeeds whether or not the
file exists and line 41 aborts before `PD` is used — **the output is
byte-identical with `~/.claude/skills` deleted**. It was replaced with
`test -f "$PD" && node "$PD" --version`. A check that could not honestly be made
from inside the session was **left open rather than claimed**: "this session
picked them up immediately" is not evidence about a cold start and cannot be made
into evidence from inside itself, so it was closed in a separate entry from a
different session — and even then a name in a skill menu was ruled insufficient,
because _a name in a menu is a claim about discovery, not about whether the
target resolves or its code runs._ What made it enough was `readlink -f`
resolving into the clone plus `page-diff.mjs --version` printing through the
link: _"an artifact a working system makes, not the absence of a complaint."_
And then **the instrument was observed catching something nobody planted** — the
machine-path guard fired on prose in the journal entry quoting that very
`readlink` output.

### scriptorium-setup — the busiest repo in the cluster, and it is not a website

The entire configuration of a writing appliance: a 2015 MacBook Pro reinstalled
with Debian, booting straight into a fullscreen terminal running `micro`, **no
browser installed**. `sbin/config-sync` re-applies the repo at every boot, so **a
push to this repo is a deploy.** **89 commits, all human, 0 bot** — the highest
count in the cluster — over 8 active days; **0 Actions runs**, the gate being ten
shell test files run locally. Five operator-bearing sessions, one of 18.7 hours
and one of 14.4.

Its 08-18/19 design cycle is stated entirely as **refusals**, which is the right
shape for a thing that can brick a machine nobody can SSH into: it refuses a
commit whose scripts do not parse, reverts a config that left no working menu,
and promotes only a config the menu confirmed. The Apple Option accent table was
**proven by compiling the real keymap with `xkbcli` rather than by typing at it.**

**The three-entry "can't push from home wifi" episode is the best worked example
of diagnosis in the portfolio.** Entry 1 (09-05) diagnosed entirely from the Mac
because the machine never answered on the LAN, ruled the network **out** with
positive checks, formed a belief, and then **explicitly declined to record it as
fact**: _"no memory written as fact, no journal claim of a root cause: the one
thing that would settle it — `git -C ~/writing/caldea push` unsilenced at the
machine — was unreachable."_ Entry 2 (09-06), at the machine: `ahead 2, behind
1`; `git fetch` returned 0 **on the home network, the one that "could not
push"**, first try. **"The network was never involved."** And the generalisation
is a trap the fleet had set for itself: _any_ Mac-side push to a writing repo — a
fleet sweep, a docs PR — makes the writer's next ship read as offline, because
`[p]` is `--ff-only` and cannot clear a divergence. **The 09-05 fleet-wide
journal sweep set this trap itself.**

Entry 3 carries a belief corrected **inside the fix for the misdiagnosis**: the
first draft matched `*"access rights"*` to detect a refused SSH key, and an
experiment against a real dead remote — rather than memory — showed git says
"access rights" for an _unreachable_ remote too. The match **would have filed
every dead network as a bad key: the same class of misdiagnosis the whole commit
exists to remove, reintroduced by the fix for it.** Also from that entry: the
file-picker's existing test was **satisfied by the bug** — its one assertion was
"row count equals file count", which an off-by-one satisfies exactly as happily,
and whose only symptom is opening the wrong chapter on a machine with no other
way to look.

And the honest accounting is explicit: _"None of this prevents the divergence. It
only stops the machine from blaming the network for it."_

### canvas-starter — a prototype on life support

A public prototype of a 2D "navigating a canvas" interaction, scaffolded from the
starter with Prismic left as an inert stub so it could be promoted to a template
if the interaction felt right. **The whole interaction was built on 2026-07-24,
before this window opens.** Inside the window, exactly two commits touched
anything but CI or dependencies and neither touched the canvas. 15 commits (7
human, 8 Renovate), 18 PRs of which 12 are Renovate's, 139 Actions runs of which
89 are Renovate's. The cheapest honest sentence available: **a dormant prototype
still consumes 89 Renovate runs and 12 bot PRs per seven weeks, plus the human
attention to merge them.** Two of its three CI failures are the tidiest
self-inflicted wound in the record — the 09-05 journal sweep added
`docs/workJournal.md`, `prettier --check` failed on the markdown, and the next
commit is literally `docs: format the journal so prettier --check passes`.

---

## 6. Personal and side projects

Eleven checkouts with nothing to do with Reddoor: a physics game, a game jam, a
novel, a song cheatsheet for an old iPad, an LED gaming table, a party
invitation, an ultimate-frisbee teaching tool, a VS Code word counter, and a
self-hosted budget. **880 commits (33.6% of the window), 38% of unique operator
prompts, 61,091 tool calls — and 12 Actions runs in seven weeks, 0.35% of the
corpus's 3,437.** Airtable has no rows for any of them; Discord mentions them
three times.

### Broken — the one that ate the window

A 2D physics game in Godot 4.7: you are a wrench-shaped robot with a hand on each
end, magnetising to anchor studs and throwing yourself around by spinning a
ratchet. Started 2026-08-16 as a two-day jam-scale prototype and did not stop.

**359 commits over 18 days. 43,102 tool calls — more than `reddoor-website`
(36,914), the largest Reddoor repo.** 324 `Agent` spawns, 64 `Workflow` runs, 50
`TaskStop` calls, 63 interruptions and 19 API errors, all the highest in the
cluster. **224 of the corpus's 268 `Artifact` publishes (84%) and 396 of its 525
`SendUserFile` calls (75%)** belong to this repo: design review here happens by
publishing a shape study as an artifact and arguing about it at revision
granularity — _"can I see r 16 and 17 i think the ideal is somewhere in there?"_
The code is 42 script files / 20,530 lines against **22 test files / 18,066
lines**, the same statement of intent the central Reddoor repo makes; the test
board went **12 suites / 293 checks on 08-19 to 19 suites / 941 checks on 09-08**.
`docs/` is **171,679 words, of which `workJournal.md` alone is 118,731** — three
times the length of the novel in this same cluster, written in 24 days.

**Broken contains the highest-quality run of "prove the instrument" anywhere in
the record, including the Reddoor repo where the rule is written down.**

_2026-08-19 — twelve suites reported all-green having run zero checks._ `run.sh`'s
only pass/fail signal was Godot's exit code, and **Godot exits 0 when a
`--script` suite fails to parse**. Reproduced by cloning into a scratch directory
and typing the documented first command: **twelve suites executed zero of 293
checks and printed `12 suites, all green, 2s`.** The near-miss in the fix is the
better half: the review suggested grepping for `SCRIPT ERROR`, which healthy
suites emit at teardown — _"grepping for it would have failed every run, which is
the same bug pointed the other way."_ A third mode surfaced only while injecting
faults to test the first two: Godot sometimes never exits at all, and macOS ships
no `timeout(1)`.

_The same afternoon — three checks that could not fail, in one suite, all with an
identical shape: the measurement was taken and then not used._ A check whose
comment said the point was _"not just 'it did not take it' — 'it did not even
pull'"_ computed the drift and printed it in the **pass message** rather than
asserting it; delete the rule it guards and the wall reels a carried cell the
full **106 px** onto its face while the line prints PASS. A fence check fired the
cell at **3000 px/s** and read its position at frame 180, calling that "came to
rest" — at that speed the cell rebounds off the far wall and settles at x=1237,
so the check passed **with the fence commented out entirely**; swept at speeds
that can actually reach the trap, −200 px/s rests at x=−130 and −400 at x=−73,
both inside an unwinnable strip.

_2026-08-19, later — the review's own gate was miscalibrated, and that was worth
more than the review._ Five lenses over the repository, each finding put to two
independent refuters with either able to kill it: **59 agents, 27 findings
raised, 2 survived.** Four of the 25 killed findings were spot-checked by hand
and **all four were real.** Requiring both refuters to pass a finding means one
skeptic buries it, and refuters were already told to default to refuting.

_2026-09-04 — the harness refuted the reason it was built._ Recorded play
"tapes" sent from the phone showed **16.7 px of worst drift over 57 checkpoints
and 27.4 s**, against a power-cell radius of 9.3 px. A design was written arguing
that wasm-in-Safari versus native-arm64 was the cause and that web tapes must be
replayed in browsers. A scripted-recording harness was built, and **its first act
was to kill its own premise**: native→native 0.07 px, native→**browser** 0.16 px,
7/7 events exact both ways. **Cross-runtime drift is 0.15 px, not 16.7** — the
two runtimes agree with each other to a seventh of a pixel while both disagree
with the original run by sixteen, so the variable was never the runtime, it was
the _build_. _"The design's reasoning was right and its conclusion was
backwards."_ The document was corrected by a dated section at the top with
nothing below it edited.

_2026-09-08 — a benchmark of a paused world._ A study answering "is the scan
cost significant?" measured 900 ticks at 0.027 ms and produced a beautifully flat
line across group sizes of 24, 88 and 524 — **because the room's boot card pauses
the tree, and a frozen world is equally frozen at every size.** A 24× understatement
that looked exactly like the answer _"the scan is free"_. It was caught because
the study prints, beside every timing, whether the robot actually moved:
_"`moved 0 px` under a number is unmissable; a plausible number on its own is
not."_ The real figure is **0.95 microseconds per mateable face per tick** — 0.3%
of a 16.7 ms frame. The rule it leaves behind is the most portable line in the
cluster: **every performance number in this repository should be printed next to
evidence that the thing being timed was doing something.**

And one misdiagnosis that stood **two days and 84 commits**: a ratchet direction
mark died at 2.2 px of stroke and the note written down was _"fine shape is the
wrong channel at a 16 px boss"_. That sentence then justified five successive
treatments — a solid wedge, cut-out chevrons, a taper, a rim arrow, a single
tooth. **It was never the shape**: purple `#7068a0` and tread green `#336c35` are
near-complementary, so a low-alpha purple averages to grey. It was the alpha.
_"Five rounds of shape work were paid for by a misdiagnosis nobody re-tested."_

**State now.** Paused since 2026-09-08. **`main` is 19 commits ahead of
`origin/main`**, covering everything from 09-05 to 09-08. The `rooms` CI workflow,
added 09-03 to automate _"the 'there is no CI' this repository kept apologising
for"_, triggers on push to `main` and **has therefore not seen any of it**. Three
collaborators cannot see it either.

### dont-lose-your-head — a 38-hour jam with three other people

A game-jam entry on the theme _Body and Mind_, Godot 4.7.1 at 640×360, exported
to itch.io. Four people, three of them on their first jam. Everything in two
calendar days: the corpus records 175 commits on 08-21/22, the repo's own
backfill entry — counting squashes correctly — says **200 commits against a
Friday 10:00 → Saturday 23:59 clock, split Tucker 140 / smahre 28 / Sean 18 /
Ben 14.**

**The one measured thing worth carrying is the PR behaviour: 64 PRs, 62 merged,
median time-to-merge 2.9 minutes, mean 26.0, max 11.9 hours — with 14 reviews
across all 64.** Under jam pressure a PR is a merge mechanism and a
change-visibility mechanism, not a review mechanism, and the team used it that
way deliberately. **This is the only repo in the entire portfolio with real
review volume, and the only one where more than one person is committing.** The
moment the process broke against the clock is the clearest statement of a
tradeoff in the record, at 23:05 on the Saturday: _"ok this is too musch smoke
testing, we need to ship shit."_

Defects, all of the invisible-until-shipped kind: the intro sky was set to
`#201c02`, **which was the sprites' own outline colour**, so every silhouette
vanished into the background; a button sprite sheet was doubled 48×16 → 96×32
without updating its 16×16 atlas regions, making every button invisible.

**State now.** Finished and frozen since 2026-08-22 apart from the 09-05
backfill. One PR still open.

### songbook + songbook-content — built in two nights and then used

A replacement for an Obsidian folder of song charts, read on an iPad Air 2
(iPadOS 15.7 / Safari 15.6). 117 commits over 7 days, essentially all of the
build in two: **22 commits on 08-24** (the spec, taken through five adversarial
review rounds _before a line of code_ — _"i want to start from a place where an
adversarial review returns only nits rather than big findings"_) and **61 on
08-25** (a Needleman-Wunsch derivation engine, a transcription editor with tap
tempo, an offline PWA reader, a legacy importer, an Ultimate Guitar converter and
GitHub content sync).

**The content repo is a security decision, not a convenience one.** `songbook`
auto-deploys a public site; a write token for it on a device _"that might be lost
or handed to someone at a gig"_ is remote code execution on that site. So songs
live in `songbook-content`, which has no CI and deploys nothing, and the iPad's
token is scoped there. (`songbook-content` shows **27 commits and zero
sessions** — INFERRED but well supported: the subjects are the shapes a GitHub
Contents-API write makes. **Its commits are written by the app, not by a
session.**)

**The false-green episode, 2026-09-09**, is the cluster's second-best instrument
story. Reported as _"on the ipad, 4 ends up truncating the song"_. The obvious
suspect was ruled out with numbers — deriving all 36 corpus songs at levels 3, 4
and 5 gave **identical line and bar counts at 4 and 5 on every song**. The actual
cause was CSS: **WebKit creates no overflow columns for `column-count: 1`.**
Measured side by side in a byte-for-byte replica of the reader's layout chain:

|                           | `.body` client height | content height | `scrollWidth`        | columns  |
| ------------------------- | --------------------- | -------------- | -------------------- | -------- |
| WebKit, `column-count: 1` | 744px                 | **9885px**     | 1475 (= clientWidth) | **0.98** |
| Chromium, same markup     | 382px                 | 382px          | 31963                | 39.93    |

Chromium fragmented identical markup into forty columns; WebKit made one and hid
seven-eighths of it, with no scrollbar, no marker, and `scrollWidth ===
clientWidth` so the page-turn logic **correctly** reported it was already at the
end — of the first screen of a nine-screen song. The entry says it plainly:
**"the app has been developed almost entirely in the engine that does not have
the bug."** A `/spike/multicol` harness already existed for exactly this class of
question, printed with _"Run this on the iPad — WebKit is what is under test"_,
and there is **no record of it ever being run on the device** — and **it would not
have caught this anyway**, because it measured elements that were _split_ and
this bug's content was never laid out to be split. A code comment claimed paged
reading was _"off by default until the stage-4 spike says WebKit honours
`break-inside: avoid`"_; it had been **on** by default with the spike's verdict
never recorded — _"the gate was described in the code and never closed."_

Honest accounting, quoted: _"The win is a two-line CSS change and nothing else;
the day's reading of `derive/` contributed nothing but a ruled-out hypothesis,
which is worth exactly what it cost and no more."_

**State now.** Live and in daily use. **1,202 tests across 55 files**; `to-fix.md`
**empty for the first time** after nineteen items shipped between 31 Aug and 10
Sep. The bottleneck has moved off the tooling entirely: **5 of 36 songs are
transcribed in full.**

### caldea — a novel, and the most regular cadence in the corpus

A literary/crossover SFF novel: prologue + 15 chapters + epilogue, ~64,650 words,
rough draft due **Sat 7 Nov 2026**. **56 commits across 35 of the window's 45
days** — near-daily, with subjects that read like a diary (_"tamer getting ego
checked"_, _"touching the file for today, game jamming"_). On the jam weekend he
still showed up and committed, explicitly to keep the streak.

**Claude's role here is not writing.** 222 transcript files across **62 distinct
sessions** — the highest session count per commit in the cluster — carrying only
913 tool calls between them: _"how are we on pace, what's the plan for this
week?"_, _"update the tracker for me"_, plus continuity and pacing consulting. The
operator drew the line explicitly on 09-05: _"no work journal needed here, just
in code."_ This is also the one repo where cheap models dominate — haiku-4-5 (91
sessions) and opus-4-5 (82) against opus-5 (9).

**The numbers, from the tracker's own 09-09 header.** 33,999 of ~64,650 —
**52.6%** — with **30,651 to write in 53 days, ~578/day**. Phase-1 pace ~305/day
against a 340 target. And recorded without softening: **three consecutive missed
days, Sun Sep 6 – Tue Sep 8, the first breach of rule 1 in the whole draft**,
absorbed by raising the book-wide ask 559 → 578 rather than by moving the
deadline.

**One ratio worth putting in front of the reader without a verdict attached.** The
tracker is **16,474 words** and the outline **9,865** — **26,339 words of
apparatus, almost all of it agent-written, against 37,039 words of manuscript.**
That is 0.71 apparatus-to-artifact. Whether that is scaffolding or displacement
is not something the corpus can settle; the tracker's honesty about pace
slippage argues for scaffolding, and the three missed days are the only
counter-evidence.

### the-bench — the hardware track

An LED rim turn counter for an octagonal gaming table: **ESP32-S3, a 221-LED
WS2812B rim, eight piezo sensors under a wooden top**, and a phone web UI. Two
dense build nights (Aug 14–16, 41 commits) running four full spec → plan →
firmware → docs cycles, including a tap guard that quarantines a chattering seat
**by loudness duty cycle rather than by chasing a threshold**. The loop is
physical and the operator is inside it: _"still gettig phantom taps after
tapping, I'm going to try replacing the piezo"_ → _"alright new peizo in and this
looks better"_ → the commit _"inventory: side 7 piezo replaced, 1 spare disc
left"_.

**Its own could-never-pass gate** is the cheapest in the portfolio to describe.
`ota_flash.py` ran a TCP pre-flight against port 3232 before pushing firmware.
**ArduinoOTA's port 3232 is UDP** — the device connects _back_ over TCP after
receiving an invitation datagram — so `socket.create_connection()` failed against
a healthy board that had just printed "OTA ready". _"It blocked every push, not
just broken ones."_ The commit's own closing line is the reusable part: _"The
unit tests never touched this: they covered secrets parsing and platform
discovery, not the protocol assumption underneath, which is where the bug was."_

**The migration, 09-04/05**: the turn counter came in by `git subtree` with its
full history, so **70 of the-bench's 78 commits are the turn counter's**. One
consequence was written down at migration time rather than discovered later —
**subtree import breaks `git log --follow`** for every migrated path, so the
pre-merge tip `7b1ebb2` is recorded as the handle for reading a file's real
history.

### welcome-to-the-flower-court — 47 hours, deadline-shaped, and shipped

An invitation site for a tabletop game run on **Monday 7 September at 3pm for
twelve to thirteen people**, plus the whole physical layer: Cricut cut files for
twelve papercut sigil badges, folded covers, and two-sheet dossiers printed from
the site's own routes. 75 commits in three days, 41 on the first.

**The scope cut is the whole story, and the operator made it in one sentence.**
The opening ask at 17:57 was a reusable product — theme engine, per-guest HMAC
links, Turso, an admin authoring UI, a two-week build. At 19:20: _"how would
scope if I want to send out invites by end of day today? doesn't need to be
reusable, we can rebuild into a bigger project with the lessons we learn building
this."_ Turso went; the governing rule became **cut the abstractions, keep the
mechanisms**. At 20:14 he split the names so the throwaway would not squat on the
reusable one. He also time-boxed the agent directly: _"I'm giving you an hour to
finish this."_

**The best design decision came from the constraint, not a feature.** With no
database there is no way to show which playbooks are already claimed, so instead
of building a race that cannot be arbitrated, the form asks for a **ranked top
three plus an opt-out list** — which is how he already casts. _"The no-database
version of this feature is not a degraded version, it is the correct one."_ And
character creation was cut after **reading the game's own rulebook**, which has
players fill sheets at the table — so the one genuinely sensitive field, a secret
objective, is never transmitted, stored or emailed. _A privacy problem solved by
reading the source material instead of by engineering._

**A belief corrected within hours of being written down**: the first entry claimed
the custom domain resolved instantly _"because there is already wildcard DNS on
`tuckerlemos.com`"_. There is no wildcard; a random subdomain does not resolve at
all. The real reason is that the domain's nameservers are Netlify's. The
correction is a new dated entry and **the wrong paragraph stays exactly as
written** — the `reddoor-maintenance` history rule applied on a personal repo
three days after it was rolled out there.

**State now.** The event happened; every guest email and the physical pipeline
went out. But **33 commits sit on `feat/sigil-badges`, unpushed and unmerged** —
everything from 09-06 09:42 onward, including the cast, the twelve sigil SVGs,
the Cricut cut files, the dossier PDFs and the record of which email went to
whom. `main` is itself 2 commits ahead of `origin/main`. **The work shipped to
its audience and never reached its remote.**

### The small ones — a roll-up

**`ulti-grid`**: an interactive teaching tool for ultimate frisbee defense —
place disc, offense and defenders on a grid and each open square's brightness
shows how available it is to the thrower. Three real commits on 2026-08-02
(RECONSTRUCTED), dormant since; the only later commits are the journal rollout.
**`to-go`**: a VS Code status-bar item that counts the day's words _down_ to a
target. One commit, 2026-09-02, and it exists to serve `caldea` — word counting
is whitespace tokens _"the same rule micro uses, so the two machines agree on the
number"_, a small piece of deliberate cross-device instrument calibration.
**`a-budget`**: self-hosted Actual Budget in Docker; three commits, one of which
is a **recorded financial decision** (_"Record the rollover IRA decision: leave it
Traditional"_) — the repo is used as a decision log, not just a container. Its
`main` is 2 commits ahead of origin with two untracked TypeScript files no commit
references.

---

## 7. What the portfolio shows that no single repo does

**1. The false-green is not a Reddoor problem, it is a universal one, and the
count is the finding.** Adding up the per-cluster catalogues gives roughly
**forty-five distinct documented instances in six weeks** of a gate, probe or
number that was green on a question it could not fail: twelve in
`reddoor-maintenance`, thirteen in `reddoor-website`, nine across the active
client sites, at least four in the quiet ones, six in infrastructure, and three
independently rediscovered in the personal repos. The personal-repo instances
matter most for the argument, because those repos have **no CI at all** — 12
Actions runs in seven weeks — so this cannot be blamed on a CI configuration. In
every case the gate was authored by the same session that wrote the code, run by
nobody else, and believed until something forced a fresh clone, a different
device, or a first real push. The repo whose `CLAUDE.md` leads with the rule
produced the most instances, in a codebase with 484 test files against 379 source
files. **The failure mode is not carelessness; it is that a system this size is
mostly instruments, and an instrument's own correctness is the hardest thing in
it to observe.**

**2. The corollary the written rule does not state.** `CLAUDE.md` says a check
that has only ever _failed_ is not evidence. The window supplies the mirror image
at least as often — the frozen route's fidelity gate measuring a three-minute-old
copy, `prettier --check` skipping every Svelte file, the axe suite scanning two
dev fixtures, `reducedMotion` inert since June, the backup verifier comparing a
dump against itself, twelve Godot suites printing all-green over zero checks.
**A check that has only ever passed is exactly as suspect.** The cheap
discriminator in every one of these was the same: break the thing on purpose and
watch for a red that names itself.

**3. Attribution by working directory is structurally wrong, everywhere.**
`reddoor-maintenance` has **43 commits across 2026-09-02 → 09-07 with zero
sessions under its own cwd**; both traced cases were central capability built
from a client's chair because a client asked. Four of the six infrastructure
repos have **no session record at all** and were changed entirely from other
repos' checkouts. `the-bench` has 55 commits against 4 operator turns because its
work happened under a directory that no longer exists. `songbook-content`'s
commits are written by an app. **Any measurement of "where the time went" keyed on
cwd will under-count every platform repo and over-count whichever site happened
to be open.**

**4. Review, as an institution, does not exist here — and the one place it does
is a game jam.** Zero GitHub reviews across 219 central PRs, 65 website PRs, 197
quiet-cluster PRs and 82 infrastructure PRs. Median human merge latency 10.3
minutes centrally and 0.2 hours in the quiet cluster. The actual review pressure
is real but is three other things: the `superpowers:code-reviewer` subagent (249
invocations corpus-wide), the operator reading a Netlify deploy preview, and
Tim/Nicole/Erik commenting on that preview in Discord. That loop works for design
— four rounds on a portfolio pin ending with Nicole's _"ooooohh i like this. no
notes"_ — and **nothing in it can catch a vacuous test, a false-green gate, or a
length-leaking token compare.** The only repo in the portfolio with real review
volume is `dont-lose-your-head`, 14 reviews across 64 PRs, and it got them
because three other people were committing.

**5. Using the thing beats reviewing it, and the record says so twice.** Three
adversarial review rounds on the match-harness recipe (#733) did not find the
gate that printed ALL DONE over runs that never happened; installing the recipe
on 29-navy and running it once did, in a single command. Broken's five-lens
review raised 27 findings and passed 2, while four of the 25 it killed were
spot-checked by hand and **all four were real** — the review's own gate was
miscalibrated, and discovering that was worth more than the review. Meanwhile the
things that _did_ find defects were: a deliberately mangled Svelte file, a
throwaway Prismic field pushed through a live client site, a fresh clone in a
scratch directory, a real dead remote, a first physical push to a board, and an
iPad.

**6. The operator's highest-leverage act is reading output, not writing
prompts.** The median prompt is short — 170 characters corpus-wide, 37% under 80
— and one in five is pure approval. But **one in eight (348 of 2,693) asks an
agent to prove something**, and every one of the window's most valuable
corrections came from him quoting a rendered artefact back: _"several of these
things are on our site…"_, _"is 94 the max readability?"_, _"76 checks 53/67
passing doesn't scan"_, _"I just sent a test submission and don't see anything in
the cockpit"_, _"the fallbacks we added are visible behind the rives"_, _"what
are you checking right now? I've said three times now we're not matching
anymore."_ Short prompts produce work; artefact-quoting prompts produce quality.
The uncomfortable corollary is that **he is the most reliable instrument-prover in
the loop**, and on day four of a pixel-matching task he had to _ask_: _"please use
playwright to check things as you build them."_

**7. When the operator corrects the _shape_ of a fix, it lands better than the
fix.** Three times: _"this feels retroactive… by the time you've run the check
the cost of failing has already ocurred"_ turned a CI audit into a prompt-time
capability index — _"the instruction was never missing; the DATA was"_.
_"Shouldn't slices be able to get that data through content relationships?"_
prevented a third starter template. _"i feel like you consistently get hung up on
archived repos"_ produced `fleet-repos.sh`. And _"we're done with pixel matching,
how can I enforce you remembering that?"_ produced a **file-existence pause
switch with an exit code**, because a rule already in the context was outranking
the prose instruction to stop. **Prose to an agent is the weakest carrier of a
changed objective; data and exit codes are stronger.**

**8. Cost and rate limits are design constraints, not friction.** Eight prompts
in `reddoor-website` alone are pure _"hit a session limit, continue"_; six change
the architecture (_"is there a reason we're using opus?"_, _"have an env toggle
between this and the actual API usage"_, _"take 5 representative sites and run"_).
Model tier is matched to task deliberately — `caldea` runs on haiku-4-5 and
opus-4-5, `Broken` on opus-5. An audit product whose unit cost is an LLM call was
designed around the credit ceiling from its first week. And the single largest
strategic decision of the window — deferring the Turso migration by paying for
more Airtable quota — was a **token-budget** decision, made to protect a game jam.

**9. Merged is not deployed, pushed is not merged, and written is not pushed.**
The `staging`→`main` split was introduced for the right reason and then
squash-merging silently diverged the branches, so one change opened at +2,353 /
−283 and landed at +28 / −8. **54 commits sit unpushed across three personal
repos** at window close, including Broken's four most recent working days and the
entire physical pipeline for an event that already happened — and Broken's CI
gate is real, correct, and **has never seen any of it, because it triggers on
push.** In the scriptorium, a file-picker fix written on 08-30 was still on the
Mac a week later, found only when the operator asked _"did the 'file list starts
on 0' change ever get implemented? not seeing it on device."_ **A gate you can
bypass by not pushing is a gate on a habit.**

**10. Fleet infrastructure is funded by client work, deliberately and
explicitly.** The `markup-review` skill came out of beachfront; the CMS-authored
confirmation copy and its rich-text renderer came out of gallerysonder and
shipped as `@reddoorla/maintenance` 0.92.0/0.93.0; the matching harness
generalised from beachfront into a recipe 29-navy installed. The operator states
the accounting himself: _"the fleet stuff is investment in our stack, don't worry
about scope any more, I'll deal with that side of things, you just do the work."_
This is a real strength, and it is also why point 3 matters: the funding
mechanism is exactly what breaks cwd-keyed attribution.

**11. A fleet template is authored once and formatted N times.** Three separate
incidents in one window — the Renovate App workflow (quoted YAML rewritten
differently by `singleQuote` repos), the `prismic-ci` workflow (erp's
`singleQuote: true` on a fresh clone with no `node_modules`), and the work
journal itself (the-tower-burbank's markdown failing `prettier --check`, twice,
needing a third commit; `canvas-starter`'s the same). The half-learned rule:
write sweep artifacts in the format-neutral form, because the consumer's
formatter is a config you do not control.

**12. Documentation arrived late, retroactively, and immediately started
paying.** The work-journal convention is six days old at window close in most
repos, and its first entries honestly label themselves backfills — _"detail below
this line is trustworthy; detail above it is not."_ Within four days it was
producing the census and unanchored-score write-ups, which are the most detailed
defect records in the portfolio. Its most valuable property is not the prose but
the **forward pointer**, added within hours because the rule as first written was
**half a mechanism**: a correction at the bottom of a file does not reach a reader
who lands in the middle. The evidence it was needed showed up by accident — the
sweep found a repo already doing it by hand, uncommitted.

**13. The record disagrees with itself in three places, and none of them should be
papered over.** (a) **Prompt de-duplication.** The package's metrics appendix
keys on message UUID and reports **2,693** unique prompts corpus-wide, 677 for
`reddoor-website` and 344 for `reddoor-maintenance`. The cluster research agents
de-duplicated differently and report **454** and **183** for the same two repos,
and **749** distinct turns for the personal cluster against the appendix's
**1,015**. Same raw rows, three methods, up to 1.9× apart. **No prompt count
should be quoted without saying which basis it is on.** (b) **Commit rows are not
landed units.** `commits.jsonl` counts a branch commit and its squashed twin
separately: beachfront's 249 rows collapse to 225 distinct subjects, VLF's 100 to
86, 29-navy's 66 to 50, and `dont-lose-your-head`'s corpus figure of 178
disagrees with the repo's own carefully-counted 200. `reddoor-website` shows 286
in `repos.jsonl` against 254 in `commits.jsonl`. `reddoor-starter` and
`reddoor-starter-blux` share 13 SHAs. (c) **Three collection failures are not
findings.** `espada` has zero PR rows and zero CI rows while its own commits cite
`#46`–`#69`; `gallerysonder` and `hedloc` have zero CI rows; `reddoorla-dot-github`
is missing a commit and tags merged on 09-09 because the corpus was built from a
checkout behind origin. Those are `gh-errors.txt` connection resets and a stale
local clone, not quiet repositories.

**14. And the honest limit on everything above.** The two most commercially
consequential events in the portfolio — the Webflow cutover on **2026-08-07**
that cancelled a client's subscription, and the **9.6-hour form outage on
2026-08-17** that cost real leads — are both outside or at the edge of the
transcript window, and exist only in Discord and in a repair commit. The densest
working day in the whole record (**2026-08-05**, 44 commits in one repo) and the
biggest day overall (**2026-08-03**, 173 commits and 78 merged PRs) have **no
session record at all**. **Any conclusion about how Tucker works that is drawn
from transcripts alone is drawn from the calmer half of the period.**
