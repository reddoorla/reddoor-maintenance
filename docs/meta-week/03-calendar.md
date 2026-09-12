# 03 — The calendar: 2026-07-30 → 2026-09-12, day by day

Forty-five days. 2,622 commits, 857 pull requests (763 merged), 3,437 CI runs,
and — where the record exists — 1,717 messages Tucker actually typed to an
agent. This chapter is the temporal spine of the retrospective: what happened on
each day, how the days group into weeks, and what shape the whole seven weeks
has when you stand back from it.

The other chapters explain _what_ was built and _why_ it broke. This one exists
to answer a narrower question that turns out to be the more useful one for a
reader deciding how the work should change: **when does this operator actually
work, on what, at what intensity, and what happens to him afterwards.**

---

## How to read the numbers, and what is missing

### The eleven-day hole, stated once and loudly

**Claude Code transcripts retain only back to 2026-08-10.** For
**2026-07-30 → 2026-08-09** there are **zero sessions and zero prompts** in the
corpus — `metrics.json.byDay` records `sessions: 0, prompts: 0, toolCalls: 0`
for every one of those days, and 2026-08-09 does not appear in `byDay` at all.

**A `0` in the prompts column for those eleven days means "not recorded". It
does not mean "no work".** Those same eleven days carry **416 commits** — 16% of
the window — including the single biggest commit day in the entire seven weeks
(Mon 2026-08-03, 173 commits across 25 repos) and a client site rebuilt
pixel-by-pixel and cut over to live DNS. Every narrative statement about weeks 1
and 2 in this chapter is **reconstructed from git, the PR record, Actions runs
and Discord**, and is labelled as such wherever it appears. The one mitigating
fact is that this operator's commit bodies run 20–60 lines of prose with
file:line citations and before/after measurements, so they are the closest
surviving substitute for a transcript — but they are his own account, not an
independent one.

The work journal does not fill the hole either: `docs/workJournal.md` opens on
2026-09-05 and its first entry explicitly disclaims everything above that line.

### One clock, one filter — and a filter that had to be fixed first

Two conventions make this table internally consistent, and neither is free:

**Everything below is bucketed by LOCAL day (PDT, UTC−7).** `commits.jsonl`
carries local timestamps; `prompts`, `prs` and `runs` carry UTC. Mixing them
shifts every evening's work into the next morning. Week 01's research file flags
this in the sharpest available way: read by UTC day, the PR record _invents a
busy Saturday 2026-08-01 that did not happen_ — 29 of those PRs were opened on
Friday evening. Where this chapter's per-day figures differ from a per-week
research file, the timezone basis is usually the reason, and the per-week file
usually used UTC.

**"Prompts" means messages Tucker typed**, after removing harness-injected text.
This matters more than any other number in the document, because there are three
defensible bases and they give three different answers:

| basis                                          | total for the window | what it counts                                                                               |
| ---------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| raw `prompts.jsonl`                            | 5,692                | every user-role row, including replays                                                       |
| `prompts-unique.jsonl` (dedup by message uuid) | 2,693                | each message once, but still including harness text                                          |
| **typed, this chapter**                        | **1,717**            | the above, minus `<task-notification>`, compaction preambles and auto-summariser scaffolding |

The raw figure is 3.3× the real one because every resumed or compacted session
replays its whole user history into a new transcript file. The package README
already caught that inflation and corrected it. **It did not catch the second
layer**, and neither did I on the first attempt — which is worth recording here,
because this repository's standing rule is that an instrument is the suspect
until it has passed on a known-good input.

My first filter dropped any message _starting with_ `<ide_opened_file>`. There
are 133 of those, and a good number of them are a wrapper followed by real typed
text. It silently deleted, among others, Tucker's 14:26 request on 2026-09-07
that an agent design a paper-folding jig — a day that consequently read as "1
typed prompt" when it has 2. The corrected filter strips wrappers and keeps the
remainder. **The test that it now works is that it reproduces week 07's
independently-published per-day counts exactly — 2 / 66 / 44 / 59 / 27 / 11** —
and lands within a few percent of weeks 03, 04 and 05 once their UTC bucketing
is undone. A counting rule that had only ever produced plausible-looking numbers
was not evidence; one that reproduces a known-good day-by-day series is.

### Where the research disagrees with itself

Three disagreements survive, and none of them should be resolved by picking a
favourite.

**1. The week 06 calendar column is on a different basis from every other
week's.** Its per-day "Prompts (Tucker's own)" figures total 859 — which is
exactly the count of _unique prompt records_ that the same file's own coverage
note reports, immediately before saying "of those, **~525 are Tucker's own typed
words**". My recount gives 550. So the published week 06 calendar overstates
operator turns by roughly 1.6×, and a reader comparing calendars across chapters
would conclude that week 06 drew 2.75× week 05's operator attention when the
comparable figure is 1.6×. The error is a labelling slip, not a fabrication —
but it is the exact shape of error this fleet keeps making: a number computed
correctly for one question, then reported as the answer to another.

**2. The package README's "Thursday, not Tuesday, is the busiest day for
operator input" does not survive the second filter.** On the typed + local-day
basis, **Wednesday is busiest at 78.4 typed prompts per day, Tuesday second at
71.0, and Thursday is fourth at 45.4.** Thursday only leads on the
unique-but-unstripped, UTC-bucketed basis, and it leads there by 2% (109.8 vs
Wednesday's 107.4) — inside the noise of the filter choice. The honest statement
is the one below in the rhythm section: **Tuesday and Wednesday are the heavy
days, Friday is unambiguously the lightest, and the Thu/Tue/Wed ordering is an
artifact of which filter you pick.**

**3. CI run data is missing for the central repo across weeks 1–5.**
`runs.jsonl` is capped at ~300 runs per repository, newest first, and
`reddoor-maintenance`'s 300 only reach back to **2026-09-04**;
`reddoor-website`'s to 2026-08-22. Every "CI fail" figure before those dates is
**site repos only**. A green-looking CI column in week 4 is not a finding — and
we know independently, from PR #550 landing on 2026-08-23, that the nightly
fleet smoke failed on two sites four nights running inside that same week while
reporting success. `gh-errors.txt` additionally records connection resets during
collection, losing `hedloc`'s runs entirely; a repo showing zero PRs may be a
collection gap rather than a direct push.

One further caveat carried forward from week 04: **the `interruptions` column in
`metrics.json` is attributed to the day a session _started_.** Three sessions
this window ran longer than two days, so "36 interruptions on 08-18" means "36
interruptions in a session that began on 08-18 and ended on 08-21". Interruption
counts are not included in the table below for that reason.

---

## The 45-day table

`Typed` = messages Tucker typed (— = not recorded, see above). `Commits` shows
total with human-authored in parentheses; the difference is
`reddoor-renovate[bot]`. `PRs` is opened / merged, local day. All days included,
including the empty ones.

| Date  | Day | Typed   | Commits (human) | PRs o/m   | Primary repos                                                              | What happened                                                                                                                                                                                                                                                                                                                                     |
| ----- | --- | ------- | --------------- | --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 07-30 | Thu | —       | 15 (15)         | 3/3       | claude-skills 12, reddoor-maintenance 3                                    | GA/Search-Console creds for the report cron (#469); a dashboard whose every control was dead from one build-consumed `\n` (#470); evening scaffolds the page-diff harness                                                                                                                                                                         |
| 07-31 | Fri | —       | 84 (84)         | 47/43     | reddoor-maintenance 27, gallerysonder 10, the-pointe-burbank 7             | The week's spine, 10:36→22:29: fleet-smoke fix exposes 9 of 11 sites failing behind a green nightly; header-image generator designed and shipped in one day (+3,474/−19, 27 files)                                                                                                                                                                |
| 08-01 | Sat | —       | 3 (2)           | 1/1       | gallerysonder, reddoor-maintenance, the-pointe                             | Effectively off. The day's real output — a by-hand protection sweep finding six uncovered repos and `.github` with none — left no commit; known only from the next day's commit bodies                                                                                                                                                            |
| 08-02 | Sun | —       | 36 (36)         | 69/25     | reddoor-maintenance 7, claude-skills 4, ulti-grid 3                        | a11y audit gains real-route scanning (it had only ever scanned two synthetic fixtures); ruleset self-healing + nightly protection alarm (+1,459/−0); Renovate becomes a GitHub App and opens 44 PRs                                                                                                                                               |
| 08-03 | Mon | —       | 173 (93)        | 67/81     | scriptorium-setup 33, the-pointe-burbank 19, reddoor-maintenance 14        | **Biggest commit day of the window.** The Renovate batch fought back six times in the org preset; two bad cookie-override merges corrected 14 minutes later; a new repo born at 10:34 and at 33 commits by 22:04                                                                                                                                  |
| 08-04 | Tue | —       | 26 (26)         | 4/4       | scriptorium-setup 12, beachfront-dentistry 10                              | Beachfront takes over. PR #17 opens and stays open 68 hours. In Discord: "yeah I would wait, should cutover from webflow on thursday"                                                                                                                                                                                                             |
| 08-05 | Wed | —       | 46 (46)         | 0/0       | beachfront-dentistry 44                                                    | 44 commits on one branch, 01:19→22:41. Four drifted matching rules become four programs that exit non-zero. Style census 192 → 124 → 100 → 57 → 48 → 0 mismatches. 42 of 73 CI runs red, all that branch                                                                                                                                          |
| 08-06 | Thu | —       | 14 (14)         | 0/0       | beachfront-dentistry 13                                                    | The Prismic Migration API drops five slice-model fields silently at HTTP 200 — up to 43% render divergence, a 168px-short CTA band on four routes. A leaked Maps key cleared from the newly-tracked `matching/`                                                                                                                                   |
| 08-07 | Fri | —       | 15 (15)         | 4/2       | beachfront-dentistry 15                                                    | PR #17 merges 09:29; a 44-item verified backlog worked through (landscape lockout on every phone, four nav pages with no h1, 4.8MB hero video preloading against its own LCP, 5 of 18 cross-links 404). DNS switched 17:49. Zero CI failures                                                                                                      |
| 08-08 | Sat | —       | 4 (0)           | 0/3       | alamo-anatomy, espada, gallerysonder, revogen                              | Renovate only — four `@sveltejs/kit 2.70.2 [security]` bumps merged by the bot. No human commit                                                                                                                                                                                                                                                   |
| 08-09 | Sun | —       | 0 (0)           | 36/0      | —                                                                          | **The only fully idle day in 45.** Zero commits; Renovate opens 36 PRs across 18 repos; 62 scheduled runs, all green                                                                                                                                                                                                                              |
| 08-10 | Mon | 17      | 61 (55)         | 39/20     | beachfront-dentistry 28, hedloc 7, reddoor-maintenance 6                   | "good morning, pushed this to live on friday so we could cancel webflow" opens an 84.5-hour session. markup.io skill: question → merged spec in 94 minutes. A transcript-less fleet session retires the org RENOVATE PAT                                                                                                                          |
| 08-11 | Tue | 13      | 33 (18)         | 8/18      | beachfront-dentistry 12, reddoor-maintenance 3                             | Verification day: 20 repos take a commit but only 33 commits. Tucker rules the designer outranks the pixel reference. 22:29Z a Figma URL starts a 49.4-hour, 9-interruption session                                                                                                                                                               |
| 08-12 | Wed | 55      | 81 (54)         | 14/37     | beachfront-dentistry 35, reddoor-website 9, reddoor-maintenance 8          | **The fleet morning.** A false blast-radius story merged in 1 minute and corrected 51 minutes later; a GA-credential gate built on `report --preview`, which does no IO, so it could never pass. Origin of "prove the instrument"                                                                                                                 |
| 08-13 | Thu | 34      | 12 (10)         | 4/3       | beachfront-dentistry 7, reddoor-website 3                                  | Many chats, few commits — 34 typed turns across three parallel conversations. "what are you checking right now? I've said three times now we're not matching anymore"                                                                                                                                                                             |
| 08-14 | Fri | 15      | 11 (11)         | 3/3       | the-bench 5, a-budget 2, reddoor-maintenance 2                             | Fleet quiets. #526 headless Prismic model delivery (+24,211/−16 across 66 files) merges after two days of subagent-driven work in a worktree                                                                                                                                                                                                      |
| 08-15 | Sat | 14      | 14 (14)         | 0/0       | the-bench 11, Broken 2                                                     | One project, one session: the octagonal LED turn counter. Its OTA pre-flight is deleted for probing TCP against a UDP service — it "blocked every push, not just broken ones"                                                                                                                                                                     |
| 08-16 | Sun | 97      | 87 (84)         | 27/27     | the-bench 25, Broken 19, reddoor-website 12                                | Most fragmented day yet — 97 typed turns across five projects. "why do we have to wait until monday rather than bumping all the repos now?" becomes a 12-repo bump and a 7-repo CI rollout in 70 minutes                                                                                                                                          |
| 08-17 | Mon | 60      | 21 (17)         | 5/6       | reddoor-maintenance 9, reddoor-website 6                                   | **Airtable's free monthly cap exhausts under six daily crons**; every fleet form 502s. Client complaint at 16:20 UTC; measured outage 9.6h (widest possible 22.1h). Turso migration researched, designed, deferred, pinned as #539                                                                                                                |
| 08-18 | Tue | 78      | 84 (84)         | 0/0       | Broken 38, reddoor-website 27, scriptorium-setup 17                        | Heaviest tool day of the week (16,240 calls). The browser-side CRM embed is replaced by a server-side integration and a real appointment is booked and confirmed. `const TUNING` found compile-time-folding every live knob                                                                                                                       |
| 08-19 | Wed | 80      | 95 (95)         | 0/0       | Broken 54, reddoor-website 24, scriptorium-setup 16                        | A whole-repo adversarial review whose own harness was the defect: 27 findings raised, 2 survived, and 4 of the 25 kills were real on hand-check. The link switchover: 55 snippets scanned, nine to edit, not two                                                                                                                                  |
| 08-20 | Thu | 48      | 49 (49)         | 24/21     | Broken 15, reddoor-website 9, + 19 site repos ×1                           | Release day. #133 (+25,026/−650 across 155 files, 0 reviews) merged staging→main 28 minutes after opening, over a red `ci / ci` fixed in those 18 minutes. "three years of commits???"                                                                                                                                                            |
| 08-21 | Fri | 42      | 54 (54)         | 16/15     | dont-lose-your-head 53                                                     | The game jam starts 10:00 local; the repo is created at 14:02 and takes 53 commits from four committers by midnight. Broken parked: "we're solidly out of the jam period now"                                                                                                                                                                     |
| 08-22 | Sat | 53      | 123 (123)       | 47/46     | dont-lose-your-head 122                                                    | Jam peak — **median time-to-merge 2.9 minutes**. Smoke testing explicitly cut mid-day: "this is too musch smoke testing, we need to ship shit"                                                                                                                                                                                                    |
| 08-23 | Sun | 17      | 28 (28)         | 7/8       | reddoor-maintenance 14, Broken 13                                          | Evening review with the token freeze lifted produces seven PRs (#550–#556), including the finding that the nightly fleet smoke had failed on two sites four nights running while reporting success                                                                                                                                                |
| 08-24 | Mon | **129** | 179 (167)       | 28/27     | reddoor-maintenance 79, Broken 48, songbook 30                             | **Peak operator day.** #539 Phase 2 in nine PRs before lunch, Phase 3 in three more. At 21:33–21:34 UTC one account-level session limit stalls four concurrent sessions at once; each needs a hand-typed "continue"                                                                                                                               |
| 08-25 | Tue | 103     | **185** (183)   | 33/34     | reddoor-maintenance 70, songbook 61, Broken 34                             | **Heaviest commit day of the window.** The external AEO/SEO audit merges as #580 (+12,380/−43, 51 files); songbook goes spec → installed offline iPad PWA verified in airplane mode. "is there a reason we're using opus?" → #587 nine minutes later, partly reversed the same afternoon                                                          |
| 08-26 | Wed | 95      | 109 (105)       | 24/21     | reddoor-maintenance 49, Broken 31, reddoor-website 22                      | The evening review's brief (1 CRITICAL / 10 HIGH / 16 MEDIUM) worked top-to-bottom, #618–#636. 08:25 local: "have you been pushing to main or working through staging?" 19:54: "running out of credits this week"                                                                                                                                 |
| 08-27 | Thu | 5       | 15 (15)         | 0/0       | songbook-content 12, Broken 2                                              | Both remaining mega-sessions close within four minutes of each other on the same instruction: "next step should be clear for when I pick this up on monday." The rest of the day is 12 hand-typed lyric edits, no agent                                                                                                                           |
| 08-28 | Fri | 2       | 1 (1)           | 0/0       | caldea 1                                                                   | Stated day off — "I don't work on friday". One commit: the novel. Two prompts, both a word-count question                                                                                                                                                                                                                                         |
| 08-29 | Sat | 0       | 3 (3)           | 0/0       | songbook-content 2, caldea 1                                               | **The only day in the 34 transcript days with zero typed prompts.** Two lyric edits and a novel commit                                                                                                                                                                                                                                            |
| 08-30 | Sun | 1       | 1 (1)           | 16/0      | caldea 1                                                                   | One caldea commit, one prompt. Renovate opens 16 PRs staging Monday's batch                                                                                                                                                                                                                                                                       |
| 08-31 | Mon | 63      | 79 (45)         | 8/27      | Broken 27, reddoor-maintenance 11, + 24 repos                              | **The Turso flip.** Merges 17:45 local as `dadb073`/#643 with FLEET_PARITY sites=44 health=44 schedule=44 reports=17, mismatches=0 recorded immediately before. Tucker merged it himself; the agent was explicitly forbidden                                                                                                                      |
| 09-01 | Tue | 95      | 106 (104)       | **79**/56 | beachfront-dentistry 21, vida-legacy-foundation 18, reddoor-maintenance 12 | Heaviest PR-opening day. The starter track split lands 08:58 (+1,453/−29,941 across 242 files); the Blux forward-merge instruction is dry-run tested and found to stage 178 clean deletions with only README conflicting                                                                                                                          |
| 09-02 | Wed | 118     | 114 (89)        | 38/55     | vida-legacy-foundation 34, reddoor-website 22, beachfront-dentistry 13     | The widest genuinely-parallel day — 25 repos, zero duplicated SHAs. #669 removes an Airtable env gate sitting in front of the lead dead-letter that a scheduled deletion would have armed                                                                                                                                                         |
| 09-03 | Thu | 81      | 85 (81)         | 28/29     | reddoor-maintenance 23, vida-legacy-foundation 23, Broken 17               | Repo count collapses 25→9. One client ask becomes fleet plumbing: CMS-authored auto-replies with calendar invites, #681 (+2,772/−4) plus three more PRs and four releases in one evening                                                                                                                                                          |
| 09-04 | Fri | 58      | 55 (55)         | 11/13     | Broken 18, the-bench 11, reddoor-maintenance 6                             | Quietest day, densest instrument work. Four Turnstile PRs in under nine hours, two of them corrections of the previous, ending at "nothing automated observes a production Turnstile widget on its production hostname". "computer crashed because I also opened steam, resume" — sent into four sessions in 39 seconds                           |
| 09-05 | Sat | 88      | **177** (177)   | 41/41     | welcome-to-the-flower-court 41, Broken 12, + 38 repos                      | **40 repos in one day.** The work-journal sweep touches 38 (35 merge, 4 strand, 2 red on prettier-checked markdown); CLAUDE.md returns to version control (#699); `fleet-repos.sh` lands (#701) after the archived-repo wall is hit for the third recorded time                                                                                   |
| 09-06 | Sun | 47      | 38 (38)         | 1/1       | welcome-to-the-flower-court 32, Broken 3                                   | Physical production: twelve sigils as papercut data, cells-minus-bridges as polygons with the stencil rule as a test, Cricut-sized cut files, twelve guest emails (ten delivered, one bounce, one resend)                                                                                                                                         |
| 09-07 | Mon | 2       | 39 (2)          | 0/0       | reddoor-maintenance 9, erp-industrial 6, data-dynamiq 4                    | **Effectively a day off with 39 commits** — 37 of them Renovate's Monday batch across 8 repos. Zero PRs opened, zero merged, zero CI failures. The only human work is two prompts on a paper-craft project                                                                                                                                        |
| 09-08 | Tue | 66      | 82 (80)         | **54**/22 | reddoor-website 26, claude-skills 16, Broken 15                            | Biggest and widest day of the week, 09:30→23:58. The check battery lands (#703, +12,413/−32); `claude-skills` is created and seven skills imported on `main` without a PR to preserve subtree history; 29-navy bootstrapped overnight                                                                                                             |
| 09-09 | Wed | 44      | 66 (61)         | 26/25     | reddoor-website 23, 29-navy 12, beachfront-dentistry 11                    | The match-harness recipe ships (#733, +5,058/−1, 18 files, 26 tests, 0 reviews, merged 4h24m after opening) — and eight journal entries follow, five of them about defects in code merged the same day                                                                                                                                            |
| 09-10 | Thu | 59      | 70 (64)         | 22/28     | 29-navy 25, reddoor-website 13, songbook 11                                | Fix-and-prove. Three match-harness defects fixed upstream; 29 Navy's home page goes SCORE 4/20 → 16/20; one blank page traced to three unrelated causes from one prompt; the override store ships with four instances of one bug. 22:08: "how far can you get without me, going to bed soon"                                                      |
| 09-11 | Fri | 27      | 38 (34)         | 19/16     | 29-navy 14, reddoor-maintenance 6, reddoor-website 6                       | Edit mode proven against production after a first proof run that measured an unrendered key; three self-inflicted lying instruments (an 18-minute vitest deadlock caused by piping the run into `head -3`, a 40-second EACCES false red, a stray probe failing prettier); a journal entry that invented two defects, corrected the same afternoon |
| 09-12 | Sat | 11      | 11 (7)          | 2/1       | 29-navy 5, vida-legacy-foundation 4                                        | A short morning, 09:33 → 11:01. Five pre-show items closed from one prompt; at 10:53, the request that produced this retrospective                                                                                                                                                                                                                |

---

## Week by week

### Week 1 — Thu 2026-07-30 → Sun 2026-08-02 · 138 commits · 120 PRs opened, 72 merged · 25 repos · prompts NOT RECORDED

_Reconstruction from git, PRs, runs and Discord. No transcripts exist._

> A four-day sprint that shipped the report header-image generator and re-armed
> the fleet's whole governance layer — and in the process found seven separate
> instruments that had been returning green on questions they could not fail.

Four days, 138 commits, and not one of them by Renovate: the first
`reddoor-renovate[bot]` commit in the corpus lands on 2026-08-03, which is
precisely what Sunday's work was for.

**Friday 07-31 is the week, and it is one day.** Eighty-four commits across 22
repositories between 10:36 and 22:29. The morning's fleet-smoke fix uncovered
that **9 of 11 sites had been failing behind a green nightly** — the first
instance in this window of the failure mode that goes on to define the whole
seven weeks. The midday block designed, planned and shipped the report
header-image generator inside a single working day: +3,474/−19 across 27 files.
The evening fanned one-line CI and Renovate changes to 15 site repos.

**Saturday 08-01 is the most instructive day of the week precisely because it is
nearly empty.** Three commits, one of them Renovate's, one of them Friday
night's PR merging at 08:09. The day's actual output — a branch-protection sweep
applied _by hand_, which found six uncovered repos, one with no protection at
all, and `.github` sitting with zero protection — **left no repository trace at
all**. It is known only because two commit bodies written the next day mention
it. A calendar built from commits would score this day as a rest day. It was
not.

**Sunday 08-02** is the governance day: the a11y audit gains the ability to scan
real routes (it had only ever scanned two synthetic fixtures — a check that
could not fail on a real site), ruleset self-healing and a nightly org-wide
protection alarm land at +1,459/−0 and are widened five hours later, Renovate
migrates to a GitHub App and fans out to 19 repos, and the `ci.yml` sync
template is deleted as an armed clobber. By nightfall the new twice-daily
cadence had already redded 8 CI runs across 7 repos.

### Week 2 — Mon 2026-08-03 → Sun 2026-08-09 · 278 commits (84 bot) · 111 PRs opened, 90 merged · 25 repos · prompts NOT RECORDED

_Reconstruction. Commit bodies this week run 20–60 lines with file:line
citations; they are the primary source. One quasi-quote of Tucker survives
outside Discord — "are you using the skill or winging it?" — preserved inside a
commit body, i.e. the agent's report of what was asked, not a recording._

> A Webflow client site rebuilt pixel-by-pixel against its own live stylesheet
> and cut over to a hard $40 billing deadline, while the Monday dependency batch
> had to be held back by hand six times.

The week has a clean shape: one enormous Monday, then five days that narrow to a
single repository.

**Monday 08-03** is the biggest day in the corpus — 166 unique commits (173
rows) across 25 repos, 07:37 to 22:04. Roughly 30% of the week's commit volume
is the bot merging its own dependency PRs in-run, almost all of it today. Six
preset changes in the org `.github` repo between 07:37 and 10:52 to hold the
batch back; two bad cookie-override merges corrected 14 minutes later; a
four-site vite-8 migration wave run by hand. In the background a brand-new repo
went from an empty design spec at 10:34 to 33 commits by 22:04.

**Tuesday through Friday is one branch.** Beachfront Dentistry's PR #17 opens
Tuesday 20:25 UTC and stays open 68 hours. Wednesday is the deepest single day
of work in the whole seven weeks: 44 commits between 01:19 and 22:41, all on
that branch, all gate-measured, and containing the week's most important
self-correction — a CLAUDE.md turning four drifted matching-skill rules into
four programs that exit non-zero, written in answer to "are you using the skill
or winging it?", with a fifth rule added four hours later. The style census runs
**192 → 124 → 100 → 57 → 48 → 0** mismatches. Forty-two of the day's 73 CI runs
are red, every one on that branch.

**Thursday 08-06 is the week's most expensive discovery**: the Prismic Migration
API was silently dropping five slice-model fields _and_ `\n` inside
StructuredText, at HTTP 200 — costing up to 43% render divergence and a 168px-short
CTA band on four routes. Nothing failed. It returned success.

**Friday 08-07** merges #17 at 09:29 local and works a 44-item verified
improvements backlog: a landscape lockout on every phone, four nav pages with no
`h1`, 4.8MB of hero video preloading against its own LCP, zero structured data,
silently discarded booking failures, and 18 absolute cross-links of which 5 404 —
a launch blocker. One real WCAG AA failure was escalated to the operator with
measurements rather than suppressed. Last commit 17:39; DNS switched at 17:49.
**Zero CI failures all day.**

**Then it stops.** Saturday 08-08 has four commits, all Renovate's. Sunday 08-09
has none at all — the only day in 45 with no commit rows anywhere. The fleet
kept working: 36 Renovate PRs opened across 18 repos, 62 scheduled runs, all
green.

### Week 3 — Mon 2026-08-10 → Sun 2026-08-16 · 299 commits · 95 PRs opened, 108 merged · 28 repos · 245 typed prompts

> The week the fleet's instruments were caught lying: three wrong diagnoses in
> one Wednesday morning produced the repo's top standing rule, and the same
> failure shape — a check that could never pass — turned up five times in five
> unrelated stacks.

This is the first week with transcripts, and **the gap sits exactly on the
week's headline episode**. The 2026-08-12 fleet session is absent: its
`originSessionId` (`b371bb1c-…`, named in that day's memory note) appears in
neither `sessions.jsonl` nor `prompts.jsonl`, and no transcript file exists on
disk. Between 07:08Z and 16:24Z the two sessions we _can_ see are silent — a
nine-hour hole. The incident that produced "prove the instrument before you
trust its verdict" is therefore reconstructed from PR bodies, commit messages
and a same-day memory note (all primary, all minute-stamped), and **no prompt of
Tucker's from it survives**.

Wednesday 08-12 is the heaviest day: 81 commits, 22 repos, 37 PRs merged. A
false blast-radius story was merged in one minute and corrected 51 minutes
later; a GA-credential gate that had been built on `report --preview` — a code
path that does no IO at all, so it could never pass however good the credentials
were — was repaired across three PRs in 2h21m. The credentials had been fine the
whole time.

The counter-rhythm is Thursday 08-13: **12 commits against 34 typed turns**
across three parallel conversations — the clearest instance in the window of
talking costing more than shipping. It is also the day of the sharpest
intervention: "what are you checking right now? I've said three times now we're
not matching anymore" — and the decommissioned harness the agent was still
running turned out to have been failing open on 23 of 33 stalled regions.

The weekend belongs to hardware and games, and reproduces the same defect in
C++: Saturday's OTA pre-flight is deleted because it probed TCP against a UDP
service and so "blocked every push, not just broken ones." Sunday 08-16 is the
most fragmented day so far — 97 typed turns across five projects at once — and
contains an operator question that turned into 70 minutes of fleet work: "why do
we have to wait until monday rather than bumping all the repos now?"

### Week 4 — Mon 2026-08-17 → Sun 2026-08-23 · 454 commits · 99 PRs opened, 96 merged · 26 repos · 378 typed prompts

> An Airtable free-tier quota ran out under six daily fleet crons and took a
> paying client's contact form down for ~9.6 hours; the week paid for it three
> ways at once, and closed on a Sunday evening discovering the nightly fleet
> smoke had failed on two sites four nights running while reporting success.

Commit volume steps up hard this week — 64.9/day against week 3's 42.7 — and
almost none of it is bot: 450 of 454 commits are human-authored.

**Monday's outage is the week's organising fact.** The free monthly cap
exhausted under six daily crons, every fleet form returned 502, and leads landed
nowhere. Tim reported a live client complaint at 16:20 UTC; the outage window was
measured at 9.6 hours confirmed, 22.1 hours at its widest possible. The response
was deliberately conservative: the Turso migration was researched, designed, and
then **deferred and pinned as issue #539** rather than started, because the quota
had been raised and nothing was urgent.

**Wednesday 08-19 is the week's best instrument story.** A whole-repo adversarial
review raised 27 findings, of which 2 survived — and on hand-check, **4 of the 25
kills were real**. The review harness, not the code, was the defect. Three
false-instrument fixes landed in six hours that day.

**Thursday is release day and it is not pretty**: +25,026/−650 across 155 files
merged staging→main 28 minutes after opening with zero reviews, over a red
`ci / ci` that was investigated and fixed inside those 18 minutes.

**Friday and Saturday are a game jam**, and they change the shape of the record
completely: `dont-lose-your-head` is created at 14:02 Friday and takes 123
commits on Saturday with 47 PRs opened and 46 merged at a **median
time-to-merge of 2.9 minutes**. Smoke testing was explicitly cut mid-day — "this
is too musch smoke testing, we need to ship shit." It is also the only work in
45 days that another human reviewed (see the rhythm section).

**Sunday's evening review**, run with the token freeze lifted, produced seven
merged PRs and the week's most valuable finding: the nightly fleet smoke had
been failing on two sites for four consecutive nights while reporting success
(#550).

### Week 5 — Mon 2026-08-24 → Sun 2026-08-30 · 493 commits · 101 PRs opened, 82 merged · 14 repos · 335 typed prompts

> The migration's whole middle shipped in a single 29-hour session on 36
> operator turns while three other long-lived sessions ran beside it on the same
> laptop — then the operator ran out of credits on Wednesday night and the week
> stopped dead.

This is the most extreme week in the window in both directions, and the two
directions are three days apart.

**Mon–Wed: 473 commits, 327 typed prompts, 82 PRs merged.** That is **18.0% of
all commits in the 45-day window inside three days**, and 19.0% of all typed
operator input inside three of the 34 recorded days. Monday alone: 179 commits,
129 typed turns, #539 Phase 2 in nine PRs before lunch and Phase 3 in three
more. Tuesday is the heaviest commit day of the entire window (185) and includes
a brand-new external audit tool merging at +12,380/−43 across 51 files. Note
what _fell off_ during this stretch: the whole week touches only **14 distinct
repositories**, the narrowest of any full week — the fleet sweep content for the
entire week is 18 Renovate commits arriving between 00:32 and 01:40 on Monday.

**Thu–Sun: 20 commits, 8 typed prompts, 0 PRs merged.** Thursday morning both
remaining mega-sessions closed within four minutes of each other on the same
instruction — "next step should be clear for when I pick this up on monday" —
and the work stopped. The stated cause is in the record twice: 08:25 Wednesday
brought a process correction ("have you been pushing to main or working through
staging?"), and 19:54 Wednesday brought "running out of credits this week."
Friday was a stated day off. Saturday 08-29 is the only day in the 34 recorded
days with **zero** typed prompts.

The tell that makes this a _capacity_ collapse rather than a rest is the novel:
`caldea` takes exactly one commit per day, unbroken, through every silent day.
**He did not stop working. He stopped running agents.**

### Week 6 — Mon 2026-08-31 → Sun 2026-09-06 · 654 commits · 206 PRs opened, 222 merged · 40 repos · 550 typed prompts

> The Turso flip went live inside two hours of the go-ahead and then spent the
> rest of the week being audited for what it had quietly broken — while three
> independent instruments were found green and blind in the same seven days.

**The biggest week in the window on every axis**: 93.4 commits/day, 78.6 typed
prompts/day, 222 PRs merged, 40 distinct repositories, and **seven days with no
day off**. The shortest working span is Friday's; Wednesday's runs 09:03 to
23:38 with a tail past midnight.

Monday's flip merged at 17:45 local as `dadb073`/#643, with FLEET_PARITY
recorded immediately before it at sites=44, health=44, schedule=44, reports=17,
**mismatches=0**. Tucker merged it himself; the agent was explicitly forbidden
from doing so. This is the single clearest instance in the window of the
operator reserving an irreversible action for himself, and it is worth noting
that it is _also_ the week's most heavily instrumented change.

**Saturday 09-05 is the widest day in the whole retrospective: 177 commits
across 40 repositories.** The work-journal convention was swept into 38 repos
(35 merged a PR; 4 stranded on `chore/work-journal` branches, three of them the
known un-pushable set; 2 went red on prettier-checked markdown). CLAUDE.md came
back into version control, reversing a standing exclusion. And `fleet-repos.sh`
landed _because the sweep hit the archived-repo wall for the third recorded
time_ — a cost paid three times before it was paid once properly.

Friday 09-04 is the inverse and the more interesting day: the **quietest** day
of the week by commits (55) and **zero CI failures**, and simultaneously the
densest instrument work — four Turnstile PRs in under nine hours, two of them
corrections of the previous one, ending at the honest statement "nothing
automated observes a production Turnstile widget on its production hostname."
The same day a game telemetry recorder was found to have been arming on a null,
and a Netlify Forms transport that had lost four tapes while answering 200 was
replaced.

The weekend is not a weekend: Saturday and Sunday together carry 215 commits, of
which 73 are a personal paper-craft invitation project taken from one ask to a
live site in two hours, then rebuilt as a paged form and shipped again the same
day.

### Week 7 — Mon 2026-09-07 → Sat 2026-09-12 · 306 commits · 123 PRs opened, 92 merged · 15 repos · 209 typed prompts

_Six days, and truncated: the window ends Saturday at 11:01._

> A recipe packaging "match a reference page" as an installable gate shipped and
> was then found to be lying in four separate ways — every one discovered by
> USING it on a real client rebuild, none by three rounds of adversarial review.

**Monday 09-07 is the cleanest picture in the corpus of what the system does
without its operator**: 39 commits, 37 of them Renovate's Monday batch landing
pnpm v12, vitest v5, `@changesets/cli` v3, `google-auth-library` v11, resend v6,
listr2 v11, slice-machine-ui v2, `@prismicio/svelte` v2 and lockfile maintenance
across 8 repos. Zero PRs opened, zero merged, zero CI failures, two typed
prompts, both on a personal paper-craft project. The fleet updated itself and
nobody was home.

Tuesday is the widest working day of the week — 66 typed prompts across 7 repos
in 14h28m, with four workstreams starting at once. Wednesday ships the
match-harness recipe (merged 4h24m after opening, 26 tests, **0 reviews**) and
then writes eight journal entries, five of which are about defects in code
merged the same day. Thursday fixes them and proves the fixes on a live client
rebuild, taking 29 Navy's home page from SCORE 4/20 to 16/20.

Friday 09-11 has the week's sharpest correction and it is not technical: Tucker
noticed an agent had rebuilt a component already sitting in the repo, **for the
second time in one day**, and the fix that came out of it — a components
inventory, a prompt hook, and a starter change — shipped fleet-wide. Friday also
carries three self-inflicted lying instruments in one day: an 18-minute vitest
deadlock caused by `| head -3`, a 40-second EACCES false red, and a stray probe
failing prettier.

---

## The rhythm

### Which weekdays are heavy, and the honest caveat on that claim

Over the 34 days with transcripts, on the typed + local-day basis:

| weekday       | typed prompts/day | commits/day | PRs merged (total) |
| ------------- | ----------------- | ----------- | ------------------ |
| Monday        | 54.2              | 75.8        | 80                 |
| Tuesday       | 71.0              | 98.0        | 130                |
| **Wednesday** | **78.4**          | 93.0        | 138                |
| Thursday      | 45.4              | 46.2        | 81                 |
| Friday        | 28.8              | 31.8        | 47                 |
| Saturday      | 33.2              | 65.6        | 88                 |
| Sunday        | 40.5              | 38.5        | 36                 |

**Tuesday and Wednesday carry the week.** They are 2 of 7 days and take 43% of
all typed operator input and 43% of all commits in the transcript window. Monday
is a _machine_-heavy, operator-light day — it is when Renovate's batch lands, so
commits arrive without attention. Thursday drops sharply; Friday is the floor.

The caveat stated earlier applies here and is not cosmetic: the package README
reports **Thursday** as the busiest day for operator input. That ranking comes
from the unique-but-unstripped, UTC-bucketed basis, where Thursday leads
Wednesday by 2%. Strip harness text and bucket locally and Thursday falls to
fourth. **Both numbers are computed correctly; they answer different
questions.** The stable findings across all three bases are that Tue/Wed are
heavy and Friday is the lightest working day — everything finer than that is
filter-dependent.

Friday's floor is partly a stated policy — "I don't work on friday" (2026-08-28)
— and partly not: Fri 09-04 drew 58 typed prompts and Fri 08-21 drew 42. **The
Friday rule holds in aggregate and breaks whenever there is a deadline.**

### Weekends are not rest; they are a project switch

Saturday is the **third-heaviest commit day of the week** (65.6/day), ahead of
Thursday and Friday, and two of the five biggest days in the entire window are
Saturdays: 09-05 (177 commits, 40 repos) and 08-22 (123 commits, the jam).
Sunday carries more typed prompts per day (40.5) than Thursday (45.4 — close)
and far more than Friday.

What changes on a weekend is not the volume but the _target_. **Nine of the 45
days had human commits exclusively to personal repositories** — 08-15, 08-21,
08-22, 08-27, 08-28, 08-29, 08-30, 09-06 and 09-07 — and seven of those nine are
Fri/Sat/Sun. The pattern across the window is consistent: client and fleet work
runs Mon–Thu, and Fri–Sun the same intensity is pointed at a game, a novel, a
songbook PWA, an LED table, a writing appliance, or a papercut invitation. The
research puts the personal share at roughly 33–39% of commits and prompts
depending on the week and the basis.

### The only two days off in 45 — and they are consecutive

**Sat 2026-08-08 and Sun 2026-08-09 are the only days in the window with zero
human-authored commits**, and 08-09 is the only day with no commit rows at all.
They fall immediately after the Beachfront launch (DNS switched Friday 17:49) —
i.e. the one real break in seven weeks was taken directly after a client
cutover, not on a schedule.

From **2026-08-10 to 2026-09-12 there is an unbroken 34-day run with at least
one human commit every single day**. On three of those 34 days (08-28, 08-30,
and effectively 08-29) the only human commit was the novel — which is the honest
qualifier, and also the point: even the collapse week did not produce a zero.

### Sustained runs, and how long a session actually is

The sessions do not respect days at all. Week 3 alone had four sessions running
longer than 40 hours of wall clock (84.5h on beachfront-dentistry, 50.2h and
42.5h on maintenance worktrees, 46.7h on the LED table); week 7 was carried by
two megasessions of 72.9h and 88.2h. The 84.5-hour session took 431 turns, 3,956
tool calls and was compacted and re-primed roughly five times.

Within a day, the typed-prompt span is wide and back-loaded. Of the 33 days
carrying any typed prompt, the first lands between 08:00 and 10:30 on 19 of them
— and on **23 of those 33 days the last typed prompt is at 20:00 or later**.
The hour histogram peaks at 10:00–12:00 local, holds a broad afternoon plateau,
and tails to 23:00; 01:00 to 06:00 is essentially empty. **The longest
operator-attended days in the window are 08-24 (09:05 → 23:59) and 09-02
(09:03 → 23:38)** — both approximately 15 hours of elapsed engagement.

### The Aug 24–26 peak and the Aug 27–30 collapse

This is the single most legible cause-and-effect shape in the calendar, and it
deserves its numbers stated plainly.

|                                   | Mon–Wed 08-24→26 | Thu–Sun 08-27→30  | ratio |
| --------------------------------- | ---------------- | ----------------- | ----- |
| commits                           | 473              | 20                | 23.7× |
| typed prompts                     | 327              | 8                 | 40.9× |
| PRs merged                        | 82               | 0                 | —     |
| PRs opened                        | 85               | 16 (all Renovate) | —     |
| distinct repos with human commits | 13 / 6 / 5       | 3 / 1 / 2 / 1     | —     |

Three days took 18.0% of the window's total commits and 19.0% of its total typed
operator input. The four days after them produced 20 commits, of which four were
the novel and twelve were lyrics typed by hand into an editor built two days
earlier, with no agent involved.

**The collapse is not a mystery and it is not fatigue-as-metaphor — it is a
budget.** At 19:54 local on Wednesday: "running out of credits this week."
Thursday morning both mega-sessions were closed within four minutes of each
other on the same instruction. The two stalls that preceded it are in the record
too: at 21:33–21:34 UTC on Monday, one _account-level_ session limit stalled
**four concurrent sessions simultaneously**, each of which needed a hand-typed
"continue" to resume.

That is the load-bearing observation about this operator's rhythm: **the
constraint that ends a working stretch is not the work running out, it is the
capacity to run agents running out — and because his sessions are concurrent,
that constraint arrives for all of them at once.** The same pattern recurs on a
smaller scale on 2026-09-04, when a machine crash ("computer crashed because I
also opened steam, resume") required the same message typed into four sessions
inside 39 seconds.

### Is intensity trending up or down?

Up, steeply, through week 6 — then the record ends mid-stretch.

| week             | days | commits/day | human commits/day | typed/day | repos | PRs merged |
| ---------------- | ---- | ----------- | ----------------- | --------- | ----- | ---------- |
| w1 (07-30→08-02) | 4    | 34.5        | 34.3              | —         | 25    | 72         |
| w2 (08-03→08-09) | 7    | 39.7        | 27.7              | —         | 25    | 90         |
| w3 (08-10→08-16) | 7    | 42.7        | 35.1              | 35.0      | 28    | 108        |
| w4 (08-17→08-23) | 7    | 64.9        | 64.3              | 54.0      | 26    | 96         |
| w5 (08-24→08-30) | 7    | 70.4        | 67.9              | 47.9      | 14    | 82         |
| w6 (08-31→09-06) | 7    | 93.4        | 84.1              | 78.6      | 40    | 222        |
| w7 (09-07→09-12) | 6    | 51.0        | 41.3              | 34.8      | 15    | 92         |

Commit volume rises monotonically from 34.5/day to 93.4/day — a **2.7×
increase in six weeks** — and typed operator input rises from 35.0/day to
78.6/day over the four weeks it is measured. Week 7's apparent drop should not
be read as a reversal: it is 6 days rather than 7, it ends Saturday at 11:01, and
it contains an almost entirely idle Monday. Excluding that Monday, weekdays
09-08 → 09-11 run 64 commits/day and 49 typed prompts/day — below week 6 but
above weeks 3 and 5.

The more useful reading is that **week 5 and week 7 are the two weeks where
breadth collapsed** (14 and 15 distinct repos, against 26–40 in every other
week) — both times because one deep piece of work (the migration; the match
harness plus one client rebuild) absorbed everything. Breadth and depth trade
off cleanly here, and they trade off at the week scale, not the day scale.

### Two rhythm facts about the loop itself

**The merge loop is almost frictionless, and almost unwitnessed.** 763 PRs
merged in 45 days at a median open→merge of **20.2 minutes** overall and **11.4
minutes** for human-authored PRs; 269 of them merged in under 10 minutes. **Of
857 PRs in the window, 15 received any review at all — and 14 of those 15 are in
the game jam repo, plus one in the Godot game.** Not a single pull request in
any client or fleet repository was reviewed by another human in seven weeks. The
only code review Tucker received in the entire window came from three people he
was doing a 48-hour game jam with.

**The automated layer never stops, including on the days he does.** On 08-09 —
zero commits — Renovate opened 36 PRs across 18 repos and 62 scheduled runs went
green. On 08-28 (one commit, the novel) there were 54 runs; on 08-30, 51 runs
and 16 Renovate PRs opened to stage Monday's batch. On 09-07 the fleet took 37
bot commits while its operator sent two prompts about paper. **The fleet's floor
of activity is roughly 35–60 CI runs a day regardless of what the human does**,
which is exactly what the system was built for — and also why a green nightly
that is structurally incapable of failing is so expensive here: it runs every
day, unattended, and its output is trusted precisely because nobody is watching.

---

## What this chapter cannot tell you

- **Nothing about how sessions were steered between 07-30 and 08-09.** Eleven
  days, 416 commits, one client launch, zero transcripts.
- **Nothing about the 08-12 fleet session**, whose transcript is gone from disk
  despite the rest of the week being retained — and which is the origin of this
  repository's most important standing rule.
- **Nothing reliable about central-repo CI before 2026-09-04.** The 300-run cap
  makes weeks 1–5 look greener than they were.
- **Nothing about hours worked.** Session wall-clock sums across concurrent
  sessions and exceeds 24 h/day; it is a concurrency index, not labour. The
  typed-prompt span per day is the closest honest proxy, and it is an upper
  bound on engagement, not a measure of it.
