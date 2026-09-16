# Week 4 — 2026-08-17 to 2026-08-23

**Headline.** An Airtable free-tier quota ran out under six daily fleet crons and
took a paying client's contact form down for ~9.6 hours; the week that followed
was spent paying for that in three currencies at once — a datastore migration
planned and deferred, a client funnel rebuilt out of somebody else's CRM, and two
games — and it ended on a Sunday evening finding that the nightly fleet smoke had
been failing for four nights while reporting success.

---

## Coverage and how to read the numbers

Transcripts exist for every day of this week (they retain back to 2026-08-10), so
nothing here is reconstruction-from-git. Four measurement caveats matter, because
three of them will mislead a reader who takes the corpus at face value:

- **`prompts.jsonl` double-counts.** The raw file has **1,418 rows** for this week;
  `prompts-unique.jsonl` (deduped by message uuid) has **549**, of which **353** are
  real operator turns rather than task-notifications, IDE-open notices, compaction
  summaries or auto-summariser scaffolding. The inflation comes from transcript
  forks re-logging the same message — one Broken prompt about a Grainger wrench
  appears at idx 5, 28, 48, 76, 113, 158… in a single session. **The brief's
  "304 prompts Aug 18 / 214 Aug 19" for Broken is the raw count; the unique count
  for Broken those two days is 31 and 38.** Every prompt number below is the
  deduped, real-operator count unless it says "raw".
- **Session rows attribute tools, interruptions and duration to the day the session
  _started_.** Three sessions this week ran longer than two days each, so
  "36 interruptions on 08-18" really means "36 interruptions in a session that began
  on 08-18 and ended on 08-21".
- **CI data for this week is effectively missing for the central repo.** `runs.jsonl`
  is capped at ~300 runs per repo, newest first; `reddoor-maintenance`'s oldest
  retained run is **2026-09-04**, and `reddoor-website`'s is **2026-08-22**. The
  week shows 277 runs, all `success` — but 273 of those are Renovate `schedule`
  runs on site repos. **That "all green" is a gap, not a finding**, and we know
  independently (from #550, landed 08-23) that the nightly fleet smoke failed on
  two sites four nights running inside this window.
- **`gh-errors.txt` records connection resets during corpus collection** (hedloc's
  runs, several GraphQL PR queries). So where a repo shows zero PRs — `espada`,
  `hedloc` — that is a collection gap, not evidence of a direct push.

---

## CALENDAR

| Day       | Commits (corpus, non-merge) | PRs opened / merged | Operator prompts (unique) | Sessions started | Repos touched                                                                |
| --------- | --------------------------- | ------------------- | ------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| Mon 08-17 | 21                          | 5 / 6               | 48                        | 96               | reddoor-maintenance 9, reddoor-website 6, caldea 2, 1836dig 2, scriptorium 2 |
| Tue 08-18 | 84                          | 0 / 0               | 68                        | 58               | Broken 38, reddoor-website 27, scriptorium 17, caldea 2                      |
| Wed 08-19 | 95                          | 0 / 0               | 78                        | 96               | Broken 54, reddoor-website 24, scriptorium 16, caldea 1                      |
| Thu 08-20 | 49                          | 24 / 21             | 54                        | 187              | Broken 15, reddoor-website 9, reddoor-maintenance 3, + 19 site repos × 1     |
| Fri 08-21 | 54                          | 0 / 0               | 11                        | 28               | dont-lose-your-head 53, caldea 1                                             |
| Sat 08-22 | 123                         | 41 / 40             | 63                        | 74               | dont-lose-your-head 122, caldea 1                                            |
| Sun 08-23 | 28                          | 28 / 28             | 31                        | 28               | reddoor-maintenance 14, Broken 13, caldea 1                                  |
| **Total** | **454**                     | **98 / 95**         | **353**                   | **567**          | 25 checkouts                                                                 |

Other week totals: **33,969 Bash calls**, 3,824 Reads, 2,625 Edits, 945 Writes;
326 `Agent` dispatches (275 `general-purpose`, 46 `superpowers:code-reviewer`);
249 `AskUserQuestion` calls; **68 interruptions**; **25 context compactions**;
median operator prompt length **75 characters**. Models seen: opus-5 (275
session-rows), fable-5 (122), haiku-4.5 (69), opus-4.5 (64), sonnet-5 (39).

**Mon 08-17** — Airtable's free monthly cap is exhausted. Every fleet form
submission is returning 502. Tim reports a live client complaint on
`#beachfront-dentistry-website` at 16:20 UTC. Four `reddoor-maintenance` PRs land
(#540 operator inbox, #542 Playwright port, #544 CSP replay stub, #541/#543
release). Turso migration researched, designed, deliberately deferred and pinned
as issue #539. `reddoor-website` starts the medtech two-form inquiry flow against
a GoHighLevel iframe embed; the embed starts returning 429.

**Tue 08-18** — Heaviest tool day of the week (16,240 tool calls in sessions
starting today). `reddoor-website` replaces the browser-side embed with a
server-side CRM integration, adds `/schedule` and books a real appointment.
`Broken` (the pre-jam Godot prototype) gets its rig, its spin motor, its wrench
collider and a playable cell run. `scriptorium-setup` (a 2013 MacBook reflashed
as a writing appliance) gets boot-time repo sync and a Mac-style accent keymap.

**Wed 08-19** — Highest commit day outside the jam. `Broken`: 54 commits of
playtest-driven fixes, a web build on Netlify, and a whole-repo adversarial review
whose harness turns out to be the problem. `reddoor-website`: the GHL link
switchover — 55 snippets scanned, nine to edit — and three separate corrections of
the same reasoning error in two days.

**Thu 08-20** — Release day. `reddoor-website` #133 (**+25,026 / −650 across 155
files**) goes staging → main at 17:43 UTC, 28 minutes after opening, over a red
`ci / ci`. #134 follows with route warming and a landmark fix. A fleet sweep puts
`ci: run on pushes to staging` into **22 checkouts** (18 PR rows in the corpus).
Beachfront's release path and announcement email get built. `Broken` ships to
Discord as a public Netlify link at 17:34.

**Fri 08-21** — The jam starts at 10:00 local. `dont-lose-your-head` is created at
14:02 and takes 68 commits (53 non-merge) from four people by midnight. Broken is
parked: _"we're solidly out of the jam period now."_

**Sat 08-22** — Jam peak: **132 commits** (122 non-merge), **41 PRs opened, 40
merged, median time-to-merge 2.9 minutes**. Last commit 21:27 local.

**Sun 08-23** — Two tracks. `Broken` physics hardening in the morning. In the
evening an `evening-review` (7 skill invocations) produces the week's most
valuable finding and seven PRs: #550 → #556.

---

## BEATS

### 1. The quota ran out, and the fleet lost leads it could not count

Monday opened at 02:01 UTC with one sentence: _"hit my api limit for airtable and
we're only halfway through the month, does not seem scalable. it might be worth it
to reconsider hosting everything on in turso since we're still early on this stack.
do research and give me your thoughts."_

The research workflow came back with a headline that was right and a diagnosis that
was properly measured: **~4,273 Airtable calls/month, ~142/day**, against a Free cap
of 1,000/workspace/month — crossing on day ~7 and hitting 2× on day ~14.2, which
reproduces "burned a month of quota in 15 days" exactly with no unexplained traffic.
Three write loops accounted for **83%** of it, and all three were the same defect:
`update([{id, fields}])` with an array of exactly one, inside a serial loop.

- Per-site audit write-back: **1,625/mo (38%)** — 13 sites × 125 runs across four
  workflows that pass `--write-airtable`.
- `writeNextDueDates`: **~1,360/mo (32%)** — PATCHes every row in the unfiltered
  `listWebsites` result, and is called _before_ the `due.length === 0` early return,
  so a night with nothing due still costs a write per site.
- `github-signals`: **544/mo (13%)** — 17 rows × 32 runs, with a comment at the loop
  reading "Serial: Airtable's ~5 req/sec limit."

The existing defence was rate-limit only. `throttle.ts` spaces call _starts_ 220 ms
apart to stay under ~5 req/s per base — it is designed to let you spend calls as
fast as Airtable permits, and **nothing anywhere guarded total monthly volume**. The
dashboard hit Airtable live on every request with no cache, across seven Netlify
functions.

The headline also carried a claim buried in a subordinate clause: _"every form
submission on the fleet is returning 502 and losing the lead."_ Tucker did not let
it stay buried. Thirteen hours later, at 15:58: **"wait, lead loss? are emails not
getting to clients? and A for sure"** — and that single question is what turned a
cost-optimisation exercise into an incident. The honest version of the answer only
arrived six days later in #553's commit body: `ingestSubmission` awaited
`getWebsiteBySlug` — an Airtable read — _before anything was persisted_, so a thrown
lookup 502'd the visitor with the lead recorded nowhere, **while the submissions
store (Turso) was healthy the whole time**. That is why the outage's lead loss was
unmeasurable after the fact: there was no place the lost leads could have been
counted.

What it cost: Tucker paid for Airtable mid-incident (_"i paid for airtable so you
can keep pinging the api as we transfer over, check that it works"_), the migration
was scoped, designed, planned and then explicitly deferred — _"let's save the full
turso migration for next weekend, can you pin it as an issue and a plan? I want to
save tokens for a game jam and we've time now that i paid for airtable"_ — and the
work journal got a design doc (`ec51338`) plus a phased plan. That deferral held: no
migration code landed until Sunday 08-23.

**Client-side.** At 16:20 UTC Tim posted in `#beachfront-dentistry-website` that
Dr. Quan had tried the office website's portal and it wasn't working. Tucker:
_"i'm running a migration right now, that's really unlucky timing 🙈"_, then
_"should be set in an hour i'll let you know"_, then 45 minutes later a precise
window: **Confirmed affected Aug 16 11:35 PM → Aug 17 9:09 AM = 9.6 h; widest
possible Aug 16 11:03 AM → Aug 17 9:09 AM = 22.1 h** — posted first in UTC, then
re-posted in Pacific when he caught it. Tim's reply is the process finding:
_"For future reference, anytime a form is knowingly down for a client give me a
heads up so I can let them know before hand."_ Tucker: _"copy! ideally this doesn't
happen again, we just ran out of runway on airtable's free tier. will be more
proactive scheduling outages if we need them in future!"_

### 2. The operator's own test submission was filed as spam

Still Monday. Tucker, at 16:37: **"I just sent a test submission and don't see
anything in the cockpit or on my phone."** The obvious reading — the quota outage is
still eating leads — was wrong.

`add2820` names it: a site under construction is exactly where the operator tests
their own forms — one address, several unrelated sites, minutes apart — which is
**byte-for-byte the cross-site repeat-sender signature**. So an in-development site
auto-spammed its builder's own test submissions: row marked `spam_auto`, notify
skipped, hidden from the cockpit. Indistinguishable from a broken form. The fix
gates all four spam paths on `site.status !== "in development"` — content scoring,
required-Turnstile escalation, repeat-sender scan, duplicate/spray scan, including
their retro re-bucketing of _other_ sites' rows.

Two things about how it was proven are the point. The tests include **two control
cases on `maintenance` with identical inputs, so the suite discriminates rather than
merely passing**; and it was **verified by mutation — forcing the gate on fails
exactly the three in-development tests and neither control**. That is the house rule
applied without being asked for.

Tucker's reply carried a second, larger observation almost in passing: _"add as a
note we might want more semantic names for site states, these are holdovers from
when airtable was just a reference for current work and not loadbearing."_ A
vocabulary that was fine as a human note became a load-bearing classifier input
without anyone re-deciding it. (The fix was committed 08-17 and sat unmerged until
PR #551 on **08-23** — six days — because of the token-conservation freeze.)

### 3. Three instruments repaired before anyone trusted their verdicts

Monday's other three PRs are a set, and each one is the same species: a mechanism
that could not report the thing it appeared to be reporting.

**#540 — `fix(reports)`: fall back to the operator inbox, not the client inbox.**
With `OPERATOR_EMAIL` unset, the daily digest, the analytics-failure alert and
`selftest-email` all addressed `info@reddoorla.com`, the shared client-facing inbox.
The trigger: the scheduled daily-reports run failed before its digest step, the
digest was re-run by hand from a laptop where `OPERATOR_EMAIL` existed **only as an
Actions repo variable**, and the fleet digest landed in the client inbox. The commit
states the general lesson better than a rule could: _"a fallback that resolves to a
real address cannot fail loudly, it just picks the wrong audience."_ Four call sites
each spelled out their own default and one disagreed; they now share one definition.
Tucker found it himself — _"my daily email sent to info rather than tucker @
reddoorla"_, then _"fails should come back to tucker not info"_.

**#542 — Playwright's `reuseExistingServer` was `!process.env.CI`**, so a local run
reused whatever answered the readiness probe. The probe asks "does this URL
respond?", never "is this serving the code I am about to test?" It had already bitten
in both directions: a **false red** on beachfront on 2026-08-12, investigated as a
macOS-vs-Linux difference and written into a PR description before it was caught, and
a **false green** where a passing suite ran against an old build. The fix allocates a
free port per run. The implementation note is itself a fleet-wide trap worth keeping:
the port is allocated by a short _synchronous_ subprocess rather than an async config
export, because sites spread this base (`{ ...base, use: { ...base.use } }`) and
**spreading a Promise yields no properties** — which would hand every site a silently
empty config, the same false-green class being removed.

**#544 — the CSP had been silently dropping Svelte's SSR event-replay stub.** Svelte's
server renderer emits `onload/onerror="this.__e=event"` on any load/error element
carrying a spread attribute or a `use:` directive — i.e. every
`<img {...getImageProps(field)} />` the Prismic helpers produce. Hashes don't apply
to inline handlers without `'unsafe-hashes'`, so the browser refused to run it:
**12 `script-src-attr` violations on beachfront's `/` alone, ~40 across nine routes**,
on every page view. Two details show the instrument being proven: a test asserts
`'unsafe-inline'` never appears beside the hash (which would make the hash moot), and
**the hash is recomputed from the handler text in the test rather than copy-pasted,
so a wrong literal cannot be confirmed by an equally wrong literal**. Verified in
Chrome: `img.__e.type === "error"` now, nothing at all before.

### 4. "you have a bot for this" — a memory that was confidently wrong

Monday, 17:17. Tucker wanted a short Discord-register note for Tim about Sonder:
_"look at how we talk on discord, give me something shorter re:sonder specifically to
add."_ The session could not read Discord. Tucker, 17:19: **"you have a bot for this,
look in env and I thnak you built a script. add to claude.md"** — and when that still
didn't land, 17:31: **"keep searching for the discord bot or roll your own if that's
easier, you've been able to access it before."**

The cause was a stored belief, not a missing credential. An older memory asserted that
`DISCORD_BOT_KEY` in the repo `.env` was an OAuth2 _client secret_ and named a
`DISCORD_BOT_TOKEN` as the real token. No such variable exists in `.env`, the keychain
or the shell, so the search could only fail. Proven on this day and written into
`CLAUDE.md`: **`DISCORD_BOT_KEY` IS the bot token** — `GET /users/@me` returns 200 as
"Message Reader" (`1536468462141055086`), and the same value fails an OAuth2
`client_credentials` grant with `invalid_client`, which is what settles it. Two
further facts landed with it: the creds live in the **repo** `.env`, not
`~/.config/reddoor-maint/credentials.env` where every other credential lives, and
there is no MCP server — it is plain REST at `discord.com/api/v10`.

The workflow reading: **the operator had to insist twice against the agent's own
stored memory before the agent went and measured.** The memory was the suspect and
was not treated as one until told to be.

### 5. Five days inside somebody else's CRM

The largest single block of the week by operator turns (**127 unique prompts**,
36% of the week) is `reddoor-website`, and it is one continuous story: replacing a
GoHighLevel-hosted lead funnel with pages Reddoor owns. Two sessions carried it —
`28add6be` (08-17 18:04 → 08-18 01:54, 7.8 h) and `6dfb4191` (**08-18 16:14 →
08-20 21:50, 53.6 h wall, 269 operator turns, 3,503 tool calls, 8 interruptions,
6 compactions**).

It began with Tucker pasting a LeadConnector iframe embed and asking _"look at what
this embeds too and see if we can make a custom version to tag its endpoint,"_ then
_"look in discord, I want a two form flow for the 'get started' in med tech, using
these two embeds as templates."_ The first night was spent in a failure loop that the
transcript records honestly: _"still didn't work, screencap on desktop"_ … _"retested,
still didn't work, screencap on desktop"_ … _"all success messages from the page but
the console looks ominous"_ … and then the question that broke it open: **"have we
actually been hitting that endpoint? i thought everything failed."** The browser-side
POST was `no-cors`; success messages were local. When real responses finally appeared
they were `HTTP/2 429`, and Tucker's next instinct was to doubt his own evidence:
_"check if it's actually 429ing, it might be because i just did it."_

The next morning the scope changed under the work, and Tucker said so: **"alright,
scope is growing, I own this now not Tim. I gave you read access for everything in the
CRM, check discord for an overview, but I want to follow the templates that this
company gave us while always using our site and our design language … before you make
any decisions I want you to do a deep examination of the CRM and any documentation you
can find on their process."** He then refused a partial read: _"can you not read A-102-1
and A-102-2? I want you to have all context and explain their process to me so I and
you both understand what they want at a high level before we build anything."_

What that bought: a server-side integration on the official API (`871d5c4`), a booking
calendar and `/schedule` page, and by Tuesday evening a real appointment booked and a
real confirmation text received (_"scheduling worked, I just got a text"_).

**The corrections are the valuable part, because four of them are the same error.**

- `fix(slots): the default window was one day, not fourteen` — `/api/slots` with no
  `days` param asked the CRM for a single day. `Number(null)` is **0, not NaN**, so the
  `Number.isFinite(requested)` guard meant to detect "no param supplied" took the param
  branch, and `Math.max(…, 1)` turned the 0 into a perfectly plausible 1. Nothing
  errored. Visitor-facing effect: `/schedule` only ever offered today's remaining slots,
  and once the last one passed it told everyone "There's nothing open in the next couple
  of weeks." Confirmed on staging: `/api/slots` returned 1 day, `?days=14` returned 3.
  **The endpoint had no test at all, which is the actual gap** — eight were added.
- `fix(crm): detect the dropped phone instead of assuming we cannot` — the previous
  commit had asserted detection was impossible and written the number into a note as
  the only mitigation. Measured with two throwaway contacts: when an upsert's email
  matches one contact and its phone matches another, GHL keeps the email match and
  silently drops the phone — HTTP 200, no error, no warning. **The response reflects
  what was stored, not what was sent**, so an absent phone on a request that carried one
  is a real answer, not an echo. The "impossible" was an untested assumption.
- `docs(funnel): {{contact.name}} works — third correction of the same shape` — a probe
  SMS proved `{{contact.name}}` renders "Tucker Lemos" while `{{contact.full_name}}`
  (the field the doc had recommended in its place) is the fake one. The three chase
  emails had rendered empty because **those contacts had no name** — `tim@reddoorla.com`
  still has empty first and last names. This was the **third instance in two days** of
  reading an empty render as a missing field when the record behind it was empty; the
  others were `{{appointment.id}}` (conclusion formally withdrawn in `d95a1a0`) and the
  Z-004 workflows. The rule the commit records is the transferable one: _an empty render
  is only evidence about the field when something else proves the source had a value._
- `docs(funnel): all 55 snippets scanned — nine to edit, not two` — the templates list
  requires `originId` **empty**; passing the locationId filters the result to zero,
  which is what made the store look empty and sent an earlier search to the wrong part
  of the UI. `?originId=&limit=500` returns all 55. Nine carried links that had to move;
  a two-template fix would have missed the whole no-show sequence. One was deliberately
  excluded because a blind replace would break a working message.

**Where Tucker had to intervene.** Three moments, all cheap and all load-bearing:

- He caught a proposed blanket replacement before it ran: _"⚠️ Don't blanket-change
  `{{custom_values.sub_domain_url}}`. It's `https://go.reddoorla.com`, and
  `resubscribe_for_emails_page` and `email_unsubscribe_confirmation` genuinely live
  there with no equivalent on our side. Change the trigger link's `redirectTo`, not the
  host."_
- He killed a re-litigated question: **"the calendar is fine, we've talked about this
  three times."** The session had raised the calendar-link question on three separate
  occasions; it was closed for good in `ddccf16`.
- He corrected the QA artifact's framing: **"you're over indexing on things we've run
  into this session, I want them to notice new things that are broken, so just walk them
  through the whole process and what they should check."** The artifact was shared into
  `#rd-clients-by-design` at 23:51 for Tim and Erik to walk.

And one moment where he chose a different model for a different question. On Friday
00:53, asking whether the CRM vendor could be selling the contact list: **"switching to
fable, this is important and I want to feel safe they aren't doing this."** Then:
_"show me the link to that promise please"_, and finally _"great i am assured, thank
you, I'm pretty much always happy with verified trust rather than zero trust."_

### 6. Release day: 25,026 lines over a red check, and three tests that asserted their environment

Thursday 08-20, 17:12 UTC: _"ok, we've approval to merge staging into the main site,
can you do that?"_ PR #133 — `Release: medtech industry landing page + inquiry funnel`,
**+25,026 / −650 across 155 files, 0 reviews, 2 comments** — opened 17:15 and merged
**17:43**, 28 minutes later. In between, the Monitor task reported `ci / ci: fail ALL
CHECKS SETTLED` at 17:25. The 18 minutes between the red and the merge were spent
running the failing specs in isolation, running them serially, and running one under a
pinned UTC clock; `299055b` (`test(inquiry): pin the timezone, so the slot label
asserts a conversion`) is the fix that came out of it.

PR #135's commit body is the honest write-up, and it generalises three failures into one
shape: _"all three were the same shape — tests asserting their environment rather than
their behaviour — and each was hidden structurally rather than by luck: a
timezone-dependent smoke assertion that had never run in CI, a date-dependent test in
reddoor-maintenance exposed by that repo's first CI run in three days, and two `main`
landmarks published on every navigation that had been filed two days earlier as a test
annoyance."_

That third one is worth its own paragraph, because it is a **real accessibility defect
that a full a11y suite could not see**. The layout kept `<main id="main-content">`
inside `{#key data.pathname}`, so it was rebuilt on every navigation; `out:fade` runs
500 ms while `in:fade` waits 700 ms, so **two `main` landmarks and two
`id="main-content"` existed for about half a second on every link click**. It survived
the suite because axe reports `landmark-one-main` and `landmark-unique` only under
`best-practice`, `duplicate-id` is `deprecated`, and `duplicate-id-aria` needs an
ARIA-referenced id — while the specs filter to `wcag2a/2aa/21a/21aa`. And the fix
found a second-order instrument bug: **six guards in five specs polled `main` opacity
to wait out the fade; with `main` no longer fading, every one of them would have
returned 1 immediately and waited for nothing** — quietly removing the protection they
exist to provide and letting axe scan mid-fade. They now poll the element that
actually moves.

The companion audit (`15430f5`) found four more defects _"none of which has ever
failed CI and none of which will"_: five `<h1>` on the home page (fragments of the
animated hero), none at all on `/about`, no `<nav>` landmark anywhere, and `<footer>`
nested inside `<main>` so the site exposes no `contentinfo`. One cause, not four bugs
— the axe tag filter — plus a deeper one: heading level is coupled to visual size
through global element selectors, so **the tag gets chosen for its type scale and the
document's semantics fall out of a design decision**. Written up rather than fixed,
explicitly because release day is the wrong time to turn the axe filter red.

Two more things landed the same day. Tucker asked for a fleet-level rule —
_"every site should have this shape and branch protection should force us to push
everything into staging and then staging onto main, rather than letting branches go
directly into production"_ (filed on 08-17 for "next week"), and then on 08-20,
_"can we set ci to also run on staging? this is a fleet problem"_ — which produced
`ci: run on pushes to staging` in **22 checkouts**. And `b259a10`'s flake fix carries
an unusually honest limitation: Playwright's readiness probe only requested
`/dev/a11y-fixtures`, so the first visit to every other route happened inside a test,
several cold routes at once under `fullyParallel`. #105 had treated this with headroom
(30 s poll, 60 s timeout) and made it rarer without removing it — #133 still lost three
portfolio-search and two schedule tests to the same signature. The new fix requests
each route once, sequentially, before workers start, and says plainly: _"this targets a
verified mechanism … but it is an improvement, not a proven fix. Local measurement here
is not trustworthy … CI is the controlled environment; watch the flaky count there."_

Small but expensive-later footnote: #135 also added `.worktrees` to `.prettierignore`
because prettier walked nested worktree checkouts and `pnpm lint` failed locally on a
generated file CI never sees — _"A false red is worse than no check — it teaches people
to skip the output."_ **The identical problem hit `reddoor-maintenance` nineteen days
later (2026-09-08, 1,771 ESLint errors, all from `.worktrees/`).** The fix was known
here and not carried across.

### 7. Broken: a review harness that killed its own findings, and three checks that could not fail

`Broken` is the Godot prototype Tucker had scoped as _"the play prototype that we want
to finish in a game jam amount of time (two days of work)"_. It ran Tuesday through
Thursday: **107 commits, 594 operator turns and 12,144 tool calls in one session
(`5fe60bbc`, 08-18 18:02 → 08-21 00:53, 54.9 h wall, 28 interruptions, 5 compactions)**.

The mechanical work is well documented in its own journal, and three findings are worth
carrying out of it:

- `50806bd` — **`const TUNING` was compile-time-folding every knob read**, so the live
  tuning panel Tucker had asked for ("add tuning knobs so I can adjust feel") appeared
  to work and changed nothing. The fix was propagated into unbuilt tasks the same hour
  (`e62cdc2`), which is the right response to discovering a class rather than an
  instance.
- `6ee9c9a` — _"measure mass properties instead of trusting Godot's auto inertia"_, and
  `78f5c17` — _"the measured clearance overturns the paper figure."_ Two cases of a
  spec number losing to a measurement.
- `c0b9f60` — **`head_density: built to test the heavy head, measured the opposite.`**
  Tucker had proposed biasing weight toward the head (_"can we bias weight towards the
  head to increase this effect? added benefit is it makes our brain/eye feel more
  important"_); the knob built to confirm it disconfirmed it. That commit subject is the
  cleanest "belief corrected on contact" of the week.

**But the instrument story is the one that matters.** Three separate false greens in
about six hours on Wednesday:

1. **`0fa9651` — `run.sh: stop reporting suites that never ran as green.`** Godot exits
   0 when a `--script` file fails to parse, and `run.sh`'s only pass/fail signal was
   that exit code. **Measured on a fresh clone: twelve suites executed zero of 293
   checks and the runner printed "12 suites, all green, 2s."** The cause was that
   `.godot/` — holding the script-class index and imported assets — is not in the repo,
   so nothing resolves a `class_name` on a clone. Three fixes, _each verified by
   injecting the fault_: a suite that prints no tally fails; the output is grepped for
   `Parse Error` / `Failed to load script` but deliberately **not** for `SCRIPT ERROR`
   (healthy suites emit those at teardown); and a per-suite timeout, because Godot does
   not always exit at all — a bad type in `anatomy.gd` left `anatomySmoke` spinning past
   three minutes. Also recorded: `--import`, **not** `--editor --quit-after N`, which is
   the obvious guess and writes the class index but quits before the asset scan.
2. **`a81c2da` — "Three checks that could not fail."** A whole-repo review, five lenses,
   found that `roomSmoke`'s "a cell in a hand is left alone" computed its number and
   then used it only in the pass message: deleting `WallSocket`'s `HELD_GROUP` scan skip
   let the wall reel a carried cell the whole **106 px** onto its face while the line
   printed PASS. Worse than cosmetic — `attach` then refuses the held face, `_install`
   re-fires every frame and pin-joints the wrench to the wall. **A soft lock, green
   across all 12 suites.** A second check ("the cell cannot get out past the columns")
   fired at 3000 px/s and read frame 180, at which speed the cell rebounds off the wall
   to x=1237 — so it **passed with the cell fence deleted entirely**; the fence only
   matters slowly (measured: −200 px/s rests at x=−130, inside the 79 px strip nothing
   can reach). The commit names the shared pattern: _"the measurement was taken and then
   not used."_
3. **`b63214e` — the review harness itself was the broken instrument.** Its first version
   required **both** refuters to pass a finding, so either could veto — and refuters are
   instructed to default to refuting. Result: **27 findings raised, 2 survived**. Tucker
   was shown the kills, and the hand-check found **4 of 25 kills were real**, including
   the check that stayed green with the entire cell fence deleted. Two rules went into
   the harness: _reality and impact are different questions_ ("nobody would notice" is
   not a reason to say a defect does not exist; impact is judged by its own agent and
   cannot reject anything), and _kills need agreement, survival does not_ (two
   independent reality lanes, either one standing it up keeps the finding;
   disagreements come back flagged `split`). The refuted list keeps its reasoning **so
   spot-checking a kill is cheap, which is how the flaw was found in the first place**.
4. **`d9ef156` — the re-run.** Same 27 findings through the corrected harness:
   **22 stood up where 2 did before, and the 5 now refuted are exactly the five already
   fixed by hand during the session — a clean control on the new verdicts.** Two of the
   recovered findings were player-facing and precisely measured: the aim readout traced
   the cell's **pre-kick** velocity, so the lit landing peg — the only aiming aid left
   after the sticks were cut — was always short by exactly the throw boost (with the bug
   reinstated, an 80% kick moves the predicted landing **0 px**, which is the check);
   and `socket_velocity` measured its arm from the body **origin** while Godot rotates
   about the **centre of mass, 21.5 px away** — making every handed velocity and every
   latch window wrong by |ω| × 21.5 px/s.

Tucker's role in this was one word at 04:50 on 08-20: **"fix the wrong gate, did you
ship the new changes for the controls and params ui?"** He had been shown the refuted
list, spotted that the gate was the problem rather than the findings, and said so.

He also cut scope decisively twice — _"no, you can remove it. precise throwing isn't
going to be a default ask of the player so let's just drop that feature"_ and
_"this part can be thin, its a prototype"_ — and shared the build publicly on Thursday
(`broken-cell-run.netlify.app`, posted to `#tangents` at 17:34). Tim: _"I think I have
to be smarter to play this 😂"_. Tucker: _"nah, just means I need to improve the UX
haha."_ On Friday he closed it out: _"pin that for next week please, if we haven't got
the physics set we can't start thinking about anything else … we're solidly out of the
jam period now and into making the baseline for the game."_ **A two-day scope became
four days plus a follow-on Sunday session — and the scope was renamed rather than the
estimate defended.**

### 8. "three years of commits???"

Thursday 21:58 UTC, in the middle of ratchet-mark art iteration, Tucker read a journal
line the agent had just written and replied with four words: **"three years of
commits???"**

The line claimed five rounds of shape work had been paid for by _"a misdiagnosis
nobody re-tested for three years of commits."_ The repository is weeks old. `96cf789`
corrects it: _"a misdiagnosis nobody re-tested for two days and 84 commits — which is
the whole life of the mark, since `446a525` is where the wedge replaced the arc on
2026-08-18."_

The underlying finding was real and worth the five rounds — **low-alpha purple averages
straight to grey**; a full-alpha stroke with the ramp in colour reads at play size
while the identical stroke with the ramp in alpha greys out at the tail, and
`ratchetShapes.gd` now holds the two side by side. The fabricated number was
decoration attached to a true finding, which is the dangerous kind: it makes the claim
_feel_ better evidenced than it is. One four-word operator turn cost less than a minute
and removed a false fact from a document whose entire value is being trustworthy about
history.

(Also measured in the same run, and kept: **stacking does not band** — forty stacked
`draw_arc` calls and one `draw_polyline_colors` are indistinguishable at this size.)

### 9. The jam: 63 PRs in about 30 hours, with three other people

Friday 10:00 local the real game jam started — theme _Body and Mind_, **three people on
their first jam, learning Godot while shipping**. Tucker immediately corrected the plan
he'd been handed: **"the jam started at 10AM are time today, so 48 hours is too generous
for the time we actually have,"** and set the target himself: _"saturday at midnight,
head will by physics object, 3 that is tonights target, fixed scene for camera, others
can merge pr or self merge if necessary … can we get the task list now?"_

The measured shape of it:

- **200 commits** total (175 non-merge in the corpus) — **68 on Friday, 132 on
  Saturday**. Authorship is _disputed between two sources and I have not resolved
  it_: the corpus's author field over non-merge commits reads **Tucker 92, Sean 33,
  Ben 32, smahre 18**, while the repo's own backfilled journal entry reads
  **Tucker 140, smahre 28, Sean 18, Ben 14** over all 200. The likely cause is
  squash-merge attribution (PR author vs. merging user, and `Sean`/`smahre` being
  the same person under two git identities), but that is an inference, not a
  measurement.
- **63 PRs opened, 62 merged, median time-to-merge 2.9 minutes** (min 6 s, max 11.9 h),
  **+16,491 / −2,437 across 720 changed files**.
- One session carried Tucker's side: `39434611`, **08-21 21:04 → 08-23 02:23 UTC,
  29.3 h, 308 operator turns, 2,715 tool calls, 3 interruptions, 5 compactions.**
- Last jam commit: **Sat 21:27 local** (`Add credits (#63)`). The **only PR that never
  merged is #62, "Touch controls: a drag stick that appears wherever the finger lands,"
  opened 5 minutes before the credits landed** — the mobile work ran past the buzzer.

Three things a downstream reader should take from it:

**A hard constraint produced better instincts than a soft one.** Tucker cut ceremony
explicitly when it stopped paying: **"ok this is too musch smoke testing, we need to
ship shit, is the buttonless intereaction and kiki situation all dealt with?"** He had
asked for smoke tests the night before (_"review the code we have, write and justify
smoke tests that you think you need"_) and cut them the next evening. Both calls look
right in context; the notable thing is that he made the second one out loud rather than
letting the suite quietly slow everything down.

**The overnight batch was the highest-leverage move of the jam.** At 05:48 Saturday he
wrote out a four-item autonomous brief — a forkable transition scene, a justified smoke
suite, an SFX/music trigger inventory ("ben and i are musicians"), and animation polish
on a separate branch — and framed the goal explicitly: _"getting us to a place tomorrow
where our foundation is solid and we're … focused on the jokes and content and
mechanical breaks in the scenes rather than getting the basic chassis into a useable
place."_ That produced PR #17 (**+2,687 / −157 across 60 files**) which was reviewed
first thing Saturday — _"do a deep review of all the branches, will they help us ship
faster / make the game better, do they work, and is the code in them easily parsable
and available for us to interact with"_ — and then merged.

**Human collaborators were the dominant source of merge friction, and Tucker handled it
manually every time.** _"alright, I think sean just added some stuff so make sure we
integrate well with that"_ … _"can we merge in seans files and then do it?"_ …
_"sean made some changes to that scene recently, do we merge cleanly?"_ …
_"yeah that's ok he's in the room with me, take a look at his changes and figure out how
we merge in cleanly to each others"_ … _"also i see sprite/button commits on my main they
should all be on the branch so I can pr them in"_. Not one of these was answered by
tooling; all of them were answered by asking.

The jam's own bugs are a good corrective to the idea that agent-written code is where
defects come from. `082b249`: **the intro sky was `#201c02`, which is the sprites' own
outline colour — so every silhouette vanished into the background.** `da25f4d`:
`bridge.png` draws its rope and deck line in `#988277`, the sky colour, so with the
deck rect removed those pixels were invisible and only the posts read. `49150e4`:
buttons invisible on main because **the atlas regions were still 16×16 after the sheet
was doubled to 96×32**. `c623c47`: smoke went red on main because
`head.set_solid()` toggled a collision shape inside a physics callback. And on Sunday
morning, from a web build: _"math problems get corrupted in web builds, is there a fix
for that?"_ — handed straight to Sean. These are art-pipeline and engine-lifecycle
bugs, found by playing.

One measurement worth keeping from the palette work, because it shows the standard the
team was actually holding: `8a13668` verified a scene's palette _"by counting every
pixel of a rendered frame: all scene geometry is exact palette entries; the only
off-palette pixels are antialiased text edges."_

### 10. Sunday evening: the nightly that failed four times while reporting success

Sunday 17:55 UTC: _"we pushed a couple of things to this week, what's up now?"_ Then,
after the answer: _"start with the timeout and time-travel wall, let me know when that's
done"_, and — the sentence that reopens the week's deferred work — **"great, do all these
in order, when you're done with the first set we can get going on airtable, no need to
conserve tokens this week."** One session (`9a25ef42`, 17:55 → next day 18:55) produced
seven merged PRs.

**#550 is the week's most important finding, and it is a textbook false green.**
`reddoor-website` and `beachfront-dentistry` **failed the nightly fleet smoke four nights
running while the workflow reported success and Airtable showed both green.** Three
independent mechanisms had to line up:

1. **The budget was 5m00s.** `reddoor-website`'s own `Smoke test` step takes **4m57s** on
   a 2-core runner with chromium installed and node_modules warm (run 32413378638). The
   fleet path is strictly heavier — `test:smoke` is `playwright install chromium &&
playwright test`, so the **browser install lands inside that budget, on a fresh
   clone**. Three seconds of headroom; the medtech release spent it. Both sites were
   killed at **5m03s / 5m04s — the wall, not their suites.** Now 15 minutes, ~3× the
   measured cost.
2. **The timeout rethrew into a catch-all** as `smoke: unexpected error — Error: spawn
timeout…`: nominally a fail, carrying no details. The Airtable writer keys on
   `details.checkedAt`, so it correctly preserved the prior verdict rather than write a
   false fail — **which is right, and is exactly why the row kept serving a stale green
   tick.** Timeouts are now `smoke: NOT MEASURED`.
3. **The workflow gate was structurally incapable of firing.** `fleet-smoke.yml` gated
   only on `FLEET_WRITE_SUMMARY`, which counts rows _written_, not rows _passing_ — and
   an unmeasured site still writes, because it writes nothing new. The CLI now emits
   `FLEET_SMOKE_UNMEASURED` on every sweep, **count=0 included**, and the workflow reds
   when N > 0 **or the line is absent**.

And then the fix proved its own instrument, which is the part to copy: _"The gate is
executed, not asserted: `tests/build/fleet-smoke-workflow.test.ts` extracts the step's
shell out of the YAML and runs it under `bash -e` against a stubbed CLI, **clean-sweep
case first, so the alarm is proven to pass before any failure it reports is believed.**
Every new test was mutation-checked."_

The rest of the evening, in order:

- **#549 (landed 08-20, reviewed here) — the weekly time-travel run.** A test that pins
  an absolute date fixture while production falls back to `new Date()` is green when
  written and red forever once wall time walks past the staleness window. **It had
  happened twice in the same file — 2026-08-16 (two tests) and 2026-08-19 (a third,
  twelve lines below the comment explaining the trap). The second held `main` red for
  three days** because nothing was pushed and `ci.yml` only runs on push/PR. The commit's
  verdict on documentation as a control: _"Careful prose next to the hazard demonstrably
  did not prevent the recurrence, so this is the mechanical version."_ The shim sets the
  clock at **module** level, not in `beforeAll` — **the first version used `beforeAll`,
  was silently reverted by test files' own hooks, and reported a confident green while
  running on the real clock.** A guard test asserts the shift actually landed via
  `vi.getRealSystemTime()`, because _"a probe that quietly fails to apply is worse than
  no probe, because it manufactures confidence exactly where you went looking for a
  problem."_ The adversarial review then found **four more**, including a gate mismatch
  where `REDDOOR_TIME_TRAVEL_DAYS=""` skipped the shim entirely, the guard's
  "dormant by default" branch passed, and the run went green on the real clock — **the
  hollow green the guard exists to prevent, delivered by the guard itself.**
- **#552** finished a `wip` commit that had sat since 08-17 marked _"UNTESTED — no test
  run, no changeset"_. `BUDGET_THIN` compared click→success-banner against
  `INGEST_TIMEOUT_MS`, but that budget only aborts the site→central fetch — so
  **vineyard-custom-homes warned at 16.9 s click→banner while its own function answered
  in 0.25 s warm / 2.0 s cold. Page-render time was being reported as abort risk.**
  The runner now stamps `postElapsedMs` and the check compares that; **no POST observed →
  no claim**, with no fallback to click→banner (which would reintroduce the over-warn
  exactly where attribution is least knowable), plus a guard so a pre-click analytics
  beacon leaves the timing unstamped instead of computing an epoch-sized "elapsed."
- **#553** — the dead-letter table that makes the 08-17 lead loss impossible to repeat
  unmeasured, with hard boundaries written down: a lookup that _resolves_ null is still
  unknown-site; a `testMode` probe still throws so form-e2e reds when ingest is degraded;
  a failing dead-letter write propagates because both stores being down makes the 502
  honest; **replay does not launder spam** (a stored `fail` verdict still escalates).
- **#554 / #555 / #556** — Turso Phase 1.1–1.5 plus a pre-Phase-2 guard rail. The writer
  map was derived from the **live** schema (metadata API, 113 columns) explicitly _"Not
  the Desktop CSVs, which are gone and were six days stale"_ — a nice small instance of
  choosing the authoritative source over the convenient one. Findings: the table split
  holds; **the ack/mute workflow has no code write path at all**, so the console must
  absorb it before Phase 5's freeze; **33 populated-but-unreferenced columns** go to a
  `sites.legacy` JSON; plaintext DNS/CMS credential cells never migrate, _tested by
  serialising the entire mapped output and asserting the secrets appear nowhere_.
  `db parity` diffs both stores **using the importer's own mapping functions**, and
  **its known-good pass — green immediately after an import — is the first test in the
  file.** #556's EXPLAIN-query-plan gate is proven in both directions: it found a real
  full-table scan on day one (`listSpamReasonsFiltered`'s facet tally), three mutations
  bite, and **a scenario that executed no SQL fails as vacuous instead of passing.**

### 11. The two side projects, and one cross-repo coupling bug

`scriptorium-setup` (a 2013 MacBook Pro reflashed as a Debian writing appliance) took
**33 commits and 17 operator turns**, starting from _"remind me how to update to the
latest version from the scriptorium?"_ and becoming _"could we bundle it in with the pull
command?"_ — boot-time repo sync with a syntax check and one-boot rollback — plus a
Mac-style accent keymap (_"mostly need accents (áéó) for poetry stress and some names but
might as well have them all since I steal from other languages sometimes"_). The friction
signal: at 15:31 on 08-19, **"are you spinning or hung?"** The session's own compaction
summary admits it: _"I had stalled without dispatching Task 5."_ An agent that stops
without saying so costs the operator a poll.

`caldea` (a novel) produced the week's neatest cross-repo defect. Moving outline prose
out of chapter files into `outline.md` **made the scriptorium's week word-count delta
read −7,754** — _"numbers are showing up as super negative on scriptorium after those
changes"_ — because the counter measures the repo, not the writing. The fix Tucker asked
for is worth recording as product judgement: a "reset the week" feature, then
_"make it so the week resets itself every seven days by default."_ He also corrected the
tracker's arithmetic: **"i think your per day words numbering is wrong, you're assuming 5
days not seven. my goal is just to show up every day, having a smaller number to hit is
helpful with that."** The agent had optimised for the number; he was optimising for the
habit.

---

## What this week says about the workflow

- **The operator is the last line of defence against confident wrong numbers, and he is
  good at it.** "three years of commits???", "wait, lead loss?", "have we actually been
  hitting that endpoint?", "check if it's actually 429ing", "i think your per day words
  numbering is wrong" — five interventions, each a few seconds, each catching something
  a reader downstream would have inherited as fact.
- **Three false greens and one false red in seven days, in four different systems**
  (a Godot test runner, a fleet CI gate, a review harness, a local lint). Every one was
  found by a human noticing an implausible result, not by a check. The repo's stated rule
  — prove the instrument on a known-good input before believing a verdict — was applied
  _after_ the fact each time, then written into the fix. The Sunday PRs are the first in
  this week where it was applied before: #550's gate test runs the clean-sweep case first,
  #556's parity test's first case is the known-good pass.
- **Deferral worked, and had a visible cost.** Token conservation for the jam was an
  explicit scheduling constraint stated three times. The Turso migration held (nothing
  landed until 08-23), but a tested spam fix sat unmerged for six days and a `wip` commit
  marked "UNTESTED" sat for six days in the same window.
- **The same defect class crossed repos and was not carried.** `.worktrees` lint noise
  was fixed in `reddoor-website` on 08-20 with the note _"a false red is worse than no
  check"_; it cost `reddoor-maintenance` 1,771 spurious errors on 09-08.
