# Cluster 03 — client sites with real activity, 2026-07-30 → 2026-09-12

Seven repositories: `beachfront-dentistry`, `vida-legacy-foundation`, `29-navy`,
`gallerysonder`, `alamo-anatomy`, `espada`, `revogen`. Written for a reader with
no other context, from the derived corpus plus each repo's own
`docs/workJournal.md`, which several of these repos did not have until
2026-09-05 and which is itself part of the story.

---

## Before anything else: what this corpus can and cannot see

Stated up front because three of the numbers below would otherwise read as
findings when they are gaps.

**Transcripts begin 2026-08-10.** For 2026-07-30 → 2026-08-09 there are **no
session records and no operator prompts** in the corpus — only commits, pull
requests and Actions runs. Everything said about that ten-day stretch is
RECONSTRUCTION from git, and is labelled as such where it appears. That window
is not incidental here: it contains the single densest run of work in the whole
cluster (beachfront, 44 commits on 2026-08-05 alone), and it is exactly the part
nobody can read back.

**Two repos are missing from the CI corpus entirely.** `runs.jsonl` carries rows
for 24 repositories; `gallerysonder` and `espada` have **zero**. `gh-errors.txt`
records `read: connection reset by peer` against the Actions and GraphQL
endpoints during collection, so this is a fetch failure, not a quiet repo.
`espada` additionally has **zero rows in `prs.jsonl`** while its own commit
subjects cite `(#46)` through `(#69)`. So: **CI health for gallerysonder and
espada is UNKNOWN, not clean**, and espada's PR record is absent rather than
empty.

**`runs.jsonl` caps at 300 rows per repo.** `beachfront-dentistry` sits at
exactly 300, earliest `2026-08-03T20:04:18Z`, which means its runs from 07-30 to
08-02 were truncated away. Its CI numbers below are a **floor**.

**`commits.jsonl` counts a branch commit and its squashed twin separately.**
Stripping the trailing `(#N)`, beachfront's 249 rows collapse to 225 distinct
subjects, VLF's 100 to 86, 29-navy's 66 to 50. Commit counts here are rows, and
the distinct-subject count is given alongside.

**`sessions.jsonl` rows are transcript FILES, not sessions.** VLF's 452 rows
resolve to **18 distinct session ids**, 399 of them under one; 29-navy's 85 rows
resolve to **2**. Where this document says "sessions" it means distinct session
ids, and says so. `durMin` spans a transcript file's first to last timestamp, so
a session left open across three days reads as 5,071 minutes — it is not working
time and is not quoted as such.

**`prompts.jsonl` contains duplicate rows.** Beachfront's 506 prompt rows dedupe
by text to **200**; VLF's 250 to 139; 29-navy's 287 to 97. Deduped counts are
used throughout. Note also that many rows are machine-generated
`<task-notification>` blocks and context-compaction preambles, not Tucker
typing — those are excluded from the quotes but not from the counts, which are
therefore still generous.

---

## beachfront-dentistry — the pixel-match rebuild, and the gates that had to be taught to refuse

**What it is.** A dental practice in Redondo Beach (`beachfrontdentistry.com`,
contact `Reception@dochopkins.com`, Airtable status `maintained`, quarterly).
The repo is a from-scratch rebuild of the client's existing **Webflow** site in
SvelteKit 2 / Svelte 5 / Tailwind v4 / Prismic on Netlify, forked from
`reddoor-starter`. First commit 2026-07-28, i.e. two days before this window
opens.

**What kind of work.** A new build that became a fidelity campaign, then a
design-review loop, then a harness-hardening project. Four distinguishable
phases, and the repo's own commit subjects carry the scores.

**Measured.** 249 commit rows (225 distinct subjects) — 230 by Tucker, 19 by
`reddoor-renovate[bot]` — across **23 active days**, 2026-07-31 to 2026-09-10.
45 PRs: 40 merged, 3 closed, 2 open (both Renovate `sharp` security bumps
outstanding at window close), 11 bot-authored, **+79,473 / −7,199** lines over
45 PRs, 0 reviews, 48 comments. **300 Actions runs (the collection cap, so a
floor): 233 success, 66 failure**, every failure on the `ci` workflow, and 52 of
those 66 land on two days — **15 on 08-05 and 37 on 08-06**. 14 distinct session
ids over 95 transcript files, 7 transcript days, 7,980 tool calls, 200 deduped
operator prompts, 5 interruptions. Skills invoked: `markup-review` ×6,
`superpowers:brainstorming` ×6, `new-site` ×5, `writing-plans` ×5,
`subagent-driven-development` ×5; 133 `general-purpose` subagent dispatches.

**Phase one, 07-31 → 08-09, RECONSTRUCTED from git only.** The matching campaign.
There is no transcript for any of it. What the log shows is 44 commits on
2026-08-05 alone, each carrying its own score in its subject line — `rebuild the
review band from live's rules — 19/27 -> 21/27`, `rebuild the Office Tour
section from live's rules — 13/24 -> 16/24`, `Phase 3 CLEAN — 0 undeclared type
mismatches, from 192`. A style census went **192 → 124 → 100 → 57 → 48 → 0**
undeclared type mismatches in one day. The 37 CI failures on 08-06 sit
immediately after the day the `matching/` scripts were first tracked
(`chore(matching): track the gate scripts, ledger and spec`), and the repair
lands as `fix(ci): redact live's Maps key, format the newly-tracked matching/,
fix build` — INFERRED, but the sequence is tight.

The same undocumented stretch produced the repo's five matching rules.
The journal's own later reading of them is worth keeping: **the five rules in
`CLAUDE.md` were written mid-campaign, not up front** — four on 08-05, the fifth
the same day — and _"each is a drift that had already happened: geometry applied
from a probed number instead of a stylesheet line, a page touched before its
spec existed, a stalled region attempted a fourth time."_

**The cutover, and the first instrument to lie.** On 2026-08-10 Tucker's opening
message is _"good morning, pushed this to live on friday so we could cancel
webflow but there's still some stuff to be done, take a look at the repo and
state of everything re:fleet onboarding and get this up to standard with
everything else"_ — so the business driver was **cancelling a Webflow
subscription**, and the site went live 2026-08-07 with the fidelity campaign
unfinished. That cutover broke the gate silently, and the fix commit names it
exactly: `fix(gate): production cut over to our build — REF repoints at the
webflow.io original`. The harness had been diffing the new build against the
production domain. Once the domain served the new build, **the gate was
comparing the site to itself** and could only ever agree. Nothing about its
output changed shape.

**The MarkUp.io loop.** Also on 08-10: _"ok, next thing, can you integrate with
markup.io?"_ → _"merge the pr when green, would love to test this skill with
some comments tim left in markup for beachfront"_. Tim Holmes is internal
Reddoor, the designer; the `markup-review` skill was built here, in-flight, to
turn his board pins into a fix list. It ran in lettered rounds (A through E in
August, I1–I4 on 01–02 September) and the ledger commits record something
unusual — **rounds close on "deviations," not matches**: `feat(cta): every Book
CTA now reads Request — the pin outranks the reference`, `feat(wave): the crest
rolls now — Tim's pin outranks the reference's own flat spot`,
`docs(ledger): operator ACKs the markup-round deviation floors`. The reference
stopped being the authority and the designer became it.

**The goal changed, and the agent did not notice.** This is the cluster's
clearest workflow defect. Tucker, 08-12: _"yep we're no longer chasing matching
so that's fine."_ Then 08-13, after the agent kept invoking the matching gate:
_"what are you checking right now? I've said three times now we're not matching
anymore"_. The eventual fix is a mechanism, not a paragraph — 09-01: _"we're
done with pixel matching for now, how can I enforce you remembering that? we're
going to do other webflow sites, so it is going to be a running theme"_,
answered by `chore(matching): a pause switch, because a backlog reads as an
agenda`. As of 2026-09-05 `matching/PAUSED` records the frozen state: **109/153
regions passing, 24 open failures, 18 declared floors, 1 operator-accepted
failure, worst page `our-team`.** The switch is an exit code rather than prose
because rule 5 ("a commit is a checkpoint, not a stopping point") would
otherwise override a written instruction to stop — a rule overruling an
instruction is itself worth noting.

**The client-impacting incident, 2026-08-17.** Not in the commit log; only in
Discord. Tim relays the practice owner: _"Hey Tim I tried to send a message thru
the portal on the office website and it's not going thru."_ Tucker: _"i'm
running a migration right now, that's really unlucky timing 🙈"_, then the
measured answer — **"Confirmed affected Aug 16, 11:35 PM → Aug 17, 9:09 AM =
9.6h. Widest possible Aug 16, 11:03 AM → Aug 17, 9:09 AM = 22.1h"** (Pacific).
Cause: the Airtable free-tier quota, which is what the Turso migration existed
to escape. Tim's process correction is the durable output: _"anytime a form is
knowingly down for a client give me a heads up so I can let them know before
hand. Then we can schedule based on a time that is the generally the darkest
range based on past submissions."_

**The 2026-09-09 harness audit — the highest-value episode in the cluster.**
Four days after the journal convention arrived, the matching gates were audited
against the repo's own "prove the instrument" rule, and three separate vacuous
greens fell out. All three are written up in
`beachfront-dentistry/docs/workJournal.md` with reproductions.

1. **`census.sh` granted a green from a census that never ran.** Point
   `MATCHING_SKILL_DIR` at a directory with no `style-census.mjs` and the gate
   prints a table of zeroes and `Phase 3 CLEAN — 0 undeclared type mismatches`,
   exit 0. Every run died on module resolution; `census-count.mjs` counts rows
   matching `^  y=` and a stack trace has none, so each crash log read as
   `0 0 0`; the shell summed three zeroes into a pass. **Nine pages × three
   viewports = 27 such runs, and the operator sees one word.** The belief
   corrected on contact: the obvious repair — check the exit status — _could
   never have worked_, because `style-census.mjs` exits 1 when it finds
   mismatches and node's uncaught-exception code is also 1. One number meaning
   both "there is a finding" and "I died before I looked". Enumerating the class
   rather than the instance turned one reported case into **seven**, each of
   which printed CLEAN and exited 0 on `main`.
2. **The fix was itself wrong one step along, and the journal says so.** A
   _complete_ census reporting `mismatches: 3` still printed CLEAN, because the
   new guard matched the counts line with `grep -qE` — answering _is it there_ —
   and then threw the numbers away, while the count actually reported came from
   a different parser. **Two readers of the same artefact, no cross-check**, and
   they version in different repositories, so drift needs nobody to touch either
   one. One leading space was enough: the parser matches `/^ {2}y=/`.
3. **`next.mjs` scored pages it could not score.** The denominator assumed an
   anchored run; with `anchors: []` — the shape every new site starts in — the
   numerator counted real grid regions and the denominator counted an imaginary
   anchor cut. Measured: `SCORE 12/3 regions passing`, then `No open geometry
failures`, then `Backlog is empty`, exit 0. _"The absurd fraction is the
   harmless half: someone would question `12/3`. Nobody questions 'Backlog is
   empty', and it prints from the same run."_ Worse, the ranking: an unanchored
   ratio is not bounded by 1, so the one page whose Phase 1 was never done
   sorted **best** and could never be named. The fix is to refuse and exit 2,
   not to relabel.

The honest-accounting habit shows up throughout, most sharply as
`fix(home): the verified half of attempt 4; revert the half that did nothing`
and `test(content): two of the new checks passed while the band was empty`.

**State at window close (MEASURED).** `main` current; local HEAD is
`fix/p751-unanchored-score`; four branches in the checkout. Matching PAUSED
since 09-01, resumption an operator decision. Two Renovate `sharp` security PRs
open since 09-09. Site live, on maintenance, GA4 `G-51J638HZPL` mounted 08-24,
Search Console verified, announcement email sent to Tim 08-24.

---

## vida-legacy-foundation — a bilingual site built from a Figma comp in four days, already over budget when it started

**What it is.** Vida Legacy Foundation, a San Antonio organ-donation and
transplant-support nonprofit (client contact `brooke@vidalegacy.org`, Airtable
status `building`). SvelteKit 2 / Svelte 5 / Tailwind v4 / Prismic on Netlify
from `reddoor-starter`, translated from a Figma comp by Nicole (internal
designer), shipping **English and Spanish at launch**. `Initial commit`
2026-09-01.

**What kind of work.** A new build, compressed. And the only project in the
cluster whose commercial frame is visible: Erik Svendsen (internal, account) in
Discord on 09-02, _"We're already into overages on this site, so as efficiently
as possible, pretty please"_ and _"I have an overage bill heading their way."_
The site had been in design since at least 2026-07-30 and had consumed the
budget before a line of code existed.

**Measured.** 100 commit rows (86 distinct subjects) — 93 Tucker, 7 bot — over
**11 active days**, 2026-09-01 to 2026-09-12. 64 PRs: 60 merged, 1 closed, 3
open, 3 bot-authored, **+26,328 / −4,221**, 0 reviews, 65 comments. 168 Actions
runs, **167 success and exactly 1 failure** (2026-09-05) — the cleanest CI in
the cluster by a distance. 18 distinct session ids across 452 transcript files
(399 under one id), 8 transcript days, **17,246 tool calls** (14,102 of them
`Bash`), 139 deduped prompts, and **56 interruptions — by far the highest in the
cluster**. Skills: `figma-slices` ×7, `figma:figma-design-to-code` ×7.

The repo's own reconstruction, written on day five from _"the commit log, 49 PR
bodies, the GitHub issues, and 74 of Tucker's own messages recovered from 22
session transcripts"_, puts the core build at **51 commits, 49 PRs, four days,
22 agent sessions, three models** (Opus 5, Fable 5.1, Fable 5 — 65
`Co-Authored-By` trailers across 51 commits, because a squash carries one per
collapsed commit).

**The arc, from the commit subjects.** Day 1 is bootstrap, brand tokens and the
`HeartHero` masthead with a scroll-driven four-frame reveal. Day 2 is a
seventeen-slice sprint — `ImageBand`, `StatementPanel`, `PersonGrid`,
`PageMasthead`, `IconColumns`, `SectionGrid`, `CtaBanner`, `StatsBand`,
`Testimonial`, the real nav and footer, the `/es` route tree with hreflang and a
language switch **that only points at pages that exist**, and a donation page
built to the comp _"with the backend deliberately empty"_. Day 3 is four review
rounds with Nicole and Erik in Discord, then an a11y and no-JS sweep. Days 4–5
are gate work and the retrospective. Then a long tail — stock photography
licensing, a Vimeo hero clip, and Nicole's second review round — running to
09-12.

**The donation page is the most interesting product decision.** Tucker, in
Discord on 07-31: _"I'm not going to ever build something by hand that takes
financial information, we don't want that liability."_ On 09-02 he investigates
the client's existing donor platform (LGL), finds no API, and concludes _"a
paypal link and an lgl link would be my rec, simplest, especially if we've
already overrun this project before i even started developing."_ The page was
still built to the comp and shipped behind a `show_form` switch — the design was
honoured, the liability was not taken, and the work is recoverable if the client
changes platforms.

**The retrospective is the artefact worth reading.** Tucker, 09-05: _"Review
these sessions, how we built this site against the figma and create a timeline
of everything you did, and put it into one document. And then make
recommendations on what we can change process-wise to improve for the next
site."_ Then _"do all ten, and then do a review of the whole process with a
comparative research step for how other people are doing this currently."_ The
ten, with their evidence, are in
`vida-legacy-foundation/docs/workJournal.md`. The four that matter most:

- **The gates were pointed at fixtures for four days.** _"For four days the axe
  gate audited `/dev/a11y-fixtures` and `/dev/animate-in` and nothing else, and
  the smoke suite covered three of eight routes. Every slice PR said 'axe 0
  violations'; all of them meant the fixture passed."_ And it was a repeat: the
  fleet's own comment on `a11yRoutes` records that the key exists _"because
  scanning only fixtures let a critical `image-alt` violation ship to five
  production pages with CI green"_ — a lesson already paid for on a prior site,
  re-paid here because the key is opt-in and **nothing in `/new-site` sets it**.
- **"A pass must require positive evidence, never the absence of an error."**
  `/health`'s `forms.turnstile` was a truthiness check on an env var, allowed to
  mean "the widget works"; `rendered` meant "the mount point is in the DOM,"
  which the starter emits whenever the env var is set. _"Each time, the fix
  reintroduced the same shape one step along — the last one survived by exactly
  one error code."_ The repair is `fix(turnstile): the suite discarded the one
error that matters, by name` (#54).
- **The comp-measuring harness was built on day three, after all 17 slices had
  merged**, and immediately cost three PRs re-doing pages already called done,
  plus nine PRs on a sticky-band mechanism it should have specified once. Two
  facts drove most of it and are **invisible in `get_screenshot` and absent from
  `get_design_context`**: Figma Extended text boxes trimmed to cap height, and
  prototype sticky scrolls. Both were extractable from the design's own data on
  day one. The self-correction two days later is the better lesson: building it
  early still holds, **building it ourselves did not survive contact** — three
  off-the-shelf tools do this, one free.
- **Verify on a production build** — and the entry marks itself as not merely
  unimplemented but contradicted: _"BOTH browser gates run `npm run vite:dev`,
  so the harness that enforces the other nine contradicts this one."_

**Beliefs corrected on contact, with numbers.** The brand palette was taken from
the client's own PDF cheat sheet and was **wrong by one value per channel** —
`#fef5e9` → `#fdf5e8`, `#00263f` → `#01263f`, `#f1e9dd` → `#f2eadd`. Not
academic: the Figma-exported logo bakes the Figma value, so the shipped lockup
showed a **visible seam** against the page ground, and the favicon and OG card
had to be regenerated. _"The variables were one `get_variable_defs` call away
the whole time."_ Separately, a **fabricated design fact shipped into
`CLAUDE.md` and lived there a day** — an assertion that white-on-green at 2.10:1
was the primary donate button and therefore a WCAG problem to design around; a
measurement of all three buttons in the comps found **no white-on-green anywhere**,
every button being `#263b02` on `#9cbf5b`, 5.86:1 both directions. And a font
check that returns `true` for a weight that does not exist:
`document.fonts.check('300 16px "pragmatica-extended"')` matches at family level
after fallback, so only iterating `[...document.fonts]` and reading each face's
`.weight` is honest.

**Process signal, measured.** 56 interruptions, five of them named in the
journal — two session limits, a model handover, a context exhaustion and a
crash (_"computer crashed because I also opened steam, resume"_) — and Tucker
asking **three separate times** what was currently running. Recommendation 9
reads that as the tell: _"in-flight work had no durable readable home."_

**State at window close (MEASURED).** `main` current, local HEAD
`fix/person-card-clipping`, **11 branches** in the checkout. PR #74 open
(person-card clipping), two Renovate `sharp` PRs open. Staging URL
`vida-legacy-foundation-rd.netlify.app` shared with the client; Erik green-lit
photography purchase 09-10; hero video landed 09-11. Not yet launched.

---

## 29-navy — the second Webflow conversion, and the harness that had learned to refuse

**What it is.** `www.29navy.com`, a Webflow site (Airtable: `site host
webflow.com`, status `building`, yearly maintenance) for a residential
building — the page sections are a hero slider, Residents, Creative Lofts,
Location. Bootstrapped from `reddoor-starter` on 2026-09-08.

**What kind of work.** A new build that is explicitly the **second run of the
beachfront playbook**, with the instruments fixed first. Tucker, 09-09: _"alright,
ready to convert this site, what do you need from me to get runnin on this?"_
and, that night, _"ok, do BC, ask me any questions or permissions you need from
me now, i'm going to sleep and want you to run as autonomously as possible"_.

**Measured.** 66 commit rows (50 distinct subjects) — 64 Tucker, 2 bot — over
**5 active days**, 2026-09-08 to 2026-09-12. 23 PRs: 21 merged, 2 open, 2
bot-authored, **+26,105 / −609**, 0 reviews, 26 comments. 71 Actions runs: 70
success, 1 failure (09-10); workflows `ci` 59, `renovate` 8, **`prismic-models`
4** — the model-delivery workflow, installed here. **2 distinct session ids
across 85 transcript files** (84 under one id), 4 transcript days, 8,730 tool
calls, 97 deduped prompts, **1 interruption**. 134 `general-purpose` subagent
dispatches and 20 `superpowers:code-reviewer`; skills
`subagent-driven-development` ×5, `code-review` ×5. This is the most
subagent-dense and most operator-sparse project in the cluster: effectively one
long session, run largely overnight, checked in on.

**The score arc, measured.** `feat(home): build the 29 Navy home page — SCORE
4/20 to 16/20` (09-10), then on 09-11 **20/20 at all four viewports, zero
floors, zero masks, threshold still 0.1**.

**The false greens found before the build started.** The bootstrap ran on
09-08 and its journal entries are titled for what they found: _"journal the
half-landed Prismic write, Netlify wiring, and a false green"_, then _"What an
adversarial review of this branch found, including a hatch that greens the whole
gate over an empty site."_ That hatch is the one to carry forward, because **it
ships in the starter to every clone**: setting `VITE_PRISMIC_ENVIRONMENT` to the
sentinel makes `entries()` return `[]`, so `/` is never prerendered. Measured —
`build exit=0`, `build/index.html: ABSENT`, `files in build/: 5`. The smoke
suite reads the _same_ environment variable and flips its expectation for `/`
from 200 to 404, so it passes too. _"Setting that variable in CI or on Netlify,
to make a red build go green, greens the entire gate over a site that serves no
home page. It is the fastest available fix for the exact failure this repo is
sitting in right now, which is precisely when someone would reach for it."_

Then the harness was upgraded _before_ it was used: `maint: upgrade the
installed matching harness past #744, #751 and #739` — i.e. the beachfront
census and unanchored-score fixes were carried across before the first gate run,
and the journal entry is titled _"The installed harness was the one that could
lie, upgraded in place."_ This is the cluster's clearest instance of a lesson
actually transferring.

**The measurement was reading two different pages, for a phase and a half.**
`Creative Lofts` failed 34–38% across five phases. `capture.mjs:42` sets
`reducedMotion: "reduce"` on every capture; this build honours it and does not
autoplay, and **Webflow's slider ignores the media query and keeps advancing**.
The gate was photographing this build on slide 1 and the reference on slide 5 of
6 — `gallery_roof1.jpg` against `gallery_29navy_interior.jpg`.
`heightDeltaFraction` was **exactly 0**, the anchors were identical, the band
below matched pixel for pixel. Everything measurable said the geometry was
right, and it was. The evidence that settled it was the fail crop showing a
kitchen on the left and a rooftop in the middle — an image that _"had been
sitting in `matching/out-phase5b-home/` for a phase and a half."_ The line
worth quoting to any agent: **"Four viewports of consistent arithmetic got more
attention than the picture of the thing failing."** Fixing it took a one-line
`pinState` config change; `Creative Lofts` went to **0.0% at all four
viewports**.

The honest accounting on that is unusually clean: _"The gate did not move
because of anything drawn or restyled this session. Every one of the 20 regions
was already correct; the measurement was reading two different pages. The slider
motion work in #18 and the preload/modal work in #17 were both real, but neither
moved this number, and anyone reading the score jump as evidence that they did
would over-invest in exactly the wrong place."_

Two more instruments failed here. A **probe modelled its subject differently
from the subject**: `probe-anchor-parity.mjs` selects over `body *` while the
real cutter uses a fixed tag list that does not contain `main`, and it compared
box heights where the gate cuts on top Y — so it raised a confident alarm about
a comparison the gate had never made. _"A probe that models the thing it audits
differently from the thing itself is worse than no probe."_ And the **seeder's
own `--verify` vouched for fields it never read**: it printed "the published ref
carries what site-pages.js describes" while comparing slice _count_ and nothing
else, having just been run over a write whose entire purpose was two text
fields.

**The reuse problem, and the operator correcting the shape of the fix.** Tucker,
09-11: _"slider looks good, but this is the second tyime today I've had an agent
try and invent a component rather than using battletested code I've already
built. how do we fix this?"_ The third instance landed the same day — a
hand-rolled focus trap when `$lib/actions/trapFocus.ts` was already in the repo
_with a docblock describing that exact case_, plus `prefersReducedMotion`
declared verbatim in two slices while `$lib/transitions.ts:15` exports exactly
it. The first proposal was a CI audit; Tucker rejected it on shape: _"the worry
here is that this feels retroactive, when the goal is do avoid doing duplicate
work, so by the time you've run the check the cost of failing has already
ocurred."_ The journal's concession is the useful part — _"I had optimised for
unevadable when the goal is never started. A gate that fails in CI saves the
merge; it does not save the hour, and the hour is the thing being wasted."_ What
shipped is `scripts/capability-index.mjs` generating `docs/COMPONENTS.md`: 50
modules from `src/lib` with their real prop names, wired into `CLAUDE.md`'s
orientation table so it is in front of an agent before any decision. And the
diagnosis of why more prose would not have worked: _"CLAUDE.md already said to
check for existing work. I read it at session start and re-derived three things
anyway. The instruction was never missing; the DATA was. Before today nothing in
this repo put the string `Slider.svelte` next to the word 'carousel'.
Recognition is a different mechanism from recall, and only one of them had been
tried."_

Its stated limit is honest: it is advisory, it reaches one repo, and the
earliest-firing layer — a `UserPromptSubmit` hook — cannot ship fleet-wide
because `.claude/` is gitignored in the starter. That is an operator decision
still open.

**State at window close (MEASURED).** `main` current, 4 branches, 2 PRs open.
Matching gate accepted/flipped off on 09-12 (_"gate is accepted we are past
matching, you can flip that toggle"_). Tucker's last prompt in the corpus:
_"published, anything outstanding that doesn't have an issue attached to it?"_
Site not yet launched.

---

## gallerysonder — almost no code, and the most instructive analytics failure in the cluster

**What it is.** Gallery Sonder (`gallerysonder.com`), an art gallery — Airtable
`maintained`, **monthly** maintenance, the most frequent in the cluster. Josh is
the client; Tim and Nicole are internal; Carlo Valentino is the gallery's
part-time digital marketer. The repo dates to 2024-03-22 and carries 455
commits total.

**What kind of work.** Maintenance plus one feature, and — unusually — the
sessions are mostly **not about code**. Of 104 operator prompts, a large share
are Tucker using the agent as a research-and-drafting partner for client email
and scoping. Gmail MCP calls (`search_threads` 20, `get_thread` 11,
`get_message` 8) outnumber `Edit` calls (51 vs 39 across those three).

**Measured.** 53 commit rows (45 distinct subjects) — 39 Tucker, 14 bot — over
**19 active days**, 2026-07-31 to 2026-09-11. 40 PRs: 33 merged, 4 closed, 3
open, 13 bot-authored, **+5,631 / −3,122**, 0 reviews, 49 comments. **CI: no
data — zero rows in `runs.jsonl`, a collection failure, health UNKNOWN.** 10
distinct session ids over 27 transcript files, 5 transcript days, 1,021 tool
calls, 104 prompts, 3 interruptions.

**The late-July fix pass (RECONSTRUCTED, 07-31 has no transcript).** Seven
commits in one day closing findings from an external site audit: a newsletter
signup usable from the nav with real validation, the cookie-consent gate made a
real dialog, roster stubs no longer served or advertised, _"dead RSVP
call-to-action, empty hrefs, missing alt, www robots"_, and crawlable footer
navigation with an a11y gate over real routes.

**The feature: CMS-authored RSVP confirmations.** 09-03. Worth noting because of
how the scope was handled. Tucker: _"could we possibly do rich text for the body
instead of plain text? I know that's harder but this is reusable tech for the
whole fleet"_, and then, explicitly: _"the fleet stuff is investment in our
stack, don't worry about scope any more, I'll deal with that side of things, you
just do the work."_ The work shipped as two `@reddoorla/maintenance` releases
(0.92.0, then 0.93.0 for the rich-text renderer) with the site as the first
consumer — client work deliberately converted into fleet infrastructure.

**The analytics episode, 09-10 → 09-11, and it is a textbook false green in a
measurement instrument.** Carlo published a GA4 Event tag, `rsvp_submit`, firing
on _Click – All Elements_ where click text contains "Submit RSVP". It looked
completely healthy in the GTM UI, and was verified live rather than from
screenshots — fetching the served container returned **460,815 bytes**
containing both the event name and the predicate, so it was genuinely published.
It was still wrong twice over:

- The POST is _awaited inside_ the click handler, so GTM fired **ahead of
  Turnstile, ahead of the network, ahead of any knowledge of the outcome**.
  Failed posts, spam-blocked posts and double-taps all became conversions.
- **The visible RSVP inputs are not inside a `<form>`** — the page has zero
  `<form>` tags; the real one is a hidden element populated field-by-field at
  submit. So the `required` attributes are decorative, and a visitor mashing
  Submit with three empty fields _"registered a GA4 conversion and no database
  row."_

Net effect: **GA4 read above the truth, in the opposite direction from the
consent-gating undercount everyone on the thread was braced for.** The fix went
into the one function all four forms share — the only place that knows whether
the ingest returned 2xx — so one push site covered four forms.

Two further traps, both named. The RSVP form's own field for the exhibition
title is `event`, which is **the reserved dataLayer key**; a verbatim
field-name passthrough would have overwritten the event name and silently
unhooked the trigger it was built to feed. And the verification harness itself
lied: a Playwright route of `**://*.google-analytics.com/**` **matches nothing**,
because GA4 collection goes to `analytics.google.com/g/collect` and
`www.google.com/g/collect`. It _"fails silently in the worst possible direction:
the run looks clean, reports zero hits captured, and concludes 'the tag did not
fire' — while every hit sails through undisturbed."_ The honest accounting is
recorded rather than buried: that run **delivered one real `rsvp_submit`
(guests=4, exhibition_uid=euphorbia), a page_view and a Google Ads conversion
ping into the client's live property**, around 21:30 PT on 10 Sep. The derived
rule — _"for verifying tracking, always push; never submit"_ — is cheap and
would have avoided it.

Then, when a loop reported all four events failing including one known good
minutes earlier: _"When every case fails at once and one of them is known good,
suspect the instrument before the system."_ The bug was `page.evaluate` with a
destructured array argument.

**The operator-voice correction, worth carrying to any drafting task.** Across
09-01 → 09-02 Tucker pushes back three times on being handed prose: _"sorry,
I'm not going to use your whole pastable response, that's clearly not how I
write, compress it down to one sentence that I can rewrite in my voice"_, _"I'm
naming our stuff do give him a graceful way to realize he's wrong"_, and the
general rule — **"overall note, I like to have the data and write my own emails,
when I paste one in, I'm asking for feedback and not a rewrite."**

**State at window close (MEASURED).** Local HEAD `docs/journal-2026-09-11`, 4
branches, 2 worktrees, 3 PRs open. The site-side chain is measured end to end
for RSVP only; inquiry and contact have never been exercised live. Custom
definitions unregistered pending Carlo's access to the right GA4 property.
Hotjar removal has been awaiting Josh's decision since 09-02. A Salesforce
integration was scoped at **$750** (Tim's number) and is not started.

---

## revogen — one compliance takedown, one image fix, one belief corrected by pixel diff

**What it is.** Revogen Biologics (`revogen.com`) — regenerative biologics,
ocular/wound-care/surgical-graft lines, plus a password-gated distributor
resource hub. Airtable `maintained`, quarterly. Built from Tucker's own
SvelteKit+Prismic starter, not `reddoor-starter`; 163 commits total from
2025-08-08.

**What kind of work.** Maintenance, with one content event. Discord for this
channel is **overwhelmingly print and packaging design** (Nicole, dielines,
an ocular envelope, _"almost 400 lbs. of RevoGen packaging was delivered
today"_) — the website is a small part of the account.

**Measured.** 34 commit rows (28 distinct subjects) — 22 Tucker, 12 bot — over
**15 active days**, 2026-07-31 to 2026-09-05. 28 PRs: 22 merged, 4 closed, 2
open, 13 bot-authored, **+2,538 / −1,808**. 162 Actions runs: 159 success, 3
failure, all three on 2026-08-03 (the Vite 8 stack bump day, fleet-wide).
5 distinct session ids over 14 transcript files, **only 2 transcript days**
(09-01, 09-02), 682 tool calls, 31 prompts, 0 interruptions.

**The takedown, 2026-08-10 (RECONSTRUCTED — before the transcript window, but
with Discord).** Erik on 08-06: _"Meagan is asking us to remove all brochures
from the Revogen site because they're going to make updates."_ Then a compliance
request to pull all product narrative copy while the language is rewritten for
approval. Three commits land it: `content(home): remove category descriptions
per RevoGen compliance request` and `content(home): replace hero copy with the
Revogen wordmark`. The finding that matters is in the journal: **the category
descriptions and hero headline were hardcoded in components rather than in
Prismic, so a content decision required a code change** — exactly the coupling
the fleet's CMS-first posture exists to avoid, sitting in a repo built before
that posture existed.

**The belief corrected, with a measurement.** PR #69 (09-01) put each product's
still image behind its Rive canvas as a fallback, _assuming the canvas would
paint over it_. **Rive artboards are transparent outside their artwork, and the
canvas is 12px taller than the still**, so the still's baked-in labels ghosted
through every product Rive. Tucker, 09-02: _"the fallbacks we added are visible
behind the rives, please fix and make sure to check in future that the pixels
don't change if you promise a change of this nature."_ #73 renders the still only
after `onLoadError`, verified by pixel diff against a build of #69's parent —
**slice 1, 0 pixels changed**. `scripts/pixel-diff.mjs` was kept.

**The not-a-defect, recorded so it stops being re-opened.** The distributor
gate offers no protection in two independent ways: the password is a literal
compiled into the **client bundle**, and the server route fetches every gated
document into the SSR payload regardless, so the links are in page source
whether or not anyone types anything. Tucker's ruling, 09-05: _"the revogen
password is a fake lock, there's nothing actually sensitive behind it."_ The
journal explicitly retracts its own earlier framing of this as "June's critical
finding is still open" and leaves the retraction visible — and notes that
fixing the password alone would buy nothing while the SSR payload still carries
the links.

**State at window close (MEASURED).** `main` current, 3 dirty files, 4 branches
(`fix/home-graft-lqip-blur`, `fix/rive-fallback-ghosting`,
`perf/remove-legacy-prismic-toolbar` unmerged), 2 PRs open. No web work after
2026-09-05.

---

## alamo-anatomy — pure fleet maintenance, no dedicated sessions

**What it is.** Alamo Anatomy Training Institute, a San Antonio anatomy training
facility whose lab you book — the `reserve` form collects station counts, tissue
type, and whether a C-arm, drills or arthroscope are needed. Airtable status
`launching`, still on `alamo-anatomy.netlify.app`, quarterly, and sharing a
billing contact with Revogen. Built from an **early** fork of the starter — early
enough that `src/lib/slices` does not exist at all; content is five
single-instance custom types with numbered section fields.

**Measured.** 23 commit rows (18 distinct subjects) over 12 active days,
2026-07-31 to 2026-09-05, and the split is the whole story: **12 bot, 11
Tucker**, and of the 11, eight are fleet plumbing (`actions/checkout` v7,
Renovate as a GitHub App, prettier-plugin-svelte v4 reformat,
`@reddoorla/maintenance` 0.81→0.83, reusable workflow v1.4.1, CI on `staging`,
the work-journal adoption). Exactly **one** is site behaviour: `fix(images): cap
Prismic srcset widths and give every image a real sizes` — which came down from
the starter, not from this site. 21 PRs (17 merged, 13 bot-authored,
+1,806/−1,262). 150 Actions runs, 148 success, 2 failures both on 08-03.
**Zero transcript rows and zero operator prompts** — all work here arrived
through fleet sweeps driven from `reddoor-maintenance`, never from a session
in this repo.

The repo's own journal states the ratio plainly and it is the finding: _"After
2026-05-26 the log contains no design or content work at all"_ — one exception,
a footer opacity lift from 60 to 80 for contrast — _"the other 60 are fleet
maintenance."_ A site at `launching` status that has had no launch work in three
and a half months.

---

## espada — pure fleet maintenance, and the largest corpus gap in the cluster

**What it is.** Espada, a commercial real estate firm in San Antonio
(`espadarealestate.com`). Airtable `maintained`, `Smoke OK: pass`, quarterly.
133 commits total from 2024-11-18.

**Measured.** 28 commit rows (25 distinct subjects) over 14 active days,
2026-07-31 to 2026-09-05; **13 bot, 15 Tucker**, and every one of the 15 is
fleet work — the same checkout/Renovate/vite-8/prettier/maintenance-bump/
reusable-workflow/staging ladder the rest of the fleet took, plus `ci: deliver
Prismic model changes from merged PRs` and the journal adoption. **No site
behaviour changed in this repo during the window.** Zero transcript rows, zero
prompts.

**The gap, stated rather than filled.** `espada` has **zero rows in `prs.jsonl`
and zero in `runs.jsonl`**, while its commit subjects cite `(#46)` through
`(#69)`. Both are collection failures, consistent with the connection resets in
`gh-errors.txt`. Its PR and CI health for this window are **unknown from this
corpus**.

One item worth pulling forward from the repo's own journal, because it is the
same epistemic shape as everything else in this cluster: a June morning report
predicted the contact form was capturing **no leads at all** — it used bare
`netlify` form attributes, and Netlify detects forms by scanning static HTML at
build time while this site is SSR with no static fallback. Eleven days later the
form moved to central ingest. _"Whether submissions were in fact being dropped
for the eighteen months before that was never confirmed — the review inferred it
from the setup, and the fix removed the question rather than answering it."_

---

## What runs across this cluster

**1. The work splits cleanly into two populations, and the ratio is stark.**
Three repos (beachfront, VLF, 29-navy) account for **415 of the 553 commit rows
(75%)**, all three of the ground-up build projects, and every operator prompt
but 135. The other four (gallerysonder partially, alamo, espada, revogen) took
between 11 and 39 human commits each, most of them fleet plumbing arriving from
`reddoor-maintenance` sweeps. Two of them — alamo and espada — had **zero
sessions in their own directory for the entire window**. Maintenance is real
work that leaves almost no session trace, and any workflow analysis built only
on transcripts will under-count it by a large factor.

**2. Every one of the three build projects shipped a gate that granted a green
it had not earned, and the pattern is the same each time.** A gate whose
failure mode and its success mode produce the same output. Enumerated here: the
matching REF pointing at the new build after cutover (beachfront, 08-10); seven
ways `census.sh` printed CLEAN over a census that never ran, plus one more after
the first fix (beachfront, 09-09); `next.mjs` printing `SCORE 12/3` and `Backlog
is empty` for a page with no anchors (beachfront, 09-09); axe auditing only
`/dev/a11y-fixtures` for four days while every slice PR reported "0 violations"
(VLF); `forms.turnstile` as a truthiness check on an env var (VLF); the sentinel
env var that greens the whole gate over a site with no home page (29-navy,
**and it ships in the starter**); `--verify` comparing slice count over a write
whose purpose was two text fields (29-navy); a GA4 click trigger counting failed
submissions as conversions (gallerysonder); a Playwright route pattern matching
none of GA4's three real collection hosts (gallerysonder). **Nine instances in
six weeks, in one cluster.** The repo rule — _a check that has only ever failed
is not evidence_ — has an equally expensive mirror: a check that has only ever
passed is not evidence either, and the cheap discriminator in every case above
was to break the thing on purpose and watch for a red that names itself.

**3. The lesson did transfer once, and that is the most encouraging fact here.**
29-navy upgraded its installed matching harness past the beachfront census and
unanchored-score fixes **before running the first gate**. That is the difference
between a journal and a changelog.

**4. A pixel-perfect target was abandoned by the operator, and the agent could
not tell.** Tucker said "we're no longer chasing matching" on 08-12 and had to
say it again on 08-13 — _"I've said three times now"_ — and the durable fix was
a **file-existence pause switch with an exit code**, not a sentence in
`CLAUDE.md`, because a rule in `CLAUDE.md` ("a commit is a checkpoint, not a
stopping point") was actively overruling the prose. The generalisable form: when
a project's objective changes mid-flight, prose to the agent is the weakest
possible carrier, and rules already in the context can outrank it.

**5. Component reinvention happened three times in one day, and the fix's shape
was corrected by the operator.** A CI audit catches it at merge; the hour is
already spent. What shipped was a generated capability index in the agent's
orientation path — recognition rather than recall — with an explicit ladder for
the earlier-firing layers (`UserPromptSubmit` hook, then `PreToolUse` on writes,
then CI as backstop) and an honest note that the hook layer is blocked because
`.claude/` is gitignored in the starter.

**6. Client and design feedback arrives in Discord and MarkUp.io, never in the
repo.** Tim's beachfront pins, Nicole's VLF review rounds, Erik's budget
pressure and the Aug 17 form-outage incident are all invisible from git. The
`markup-review` skill was built mid-project (08-10) to bridge one of those
channels; the Discord side is still read ad hoc with curl. Any account of what
these projects cost that reads only commits and PRs is missing the half that
sets the deadlines.

**7. Documentation was created retroactively, and the repos say so in writing.**
Six of the seven repos opened a `docs/workJournal.md` on **2026-09-05**, each
with a backfill entry that explicitly marks itself untrustworthy above a line —
_"nothing here should be cited as though someone wrote it down at the time."_
The convention arrived from Tucker's request on VLF day five: _"add to the
starter CLAUDE.md and all the other repos I have on this machine, I want every
repo to maintain a workJournal."_ Within four days it was producing the census
and unanchored-score write-ups, which are the most detailed defect records in
the cluster. Beachfront's own assessment of the gap it closed: _"six weeks of a
scored, phase-gated campaign left its numbers in `LEDGER.md` and its conclusions
in `CLAUDE.md`, but had nowhere chronological to say why a round went the way it
did — so that reasoning survives only where someone happened to write a good
commit subject."_

**8. Session shape is bimodal and getting more extreme.** Beachfront in August
ran 14 sessions with 200 operator prompts and heavy inline back-and-forth.
29-navy in September ran **2 session ids across 85 transcript files, 97
prompts, 8,730 tool calls and 1 interruption** — one long autonomous run with
134 subagent dispatches, started with _"i'm going to sleep and want you to run
as autonomously as possible"_ and checked in on with _"what's up next?"_. VLF
sits in between and paid for it: **56 interruptions**, five named in the journal
(two session limits, a model handover, a context exhaustion, a crash), and
Tucker asking three separate times what was currently running. The operator's
own framing of what he is now buying, from Discord on 07-31: _"my hours are
really weird now, because a lot of it is having claude running in the background
and being available to answer questions, review what's going on, I'm going to
mostly budget time by days more than anything else."_

**9. Fleet infrastructure is funded by client work, deliberately.** The
`markup-review` skill came out of beachfront; the CMS-authored confirmation
copy and its rich-text renderer came out of gallerysonder and shipped as
`@reddoorla/maintenance` 0.92.0/0.93.0; the matching harness generalised from
beachfront into a recipe that 29-navy installed. Tucker is explicit about the
accounting: _"the fleet stuff is investment in our stack, don't worry about
scope any more, I'll deal with that side of things, you just do the work."_

**10. And one piece of honest accounting about this document.** The two most
commercially consequential events in the cluster — the Webflow cutover on
2026-08-07 and the 9.6-hour form outage on 2026-08-17 — are both **outside or at
the edge of the transcript window**. The cutover is reconstructed from a single
Monday-morning prompt and a gate-repair commit; the outage exists only in
Discord. The days with the most commits in this cluster (2026-08-05, 44 commits;
2026-08-06, 13 commits and 37 CI failures) have **no session record at all**.
Any conclusion about how Tucker works that is drawn from transcripts alone is
drawn from the calmer half of the period.
