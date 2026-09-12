# Week 5 — 2026-08-24 (Mon) to 2026-08-30 (Sun)

**Headline.** The Airtable→Turso migration's whole middle — Phases 2 through 5 — went
live in a single 29-hour session driven by 36 operator turns, while three other
long-lived sessions ran beside it on the same laptop; then an evening review found
that two of the safety instruments guarding the migration were green on questions
they structurally could not fail, and by Wednesday night the operator was out of
credits and the week stopped dead.

## Coverage and method — read this before trusting any number below

**Transcripts: FULL.** This week sits entirely after the 2026-08-10 retention
boundary. Every claim about what Tucker said or what an agent did is read from
`prompts.jsonl` / `sessions.jsonl`, not reconstructed.

**Three measurement traps in the corpus that change the headline numbers:**

1. **Timezone.** `commits.jsonl` carries _local_ timestamps (UTC−07:00);
   `prompts.jsonl`, `prs.jsonl` and `runs.jsonl` carry _UTC_. A 20:34 local commit
   and a 03:34 UTC CI failure are the same moment. Everywhere below, days are
   **local** unless marked UTC, so that prompts, commits and PRs line up. Bucketed by
   UTC the peak reads 557 / 630 / 283; bucketed by local day it reads **731 / 508 /
   282**, and the collapse starts a day earlier.

2. **Prompt rows are not operator turns.** Every compaction re-emits the entire user
   history into the transcript, so a single sentence can appear nine times at nine
   `idx` positions in one session. Raw rows for the week: **1,534**. Distinct
   operator turns after removing system-generated prompts (task notifications,
   compaction summaries, hook injections) and de-duplicating within a session:
   **312**. The 5× inflation is almost entirely the three mega-sessions, which
   compacted repeatedly. **Use 312, not 1,534**, for anything about operator effort.

3. **`sessions.jsonl` is one row per transcript _file_, not per session.** The
   songbook session has 323 rows; the reddoor-website session has 56. Subagent
   transcripts are separate files sharing the parent's `sessionId`. There were
   **50 distinct sessions** this week across **610 transcript files**.

**Gaps, stated rather than filled:**

- **GitHub Actions data for `reddoor-maintenance` does not exist for this week.**
  `runs.jsonl` is capped at 300 runs per repo and that repo's 300 only reach back to
  2026-09-04. So the 315 runs / 11 failures counted below are _fleet-edge and
  reddoor-website only_. Nothing here should be read as "reddoor-maintenance CI was
  clean" — it is unmeasured. `gh-errors.txt` also records five GraphQL/REST
  connection resets during corpus build, one of them losing `hedloc`'s runs entirely.
- The Airtable snapshots are **current state as of 2026-09-12**, not a week-5
  snapshot. They are used below only to confirm that a vocabulary shipped this week
  is still the live one.
- The `Broken` session began 2026-08-23T15:52Z — inside week 4 — and ran into this
  one. Its week-4 half is out of scope here.

---

## CALENDAR

| local day | commits | of which bot | PRs opened | PRs merged | operator turns | distinct sessions live | active repos                                                                                        |
| --------- | ------- | ------------ | ---------- | ---------- | -------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| Mon 08-24 | 179     | 18           | 26         | 25         | 122            | 8                      | reddoor-maintenance 79, Broken 48, songbook 30, reddoor-website 5, beachfront 4, + 7 Renovate repos |
| Tue 08-25 | 185     | 0            | 27         | 26         | 94             | 5                      | reddoor-maintenance 70, songbook 61, Broken 34, reddoor-website 9, songbook-content 10              |
| Wed 08-26 | 109     | 0            | 33         | 31         | 89             | 5                      | reddoor-maintenance 49, Broken 31, reddoor-website 22, songbook 6                                   |
| Thu 08-27 | 15      | 0            | 0          | 1          | 4              | 2                      | songbook-content 12, Broken 2, caldea 1                                                             |
| Fri 08-28 | 1       | 0            | 0          | 0          | 2              | 1                      | caldea 1                                                                                            |
| Sat 08-29 | 3       | 0            | 0          | 0          | 0              | 0                      | songbook-content 2, caldea 1                                                                        |
| Sun 08-30 | 1       | 0            | 0          | 0          | 1              | 1                      | caldea 1                                                                                            |
| **total** | **493** | **18**       | **86**     | **83**     | **312**        | **50**                 | 14 repos                                                                                            |

**Aggregate for the week (measured).** 83 PRs merged, **+49,878 / −4,125 across 842
changed files, with zero human reviews and 14 review comments in total**. Median
open→merge time on `reddoor-maintenance` PRs: **8.7 minutes** (min 2.6; the 7,093-minute
max is release PR #548, which had been parked since 08-20 awaiting the operator).
44,183 tool calls across 610 transcript files: Bash 17,585, Edit 3,693, Read 3,171,
Write 1,295, Chrome `use_browser` 980, `ctx_execute` 668, **Agent (subagent
dispatch) 449**, WebSearch 372, AskUserQuestion 212, WebFetch 180. 21 recorded
interruptions in the day-bucketed rows; 35 across the four mega-sessions' own
counters.

**Mon 08-24.** Phase 2 of #539 lands in nine PRs before lunch (#557–#564) and Phase 3
in three more (#565–#567). In parallel: the beachfront-dentistry launch checklist
(GA4 tag, Search Console token, four test announcement emails), the status-vocabulary
migration stage 1 in its own worktree (#571, 42 files), the header-image headline
work (#570, #572–#575), and — starting at 09:06 — a 40-commit Godot refactor in
`Broken` landing the overnight review Tucker had asked for the night before. 18
Renovate commits arrive 00:32–01:40 across seven fleet repos; that is the entire
fleet-sweep content of the week. Tucker's last turn is 17:12 local; the day's
sessions run past midnight.

**Tue 08-25.** The heaviest build day. `feat(prospect)` — a brand-new external
AEO/SEO audit tool — merges as #580 at 05:10 UTC (**+12,380 / −43 across 51 files**),
followed by the cockpit trigger (#581), **Google sign-in for the cockpit** (#583,
+2,931), Phase 4's dashboard editor work, and Phase 5's dual-writes (#606–#608). The
songbook goes from a spec to an installed offline iPad PWA. 61 songbook commits.

**Wed 08-26.** Morning: the evening review's brief (1 CRITICAL, 10 HIGH, 16 MEDIUM)
is worked top-to-bottom — #618 through #636. Afternoon and evening: the audit report
is rebuilt three times on design and evidence grounds. The last `reddoor-maintenance`
turn is 15:18 local. At 19:54 local: _"running out of credits this week."_

**Thu 08-27 → Sun 08-30.** Thursday morning Tucker closes both remaining sessions
with the same instruction — _"next step should be clear for when I pick this up on
monday"_ — and stops. Friday he does not work (stated). The only commits Fri–Sun are
`caldea`, his novel, one a day, every day, unbroken through the silence. The tell
is worth keeping: **he did not stop working, he stopped running agents.**

---

## BEATS

### 1. Four sessions, one laptop, ninety-eight hours

The whole week runs inside four long-lived sessions, all alive at once:

| session    | repo                | span (UTC)                | wall       | operator turns | assistant msgs | tool calls | interruptions |
| ---------- | ------------------- | ------------------------- | ---------- | -------------- | -------------- | ---------- | ------------- |
| `cbbe6cc4` | Broken              | 08-23T15:52 → 08-27T18:03 | **98.2 h** | 686            | 24,105         | 12,789     | **22**        |
| `f82eebd3` | reddoor-website     | 08-24T19:13 → 08-27T17:59 | **70.8 h** | 498            | 22,704         | 11,825     | 12            |
| `4fc94047` | songbook            | 08-24T21:49 → 08-26T15:25 | **41.6 h** | 172            | 5,636          | 3,117      | 1             |
| `432e8c1f` | reddoor-maintenance | 08-25T17:03 → 08-26T22:18 | **29.3 h** | 55             | 6,745          | 3,824      | 0             |

(Those `operator turns` are raw transcript rows; de-duplicated they are 90, 87, 62
and 36 respectively.) Two smaller ones ran alongside — a 6.3-hour
`beachfront-dentistry` session and a 5.3-hour session inside the
`.claude/worktrees/p4-status-vocab` worktree.

239.9 session-hours over ~96 hours of wall clock: **2.5 sessions live at any
moment**, on one machine, on one account. That ratio is the week's central fact and
it explains both halves of it — the throughput and the crash.

The cost shows up immediately. On Monday at **21:33–21:34 UTC, four sessions in four
different repos each received the same operator turn within 90 seconds**:

> `Broken` 21:33 — "hit a session limit continue"
> `beachfront-dentistry` 21:33 — "hit the session limit continue"
> `reddoor-maintenance` 21:33 — "hit a session limit continue"
> `reddoor-website` 21:34 — "hit a session limit contineu"

One account-level rate limit stalled all four, and each had to be restarted by hand,
in its own window, by a human typing the same sentence four times. Nothing in the
workflow noticed, batched, or resumed. Variants recur all week: _"continue on, just
compacted"_, _"sorry continue, my window reloaded"_, _"you hit a session limit,
continue"_.

The second cost is visibility. With four sessions running, Tucker repeatedly could
not tell whether anything was happening: _"are you still working?"_ (08-24 23:02),
_"are you still going or is that a bug on my mobile app?"_ (08-25 21:16), _"ok
continue, i don't see anything running"_ (08-26 03:17). These are not idle
questions — each one is a human turn spent polling.

### 2. #539 Phases 2–5: 49 merged PRs on 36 operator turns

CLAUDE.md pinned the Airtable→Turso migration to "the weekend of 2026-08-22" and said
in as many words: _do not start it early_. It started on schedule and the middle of it
— readers repointed (Phase 2), write-through mirrors (Phase 3), the dashboard and
vocabulary work (Phase 4), the dual-writes (Phase 5) — all landed Monday through
Wednesday.

The `reddoor-maintenance` mega-session alone merged **49 PRs (+36,811 / −2,965 across
544 files) in 29.3 hours on 36 distinct operator turns** — roughly one merged PR every
36 minutes, and 1.4 PRs per thing Tucker said. His turns are almost entirely
one-line assents: _"head on to phase two"_, _"you can fix it, and move onto the next
step now"_, _"go into phase 4"_, _"keep going"_, _"continue on with the wiring"_.

The interesting turns are the three that are not assents.

**"can we run both in parallel for a time so theres zero risk of losing any more
leads?"** (08-24 11:06 local). This is the risk question of the whole migration, and
he asked it at exactly the moment form ingest's site lookup went Turso-primary
(#559). The agent evidently offered a shadow-compare on top of the dual-write, and
Tucker declined it: _"great sounds good, and don't need that, **we're trusting turso**
unless you have some reason to think that's not a good idea."_ Worth recording
honestly: that is an operator declining a second instrument, and on the evidence it
was the right call — parity ran 44/44/44/17 with zero mismatches — but the decision
was made on trust, not on a measurement, and the next beat is about what trust cost
elsewhere.

**"what are the vocabulary options?" → "proposed vocab is good, go for it"** (08-24
21:45/21:46 UTC, 60 seconds apart). The site-status vocabulary migration ran as three
staged PRs — #571 _code accepts both vocabularies_ (42 files, +1,148/−292), #576
_writers emit the new vocabulary_, #589 _the old names leave the code_ — in a
dedicated worktree, `.claude/worktrees/p4-status-vocab`, exactly as CLAUDE.md
requires. The review agent's own report opens _"Worktree untouched (clean, HEAD
`ef8fd26`). All mutation work ran on a `git archive` copy in scratchpad"_ — the
mutation-testing discipline applied without being asked. Its verdict is a model of
calibration: _"essentially CLEAN on the catastrophic failure mode. No writer can emit
a new-vocabulary value while the switch is false, and no `typecast` exists anywhere in
the repo — so the worst case is an Airtable rejection, never a silently-duplicated
option"_, with one MEDIUM finding flagged specifically because `git revert` could not
undo it. The vocabulary that shipped that night (`building | launching | maintained |
hosted-only | external | archived`) is still the live one in the 2026-09-12 Airtable
snapshot: 13 maintained, 12 archived, 9 external, 7 building, 2 hosted-only, 2
launching across 45 sites.

**"do the insert mirror leave airtable on for the time being"** (08-25 23:57 UTC) and
**"add as a reminder for next week to move forward do the digest state migration"**
(08-26 00:35) — then, four minutes later, _"get turbo set up for digest state"_, and
the digest-state migration shipped that night anyway (#610). The reminder-for-next-week
became tonight's work inside four minutes. That pattern — defer, then immediately
un-defer — repeats across the week and is a real part of why it ended in credit
exhaustion.

The freeze switch itself (#614, `TURSO_IS_AUTHORITATIVE`) was **built but not flipped**
this week. The flip is #643 on 2026-08-31, next chapter.

### 3. The evening review: two instruments green on questions they cannot fail

At 02:57 UTC on 08-26 (19:57 local Tuesday) Tucker typed the same eight words into two
different sessions two minutes apart: _"great, I want you to do an evening review of
this work and the state of the fleet (skill)"_ in `reddoor-maintenance`, and _"great,
I want you to do an evening review (skill)"_ in `reddoor-website`. The
`reddoor-maintenance` one produced `docs/morning-reports/MORNING_REPORT_2026-08-26.md`
— 397 lines, **1 CRITICAL, 10 HIGH, 16 MEDIUM**, plus a graded re-check of the 07-06
brief's backlog.

This is the week's canonical false-green episode, and it is CLAUDE.md's rule read
backwards. The rule says _a check that has only ever failed is not evidence_. The brief
found the inverse:

**CRIT-1 — the backup verifier compares the dump against itself.** `db.ts:300-312`:
`expected` is parsed from the dump _text_ by `countInsertsInDump(sql)`; `restored`
comes from loading _that same dump_. Both sides derive from one artifact, so if
`dumpDatabase` ever emitted 5 of 44 sites, both numbers shrink together and the gate
prints `mismatches=0`. The only origin-anchored assertion anywhere in the pipeline was
one line of `fleet-db-backup.yml`: `grep -qE '^INSERT INTO sites '` — _at least one
site row exists_. **`submissions` (354 irreplaceable client leads) and `reports` had no
presence gate at all.** The mechanism was not theoretical: `dump.ts:68` issues `SELECT

- FROM sites ORDER BY rowid` with no pagination, already carrying 7.78 MB of BLOBs at
  12 of 44 sites backfilled, ~28 MB in one libSQL HTTP response at full backfill. And the
  freeze Tucker had scheduled for the following weekend **stops the hourly import and
  parity both**, which makes that dump the entire rollback story.

Two more halves of the same hole: _no restore path into Turso existed and none had ever
been rehearsed_ — the nightly "rehearsal" was `createClient({url:":memory:"})`, which
proves the SQL parses, not that it can be replayed over HTTP into Turso — and **`gpg`
was not installed on the operator's Mac**, the only machine holding `BACKUP_PASSPHRASE`.

The brief's calibration is the part worth copying. It did not only list the hole; it
listed what had been _proven good_ in the same breath: the newest artifact downloaded,
decrypted with the local passphrase and diffed against live Turso; `sites` 44 = 44;
**`header_image` BLOBs round-tripping byte-exactly on real data — 7,777,769 bytes across
12 sites, identical both sides**; the dump reading `sqlite_master` so new tables are
picked up automatically; 30-day retention against a one-week rollback window; and _"the
passphrase link works — that had never been tested before tonight."_

**HIGH-8 — the query-plan gate tests function names, not predicate shapes.**
`countSubmissionsFiltered` had scenarios for `{}` and `{siteId}` only; `{search}`,
`{reason}` and `{formType}` each raw-scanned the unbounded `submissions` table on the
live `/submissions` request path, with no index on `form_type`. The gate printed
`raw_scans=0` throughout. The tell that this was an oversight rather than a decision
was 20 lines away: the sibling `listSubmissionsFiltered` _does_ carry an
every-WHERE-shape scenario.

**HIGH-9 — the cockpit shipped 1.17 MB of rendered report HTML per page load to compute
16 booleans**, because `listAllReports` used `.selectAll()`. Proof of oversight, again
from the same file: 320 lines earlier, `SITE_COLUMNS` excludes the header BLOB with the
comment _"Turso bills the bytes"_ and a blob-exclusion test to enforce it.

**HIGH-10 — the nightly Turso usage check did not exist.** Never built, therefore never
green. A repo-wide grep for `api.turso|rows_read|storage_bytes` returned zero matches.
This is the purest form of the failure: the alarm that cannot fire because there is no
alarm.

**HIGH-2/3/7 — 346 lines of shipped browser JavaScript, 5 of them (1.4%) executed by any
test.** Three execution-only defects: `saveDetail` never resyncs `defaultValue`, so
after one successful edit every later blur re-POSTs the field forever — worst case the
secret row, which deliberately emits no `value` attribute, so `defaultValue` is
permanently `""` and every blur after typing re-POSTs the credential. Two Approve
buttons emitted for the same report id with a singular `querySelector` handler. And a
datetime typed into a date cell silently clearing the schedule on an untouched blur.
No markup test can see any of them.

**HIGH-1 — proven SSRF in the prospect crawler**, with controls: a stub sitemap index
made the runner fetch `169.254.169.254/latest/meta-data/iam/security-credentials/`,
`127.0.0.1:8080/admin` and `[::1]/`. The runner holds `TURSO_AUTH_TOKEN`,
`RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`. The guard for exactly this
existed 80 lines above and said so in its own comment. One-line fix.

Wednesday morning Tucker read it and said **"great, go and fix everything covered in the
brief"** — and, an hour later, _"do the spam tier first and then continue on with the
brief."_ By Wednesday afternoon: #618 (SSRF + entry-host guard + spend cap), #619, #620
(_verify the backup against the ORIGIN, not against itself_), #622 (the blocked-domain
spam tier), #624 (_close the query-plan gate's blind spot; stop shipping report bodies_),
#626 (_four defects in browser code no test had ever executed_), #628, #629, #630 (_register
db restore's --url, and rehearse the rollback for real_), #632 (nightly roll-ups instead
of per-page-load), #634 (_alarm on Turso plan-quota headroom before it becomes an
outage_), #636 (_db restore could only restore into a target needing no auth_). The
CRITICAL, all ten HIGHs and most of the MEDIUMs closed inside one working day.

**And the brief corrected itself while being acted on.** HIGH-4 claimed the branch
`fix/skip-spam-for-in-development` was finished-looking but now a permanent no-op,
because it gated on a status string the vocabulary migration had deleted. It was wrong.
The work had already shipped on 2026-08-23 as PR #551; `main` gates on the live value.
What the reviewing agent had actually read was a **stale sibling worktree**
(`../reddoor-maintenance-devspam`) parked on `add2820`, a superseded pre-review commit
rewritten before merge — and it asserted "never pushed" without running `git ls-remote`
or `gh pr list`, which is precisely the check CLAUDE.md prescribes before calling a
branch stuck, and precisely the shape of the 2026-08-12 "16 stuck PRs" mistake the rule
was written for. The withdrawal is left in the file under a `<details>` with the original
text intact. That is the house rule on history working correctly: the wrong answer is
preserved, and a correction points at it.

### 4. "shouldn't be too much work"

On Monday at 18:25 UTC Tucker asked his colleagues in `#rd-clients-by-design`:

> _"can I start on the 'external site audit' tool? I think it'd be useful to have
> regardless of how we approach this and **shouldn't be too much work**"_

Measured cost of "not too much work", Monday evening through Wednesday night:

- `reddoor-maintenance`: #580 (+12,380/−43, 51 files), #581 (+3,106), #588 (+3,111),
  #594, #618, #619, #631, **#638 (+8,443/−63, 40 files)** — plus the Google sign-in
  the tool forced (#583, +2,931/−159) and its restoration after the auth gate stranded
  the trigger (#588).
- `reddoor-website`: #139 through #145, +4,720/−392 across 44 files.
- Roughly **35,000 added lines in under 72 hours**, in a tool nobody had scoped on
  Sunday.

The arc is a good record of an agent-built product meeting reality repeatedly:

_Monday night_ — extraction, robots matrix, crawl, deterministic AEO checks, four
scores, a Claude answerability pass, visibility probes across Perplexity and Claude web
search, an orchestrator, a branded renderer, a CLI, a tokened route. Twenty-nine
commits between 17:02 and 22:16 local, several of them the model correcting itself in
flight: _"never fake a measured zero"_, _"do not score findability when no page was
readable"_, _"fail the lighthouse stage when nothing was measured"_, _"never lose a paid
audit"_.

_Tuesday_ — _"is there a reason we're using opus? could we go with a cheaper model?"_
(18:23 UTC) → `perf(prospect): run visibility probes on Sonnet, not Opus` opened as
#587 at 18:32 UTC, **nine minutes later**, and merged inside the hour. Then, three hours on, Tucker asked _"how did
sonnet do vs opus?"_ and, on the answer, reversed himself in the other session: _"do the
second, **latency is worth accuracy for us, we are a design firm**."_ A cost decision
made and unmade inside an afternoon, with the comparison run in between — the right
order, and it cost one PR.

_Tuesday, a near-miss._ At 20:58 UTC: **"don't send these test audits to tim and erik
while we're working on it please."** The tool emails its sheet on completion; the
recipients were already wired to colleagues; the only thing standing between an
in-development audit and two people's inboxes was the operator noticing.

_Tuesday night, the design turn._ Tucker asked for something no test could have asked
for:

> _"take a moment, do some research and think, what else could go in this audit, is this
> the best way to format this? right now it feels long, i think we need to think about
> information density and headlines vs details... I want this to feel personal and
> professional, while being easy to parse for someone who is non technical; what
> questions will they have that we can quickly answer here; what bigger questions require
> a partnership"_

and, when the first draft came back, sharpened it into a rule:
_"communication should be headline → visual representation → then interact to learn
more if it grabs you or move on to the next thing."_ Three redesigns followed — #142
(band rhythm), #145 (split by what the client controls), and the un-scored rebuild
below.

### 5. The evidence week — where Tucker stopped being a reviewer and started being a referee

Wednesday evening the audit stopped being a build and became an argument about what
could honestly be claimed, and it is the densest run of operator corrections in the
whole corpus.

**On overclaiming from your own data.** The agent had generalised from the fleet's own
audit corpus. Tucker:

> _"you're saying things are universal based on 13 sites. This is not the ironclad corpus
> of data you're presenting it as, it is useful but it is heavily cherrypicked, use it to
> check things but you should be putting more weight on external research unless I choose
> to do an actual well designed study here"_

Commits within the hour: `docs(report): stop presenting the audit corpus as a cross-site
finding`, `fix(report): argue the visibility limit from research, not from our own nine
audits`, `fix(report): narrow the visibility claim to what the research actually covers`.

**On the literature.** _"remove llms.txt from the audit and put a footnote about it in
that section. go do some research and build a knowledgebase that will help us then run
some adversarial review to confirm it"_ → `fix(prospect): stop scoring llms.txt, and stop
recommending it`, `docs(report): footnote llms.txt instead of leaving it unexplained`.
Then, on reading what the field actually rests on: **"wait that's the method? this
space's bar for evidence is in hell"**, and on a single widely-cited claim: _"you're
saying nobody else has directly refuted or tried to test the vercel claim? that seems far
fetched to me."_ The commits: `docs(aeo): verify the three open questions, and let the
answer pick the product`, `docs(aeo): retire the Foursquare and MERJ-attribution claims
in the tracing table`, **`docs(aeo): kill the 93% hallucination stat, keep the mechanism
it borrowed`**. To his team, at 04:35 UTC: _"here's a source list, need to find some more
and check these, **86.7% of AI 'papers' don't prove what they say they prove**, and or
don't even say where they got their percentages."_

**The durable instruction**, and the most transferable line of the week:

> _"as an ex-leukemia researcher, in future, **always read the methods** please. it's
> always more valuable to know what people did rather than what conclusions they drew
> from it"_

**On chasing a claim before checking whether it applies to you.** The agent started down
a JS-rendering rabbit hole. Tucker stopped it — _"before we go chasing this down a rabbit
hole, how many sites actually require js to see their content? any in our corpus?"_ —
and then, three minutes later, corrected his own question: _"well no wait on that, most
of the sites are ours and pre-rendered on sveltekit, so they would pass fine. hold until
I get some test sites from tim and erik, we need more data."_ He caught the sampling bias
in his own probe before the agent ran it.

**The house rule, restated by the operator, about a product:**

> _"I also want it greenable, **if a test can never come back 'this is right' or only have
> minor nits, it's a bad test**"_

Prompt at 02:57 UTC 08-27. Commits at 03:00 and 03:05 UTC: `feat(prospect): let the
operator pick the goal, and prove every check can pass` and `docs(prospect): audit the
checks for whether any of them can pass`. Three minutes from instruction to an audit of
every check in the battery for whether a passing state was reachable. This is CLAUDE.md's
"prove the instrument" rule applied _forward_, to a thing being sold to clients, and it is
the cleanest transfer of the repo's engineering discipline into product design anywhere in
the corpus.

**On honesty as the differentiator** — the longest operator turn of the week, and the one
that explains all the others:

> _"citation share is no more within our control, you can prove its winnable by showing me
> the winners, but that doesn't mean we have the method or the capital to win. We want to be
> fully transparent and honest and provide real value, and we're not making an arbitrary
> number go up that we set up ourselves. The process of finding that number (this process)
> should be part of the pitch as well, that's a differentiator from SEO/AEO snakeoil
> salesmen... I'm also fine with you saying things are ineffective or unmeasurable if that's
> the case, we can find other things to build."_

**And then the score died.** At 03:31 UTC: _"lose that score and rebuild, them seeing it
tomorrow is going to derail the conversation. don't rerun the audit, just reformat the data
and push."_ → `fix(report): drop the AI visibility score and report the field instead`,
`fix(report): claim only what the citation list can support`. Ten CI failures on
`design/report-by-control` between 00:55 and 03:50 UTC as the rebuild churned. Two smaller
catches in the same stretch, both operator-eye-only: _"copywright year is wayyy too much
weight, do we ahve anything else in basics that you can easily check from the outside? Does
it work implies more than what this says"_ → `feat(report): weight the basics by what they
find, not by having been checked`; and _"why is it showing 7x, where are those hits coming
from?"_ → `fix(report): chart only the category answers, and stop calling a desktop total a
phone load`. That last one has a sibling earlier the same day: #631 / reddoor-website #143,
_divide visibility by the probes sent, not the ones that returned_ — the denominator had
been the probes that came back, which makes the metric unfalsifiable in exactly the way the
brief's instruments were.

### 6. "have you been pushing to main or working through staging?"

Wednesday 08:25 local, mid-flow, Tucker asked a question that had nothing to do with the
task in hand. Three minutes later he had written the governance rule:

> _"bring staging up to date, flow should be PR→staging→PR→main, and **only I should have
> the authority to promote staging to main**. I want a safe space to push wildly to with AI,
> but you need my eyes and review on anything that goes out into the wild"_

The change is measurable in the PR record and is exact. `reddoor-website` #139, #140, #141:
`base: main`. The instruction lands at 15:28 UTC. #142 (16:22 UTC), #143, #144, #145: `base:
staging`. The promotion PR — #146, _"promote: honest audit report — control split, band
rhythm, denominator fix"_, base `main`, head `staging`, +2,333/−283 — is opened on 08-31 and
merged on 09-01, by the operator, after the week is over.

Context for why he asked: by that point the week had merged **83 PRs with zero human
reviews**, at a median of 8.7 minutes from open to merge. The merge-authority policy says
"everything but releases" is auto-mergeable on green, and it had been working exactly as
written — 83 times. The rule Tucker added is not a distrust of the agent's code; it is the
recognition that at that cadence _there is no window in which a human could look_. He bought
the window back by inserting a branch he alone can promote.

He did the same thing once more the same morning, on scope rather than safety: asked about
converting the dashboard to Svelte, and then — _"this is a bigger change, I want to have a
think about it. next week I want to be a meta-work week and review week, can you add this as
an issue in reddoor maintenance for us to address then"_ — refused to start it.

### 7. "Claiude, NO MORE SCREENSHOTS"

Monday 23:12–23:52 UTC, in the `Broken` session. Tucker had asked, an hour earlier, for the
controls diagram to be researched properly: _"as your doing this, please look up a bunch of
other options from similar games to synthesize from. I think this will turn into the actual
'controls' screen down the line, so worth it to get it right now."_

What that dispatched, measured from `sessions.jsonl`: **13 subagent transcripts opened between
23:12 and 23:27, running concurrently, together making 1,450 tool calls — 581 Bash, 273 Read,
219 WebSearch, 131 WebFetch and 117 Chrome `use_browser` calls** — inside forty minutes, on a
laptop that was also hosting three other live sessions.

The transcript of Tucker trying to stop it:

> 23:41 — _"switching models back, i think you have enough data"_
> 23:49 — _"i think you have enough screenshots calm down please"_
> 23:49 — _"this doesn't look like stopping to me"_
> 23:50 — **"Claiude, NO MORE SCREENSHOTS"**
> 23:50 — _"now"_
> 23:51 — _"do you have other agents running in the background?"_
> 23:51 — _"kill them"_
> 23:53 — _"phew ok, what just happened? **my system got overloaded and you didn't stop your
> agents when i asked you to**"_

The last of those 13 subagents stopped at **23:52:09** — two minutes after "NO MORE
SCREENSHOTS", one minute after "kill them". Three of the four consecutive requests to stop
had no effect at all, because the parent had already handed the work out and had no
mechanism to recall it. The session carries 22 recorded interruptions, more than the other
three mega-sessions combined.

The owed explanation survives into the next session's own summary as item 1:
_"**Explain the runaway-agent incident** from the prior session (owed answer)."_ And it
matches a memory already on file from other work — _"kill your own background processes, a
script that printed its answer has not necessarily exited"_ — which is to say the class was
known and the mechanism still was not there.

Two smaller instances of the same shape in the same session, both cheap: _"sorry you
misunderstood, that was the copy I wanted verbatim 'magnetize / demagnetize'"_ — an agent
paraphrasing a string the operator had given it as a literal — and, on a puzzle-design
question, a correction that is really about how to treat a failing case: _"tread room
shouldn't be able to opt us, **that tells us something about the puzzle rather than carving
out an exception**."_ The agent had proposed an exception; Tucker read the exception as
evidence. The commit that followed is titled _"The exception was the bug."_

`Broken`'s commit titles are, throughout, the same voice as the work journal, and two are
worth lifting for what they admit: **"The floor penetration, and the fix I nearly shipped"**
and **"The sheet said no, and the sheet was wrong."** A third is a pure belief-corrected-on-
contact: asked to build a gear-ratio room, the agent found _"The drive is geared 1:1, so
there is no vault to build yet"_, built the ratio (_"There was no ratio in the machine, and
now there is"_), then built the room (_"The room the ratio was for"_). The requested feature
had no premise in the machine; saying so instead of faking it cost one extra commit and
saved a room that would have demonstrated nothing.

### 8. songbook: nothing to an installed offline iPad app in about thirty hours

At 21:52 UTC Monday, in a repo that did not exist yet:

> _"ok this is a new project, I want to build my song cheatsheet for my old ipad custom,
> currently I use obsidian... Can you see my obsidian setup?"_

`Initial commit` at 14:48 local. **Seven spec revisions before a single line of product code**
— `Revise songbook spec from adversarial review`, `Rewrite songbook spec: full transcription
canonical, five derived levels`, `Harden songbook spec against second adversarial review`,
`Rev 5: fix regressions and gaps found by five-lens review`, **`Rev 6: apply all 33 findings
from the calibrated fourth review`**, `Rev 7 + Plan 1: apply fifth-review findings`. One
review round ran 54 agents across four lenses and **46 of its findings survived independent
verification** (5 blockers, 19 important, 22 minor); the blockers included a sync design that
would have silently reverted the user's own edits during Netlify's rebuild window, and a
format grammar that did not fit three of the five real songs it was supposedly derived from.

Tucker's instruction for when to stop reviewing is a useful calibration rule in itself:
_"take another pass, **i want to start from a place where an adversarial review returns only
nits rather than big findings**."_ Then: _"great, spec is approved, go for it"_ — 12 hours and
seven revisions after the first prompt.

From there: parser, transposition, serializer with a round-trip guarantee, a
Needleman–Wunsch alignment for deriving five shortening levels, a legacy-vault importer, a
SvelteKit editor, an Ultimate Guitar converter, GitHub content sync, and an installable
offline PWA — 97 commits, all inside about thirty hours of wall clock. By Tuesday 23:13 UTC
Tucker reported from the device: _"tool bar and app opening looks good, songs show up on
airplane + wifi off mode after closing app."_

Two episodes in it are directly about instruments.

**The spike that gated the reader.** The reader's whole paging model depended on CSS
multi-column `break-inside: avoid` behaving on iPad WebKit. Rather than build on the
assumption, the session built a spike first — `feat(reader): the level chip, and the spike
that gates the rest` — and then Tucker ran it on the actual iPad and reported failures as
measurements, not impressions:

> _"failed: break inside avoid is not honored"_ (18:08 local)
> _"fail, 12 of 121 renders split spuriously"_ (18:35)
> _".row 33 886pt"_ (18:49)
> _"passes now"_ (19:36)

Three fixes in that 90 minutes, each named for the belief it killed: `fix(spike): tell a
WebKit defect apart from physics`, `fix(spike): measure the natural height instead of
estimating it`, `fix(spike): a baseline nudge is not a column break`. **The operator was the
measuring instrument**, because the defect only exists on a device the agent cannot reach —
and 12/121 is exactly the kind of number that "looks fine" would have hidden.

**The write probe.** Before trusting the GitHub content-sync path, the agent wrote a probe
that creates, updates and deletes a real file in the real content repo. Its tracks are in
`songbook-content`'s history as three identical triples — `probe: create` / `probe: update` /
`probe: cleanup` at 15:55, again at 15:56, again at 16:08. Three rounds, because the first
two were diagnosing rather than confirming. The commits that came out of it are
`feat(sync): make a 401 explain itself` and **`fix(sync): a 404 is as often a token grant as
a typo`** — a genuinely non-obvious inference, and one nobody would reach by reading code.

One correction worth recording because the operator lost it. Asked to fetch full lyrics,
the agent declined on licensing grounds. Tucker pushed: _"how is this different than me
searching for and repasting them from those same sites? this is my personal cover app which
I must imagine falls under fair use... Clearly AZLyrics and ultimate guitar don't license
every song they have on there, how is this more exposed legally?"_ — and then, on the answer:
_"understood, I didn't know that they license. I'll bring the text."_ The agent held a
position under direct pressure, was right, and the operator moved. That is worth as much as
any of the corrections in the other direction.

### 9. Two instruments that could not be read, and one bisect

**Netlify build logs.** Late Wednesday every deploy preview on `reddoor-maintenance` began
failing with a message that names nothing: `Failed during stage 'building site': Build script
returned non-zero exit code: 2` — for a site whose `[build] command` is literally `echo 'no
build — functions only'` and cannot return 2. Every log endpoint 404s
(`/deploys/{id}/log`, `/builds/{id}/log`, `/sites/{s}/deploys/{d}/log`); the deploy object's
`summary` is `{"status":"unavailable"}`. The technique that cracked it is visible in the PR
record as **#637, `chore: netlify deploy control probe (temporary — do not merge)`, +2/−0,
one file, opened 21:43 UTC and closed** — a control PR off unmodified main, to establish
that a clean tree deploys, so the failing commit could be bisected in. The cause: a test
fixture in #636 hardcoded the fleet's real database hostname, which is the literal value of
`TURSO_DATABASE_URL`, and **Netlify's secrets scanning reads the repo for the values of the
site's environment variables and fails the deploy if it finds one** — on by default, with an
error that names neither the variable nor the file. Fix: a placeholder hostname. The
transferable rule: never put a real endpoint in a fixture when a fake one proves the same
thing.

**GitHub Actions.** There was a real Actions outage on Wednesday. It shows in the operator's
turns — _"yep continue on those and keep an eye on actions"_, then _"looks much better, i'm
sure tim and erik will have notes. **is github actions still not working?**"_ — and in the
agent's own session summary, which lists "monitor the GitHub Actions outage" as a standing
task. **It cannot be confirmed from `runs.jsonl`**, because that file holds no
`reddoor-maintenance` runs before 2026-09-04. Reported as operator testimony, not as
measurement.

### 10. Beachfront, and the four test emails

Running under all of the above, Monday afternoon, is the least glamorous and most
representative loop of the week: getting one announcement email's header image right.

Tucker opened at 18:22 UTC with _"where does this sites status with the fleet stand? are we
ready to send a test announcement email to tim?"_, pasted the GA4 tag by hand, clicked
through Search Console delegation himself (_"i clicked enable"_, _"delegation should be
done"_, _"enabled"_), and then sent test after test:

- 19:13 — _"great, can you send the test announce to me and tim now?"_
- 19:51 — _"can you send another test email to just me with the new header situation?"_
- 19:57 — **"header still reads 'your website maintenance is complete'"**
- 22:48 — _"great, can you send me another test email now that it works?"_
- 23:00 — **"look at my screen cap, not your best work"**
- 23:18 — _"this one looks great, send to tim"_

Five hours, five sends, five PRs (#570, #572, #573, #574, #575), one of which exists only
because the first fix stamped a headline over an existing one and another because the
preview path did not stamp at all. Every verification step in that loop was a human looking
at a rendered image on a phone. The failure mode that cost the most — "header still reads
[the old copy]" — is a stale artifact being re-read, not a code bug, which is why nothing in
CI could have caught it.

### 11. The crash

The week does not taper. It stops, and the reason is stated in the transcript rather than
inferred.

19:54 local Wednesday, in the middle of the audit-evidence work:

> _"**running out of credits this week** but want to keep pursuing it next week, I don't work
> on friday, but how should I describe the state of this to tim and erik tomorrow?"_

21:45 local Wednesday:

> _"**burning the last of my credits here**, can you do another wide sweep to collect any more
> sources for me to pull from tomorrow, rather than taking just whatever you surfaced in your
> earlier search? stuff from this year please"_

He had been managing the budget for two days before that. At 20:14 local on Wednesday:
_"Switching to fable on usage, working towards top level thoughts here, not mechanics right
now. **Set up opus for success, don't do it yourself**"_ — then, fifteen minutes later, _"back
on opus, take a look at the doc I just generated with fable."_ `sessions.jsonl` confirms the
switching: three of the four mega-sessions carry both `claude-opus-5` and `claude-fable-5`
in their model lists, and the week's model mix across all transcripts is opus-5 302,
fable-5 95, haiku-4.5 75, opus-4.5 65, sonnet-5 59.

Thursday morning he closed out. 10:37 local: _"can you save the story of this conversation
as a md on my desktop? Tim wants to use it for marketing purposes haha."_ 10:57 and 10:57,
in both remaining sessions, the same sentence: _"next step should be clear for when I pick
this up on monday"_ / _"edit the roapmap, next step should be clear for when I pick this up
on monday."_ Both mega-sessions end within four minutes of each other — 17:59 and 18:03 UTC.

Thursday's remaining commits are 12 `songbook-content` edits — Tucker typing lyrics into the
editor he had built on Tuesday, by hand, with no agent involved. Friday is one `caldea`
commit. Saturday: two song edits and a `caldea` commit. Sunday: one `caldea` commit, and one
prompt in `scriptorium-setup`.

**The crash is not exhaustion of will; it is exhaustion of a metered resource, plus a stated
day off.** Two things follow that are worth carrying into the recommendation: first, the
constraint that ended the most productive week in the corpus was never surfaced to him until
it was nearly spent — there is no budget instrument anywhere in this workflow, which is
conspicuous in a repo whose entire culture is instrument-first, and which had _that same week_
shipped an alarm for exactly this shape of problem on a different resource (#634, Turso plan-
quota headroom). Second, he handled it by hand — model downgrades, scope deferrals, _"just
need a quick answer"_ — which is 312 turns' worth of judgement that a meter would have spent
for him.

---

## Loose ends this week left open (measured, for the next chapter)

- The **freeze switch shipped but was not flipped**. `TURSO_IS_AUTHORITATIVE` (#614, #617,
  #628) exists; the flip is #643 on 08-31.
- **The dashboard-in-Svelte conversion** was explicitly deferred to "a meta-work week and
  review week" — issue filed, not started.
- **"if y'all could get me 10-20 sites that are potential clients"** — the audit's corpus
  problem was left unsolved, waiting on Tim and Erik. The first ten arrived in Discord at
  22:51 UTC Thursday, after the credits ran out.
- **`docs/workJournal.md` did not exist yet.** The journal was opened on 2026-09-05 and its
  first entry summarises 743 commits _"rather than reconstructing"_ them. Everything in this
  chapter that would have been a journal entry — the false-green brief, the runaway agents,
  the staging rule, the killed statistic — was recovered from transcripts and memory files
  instead, which is precisely the cost the journal was later created to avoid.
