# Week 03 — 2026-08-10 → 2026-08-16

**Headline.** The week the fleet's instruments were caught lying — three wrong
diagnoses in one Wednesday morning produced the repo's top standing rule, while
the same failure shape (a check that could never pass) turned up four more times
that week in four unrelated stacks.

---

## COVERAGE — read this before trusting anything below

**Transcripts begin 2026-08-10.** This is the first week with any session or
prompt data at all, and coverage inside it is uneven in a way that matters.

| Source                             | Coverage for this week                | Caveat                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commits.jsonl`                    | complete                              | 299 commits, 41 repos scanned                                                                                                                                                                                                                                                          |
| `prs.jsonl`                        | complete                              | 131 opened, 108 merged                                                                                                                                                                                                                                                                 |
| `runs.jsonl`                       | **partial**                           | per-repo cap of 300 runs. `reddoor-maintenance` runs only go back to **2026-09-04**, `reddoor-website` to **2026-08-22**. Neither repo's CI appears in this week at all. `hedloc` runs failed to fetch entirely (`gh-errors.txt`). The 606 in-week runs are therefore site repos only. |
| `sessions.jsonl` / `prompts.jsonl` | **partial, and the gap is the story** | see below                                                                                                                                                                                                                                                                              |
| Discord                            | 100 messages, 12 channels             |                                                                                                                                                                                                                                                                                        |
| Airtable                           | complete                              |                                                                                                                                                                                                                                                                                        |
| `docs/workJournal.md`              | **does not exist yet**                | the journal opens 2026-09-05. Nothing in this week was written down at the time in the repo.                                                                                                                                                                                           |

**The single most important gap: the 2026-08-12 fleet session is not in the
corpus.** The memory note `fleet-state-2026-08-12.md` carries
`originSessionId: b371bb1c-4fcf-4f13-87ab-1968587e98db`, and that id appears in
**neither** `sessions.jsonl` nor `prompts.jsonl`; nor does the 08-10/08-11 fleet
session (`fab1b4c3-2bb9-4340-ba8c-09ce8176ed7b`); nor is there a transcript file
for either under `~/.claude/projects/`. Between **07:08Z and 16:24Z on 08-12**
the two sessions we _can_ see (beachfront, reddoor-website) are silent — a
nine-hour hole. Every fleet event in that window landed from a session whose
transcript is gone.

So the 08-12 incident — the origin of `CLAUDE.md`'s "prove the instrument before
you trust its verdict" — is **reconstructed**, not observed. The reconstruction
is unusually strong because the evidence is primary and contemporaneous: the
commit messages of the PRs involved argue the case in full, minute-stamped, and
the memory note was written the same afternoon (`modified:
2026-08-12T20:59:58Z`). But no prompt of Tucker's from that session survives,
and I do not have and will not invent one.

**Timezone convention used throughout.** Prompt and session timestamps are
**UTC** (checked: `good morning` lands at 17:01Z = 10:01 PT). Git commit dates
are **local PT** (UTC−07:00). PR and Actions timestamps are **UTC**. Where two
are compared I convert to UTC and say so.

**Prompt counting.** 872 raw prompt rows in the week; `prompts-unique.jsonl`
holds 414; after removing task-notifications, system reminders, injected
compaction summaries (17 of them) and auto-generated summarisation prompts,
**242 turns are actually Tucker typing.** Those 242 are what "prompts" means in
the table below.

---

## CALENDAR

| Day       | Commits | Repos w/ commits | PRs opened / merged | CI runs (site repos)           | Sessions¹ | Tucker's turns |
| --------- | ------- | ---------------- | ------------------- | ------------------------------ | --------- | -------------- |
| Mon 08-10 | 61      | 13               | 73 / 18             | 115 (2 fail)                   | 26        | 17             |
| Tue 08-11 | 33      | 20               | 9 / 20              | 129 (1 fail)                   | 22        | 9              |
| Wed 08-12 | 81      | 22               | 11 / 31             | 160 (5 fail)                   | 93        | 41             |
| Thu 08-13 | 12      | 4                | 7 / 9               | 53 (0 fail)                    | 149       | 48             |
| Fri 08-14 | 11      | 5                | 3 / 2               | 36 (0 fail)                    | 58        | 14             |
| Sat 08-15 | 14      | 3                | 1 / 1               | 34 (0 fail)                    | 5         | 18             |
| Sun 08-16 | 87      | 17               | 27 / 27             | 79 (4 fail)                    | 145       | 95             |
| **Total** | **299** | **28 distinct**  | **131 / 108**       | **606 (12 fail, 98.0% green)** | **498**   | **242**        |

¹ "Sessions" counts every transcript file including subagent sidecars. Only
**9 sessions in the whole week have ≥4 user turns.** The work is concentrated in
a handful of enormous parent sessions.

**Commits by repo:** beachfront-dentistry 84, the-bench 41 (the LED table
firmware), reddoor-maintenance 25, reddoor-website 25, Broken 21 (game), caldea
11 (a novel — no agent involved at all), revogen 9, hedloc 8, reddoorla/.github
8, caltex-landing 7, gallerysonder 7, espada 6, + 16 more.

**The parent sessions, measured:**

| Session    | Repo                           | Start → end (UTC)         | Wall       | Turns | Tool calls                    | Interrupts |
| ---------- | ------------------------------ | ------------------------- | ---------- | ----- | ----------------------------- | ---------- |
| `02eae5da` | beachfront-dentistry           | 08-10 16:02 → 08-14 04:32 | **84.5 h** | 431   | 3,956 (2,086 Bash, 147 Agent) | 3          |
| `32c72721` | reddoor-website                | 08-11 22:20 → 08-13 23:44 | **49.4 h** | 152   | 4,655 (2,518 Bash)            | **9**      |
| `ac0de484` | reddoor-maintenance (worktree) | 08-12 23:16 → 08-14 17:47 | **42.5 h** | 89    | 605                           | 0          |
| `5f3eb023` | the-bench                      | 08-15 00:50 → 08-16 23:33 | **46.7 h** | 75    | 667                           | 0          |
| `32629913` | reddoor-maintenance (worktree) | 08-14 17:49 → 08-16 20:02 | **50.2 h** | 18    | 500                           | 1          |
| `accd6bd5` | reddoor-website                | 08-16 15:51 → 08-17 02:52 | 11.0 h     | 54    | 1,033                         | 0          |
| `49826d53` | Broken                         | 08-16 20:07 → 23:08       | 3.0 h      | 28    | 220                           | 0          |
| `6fceb5c8` | scriptorium-setup              | 08-16 16:57 → 18:31       | 1.6 h      | 6     | 74                            | 0          |
| `ba720e39` | Broken                         | 08-16 16:00 → 16:43       | 0.7 h      | 6     | 24                            | 0          |

Four sessions ran longer than 40 hours of wall clock. **17 compaction summaries**
were injected across the week; the beachfront session alone re-entered
`markup-review`, `new-site`, `brainstorming`, `writing-plans` and
`subagent-driven-development` five times each — i.e. it was compacted and
re-primed roughly five times.

**Shape of Tucker's 242 turns:** 25 (10.3%) are him hand-operating Prismic /
Slice Machine on the agent's behalf ("pushed types", "published the migrate",
"just published, verify"). 19 (7.9%) are status polls ("anything outstanding?",
"still spinning?", "ci still running?"). 21 (8.7%) are a bare
"continue"/"go for it"/"resume". That is **27% of the week's operator input
spent on plumbing, polling and unblocking**, not on direction.

### Per-day notes

**Mon 08-10 — fleet Monday + beachfront onboarding opens.** 73 PRs open (the
Monday Renovate batch); 13 repos take commits. `02eae5da` opens at 16:02Z with
"good morning, pushed this to live on friday so we could cancel webflow". Two
beachfront PRs land (fleet audits, Turnstile in the modal). In the evening the
markup.io skill is specced and built. Separately — and **with no transcript** —
a fleet session retires the org RENOVATE PAT (#514), onboards `reddoor-md-pdf`,
closes the 17-PR "cookie" override wave, and ships two Renovate preset rules
(.github#25, #26). `hedloc` takes 8 client-feedback commits the same day with no
session in the corpus.

**Tue 08-11 — verification day, and the medtech board arrives.** 20 repos take a
commit but only 33 commits: almost all of it is the prettier-plugin-svelte v4
wave and the unfrozen lockfile batch (11 PRs merged 21:17–21:30Z). Tucker works
Tim's MarkUp pins on beachfront all afternoon. At 22:29Z he drops a Figma URL
into reddoor-website and `32c72721` begins.

**Wed 08-12 — the heaviest day.** 81 commits, 22 repos, 31 PRs merged, 41
operator turns across three chats. The fleet incident (below) runs 18:31Z →
20:57Z. The 24-PR majors-and-held sweep merges 20:04–20:48Z. beachfront #24 —
9,735 additions across 74 files — merges at 22:21Z. reddoor-website ships the
first `/medtech` preview.

**Thu 08-13 — the day of many chats and few commits.** 12 commits, 4 repos, but
**48 operator turns** and 149 session files: three parallel conversations
(beachfront mobile pass, medtech design round, prismic-models plan execution).
The "we're not matching anymore" intervention lands at 20:48Z.

**Fri 08-14 — the fleet quiets, the personal projects start.** 11 commits.
#526 (headless Prismic model delivery, +24,211/−16 across 66 files) merges
18:16Z. Two `a-budget` commits. The LED table firmware picks up at 18:53 PT.

**Sat 08-15 — one project, one session.** 14 commits, 3 repos, 5 session files.
Effectively the whole day is `5f3eb023` on the turn counter.

**Sun 08-16 — the second heaviest day, and the most fragmented.** 87 commits
across 17 repos, 27 PRs opened and 27 merged, **95 operator turns spread over
five projects at once** (reddoor-website 25, Broken 27, the-bench 27,
reddoor-maintenance 10, scriptorium 6). Two releases (0.83.0, then 0.84.0), a
12-repo dependency bump, a 7-repo CI rollout, and a live end-to-end proof on a
client repo.

---

## BEATS

### 1. Beachfront comes off Webflow, and the operator is the credential bus

_(Mon 08-10, `02eae5da` opens 16:02Z)_

> "good morning, pushed this to live on friday so we could cancel webflow but
> there's still some stuff to be done, take a look at the repo and state of
> everything re:fleet onboarding and get this up to standard with everything
> else"

One sentence, and the session it opened ran for **84.5 hours**. The first hour
is ordinary: PR #22 clears the remaining fleet audits (+115/−48, 14 files), #23
mounts the Turnstile widget in the appointment modal.

The interesting part is the credential negotiation, because it recurs all week:

> 18:36Z "look in reddoor maint, you should have an access key for turnstile"
> 18:39Z "nope, i mean you, the agent, should have access to my turnstile setup through a pat"
> 18:47Z "rolled and readded to maint env"

Three turns to establish where a secret lives, ending with Tucker rotating a
token and pasting it. The same pattern appears for MarkUp ("api key is in reddor
maint env" → "saved look now"), for Dropbox ("dropbox dropped in this env, is
there a longer term solution for me to put in reddoor maint"), and for the
Prismic tokens on 08-14 ("the tokens should all be minted, in the maint env and
across other repos on this machine, try and find them and then let me know
what you're missing" → "They're not labeled correctly, but check keys and imply
which they should be"). **The operator is the credential discovery layer**, and
every one of those exchanges costs two to four turns.

### 2. A tool built in an evening, from one question to a merged spec

_(Mon 08-10, 18:51Z → 20:38Z)_

> 18:51Z "ok, next thing, can you integrate with markup.io?"
> 19:03Z "let's do A"
> 19:04Z "write up the spec"
> 19:20Z "subagent works go for it"
> 20:35Z "merge the pr when green, would love to test this skill with some comments tim left in markup for beachfront"

Ninety-four minutes from question to merged design spec (#515, +578, merged
20:38Z). The scoping happened through `AskUserQuestion`, and Tucker's framing is
worth keeping because it defines a category the fleet did not have:

> "none of these, I just want you to have access to them so I can fix them in
> LLM driven sessions, there won't be a trickle of these there will be discrete
> rounds of review, this doesn't need to tie into the fleet architecture"

**A workflow note the corpus makes visible and nothing else does:** the spec
lives in the repo, but the artefact — `~/.claude/skills/markup-review/` — does
not. It is a user-level skill on one machine, with no version history, no
review, and no way for another session to discover how it got there. The same is
true of `CLAUDE.md` this week (untracked in `reddoor-maintenance` until #699 on
2026-09-05). **The two pieces of tooling this week that shaped the most agent
behaviour were both outside version control.**

### 3. Tim's 31 pins, and what happens when the reference stops being the arbiter

_(Mon 08-10 → Wed 08-12, beachfront PR #24: +9,735 / −904, 74 files)_

The markup-review skill's first real run: 31 pins across 6 boards, worked
through as ~12 fix rounds. Beachfront had been built against a pixel-matching
harness that treated the old Webflow site as ground truth. Tim's pins
contradicted it, and Tucker had to rule:

> 08-11 18:39Z "ones the original has we should follow tim's instructions instead"

That ruling removed the only automated arbiter in the loop, and the cost is
measurable in the wave divider — a single SVG shape that took **five commits
across three days and four operator corrections** to settle:

- `17a5986` (08-11) "the crest rolls now — Tim's pin outranks the reference's own flat spot"
- → 20:53Z **"for the shape, you're adding a little bump instead of following the same consistent wave shape"**
- `226bf79` "one crest, not a bump"
- → 21:46Z **"rewiggling is fine, I want a real sine wave even if it means we add some height to the page. I'm no longer concerned about matching the original webflow."**
- `bdccb5f` "a real sine — the divider stops impersonating the webflow swoosh"
- → 22:19Z "sine looks good now"; then 08-12 22:45Z "nav should still have links centered like before, sine should be only up/down on each page landing at the same height"
- `ad8132d` "the divider lands level and lets go of the text"
- → 08-13 01:18Z **"the wave svg has two sine wave, I want a single up and then down, coming back to neutral on both side, should be the same on any screen size"**
- `7cca1bd` "two sine periods where the operator wanted one up and one down"

**The belief corrected on contact:** the team believed the reference site was the
spec. Once the designer outranked it, nothing in the toolchain could evaluate
"right", and the operator became the gate for a shape — six turns of visual
judgement that no test could have absorbed. `a5abd7e` names the collateral
damage in its subject: _"the menu links stay centered — H2's gutter alignment
was a misread"_ — the agent had over-generalised one of Tim's pins across the
nav.

### 4. Things that shipped, passed every check, and did nothing

_(Wed 08-12, beachfront)_

Three in one day, all found by probing the running page rather than by any gate:

**`5875db5` — the nav transition that never ran.** `transition:fly={{y:-800,
duration:700}}` sat on an overlay one `{#if}` block deeper than the one that
toggles it. Svelte transitions are local by default, so it played on its own
block's creation and never on the ancestor's. _"It parsed, type-checked, linted
and shipped, and animated nothing — probed frame by frame, opacity 1 and
transform none from the first frame after the click."_ The fix is `|global`. The
rebuilt entrance is measured, not guessed: rows rise 22px over 300ms, 45ms
apart, after a 90ms lead, because _"on expoOut the wash is ~0.88 opaque at 90ms"_.

**`4671665` — the Playwright option that never reached the page.** The suite set
`use: { reducedMotion: "reduce" }`. Probed: the page still reports
`matchMedia("(prefers-reduced-motion: reduce)").matches === false` at config,
project and test level; only an explicit `page.emulateMedia()` flips it.
_"So every spec that believed it ran reduced was running with motion ON."_
Removing it changed nothing at runtime — 71/71 still passed — which is exactly
the point.

**`b789000` — the spec that could not see the bug it existed to catch.** Its
scroll pass used `scrollTo(0, y)`, which obeys the page's `scroll-behavior:
smooth`, so on an 8,000px page it never got past ~122px and fired almost none of
the reveals. It then read opacity from the immediate parent when the reveal lives
on an ancestor, so it policed hidden elements at their pre-reveal offsets. _"That
is why trimming the reveal travel in `5d76b70` turned four passing cases red
without changing a rendered pixel."_ Fixed, it immediately caught a real defect:
the FIJI label renders at opacity 1 inside the footer wave's box at 390/480/700,
with baselines measured at 80.4 / 76.8 / 68.0px.

**Honest accounting:** none of these were caught by CI. All three were caught by
an agent instrumenting the live page because the operator asked for a motion
audit. There is no gate in this repo that could have found any of them.

### 5. ⭐ The 08-12 fleet morning — three wrong diagnoses, and the rule they produced

_(Wed 08-12, 18:31Z → 20:57Z UTC. **Reconstructed** — see COVERAGE. Primary
evidence: the PR bodies, which argue the case in full, plus
`fleet-state-2026-08-12.md`.)_

This is the episode `CLAUDE.md`'s top rule is built on. It is worth laying out
in order, because the three failures are not three mistakes — they are one
mistake three times.

**(a) A belief nobody checked, propagated through three config PRs in three days.**

On 08-10 a session diagnosed `hedloc#30`'s red CI and wrote the cause into
`.github#26`:

> "Fleet CI's pnpm 11 policy (minimumReleaseAge=1440) rejects lockfile entries
> younger than 24h, but the preset had no matching gate on the Renovate side"

That justified adding a fleet-wide `minimumReleaseAge: "1 day"` to the Renovate
preset. On 08-11, `.github#27` exempted lockfile maintenance from the new gate,
repeating the premise verbatim: _"fleet CI's pnpm supply-chain policy already
rejects lockfile entries younger than 24h at install time."_ On 08-12,
`.github#28` finally read the source:

> "it justified the exemption on a pnpm supply-chain policy rejecting lockfile
> entries younger than 24h. **No such gate exists** — every fleet repo sets
> `minimumReleaseAge: 0` in `pnpm-workspace.yaml` (10/10 sampled, including
> reddoor-starter, which every site clones)."

Three fleet-wide preset changes in 72 hours, all downstream of one premise that
took a `grep` to disprove. The second-order cost was real: #26's gate emitted a
pending `renovate/stability-days` status that **froze all 11 lockfile PRs of the
Monday batch**, which is what #27 then existed to undo.

**(b) A true fix shipped with a false story, merged one minute after opening.**

`.github#28` was opened 18:31Z and **merged 18:32Z**. Its description claimed
_"18 non-major PRs across the fleet sat CI-green, CLEAN, automerge-eligible and
unmerged."_ `.github#29`, merged 51 minutes later at 19:25Z, retracts it:

> "16 of the 17 site PRs were never automerge-eligible. `group:allNonMajor`
> groups `@reddoorla/maintenance` into nearly every site's non-major branch, and
> the never-auto-merge packageRule for graph-reshaping packages therefore applies
> to the whole grouped branch. Those PRs were correctly awaiting a human and a
> green Netlify deploy preview — **the rule doing precisely its job**."

Only `reddoor-maintenance#509` — the one group with no held package — was
actually subject to the deadlock, and it had stayed green and unmerged across
four Renovate runs including two manual dispatches. So the mechanism was real
and the blast radius was overstated by 17×. The corollary that entered CLAUDE.md
comes from this PR verbatim: _"before calling green unmerged PRs 'stuck', check
whether a packageRule is deliberately holding them."_

**(c) A gate that could never pass, whose own commit message argues it is sound.**

This is the centrepiece. `#521` (merged 19:07Z) added a `preview_site`
workflow_dispatch input to daily-reports so the GA/Search Console secrets could
be proven on demand. Its reasoning for existing is airtight, and confirmed by
Airtable: **no report row was created anywhere in the fleet between 2026-07-30
and 2026-08-24.** In #521's words:

> "the only thing that can confirm them is a naturally-due report, and the
> earliest is Sonder on 2026-08-31: a three-week feedback loop on a credential
> that either works or silently does not."

Its reasoning for correctness is also carefully argued — and wrong:

> "The verdict step greps the rendered HTML for the ANALYTICS block, which
> `renderAnalyticsSection` emits only when `hasAnalyticsData()` is true. Its
> presence is therefore a **non-circular proof** that the credentials resolved
> and real numbers came back."

Non-circular, yes. Capable of passing, no. `#523` (merged 20:57Z) found why:

> "`draftReportForSite` used `base === null` to mean two unrelated things: never
> write to Airtable, AND perform no IO at all. Only the first is what
> `previewOnly` actually asks for… The conflation made `report <slug> --preview`
> **structurally incapable of ever rendering an ANALYTICS section**, however good
> the GA credentials were. #521 then built a CI credential proof on top of that
> path, so it failed 100% of the time and reported the result as 'GA/Search
> Console credentials did not resolve' — a confident, always-wrong alarm sitting
> in main, on exactly the surface whose job is making real failures visible.
> **Both of today's preview runs (Sonder, Reddoor) were that instrument failing,
> not the secrets.**"

The credentials had been fine since 08-10. Once fixed, `preview_site: Reddoor`
rendered **1,869 Users ▲127% (824 → 1,869)**.

**The full repair chain, minute by minute (UTC):**

| Time   | PR          | What                                                         |
| ------ | ----------- | ------------------------------------------------------------ |
| 18:36  | #521 opened | the gate                                                     |
| 19:07  | #521 merged | ships                                                        |
| ~19:1x | —           | first real run dies: `No Websites row matched slug "Sonder"` |
| 19:24  | #522 opened | slugify `preview_site`                                       |
| 19:36  | #522 merged | the input the gate documents did not work                    |
| ~19:4x | —           | two runs now report "GA credentials did not resolve"         |
| 20:50  | #523 opened | split `base === null` into two concepts                      |
| 20:57  | #523 merged | the instrument can now pass                                  |

**2 hours 21 minutes** from first commit to an instrument capable of a green.
Three merges to make one check work. And `#522` contains the week's best piece
of honest accounting, about its own failure:

> "the draft step's `continue-on-error` masked the exit code as success, and the
> ANALYTICS verify step is what actually failed the run. **That is the gate doing
> its job on the first try.**"

**(d) The one thing that worked — and the discipline it demonstrates.**

The same session had to answer "does `setup-node` v7 break `release.yml`'s npm
publish". Instead of arguing, it built a throwaway branch with a push-triggered
workflow running **v6 and v7 as two literal jobs under release.yml's exact
conditions**. Result: v6 exports a dummy `NODE_AUTH_TOKEN=XXXXX-XXXXX-XXXXX-XXXXX`,
v7 leaves it unset; npm does emit `Failed to replace env in config` under v7 —
but as `[WARN]`, and **every return code is identical**. #511 merged.

Two caveats were recorded at the time and both are load-bearing:
`npm publish --dry-run` returns rc=1 under _both_ versions, so the probe proves
"no regression", **not** "publish works"; and a step's `uses:` accepts no
expressions, so a matrix over action SHAs fails the whole run as a workflow-file
error — hence two literal jobs. `CLAUDE.md` also records that the probe's own
`VERDICT` line printed "OK" for both versions because it grepped the wrong
command, and the real answer came from reading the raw output. Even the probe's
summariser needed proving.

**What the week actually taught.** All three failures are the same shape:
_something was built on a mechanism whose implementation was never read._ Two of
them were one file-read away from never happening. The rule that came out of it —
**a new gate must be shown to PASS on a known-good input before any FAIL it
produces is reported as a finding** — is not a general principle someone liked;
it is the minimum procedure that would have caught all three.

**And the rule had no home.** `CLAUDE.md` was untracked in this repo until
2026-09-05 (#699). The most expensive lesson of the week was written into a file
with no history, on one machine, three weeks before anyone could diff it.

### 6. The Figma board becomes a product — and the operator becomes the CMS

_(Tue 08-11 22:29Z → Thu 08-13, session `32c72721`: 49.4 h, 152 turns, 4,655
tool calls, **9 interruptions** — the densest of the week)_

> "https://www.figma.com/design/…/RD-Sales-Funnel-LP?node-id=3074-2227 want to
> add this (board v2 only, see the comments). should be at /medtech, with the
> ability to make more of these for different industries with the slice model.
> reuse slices we already have if possible, make new ones if now."

A one-paragraph brief that became a new Prismic custom type, ~11 slices, two
upstreamed to `reddoor-starter` (#103), and a 10,147-line PR.

**The PR-as-preview pattern.** At 16:45Z on 08-12: _"can we commite and open a
PR so I have a netlify deploy preview to look at + share?"_ — `#128` exists to
produce a URL, not to merge. It was **closed unmerged**, as was its successor
`#132` (14,269 additions, 89 files). The work landed weeks later under `#133`
("Release: medtech industry landing page + inquiry funnel"), measured from
`origin/main`. The deploy preview was shared to `#rd-website` on 08-13 15:51Z
and the team reviewed there. **The PR is the review surface; merging is a
separate, much later decision.** Any tooling that assumes open-PR ≈ merge-intent
will misread this repo badly.

**The Prismic hand-crank.** Twenty-five of Tucker's 242 turns are him operating
Prismic because the agent cannot:

> "pushed types" · "published the migrate" · "pushed, let me know when i need to
> click the migration" · "slice machine pushed, check discord nicole just added a
> link with mobile crops" · "published migration release" · "just published,
> verify" · "prismic draft is published" · "pushed the models, are the drafts
> ready?" · "i don't see a migration releae and yes, commit" · "open slice
> machine for me"

This is the demand signal that produced the week's largest engineering project
(beat 7). It is also the clearest single workflow finding of the week: **a human
click sat inside an otherwise automated loop, and it cost ~10% of all operator
attention.**

**Corrections, in Tucker's words:**

- 19:27Z "I don't see the before after toggle for phlex, no logo soup, and I want
  you to do a close pass of the spacing margins, **we're supposed to match the
  figma exactly, that's why its there**"
- 20:53Z "**don't roll your own slideshow, we have a component for that**"
- "figma is source of truth, google doc is for any information missing from it"
- 19:44Z, walking back his own instruction: "on second thought, ideally we keep
  the toggle, just use the variation or a blank Spacer slice if that's easier.
  Trying to keep this easy and unbreakable design wise."

**A cross-chat collision, measured.** At **19:27Z** Tucker tells reddoor-website
"we're supposed to match the figma exactly". At **19:30Z** he tells beachfront
"ignore my last message, put it in the wrong chat". Three minutes, two sessions,
and the standing instructions in those two sessions were _opposites_ — beachfront
had abandoned pixel-matching the day before. Running parallel long-lived sessions
with contradictory standing orders is a real hazard here, and it fired.

**Two genuine defects found by measuring rather than looking:**

- `a47f4f1` — the carousel box was a hardcoded `aspect-video`. **No slideshow on
  the site is 16:9**: published sets run 1.29 to 1.62. `/portfolio/champion`
  spent **37%** of its box on empty side bars, `/portfolio/toyota` 19%, and
  `/portfolio/msot` (2.215) was letterboxed into a box taller than its artwork.
  18 slices across 11 pages. The fix deliberately does _not_ hide a genuine
  outlier: cropping a portfolio piece is the owner's call, not a layout default.
- `e1ab68f` — `ScreenWidthMedia`'s aspect ternary fell through to `""`. Harmless
  for `<img>` (intrinsic dimensions), fatal for `<iframe>` (none): a full-bleed
  video rendered as a **1440×150** letterbox slot on `/portfolio/msot`, which is
  exactly what Erik reported in `#msot` on 08-13.
- `24d3ebf` — and the **audit that flagged a defect that did not exist**: the
  slideshow-ratio flag compares spread against a 1% tolerance, but the per-slide
  "odd one out" marker compared `toFixed(3)` strings, so an 1800×1199 export
  sitting **0.09%** off its 1800×1200 neighbours landed the wrong side of the
  third decimal. Another instrument corrected the same week.

### 7. The stale types, the trap, and the fleet's biggest build of the week

_(Wed 08-12 22:53Z → Sun 08-16)_

**The discovery.** While clearing beachfront's Prismic work, `2767a45` found
`src/prismicio-types.d.ts` badly stale, and measured it: **150 declared types
against the 189 the models produce**, missing **four entire slices**
(ExamTimeline, FirstVisitToc, QuestionList, ServiceCategoryBand) plus every
variation of Hero, Carousel and CollectionList, and still listing **11 dead
`blux_*` choices**. The root cause is structural, not neglect:

> "`src/prismicio-types.d.ts` says 'Code generated by Slice Machine. DO NOT
> EDIT.', and there was **no way to obey both halves of that sentence**. The
> adapter emits it from a custom-type WRITE hook, which only fires through Slice
> Machine's UI."

**The trap, and Tucker asking to be told about it.** At 08-13 01:06Z:
**"merge on green, describe the trap to me"** — PR #26 merged at 01:07Z. The trap
materialised the next day as `#28` / `8f3229a`: #21's lockfile refresh had left
**two copies of `@slicemachine/manager` in the pnpm store (0.27.4 and 0.27.5)**,
and the regen script found the package by scanning the store and taking whichever
directory `readdir` returned first — 0.27.4 — while `slice-machine-ui` resolves
0.27.5. _"Today they agree and the script still reports 'up to date'; the day they
stop agreeing, the symptom is a diff nobody ordered."_ Resolved through
`slice-machine-ui` so the two cannot disagree by construction.

Six minutes later: **"add this as a fleet wide issue to be tackled in future
probably tomorrow"** (01:12Z). It was tackled that night.

**The spec that is the counter-example to beat 5.** `2026-08-12-prismic-headless-model-delivery-design.md`
was approved at 23:18Z on 08-12 — _"this spec looks good, write the plan"_ —
one hour and twenty minutes after #523 fixed the false alarm. It opens with a
proof table of six live probes, and it says why:

> "`PRISMIC_WRITE_TOKEN` (credentials.env) @ gallerysonder, reddoor-la — **403**…
> The 403 row matters as much as the 200s. It reproduces the historical failure
> that produced the standing 'types can only push via Slice Machine' rule, and
> localises it: the deny is a property of _that one older token_, not of the
> Types API. **Same probe, five passes and one controlled reproduction of the
> known failure — this satisfies the prove-the-instrument rule in CLAUDE.md.**"

It also carries a **"Refuted — do not re-propose"** section: Type Builder is an
Admin-only web UI with no branch/PR/CI (adopting it would _remove_ Git as the
gate); `PRISMIC_TOKEN` is an undocumented user-session token that cannot
bootstrap in CI; `prismic init` is destructive (`rm -r`s local slice directories
absent from the remote, component code included) even under `--no-setup`. That
section is the most reusable artefact of the week — four dead ends written down
so nobody walks them twice.

**Execution.** "subagent" (08-13 00:42Z), then "continue on" ×4 across two days,
in a worktree (`ac0de484`, 42.5 h, 89 turns, 38 general-purpose + 10 code-reviewer
subagents). `#526` merged 08-14 18:16Z: **+24,211 / −16 across 66 files.** The
reusable workflow (`.github#30`) splits the dry/apply paths into **separate jobs
rather than steps**, because _"job permissions cannot be conditional… Each path
is INCAPABLE of the other's action rather than merely told not to"_ — and records
that an earlier draft gating on `github.event_name == 'push'` alone would have
pushed a feature branch's models to production.

**Three follow-ups, each a correction:**

- `#528` — `reddoor-wireframer` is a placeholder **that resolves**: HTTP 200, two
  starter documents last published 2024-03-12, _"so no failed lookup will ever
  expose it as a placeholder the way a 404 would."_ Left unlisted it is a
  permanent `unknown` on the row and a nightly cockpit warning no credential can
  clear. Token doctor: 1 missing → 0.
- `#529` — _"a minus line said the opposite of what it meant."_ `- variation rail
(REMOVED remotely)` read as "the remote removed it"; the truth is the reverse —
  Prismic still **has** it, and pushing is what deletes it, _"taking the document
  data with it at HTTP 200 and no warning."_ Fixed before the workflow reached
  client repos, because that wording is what CI posts on every model PR. The same
  PR fixed **two digest tests that had been red on `main` for four days**: both
  asserted on a fixture stamped 2026-08-12 while letting `runDigest` fall back to
  the real clock, so once time crossed `PRISMIC_DRIFT_STALE_DAYS = 3` they
  failed. Code right in both readings; the tests were time-dependent.
- `#530` — _"refuse to install a workflow the site's own CLI cannot run."_ The
  reusable workflow runs the **site's** binary, and `prismic-models` first ships
  in 0.83.0. Measured at publish: **all twelve delivery candidates pinned
  something older, 0.28.0 through 0.82.0. A rollout that day would have broken
  every one.** It reads the lockfile, not the package.json range (espada declares
  `^0.81.0` and resolves 0.69.0), and has three distinct refusals — too old /
  cannot establish / ambiguous — _"because a gate that cannot tell 'too old' from
  'could not read' reports one as the other."_

**The operator unlocks the rollout.** 08-16 17:40Z: **"why do we have to wait
until monday rather than bumping all the repos now?"** Eleven minutes later, 12
manual `^0.83.0` bump PRs open (17:51–17:52Z); they merge 18:18–18:19Z; the 7
delivery-workflow PRs open 18:30Z and merge 18:50Z. **Seventy minutes from
question to a fleet-wide CI rollout**, which the Renovate schedule would have
delayed by two days.

**And then the instrument was proven, properly.** `caltex-landing#54` adds a
temporary probe field ("test(prismic): temporary probe field to prove headless
model delivery"), merged 19:33Z; `#55` reverts it, merged 19:37Z. **Four minutes,
on a live client repo, with the revert pre-planned.** That is the 08-12 lesson
executed correctly, four days later.

### 8. "I've said three times now we're not matching anymore"

_(Thu 08-13 20:48Z, beachfront)_

The sharpest operator intervention of the week:

> **"what are you checking right now? I've said three times now we're not
> matching anymore"**

He had. 08-11 21:46Z: _"I'm no longer concerned about matching the original
webflow."_ 08-12 16:24Z: _"yep we're no longer chasing matching so that's fine."_
And the compaction summary injected at 08-12 22:14Z states it as a standing
constraint in its own first paragraph: _"The pixel-matching program has ENDED —
`matching/` gates are not to be run."_ **The instruction survived compaction and
was violated anyway**, thirty minutes after the agent had committed a fix _to the
matching harness_ (`4867fe5`, 08-13 13:18 PT = 20:18Z).

**Honest accounting: the disobedient run found something real, and Tucker kept
it.** `4867fe5`:

> "The mechanical check for CLAUDE.md rule 3 (three strikes, then stop) was
> **failing OPEN**, which is the one way this particular check may not fail.
> `strikes.mjs` derives the page name from the ref URL, while `gate.sh` and
> `next.mjs` key on the gate page KEY. Those agree only where the key equals the
> path — home, our-team, services… an empty match then printed 'strikes: clear —
> no failing region has stalled' and exited 0.
> **Rule 3 was therefore enforced on 10 of 33 stalled regions.** yfv, contact,
> atd, svc, qa and team reported clear while holding 4/2/3/5/4/5 stalled regions
> — **23 hidden, every one flat for 16+ runs.**"

Tucker's reply, one minute later: _"do the strikes fix, you can merge these in,
anything else outstanding?"_ A fifth instrument found lying, in a harness that
had already been decommissioned.

A minute of friction worth noting from the same session: at 21:59Z, after the
agent proposed a next step, Tucker asks **"what do you mean remeasure?"** — the
agent had drifted into its own vocabulary.

### 9. The weekend: the same failure shape, in three unrelated stacks

_(Fri 08-14 → Sun 08-16)_

**The LED turn counter.** Note first that the checkout is
`~/Documents/GitHub/octagonal-led-turn-counter/octagonal-led-turn-counter` and
its remote is **`tucksravin/the-bench`** — a live instance of the
directory-name ≠ repository-name hazard CLAUDE.md warns about for
`welcome-to-the-flower-court`. (It is also nested one level deeper than the
scanner looks, so it is absent from `repos.jsonl` entirely while its 41 commits
appear under `the-bench`.)

`04cd87b`, 08-15, is beat 5 again in C++:

> "**ota_flash: drop the TCP pre-flight, which could never pass.** ArduinoOTA's
> port 3232 is UDP… The pre-flight used `socket.create_connection()`, so it
> probed TCP 3232 and failed against a healthy board that had just printed 'OTA
> ready'. **It blocked every push, not just broken ones.** …Found on the first
> real push. The unit tests never touched this: they covered secrets parsing and
> platform discovery, not the protocol assumption underneath, which is where the
> bug was."

A gate that had never passed, three days after the GA one, in a different
language, a different repo and a different domain — written by a session that
had no access to the fleet's CLAUDE.md.

The rest of the weekend on that project is a good model of review-heavy work:
`6253f7c` fixes **13 defects found by a 54-agent adversarial review of two plans'
diff — 24 findings survived verification** before deduping. The tap guard then
went v1 → v2 because _"adversarial review of v1 confirmed four majors sharing one
root: rate bands overlap human play in both directions"_; the replacement
discriminator is a measured one (loudness duty cycle: _"taps top out ~10% even
machine-gunned, hum sits at 50%, pinned at 100%"_). And the real control was
physical — "I'm going to try replacing the piezo" → "alright new peizo in and
this looks better" — the firmware guard had been compensating for a dying sensor.

**scriptorium-setup**, 08-16, a third dead instrument:

> "**the wi-fi check asks after a hostname google deleted.**
> `connectivity-check.gstatic.com` (hyphenated) went NXDOMAIN, so **every network
> on earth read as 'joined, but no route out'**."

Tucker's report was the classic symptom of an alarm rather than a fault: _"our
wifi went out yesterday, now the scriptorium connects but I get the error that
it's offline. same pattern on my phone hotspot and home wifi."_ Same-symptom-
everywhere is the tell, and it took the agent one probe.

**Broken** (a game, `smahre/Broken`, with a collaborator) is the only place all
week where Tucker is doing pure creative direction, and he corrects the agent's
reading twice:

> "you're misreading the green bottom, that will eventuall be your legs (tank
> treads). for the jam we just want the head, torso and arm"
> "fictionwise you're still incorrect, it's a dark ending. you've been
> homogenizing which is the greater purpose of the strip miner, to smooth the
> earth and extract. **the work you do is fixing the maching by erasing all the
> beautiful little imperfections you find along the way**"

The agent had written the anti-entropy theme as redemptive; Tucker inverted it,
and the commits follow the correction exactly (`2866faf` "Tighten hook" →
`b00477c` "Invert the fiction: the grain is the horror" → `d830b33` "Correct
color is pale near-white: serenity, not reward"). Two turns to move a whole
design document's premise.

**caldea** — 11 commits of novel prose across the week ("i think he gets it from
your mother", "tamer getting ego checked", "anna with the cerebrum") with **zero
sessions and zero prompts in the corpus**. The one thing Tucker did entirely by
hand.

### 10. Sunday's sub-pixel endgame, and the operator asking for a measurement loop

_(Sun 08-16, reddoor-website, 25 commits)_

The `/medtech` process section went through five commits in six hours on the
strength of Tucker looking at it:

> 18:54Z "process section: no line above it arrows don't match the design, we
> should also do a custom animatation for them in as we scroll down…"
> 20:05Z "the animation still results in the heads of the arrows not touching the
> line, **please use playwright to check things as you build them**. numbers in
> the circles appear very slightly off center, can you confirm and fix?"
> 22:45Z "**you're wrong about animateIn**, the vertical cascade happens because
> of scroll triggers and feels better and more reactive that way, don't do the
> vertical list"
> 23:34Z "the numbers still feel off center to me, too far to the right in the
> circles"

Each correction produced a commit that is worth reading as an example of the
measurement quality this codebase reaches when pushed:

- `86eacf4` — the animateIn reversal, in the agent's own words: _"The previous
  commit read animateIn wrong. Its vertical cascade does not come from the delay
  term at all — it comes from every element carrying its own IntersectionObserver…
  Adding an index stagger replaced a **trigger** with a **playback**: the same
  sequence every time, whatever the reader was doing."_ Verified by walking the
  page in steps and recording the scroll position each row revealed at. It also
  fixed the arrow test _"which this exposed rather than broke"_ — lazy media above
  the rail kept the page growing while a measurement was in flight.
- `8c5f0a3` — the numerals. One 1.2px nudge for all of them could not work
  because `letter-spacing: 1px` lands a pixel after the _last_ digit too, and the
  tabular figures draw every digit centred in its 8.12px slot **except `1`**,
  which sits 0.46px left with a 2.74px right bearing. Averaging left `02`/`03`
  sitting **0.69px** right of centre. Per-numeral correction: worst circle 0.69px
  → **0.06px** across.
- `ede1be1` — and then the cross-engine pass, which is the best single piece of
  measurement in the week: _"Firefox put the numerals 0.48px right of where
  Chromium and WebKit did… a transform alone matches across all three engines,
  and a negative margin alone matches too. **Only the two TOGETHER diverge.**
  Firefox pixel-snaps a transformed element's layout position."_ Worst |dx| across
  three engines: uncorrected 1.56/1.58/1.69 → margin+transform 0.06/0.42/0.19 →
  transform-only **0.06/0.08/0.19**.

**The line worth carrying forward** is Tucker's: _"please use playwright to check
things as you build them."_ He had to ask. Three of the week's five discovered
false greens were found by an agent instrumenting the running page — but only
after being told to.

---

## Cross-cutting: what this week is evidence for

**Five distinct false greens, in five unrelated systems, in seven days.**
(1) `#521`'s GA gate, structurally incapable of passing; (2) Playwright's
`reducedMotion` option that never reached the page; (3) the reveal spec that
could not scroll and read the wrong node; (4) `strikes.mjs` failing open on 23 of
33 stalled regions; (5) the OTA pre-flight probing TCP against a UDP service.
Add the slideshow audit flagging a 0.09% difference as a defect, and the
Renovate preset justified by a pnpm gate that does not exist. **Not one of these
was caught by CI. Every one was caught by someone probing the real thing.**

**The fleet loop went quiet mid-week and nobody noticed.** Fleet-state memory
notes exist for 08-10, 08-11 and 08-12, and then stop. Thursday through Sunday
there is no fleet sweep at all — attention went to product work — and the only
reason that is visible is the absence of a file. The nightly audits stayed green
(98.0% of 606 site-repo runs), which is exactly the condition under which a
stopped sweep is invisible.

**Two 40-hour sessions carried the week, and paid for it in re-priming.** 17
compaction summaries; skills re-entered five times in one session; one standing
instruction violated three statements and one compaction after it was given.

**The operator is still in three loops he should not be in:** clicking Publish
in Prismic (25 turns, 10.3%), polling for status (19 turns, 7.9%), and locating
credentials (at least 4 multi-turn exchanges). The first of those generated the
week's largest project; the other two did not generate anything.
