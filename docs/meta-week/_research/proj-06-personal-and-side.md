# Cluster 06 — Personal and side projects

_Mile-high, project-by-project. Window: 2026-07-30 → 2026-09-12. Audience: a
model with no other context._

Eleven checkouts that have nothing to do with Reddoor: a physics game, a game
jam, a novel, a song cheatsheet for an old iPad, an LED gaming table, a party
invitation, an ultimate-frisbee teaching tool, a VS Code word counter, and a
self-hosted budget. They account for **a third of everything committed in the
window and close to half of every session and prompt on the machine**, and they
are invisible to every instrument the Reddoor fleet runs. Treating them as
noise would misread the record by about a third.

---

## Coverage, and what the numbers actually count

**The transcript gap.** Session and prompt transcripts only retain back to
**2026-08-10**. For 2026-07-30 → 2026-08-09 there are commits, PRs and Actions
runs and nothing else; anything said about those eleven days is RECONSTRUCTION
from git and is labelled as such. For this cluster the gap costs almost
nothing: **13 commits total fall in it** — caldea 10 (Aug 3–6) and ulti-grid 3
(Aug 2) — against 867 after it. Seven of the eleven repos had not been created
yet.

**Three counting traps in the corpus, which I hit and corrected.** State them,
because the headline figures in `metrics.json` are inflated in ways that matter
for any workflow conclusion drawn from them.

1. **`sessions.jsonl` rows are transcript FILES, not sessions.** Broken's
   "642 sessions" is 642 files: **81 top-level transcripts carrying 25 distinct
   `sessionId`s**, with 561 subagent and workflow transcripts underneath. Across
   the cluster: 1,548 files → 436 top-level → **136 distinct sessions**. The
   ratio is the finding, not an error — see _Subagent-first_ below — but
   "651 sessions" is not 651 sittings.
2. **`prompts.jsonl` repeats prompts across resumed and compacted sessions.**
   Broken's 1,610 prompt rows are 1,413 after stripping auto-summariser and
   task-notification rows, and **358 after deduplicating on timestamp+text**.
   Cluster-wide: 2,467 rows → 2,102 human → **749 distinct operator turns**. A
   4.5× inflation on the busiest repo.
3. **`commits.jsonl` double-counts squash merges.** In `dont-lose-your-head`
   both `Add credits` and `Add credits (#63)` appear. The corpus says 178
   commits; the repo's own backfill entry, counting properly, says 200 across
   two days. Where the two disagree below, I say which I am quoting.

`durMin` is unusable as an attention measure. Merging top-level session
intervals gives Broken 278 wall-clock hours over 14 session-days — 20 h/day —
because sessions sit open running agents. It measures _session openness_, not
time spent. I have not used it.

---

## The cluster in numbers

MEASURED, from `commits.jsonl`, `sessions.jsonl`, `prompts.jsonl`,
`prs.jsonl`, `runs.jsonl`, and read-only `git` in each checkout.

|                          | Cluster | All repos | Share     |
| ------------------------ | ------- | --------- | --------- |
| Commits in window        | **880** | 2,622     | 33.6%     |
| Session transcript files | 1,548   | 3,469     | 44.6%     |
| Distinct sessions        | 136     | —         | —         |
| Prompt rows              | 2,467   | 5,692     | 43.3%     |
| Distinct operator turns  | 749     | —         | —         |
| Tool calls               | 61,091  | 159,263   | 38.4%     |
| **GitHub Actions runs**  | **12**  | **3,437** | **0.35%** |
| Pull requests            | 73      | 857       | 8.5%      |

Per repo:

| Repo                        | Commits (human/other)       | Transcript files / sessions | Distinct turns | Active commit days | First → last commit | PRs | CI runs |
| --------------------------- | --------------------------- | --------------------------- | -------------- | ------------------ | ------------------- | --- | ------- |
| Broken                      | 359 (356 Tucker / 3 others) | 642 / 25                    | 358            | 18                 | 08-15 → 09-08       | 2   | 12      |
| dont-lose-your-head         | 178 (95 / 83)               | 94 / 5                      | 100            | 3                  | 08-21 → 09-05       | 64  | 0       |
| songbook                    | 117 (117 / 0)               | 342 / 8                     | 94             | 7                  | 08-24 → 09-10       | 1   | 0       |
| welcome-to-the-flower-court | 75 (75 / 0)                 | 88 / 16                     | 69             | 3                  | 09-05 → 09-07       | 0   | 0       |
| caldea                      | 56 (56 / 0)                 | 222 / 62                    | 68             | 35                 | 08-03 → 09-12       | 1   | 0       |
| the-bench                   | 55 (55 / 0)                 | 49 / 13                     | 4              | 5                  | 08-14 → 09-05       | 1   | 0       |
| songbook-content            | 27 (27 / 0)                 | 0 / 0                       | 0              | 4                  | 08-25 → 09-05       | 1   | 0       |
| ulti-grid                   | 6 (6 / 0)                   | 0 / 0                       | 0              | 2                  | 08-02 → 09-05       | 1   | 0       |
| to-go                       | 4 (4 / 0)                   | 0 / 0                       | 0              | 2                  | 09-02 → 09-05       | 1   | 0       |
| a-budget                    | 3 (3 / 0)                   | 7 / 3                       | 5              | 2                  | 08-14 → 09-05       | 1   | 0       |
| octagonal-led-turn-counter  | 0 — history migrated        | 104 / 4                     | 51             | —                  | —                   | 0   | 0       |

Two rows need explaining before anything else. **`octagonal-led-turn-counter`
has 104 transcript files, 51 operator turns and zero commits** because its
directory no longer exists: its history was carried into `the-bench` by
`git subtree` on 2026-09-04 and the standalone checkout was deleted. And
**`songbook-content` has 27 commits and zero sessions** — INFERRED, but well
supported: the commit subjects are `Update songs/<slug>.md` and `probe:
create/update/cleanup`, the shapes a GitHub Contents-API write makes, and the
`songbook` app shipped a browser editor plus GitHub sync on 2026-08-25. Its
commits are written by the app, not by a session.

**Interleaving.** Of the 44 days in the window with any commit at all,
**32 carried both personal and Reddoor commits**. Only seven were
personal-only — the jam weekend (Aug 21–22), Aug 15, and the quiet caldea-only
stretch Aug 27–30 — and only five were Reddoor-only, all of them inside the
pre-transcript reconstruction window. This is not a person who blocks out
evenings for side projects. The two tracks are braided through the same days.

**Discord and Airtable carry nothing.** Grepping 2,000+ Discord messages for
these projects returns three hits. The Airtable fleet record has no rows for
any of them. Every operational instrument Reddoor runs is blind to a third of
the work.

---

## Broken — the one that ate the window

_Godot 4.7 / GDScript, private, remote `smahre/Broken`. Live at
`broken-rooms.netlify.app`._

**What it is.** A 2D physics game. You are a wrench-shaped robot with a hand on
each end of its body; you magnetise to anchor studs on the walls of a room and
throw yourself and power cells around by spinning a ratchet. The fiction Tucker
settled on day one, arguing the agent out of a cheerier reading: _"you've been
homogenizing which is the greater purpose of the strip miner, to smooth the
earth and extract. the work you do is fixing the maching by erasing all the
beautiful little imperfections you find along the way."_ The colour that means
an anchor is correct is a pale near-white, not green, because — _"'I am as I
should be' rather than a 'here's a checkmark, you did a thing!'"_

**What happened.** It started on 2026-08-16 as a two-day jam-scale prototype
and did not stop. 359 commits over 18 days. It is by a wide margin the
heaviest consumer of machine in the entire corpus:

- **43,102 tool calls** — more than `reddoor-website` (36,914), which is the
  largest Reddoor repo.
- **324 `Agent` spawns, 64 `Workflow` runs, 50 `TaskStop` calls.**
- **224 of the corpus's 268 `Artifact` publishes (84%)** and **396 of its 525
  `SendUserFile` calls (75%)**. Design review here happens by publishing a
  shape study as an artifact and looking at it — _"can i see it in the claude
  artifact?"_, _"can I see r 16 and 17 i think the ideal is somewhere in
  there?"_
- 63 interruptions and 19 API errors, both the highest in the cluster.

The code is 42 script files / 20,530 lines of game, **22 test files / 18,066
lines of suite** — tests at 88% the size of the thing tested, the same
statement of intent the Reddoor central repo makes with 369 source files
against 471 test files — plus 43 "studies" (8,756 lines) that render a shape
question to a PNG so it can be argued about. The test board went from
**12 suites / 293 checks** on 2026-08-19 to **19 suites / 941 checks** on
2026-09-08, and is run from a single command in about 12 seconds.

And the documentation is enormous. `docs/` is **171,679 words, of which
`workJournal.md` alone is 118,731** — three times the length of the novel in
this same cluster, written in 24 days.

### The instrument episodes, which is why this repo matters most

Broken contains the highest-quality run of "prove the instrument before you
trust its verdict" anywhere in the record, including the Reddoor repo where the
rule is written down. Four, in order.

**2026-08-19 — twelve suites reported all-green having run zero checks.**
`run.sh`'s only pass/fail signal was Godot's exit code, and **Godot exits 0 when
a `--script` suite fails to parse**. Reproduced by cloning the repo into a
scratch directory and typing the documented first command: _"twelve suites
executed **zero of 293 checks** and printed `12 suites, all green, 2s`."_ The
tally was already being computed and used as decoration — a suite that printed
nothing got `ok <suite> no tally printed` and still counted green. A suite is
now green only if it also _said_ something. The near-miss in the fix is the
better half: the review suggested grepping for `SCRIPT ERROR`, which healthy
suites emit at teardown — _"grepping for it would have failed every run, which
is the same bug pointed the other way."_ A third mode turned up only while
injecting faults to test the first two: Godot sometimes never exits at all, and
macOS ships no `timeout(1)`, so each suite now runs against a 120 s clock.

**The same afternoon — three checks that could not fail, in one suite.** The
pattern was identical in all three: _the measurement was taken and then not
used._

- A check whose comment said the point was _"not just 'it did not take it' —
  'it did not even pull'"_ computed the drift and then printed it in the **pass
  message** rather than asserting it. Delete the rule it was guarding and the
  wall reels a carried cell the full **106 px** onto its face while the line
  prints PASS.
- A fence check fired the cell at **3000 px/s** and read its position at frame
  180, calling that "came to rest". At that speed the cell rebounds off the far
  wall and settles at x=1237, so the check passed with the fence commented out
  entirely. Swept at speeds that can actually reach the trap, **-200 px/s rests
  at x=-130 and -400 at x=-73**, both inside an unwinnable strip.
- A stylebox check that examined one state out of three.

**2026-08-19, later — the review's own gate was miscalibrated, and that was
worth more than the review.** Five lenses over the whole repository, each
finding put to two independent refuters with either able to kill it.
**59 agents, 27 findings raised, 2 survived.** Four of the 25 killed findings
were spot-checked by hand and all four were real. Requiring both refuters to
pass a finding means one skeptic buries it, and refuters were already told to
default to refuting.

And the fix for the first bug had its own parity bug: the check written to pin
a toggle-vs-idempotent-setter defect **pressed the key three times**, and a
toggle ends locked after an odd number of presses exactly as an idempotent
setter does. It passed with the bug fully reinstated. Worse, reverting the
_wiring_ — where the defect actually lived — also left every suite green,
because the only suite that drives real bindings had never pressed that key.

**2026-09-04 — the harness refuted the reason it was built.** Tucker had been
sending "tapes" (recorded play sessions) from his phone. Two of three carried
**no position checkpoints at all**: the panel armed the recorder from the room's
wrench, Godot readies children before parents, `Tape.watch(null)` is legal, and
`sample` quietly skips the checkpoint branch. Every check in `tapeSmoke` armed
the recorder on the line after building the room — _"the tests exercised a code
path the game does not take."_ The new check asks the question of the scenes a
person actually plays and **failed at 0 checkpoints in 65 ticks before the fix
and passes at 3 after, which is the only reason to believe it defends
anything.**

Then the one checkable tape came back at **16.7 px of worst drift over 57
checkpoints and 27.4 s** — against a power-cell radius of 9.3 px and a magnet
assist of 40, so 1.8× the cell. A design was written arguing that wasm-in-Safari
versus native-arm64 was the cause and that web tapes must therefore be replayed
in browsers. Tucker took the decision inside the hour: _"C and A, getting this
right should be our first priority, getting all the movement and physics right
has to come before we build anything else, and getting correct feedback on the
physics is how we get physics and movement right."_ A scripted-recording harness
was then built — and its first act was to kill its own premise:

```
native recording -> native replay:    0.07 px, 7/7 events, EXACT
native recording -> BROWSER replay:   0.16 px, 7/7 events, EXACT
```

**Cross-runtime drift is 0.15 px, not 16.7.** The two runtimes agree with each
other to a seventh of a pixel while both disagree with the original run by
sixteen — so the variable was never the runtime, it was the _build_: a
pre-provenance tape replayed against a tree many commits newer. _"The design's
reasoning was right and its conclusion was backwards."_ The design document was
corrected by a dated section at the top with nothing below it edited.

**2026-09-08 — a benchmark of a paused world, twice.** A review complained that
a scan cost was unmeasured. The study that answered it measured 900 ticks at
0.027 ms and produced a beautifully flat line across group sizes of 24, 88 and
524 — because **the room's boot card pauses the tree**, and a frozen world is
equally frozen at every size. A 24× understatement that looked exactly like the
answer _"the scan is free"_. It was caught because the study prints, beside
every timing, whether the robot actually moved: _"`moved 0 px` under a number is
unmissable; a plausible number on its own is not."_ The real figure is **0.95
microseconds per mateable face per tick**, so the four-room section costs
0.05 ms of a 16.7 ms frame — 0.3%. The rule the entry leaves behind is the most
portable line in the cluster: **every performance number in this repository
should be printed next to evidence that the thing being timed was doing
something.**

### Two more defects worth naming

- **`const TUNING` was compile-time-folding every knob read** (2026-08-18), so
  the live tuning panel silently did nothing. The follow-up is the interesting
  part: on 2026-08-24 the fix became _"a linter instead of a vigilance rule"_.
- **A misdiagnosis that stood two days and 84 commits.** A ratchet direction
  mark died at 2.2 px of stroke and the note written down was _"fine shape is
  the wrong channel at a 16 px boss"_. That sentence then justified five
  successive treatments — a solid wedge, cut-out chevrons, a taper, a rim arrow,
  a single tooth. It was never the shape: **purple `#7068a0` and tread green
  `#336c35` are near-complementary, so a low-alpha purple averages to grey.**
  It was the alpha. _"Five rounds of shape work were paid for by a misdiagnosis
  nobody re-tested."_

### State now

Active but paused since 2026-09-08 — the last four days of the window went to
caldea and songbook. **`main` is 19 commits ahead of `origin/main`**, covering
everything from 2026-09-05 to 2026-09-08: a twelve-entry day of refactors, a
measured review, and two completed plans. The `rooms` CI workflow — added
2026-09-03 to automate _"the 'there is no CI' this repository kept apologising
for"_ — triggers on push to `main` and has therefore not seen any of it. Three
collaborators cannot see it either. Tier 0 (_is magnetize-or-be-thrown fun?_)
is answered; the roadmap's stated priority is physics correctness, with the
tape/replay instrument built before the physics it is meant to judge.

---

## dont-lose-your-head — a 38-hour jam with three other people

_Godot 4.7.1, pixel art at 640×360, exported to itch.io web._

**What it is.** A game-jam entry on the theme _Body and Mind_: a skeleton's head
is knocked off by intrusive thoughts (rendered as "kikis", violet `#8a4fb5`),
and each day the body has to chase the head and settle both before sunset.
Four people — Tucker, Sean, Ben Hogoboom, smahre — three of them on their first
jam, learning Godot while shipping.

**What happened.** Everything, in two calendar days. The corpus records 175
commits on 2026-08-21 (53) and 2026-08-22 (122) plus 3 doc commits on 09-05; the
repo's own backfill entry, counting squashes correctly, says **200 commits
against a Friday 10:00 → Saturday 23:59 clock, split Tucker 140 / smahre 28 /
Sean 18 / Ben 14.** Friday is scaffold, decision record and placeholder
rectangles; Saturday is seven day-scenes, a sprite pipeline, a scripted opening,
touch controls and credits.

**The one measured thing worth carrying forward is the PR behaviour.** 64 PRs
opened, 62 merged, **median time-to-merge 2.9 minutes**, mean 26.0, max 11.9
hours — with **14 reviews across all 64**. Under jam pressure a PR is a merge
mechanism and a change-visibility mechanism, not a review mechanism, and the
team used it that way deliberately: the working agreement said self-merge if
necessary. This is the only repo in the cluster with real PR volume, and it is
the only one where more than one person is committing.

The one moment where the process broke against the clock is worth quoting
because it is the clearest statement of a tradeoff in the record: at 23:05 on
the Saturday — _"ok this is too musch smoke testing, we need to ship shit, is
the buttonless intereaction and kiki situation all dealt with?"_

Notable defects, all of the invisible-until-shipped kind: the intro sky was set
to `#201c02`, which was the sprites' own outline colour, _so every silhouette
vanished into the background_; `head.set_solid()` toggled a hitbox from inside a
physics callback, which Godot turns into an engine ERROR and the smoke suite
turned RED; and a button sprite sheet was doubled 48×16 → 96×32 without updating
its 16×16 atlas regions, which made every button invisible.

**State now.** Finished and frozen since 2026-08-22 apart from the 09-05 journal
backfill. One PR still open (#62, touch controls); one untracked
`build/.gdignore` that `.gitignore` explicitly negates and whose own comment
says it _is_ committed.

---

## songbook + songbook-content — a cheatsheet built in two nights and then used

_SvelteKit 5 / TypeScript / adapter-static, deployed to Netlify, read on an iPad
Air 2 (iPadOS 15.7 / Safari 15.6)._

**What it is.** A replacement for an Obsidian folder of song charts, for playing
covers. Opening ask, 2026-08-24 21:52: _"I want to build my song cheatsheet for
my old ipad custom, currently I use obsidian. I want to make it easy to add new
songs, either transcribed by me or pulled from ultimate guitar and converted
into my format."_ The design settled on a full transcription as the canonical
form with **five derived levels of simplification**, from every bar with lyrics
down to a one-page chord-and-section summary.

**What happened.** 117 commits over 7 days, essentially all of the build in two:
**22 commits on 08-24** (the spec, taken through five adversarial review rounds
before a line of code — _"take another pass, i want to start from a place where
an adversarial review returns only nits rather than big findings"_ — then the
`songformat` parser/serialiser with a round-trip guarantee), and **61 commits on
08-25**: a Needleman-Wunsch-based derivation engine, a transcription editor with
tap tempo and lyric-to-bar timing, an offline PWA reader, a legacy vault
importer, an Ultimate Guitar converter, and GitHub content sync. By 23:08 that
night: _"regenerated, replaced, it's on the ipad now, sync appears to have
worked."_

**The content repo is a security decision, not a convenience one.** `songbook`
auto-deploys a public site; a write token for it on a device _"that might be
lost or handed to someone at a gig"_ is remote code execution on that site. So
songs live in `songbook-content`, which has no CI and deploys nothing, and the
iPad's token is scoped there.

**Beliefs corrected on contact.** Tucker pushed back on a refusal to scrape
lyrics — _"how is this more exposed legally? Clearly AZLyrics and ultimate
guitar don't license every song they have on there"_ — and then took the
correction cleanly: _"understood, I didn't know that they license. I'll bring
the text."_ The agent held the line and the human moved; worth recording because
it is the opposite of the failure mode people expect.

**The false-green episode, 2026-09-09.** Reported as _"on the ipad, 4 ends up
truncating the song"_. The obvious suspect — level 4 is the cue-truncation level
— was ruled out with numbers: deriving all 36 corpus songs at levels 3, 4 and 5
gave **identical line and bar counts at 4 and 5 on every song** (flake 20/52,
stubborn-love 18/130, shape-of-my-heart 33/70). Nothing in `derive/` was ever
dropping content. The actual cause was CSS: **WebKit creates no overflow columns
for `column-count: 1`.** Measured side by side on a 40-section song in a
byte-for-byte replica of the reader's layout chain:

|                           | `.body` client height | content height | `scrollWidth`        | columns  |
| ------------------------- | --------------------- | -------------- | -------------------- | -------- |
| WebKit, `column-count: 1` | 744px                 | **9885px**     | 1475 (= clientWidth) | **0.98** |
| Chromium, same markup     | 382px                 | 382px          | 31963                | 39.93    |

Chromium fragmented the identical markup into forty columns; WebKit made one and
hid seven-eighths of it, with no scrollbar, no marker, and `scrollWidth ===
clientWidth` so the page-turn logic _correctly_ reported it was already at the
end — of the first screen of a nine-screen song. The entry says the thing
plainly: **"the app has been developed almost entirely in the engine that does
not have the bug."**

Three details make this the cluster's second-best instrument story. A
`/spike/multicol` harness already existed for exactly this class of question,
printed with _"Run this **on the iPad** — WebKit is what is under test"_ — and
there is no record of it ever being run on the device, and **it would not have
caught this anyway**, because it measured elements that were _split_ and this
bug's content was never laid out to be split. It has a `clipsContent` check now,
reported ahead of the split counts. A code comment claimed paged reading was
_"off by default until the stage-4 spike says WebKit honours `break-inside:
avoid`"_ — it had been **on** by default with the spike's verdict never
recorded: _"the gate was described in the code and never closed."_ And the new
stylesheet guard was **verified to fail against the old CSS before being kept,
since a guard that cannot fail is the mistake `no-endpoint.test.ts` was written
about.**

Honest accounting, quoted from the entry: _"The win is a two-line CSS change and
nothing else; the day's reading of `derive/` contributed nothing but a ruled-out
hypothesis, which is worth exactly what it cost and no more."_

**State now.** Live and in daily use. **1,202 tests across 55 files**;
typecheck, svelte-check, build and an `assert-no-content` guard all clean;
`to-fix.md` **empty for the first time** after nineteen items shipped between
31 Aug and 10 Sep. The stated bottleneck has moved off the tooling entirely:
**5 of 36 songs are transcribed in full**, the rest carry what the old vault
had.

---

## caldea — a novel, and the most regular cadence in the whole corpus

**What it is.** A literary/crossover SFF novel. Prologue + 15 chapters +
epilogue, targeted at ~64,650 words, rough draft due **Sat 7 Nov 2026**. The
repo is 17 markdown chapter files, an outline, a pilot screenplay pulled in for
reference, and a tracker.

**What happened.** 56 commits across **35 active days out of the 45 in the
window** — near-daily, with commit subjects that read like a diary rather than a
changelog: _"i think he gets it from your mother"_, _"restasis is a fun new
word"_, _"tamer getting ego checked"_, _"anna and silas being cute"_, _"small
changes, saving brain for game jam"_, _"touching the file for today, game
jamming"_. Two of those are the point: on the jam weekend he still showed up and
committed, explicitly to keep the streak.

**Claude's role here is not writing.** 222 transcript files across **62 distinct
sessions** — the highest session count per commit in the cluster — carrying only
913 tool calls between them. They are tiny sessions, and the recurring shapes
are: _"how are we on pace, what's the plan for this week?"_, _"where do we
stand?"_, _"update the tracker for me"_, _"is there a file on my computer called
love tales and faerie stories?"_, plus continuity and pacing consulting —
_"Mmmm, the pacing is the issue not the size. It feels weird to have a fight
with an automata followed almost immediately by a fight with silas."_ Tucker
also drew the line explicitly on 09-05: _"no work journal needed here, just in
code."_ And this is the one repo where the cheap models dominate: haiku-4-5 (91
sessions) and opus-4-5 (82) against opus-5 (9).

**The numbers, as of the tracker's own 2026-09-09 header.** 33,999 of ~64,650 —
**52.6%** — with **30,651 to write in 53 days, ~578/day**. Phase-1 pace is
~305/day against a 340 target. Chapter 6 moved 2,694 → 3,883 in two sittings
(+616 on Sat Sep 5, +573 on Wed Sep 9). And, recorded without softening:
**three consecutive missed days, Sun Sep 6 – Tue Sep 8 — the first breach of
rule 1 in the whole draft**, absorbed by raising the book-wide ask 559 → 578
rather than by moving the deadline. `wc -w` over the chapter files today gives
37,039 words, consistent with three more working days since.

**One ratio worth putting in front of the downstream reader without a verdict
attached.** The tracker is **16,474 words** and the outline **9,865** — 26,339
words of apparatus, almost all of it agent-written, against 37,039 words of
manuscript. That is 0.71 apparatus-to-artifact. Whether that is scaffolding or
displacement is not something the corpus can settle; the tracker is unusually
honest about pace slippage, which argues for scaffolding, and the three missed
days are the only counter-evidence.

**State now.** Active — the last commit in the window is 2026-09-12, _"the end
of th efight between carter and automata"_. Chapters 5 and 7 closed; chapter 9
deliberately allowed to run big after a Sep 5 rebalance that moved the book
target 64,200 → 64,650. Six chapters are still near-zero and are scheduled for a
month off work in October.

---

## the-bench (and octagonal-led-turn-counter) — the hardware track

**What it is.** An LED rim turn counter for an octagonal gaming table:
**ESP32-S3, a 221-LED WS2812B rim, eight piezo sensors under a wooden top**, and
a phone web UI over Wi-Fi. Tap your seat's edge of the table, the rim advances.

**What happened.** Two dense build nights inside the window (Aug 14–16, 41
commits) running four full _spec → plan → firmware → docs_ cycles a day or two
apart: a runtime piezo→side map calibrated by tapping, OTA flashing, phone
control of mode/brightness/off, a setup lock plus an `/api/diag` endpoint and
two timed modes (countdown and time-share), and a tap guard that quarantines a
chattering seat by loudness duty cycle rather than by chasing a threshold. One
commit that day reads _"turn_counter, web_ui: fix 13 defects from the
adversarial review"_. The loop is physical and Tucker is inside it: _"still
gettig phantom taps after tapping, I'm going to try replacing the piezo"_ →
_"alright new peizo in and this looks better, check on your end"_ — followed by
the commit _"inventory: side 7 piezo replaced, 1 spare disc left"_.

**Its own could-never-pass gate**, and the cheapest of the three in this
cluster to describe. `ota_flash.py` ran a TCP pre-flight against port 3232
before pushing firmware. **ArduinoOTA's port 3232 is UDP** — the device connects
_back_ over TCP after receiving an invitation datagram — so `socket.create_
connection()` failed against a healthy board that had just printed "OTA ready".
_"It blocked every push, not just broken ones."_ Found on the first real push;
replaced with an ICMP liveness test, since UDP has no handshake for a connect()
to confirm. The commit's own closing line is the reusable part: _"The unit tests
never touched this: they covered secrets parsing and platform discovery, not the
protocol assumption underneath, which is where the bug was."_

**The migration, 2026-09-04/05.** _"I want this to be part of a monorepo that
has the context for all my workshop projects, call it 'the-bench.'"_ The turn
counter came in by `git subtree` with its full history — **70 of the-bench's 78
commits are the turn counter's**, 8 are the new root — under a shared layer
whose reason for existing is `inventory.md`: spare stock, so a second project
does not re-buy a 100-pack already in a drawer. One consequence was written down
at migration time rather than discovered later: **subtree import breaks `git log
--follow`** for every migrated path, so the pre-merge tip `7b1ebb2` is recorded
in `bench/adding-a-project.md` as the handle for reading a file's real history.

**State now.** Quiet since 2026-09-05, clean, one project in it, no branches.
The standalone `octagonal-led-turn-counter` checkout no longer exists — which is
why it shows 104 transcript files, 51 operator turns and zero commits, and is the
single most misleading row in the corpus if read without this context.

---

## welcome-to-the-flower-court — 47 hours, deadline-shaped, and shipped

_SvelteKit + Tailwind v4 on Netlify, Resend for mail, remote `tucksravin/
invitations`._

**What it is.** An invitation site for a game of **The Flower Court** (Jay
Dragon, Possum Creek Games) that Tucker ran on **Monday 7 September at 3pm for
twelve to thirteen people** — and then, on top of it, the whole physical layer:
Cricut cut files for twelve papercut sigil badges, folded covers, and two-sheet
character dossiers printed from the site's own routes.

**What happened.** 75 commits in three days, 41 of them on the first. The
opening ask on 2026-09-05 at 17:57 was a reusable product — a theme engine,
per-guest HMAC links, Turso, an admin authoring UI, a two-week build. At 19:20
Tucker cut it himself: _"how would scope if I want to send out invites by end of
day today? doesn't need to be reusable, we can rebuild into a bigger project
with the lessons we learn building this."_ Turso went, and the governing rule
became **cut the abstractions, keep the mechanisms**. At 20:14 he split the
names too, so the throwaway would not squat on the reusable one: _"if we've a
wildcard for subdomains, let's rename this repo to welcome-to-the-flower-court
and the subdomain the same. Invitations will be the bigger, differently scoped
project we talked about earlier."_ He also time-boxed the agent directly:
_"I'm giving you an hour to finish this, if that leaves some things out of scope
that's ok."_

**The best design decision came from a constraint, not a feature.** With no
database there is no way to show which playbooks are already claimed, so two
guests could both claim the Prinxarch. Instead of building a race that cannot be
arbitrated, the form asks for a **ranked top three plus an opt-out list** —
which Tucker then confirmed is how he already casts. The entry's own conclusion
is the transferable one: _"the no-database version of this feature is not a
degraded version, it is the correct one."_ Separately, character creation was
cut from the invite after reading the game's own rulebook, which has players
fill sheets at the table — so the one genuinely sensitive field, a secret
objective, is never transmitted, stored, or emailed. _"A privacy problem solved
by reading the source material instead of by engineering."_

**Two beliefs corrected, one of them within hours of being written down.** The
first entry claimed the custom domain resolved instantly _"because there is
already wildcard DNS on `tuckerlemos.com`"_. There is no wildcard — a random
subdomain does not resolve at all. The real reason is that the domain's
nameservers are `dns{1..4}.p07.nsone.net`, i.e. Netlify DNS, so attaching a
custom domain makes Netlify create the records itself. The correction is a new
dated entry; **the wrong paragraph stays exactly as written**, which is the
reddoor-maintenance history rule applied on a personal repo three days after it
was rolled out there.

**State now.** The event happened; every guest email and the physical pipeline
went out. But **33 commits sit on `feat/sigil-badges`, unpushed and unmerged** —
everything from 2026-09-06 09:42 onward, including the cast, the twelve sigil
SVGs, the Cricut cut files, the dossier PDFs and the record of which email went
to whom. `main` is itself 2 commits ahead of `origin/main`. Three feature
branches, zero PRs. The work shipped to its audience and never reached its
remote.

---

## The four small ones

**ulti-grid** — an interactive teaching tool for ultimate frisbee defense:
place disc, offense and defenders on a grid; each open square's brightness shows
how available it is to the thrower, with defenders casting shadows over the
lanes behind them. Three real commits on 2026-08-02 (strip the Prismic starter,
extract the grid math into a tested pure module, rewrite the tool page with
legend/undo/share-links/keyboard). Dormant since; the only later commits are the
09-05 journal rollout.

**to-go** — a VS Code status-bar item that counts the day's words _down_ to a
target: `118 to go`, then `goal`, then `goal +240`. One commit, 2026-09-02, and
its README says exactly what it is for: _"A port of the bar at the bottom of the
scriptorium's screen, for the days that get written on the Mac."_ Word counting
is whitespace tokens _"the same rule micro uses, so the two machines agree on the
number"_ — a small, precise piece of cross-device instrument calibration, which
is a recurring habit in this cluster. It exists to serve caldea.

**a-budget** — self-hosted Actual Budget in Docker for envelope budgeting. Three
commits: payday check-in tooling plus a pnpm-11 native-build fix (08-14), a
recorded financial decision (_"Record the rollover IRA decision: leave it
Traditional"_ — the repo is used as a decision log, not just a container), and
the 09-05 journal. **Its `main` is 2 commits ahead of origin and it is parked on
`chore/work-journal` with two untracked TypeScript files** (`close-months.ts`,
`month-audit.ts`) that no commit references.

**songbook-content** — 37 song files, no CI, no deploy, and an explicit threat
model for why it is separate. See songbook above.

---

## Cross-cutting

**1. The personal cluster runs on zero CI, and that is exactly where the false
greens live.** Twelve Actions runs in the whole cluster over seven weeks — all
of them Broken's `rooms` workflow, added 2026-09-03, all successful. Every other
repo has none. Verification here is entirely self-built and locally run:
`run.sh`, vitest, Godot smoke suites, a `/spike/multicol` page, a `roomScan`
study. Three separate repos independently produced a gate that **could not
fail** — a runner blind to parse errors (Broken), a spike that measured only
content that fragmented (songbook), a TCP pre-flight against a UDP port
(the-bench). In each case the gate was authored by the same session that wrote
the code, run by nobody else, and believed until something forced a fresh clone,
a different device, or a first real push. The Reddoor rule _prove the
instrument before you trust its verdict_ is not a Reddoor-specific lesson; the
personal repos rediscovered it three times in four weeks, and Broken is now the
best-documented corpus of it anywhere in the record.

**2. Verification discipline transfers; push discipline does not.** The habits
that crossed over are the expensive ones — adversarial spec review before code
(songbook's five rounds), tests-against-the-defect ("verified by putting the
bug back"), corrections as new dated entries rather than edits, honest
accounting of which change actually produced the win. What did not cross over is
the thing the fleet enforces mechanically: **54 commits sit unpushed across
three repos at the end of the window** (Broken 19, flower-court 33, a-budget 2),
including Broken's four most recent working days and the entire physical-
artifact pipeline for an event that has already happened. Broken's CI gate is
real and correct and has simply never seen that work, because it triggers on
push. A gate you can bypass by not pushing is a gate on a habit.

**3. The work-journal convention was rolled out to the personal repos in a
single day.** On 2026-09-05, eight repos received the same two commits — _"Adopt
the work-journal convention"_ and, right behind it, _"docs: a corrected entry
needs a pointer from where the reader lands"_ (the forward-pointer rule).
a-budget, caldea, songbook, songbook-content, the-bench, to-go, ulti-grid and
dont-lose-your-head, each with a PR opened and merged the same day. Those eight
PRs plus the two Broken day-one PRs are the **entire** PR volume of the cluster
outside the jam. The backfill entries all carry the same trust-boundary
paragraph: _"Detail below this line is trustworthy; detail above it is not."_
This is a convention being deliberately propagated, and it happened on the same
day the same rule was reversed and made trackable in reddoor-maintenance.

**4. Subagent-first, at a ratio the fleet does not reach.** Broken: **25 distinct
sessions producing 642 transcript files** — 617 of them subagents and
workflows — with 324 `Agent` spawns and 30% of its 43,102 tool calls happening
inside subagents. songbook: 8 sessions, 342 files, 52% of tool calls in
subagents. The operator asks for this explicitly (_"subagent, and switched you
onto fable"_) and it is the single biggest structural difference between how
these repos are worked and how the numbers naively read.

**5. Artifacts and file-sends are the design-review channel.** 84% of every
`Artifact` publish and 75% of every `SendUserFile` call in the seven-week record
belong to Broken, used to argue about silhouettes, ratchet marks and controller
diagrams at revision granularity (_"can I see r 16 and 17"_, _"remove the last
paragraph and image about taupe from the artifact"_). This is a visual-iteration
loop that does not exist anywhere in the Reddoor work at this density.

**6. Cost and model selection are explicit and operator-driven.** _"switched you
onto fable, pretty much iunlimited on credits because we just got a reset and
have my week reset coming up tonight"_; _"continue with opus"_; _"switching
models back, i think you have enough data"_. caldea — the lowest-stakes,
highest-frequency repo — runs almost entirely on haiku-4-5 and opus-4-5, while
Broken runs 285 sessions on opus-5. The tier is being matched to the task
deliberately.

**7. One runaway-agent incident, on 2026-08-24 at 23:49–23:53.** In sequence:
_"i think you have enough screenshots calm down please"_ → _"this doesn't look
like stopping to me"_ → _"do you have other agents running in the background?"_
→ _"phew ok, what just happened? my system got overloaded and you didn't stop
your agents when i asked you to."_ Broken logged 63 interruptions and 50
`TaskStop` calls over the window, both the highest in the cluster. A stop
request that reaches the foreground session but not its background agents is a
concrete, reproducible workflow failure and the clearest actionable item in this
cluster.

**8. Scope is cut by the operator, fast and out loud.** The flower-court
two-week product became one hardcoded page in three hours. songbook's chord
popovers were dropped mid-build. Broken's prototype narrowed from a full drive
rig to "get the power cell from one side of the room to the other". The jam
dropped the interact key entirely. In every case the cut came from Tucker in a
single sentence, not from a planning artifact.

**9. Where the record is thin, and where it is silent.** The 2026-07-30 →
2026-08-09 reconstruction window costs this cluster 13 commits and no narrative
worth reconstructing. `the-bench` has 55 commits against only 4 distinct
operator turns because its work happened under the `octagonal-led-turn-counter`
cwd and moved afterwards. `songbook-content`, `ulti-grid` and `to-go` have
commits and zero sessions — the first because its app writes them, the other two
because their real work predates or sits on the edge of the transcript window.
And Discord and Airtable — the two systems that make Reddoor work legible —
contain effectively nothing about any of this.
