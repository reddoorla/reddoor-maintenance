# Week 07 — 2026-09-07 → 2026-09-12

**Headline:** A recipe that packages "match a reference page" as an installable
gate was shipped, and then found to be lying in four separate ways — every one
of them discovered by _using_ it on a real client rebuild rather than by
reviewing it — while in parallel the prospect report grew an operator-edit layer
whose first three proof attempts proved nothing; the week's most expensive
single correction was not technical at all, it was Tucker noticing an agent had
rebuilt a component that was already sitting in the repo, for the second time in
one day.

---

## SOURCE COVERAGE — read this before believing any narrative detail

**Transcripts are FULL for this week.** Retention begins 2026-08-10; every day
here is well inside it. This is also the densest week of the retrospective for
contemporaneous prose: two repos wrote **41 work-journal entries between 09-08
and 09-12** (reddoor-maintenance 20 on `main` + 1 on an unmerged branch;
29-navy 21), plus one in reddoor-website, one in claude-skills, and shorter ones
in vida-legacy-foundation and gallerysonder.

| Source                                         | Status for this week                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commits.jsonl`                                | **Full.** 306 rows, 305 unique SHAs, 16 checkouts. 248 authored by Tucker Lemos, 57 by `reddoor-renovate[bot]`, 1 by `github-actions[bot]`.                           |
| Commit **bodies** (`git log` in the checkouts) | **Full, and load-bearing.** Several run 30–50 lines with file:line citations and measured before/after numbers.                                                       |
| `docs/workJournal.md` in the checkouts         | **Full and extraordinarily dense.** This is the primary narrative source for the week and the reason this chapter is written as a _complement_ rather than a summary. |
| `prs.jsonl`                                    | **Full.** 123 opened / 92 merged in the local-day window.                                                                                                             |
| `runs.jsonl`                                   | **Full.** 737 runs, 16 non-success (2.2%).                                                                                                                            |
| `sessions.jsonl`                               | **Present, but the per-day numbers are misleading** — see caveat 2.                                                                                                   |
| `prompts.jsonl`                                | **Present and heavily duplicated / inflated** — see caveat 3. Use `prompts-unique.jsonl`.                                                                             |
| `discord-messages.jsonl`                       | **Present — 111 messages**, 19 channel/author pairs, 4 humans. Carries Tim's portfolio review rounds, Nicole's VLF rounds, Erik's VLF asks.                           |
| `airtable-*.json`                              | Snapshot dated 2026-09-12. Not materially used here.                                                                                                                  |

### Four measurement caveats that change the numbers

1. **Two clocks.** `commits.jsonl` carries local timestamps (`-07:00`);
   `prompts`, `sessions`, `prs` and `runs` carry UTC. Verified directly: a
   29-navy prompt at `2026-09-09T00:21:00Z` and a 29-navy commit at
   `2026-09-09T18:03:54-07:00` are 18 hours apart, not 18 minutes.
   **Everything in the CALENDAR below is converted to local (UTC−7).** A naive
   read of the raw `day` fields pushes every evening's work into the next day —
   which is exactly what makes the brief's "29-navy takes 175 prompts on Sep 9"
   read as one heroic day when the work actually straddles Tue evening →
   Wed afternoon.

2. **`sessions.jsonl` rows are session _files_, not sittings, and `durMin` is a
   file span, not attention.** 297 rows in the UTC window; only **48** are main
   sessions and **249** are `agent-*.jsonl` subagent transcripts. Two
   megasessions carry almost the whole week:

   | sessionId  | repo                | start → end (UTC)         | span                   | user msgs | assistant turns | tool calls | subagent files |
   | ---------- | ------------------- | ------------------------- | ---------------------- | --------- | --------------- | ---------- | -------------- |
   | `d2b6a2f6` | reddoor-maintenance | 09-08 19:00 → 09-11 19:54 | **4,374 min (72.9 h)** | 178       | 5,260           | 2,484      | 28             |
   | `99991f90` | 29-navy             | 09-09 00:20 → 09-12 16:34 | **5,294 min (88.2 h)** | 283       | 10,256          | 4,541      | 83             |

   Because `metrics.json` attributes a session to its **start** day, Friday
   09-11 shows "13 sessions / 353 tool calls / 230 durMin" while actually
   carrying 38 commits, 5 journal entries and a major design correction. **Do
   not use per-day session counts for this week.** Prompts-per-local-day is the
   honest proxy.

3. **The prompt corpus overstates operator input by ~3.3×.** 690 rows in
   `prompts.jsonl` fall in the window; `prompts-unique.jsonl` dedupes to 383;
   stripping harness-injected text (`<task-notification>`, compaction summaries,
   `<command-name>` blocks, the recurring ~6,000-char skill preamble) leaves
   **209 messages Tucker actually typed**. For 29-navy specifically: 287 raw
   rows → 98 unique → **32 typed**. Every quote below is from the stripped set,
   verbatim, typos included.

4. **`runs.jsonl` `conclusion: cancelled` on `lighthouse` is normal.** 4 of the
   16 non-success runs are `lighthouse` cancellations on superseded pushes, not
   failures. Real red: 12 runs.

Everything below is (a) quoted from a transcript, commit body, journal entry or
Discord message, (b) an arithmetic aggregate over the corpus, or (c) explicitly
marked INFERRED.

---

## CALENDAR

All times local (UTC−7). "Prompts" counts only messages Tucker typed.

| Day       | Commits (uniq) | Repos | PRs open/merge | CI runs (fail) | Prompts | Human span    |
| --------- | -------------- | ----- | -------------- | -------------- | ------- | ------------- |
| Mon 09-07 | 39 (39)        | 9     | 0 / 0          | 53 (0)         | **2**   | 10:38 → 14:30 |
| Tue 09-08 | 82 (81)        | 7     | 54 / 22        | 188 (7)        | 66      | 09:30 → 23:58 |
| Wed 09-09 | 66 (66)        | 8     | 26 / 25        | 166 (5)        | 44      | 00:00 → 23:09 |
| Thu 09-10 | 70 (70)        | 9     | 22 / 28        | 165 (3)        | 59      | 09:04 → 22:13 |
| Fri 09-11 | 38 (38)        | 8     | 19 / 16        | 108 (1)        | 27      | 00:02 → 21:54 |
| Sat 09-12 | 11 (11)        | 3     | 2 / 1          | 36 (0)         | 11      | 09:33 → 11:01 |

Commits by repo, by local day:

| repo                        | 09-07 | 09-08 | 09-09 | 09-10 | 09-11 | 09-12 | total  |
| --------------------------- | ----- | ----- | ----- | ----- | ----- | ----- | ------ |
| reddoor-website             | 4     | 26    | 23    | 13    | 6     | —     | **72** |
| 29-navy                     | —     | 10    | 12    | 25    | 14    | 5     | **66** |
| reddoor-maintenance         | 9     | 12    | 9     | 10    | 6     | —     | **46** |
| claude-skills               | —     | 16    | —     | 2     | 2     | —     | **20** |
| beachfront-dentistry        | 3     | —     | 11    | 4     | —     | —     | **18** |
| vida-legacy-foundation      | 4     | 1     | 2     | 2     | 4     | 4     | **17** |
| Broken (Godot, personal)    | —     | 15    | —     | —     | —     | —     | **15** |
| songbook (personal)         | —     | —     | 4     | 11    | —     | —     | **15** |
| reddoor-starter             | 4     | —     | 4     | —     | 2     | —     | **10** |
| gallerysonder               | 3     | —     | —     | 2     | 3     | —     | **8**  |
| erp-industrial              | 6     | —     | —     | —     | —     | —     | 6      |
| caldea (writing)            | —     | —     | 1     | 1     | 1     | 2     | 5      |
| data-dynamiq                | 4     | —     | —     | —     | —     | —     | 4      |
| rfp-analyze                 | —     | 2     | —     | —     | —     | —     | 2      |
| welcome-to-the-flower-court | 2     | —     | —     | —     | —     | —     | 2      |

### Per-day notes

**Mon 09-07 — effectively a day off, with 39 commits.** 37 of the 39 commits are
`reddoor-renovate[bot]`: the Monday batch landing `pnpm` v12, `vitest` v5,
`@changesets/cli` v3, `google-auth-library` v11, `resend` v6, `listr2` v11,
`slice-machine-ui` v2, `@prismicio/svelte` v2 and lockfile maintenance across
erp-industrial, data-dynamiq, gallerysonder, beachfront-dentistry,
reddoor-website, reddoor-starter, vida-legacy-foundation and
reddoor-maintenance. **Zero PRs opened, zero merged, zero CI failures.** The
only human work is two typed prompts in `welcome-to-the-flower-court` (a
personal invitation project): "send the doxe email to Sophie.Havranek@gmail.com
please" at 10:38, and at 14:26 "for the covers, could you make a couple slits on
the midline for mock scoring to make the folding more precise?" — an agent asked
to design a paper-folding jig.

**Tue 09-08 — the biggest day of the week and the widest.** 66 typed prompts
across 7 repos in a 14h28m span. Four things start on the same day: the prospect
audit check battery lands (#703, +12,413/−32, 28 files); the `claude-skills`
repo is created and seven skills are imported into it; `29-navy` is bootstrapped
from the starter and reaches a live deploy overnight; and reddoor-website begins
the generated-OG-card work plus what becomes a three-day design loop with Tim on
the portfolio sticky pin. 54 PRs opened — the week's peak — and 7 CI failures,
also the peak.

**Wed 09-09 — the match-harness day.** Work runs from 00:00 through 23:09 with a
sleep gap. reddoor-maintenance ships #733 (the match-harness recipe, +5,058/−1,
18 files) and then writes **eight journal entries dated 09-09**, five of them
about defects in code merged the same day. In parallel Tucker asks the question
that starts the override layer, and it goes question → design spec → two
implementation plans inside eleven hours.

**Thu 09-10 — the fix-and-prove day.** 70 commits across 9 repos. Three
match-harness defects fixed upstream (#748, #749/#750, #758, #759), the fixed
harness upgraded in place on 29 Navy, 29 Navy's home page built from 4/20 to
16/20, the override store and serving route shipped, the staging→main promotion
run, and a client GTM email drafted for gallerysonder. Also the day Tucker says
"how far can you get without me, going to bed soon."

**Fri 09-11 — close-out plus the week's sharpest correction.** Edit mode proven
end to end against production; the cockpit surfaces edited/opened; a journal
entry is written that invents two defects and is corrected the same afternoon;
and the "stop reinventing components" thread produces `docs/COMPONENTS.md`,
a prompt hook, and a change to the starter that ships both to every new site.
Only 27 typed prompts — the lowest working day.

**Sat 09-12 — a short morning.** 29 Navy pre-show close-out (#28), a VLF person-
card clip fix, two caldea writing sessions, and at 10:53 the request that
produced this document.

---

## BEATS

### 1. Monday: the fleet updates itself, and nobody is home

MEASURED: 37 of Monday's 39 commits are Renovate's. Zero PRs were opened or
merged and zero CI runs failed. All 37 landed on branches that Renovate itself
merges in-run under the fleet's configured windows.

This is worth one paragraph only because it is the baseline the rest of the week
should be read against: the dependency lane genuinely runs without Tucker. The
two typed prompts on Monday are both on a personal paper-craft project. INFERRED
(from the absence of any session with tool calls against a client repo): Monday
was a day off, and the fleet's Monday batch is now boring, which is the desired
end state.

The one thing that _did_ need him lands the next morning.

---

### 2. "what's going on with the erp vuln" — a red that nothing could fix

Tuesday's first typed words, 12:01 local, into reddoor-maintenance:

> what's going on with the erp vuln

The answer, recorded in the 09-08 journal entry's honest-accounting paragraph:
two fleet repos had been red for five days on Dependabot alerts filed against a
`package-lock.json` deleted in June. GitHub's dependency graph keeps serving a
manifest after the file is gone, so the alerts name a file no bump can reach and
no toggle can suppress on a public repo. Both were dismissed as inaccurate.

Tucker's next message, six minutes later: "yes please fix and add that issue" —
the issue being #702, asking the security audit to tell an unfixable finding from
a fixable one.

**Why this belongs in a workflow retrospective and not just a changelog:** the
signal was a permanent red that the tooling had no vocabulary for. It cost a
human prompt to resolve, it will recur on the third repo (`la-homelessness-
initiative` is latent with the same shape), and the audit that surfaces it is
still blind to the distinction as of Saturday. This is a _class_ of alarm the
fleet can generate but not classify.

---

### 3. The check battery lands, and the replay catches the fix that claimed to fix it

The audit "check battery" — 46 checks over a crawled prospect site — had been
sitting at forty commits with no PR. Tucker at 12:31: "alright let's do some
audit work, are we ready to write the battery into the output?" At 13:02, after
being offered options: **"finish it"**.

What followed is the week's clearest instance of this repo's founding rule, and
the journal records it in full (`2026-09-08 — The replay caught the fix, and then
caught my fix`). The parts worth carrying forward for a workflow reader are the
**three instruments that had to be disqualified before any verdict could be
read**:

- `pnpm lint` in the main checkout reported **1,771 errors**. Every one was the
  same typescript-eslint parser error, and every one named a file under
  `.worktrees/` — _other sessions' checkouts_, which ESLint walks because it does
  not read `.gitignore`. In a clean worktree the count was **1**, and that one
  was real (an unused `contentPages` helper).
- The full suite reported **49 failures**, all `listen EPERM` — the Bash sandbox
  refusing sockets. The same eight files passed **96/96** outside it.
- The corpus replay reported **zero verdict changes**, which would have closed
  the question — except the dumps on disk still showed coyote.us at 46 missing
  URLs and richardmacdonald.com at 52 of 52, the exact numbers the patch's own
  comment claimed to have fixed.

The third was the real finding. `sitemap-coverage` never called the `norm2`
normaliser at all; it keyed URLs with its own inline
`u.replace(/\/+$/, "").split("#")[0]`, keeping scheme, `www.` and percent-
encoding. The patch had improved `norm2` and written a correct comment about a
function the check did not use. **The fix described was right; the diff had never
reached the place it needed to be.**

Then the corrected version was replayed, and the replay caught _that_ too:
sapidyne.com's `description-length` flipped to "all 1 are between 40 and 200
characters" because sapidyne declares `/` as the canonical on **19 of its 20
pages**, so folding on the declaration measured the whole site as one page. The
belief corrected on contact, stated in the journal in one line worth quoting:
_"a page that says it is another page is not therefore that page."_ The rule
became `sameDocument` — a page folds only onto a page we read that reads the
same, title, description and headline all agreeing.

Two limits on the instrument were recorded and both matter downstream: the replay
**compares status only**, so "nothing changed" means no verdict flipped, not that
the change did nothing; and the **disk** corpus is the one to replay, because the
database rows predate `metas`, `links` and `scriptSrcs`.

COST, MEASURED: #703 opened 21:36Z and merged 21:56Z — 20 minutes as a PR, but
the work behind it ran from 12:31 to ~21:30 local. The release that followed
**failed on `main`** (`release` / push / failure, 21:56Z) and produced #704 the
same evening: `release.yml` also runs the suite, so it also needs a Playwright
browser installed. A gate had been added to `ci.yml` and nothing had been added
to the workflow that actually reds `main`.

---

### 4. Tucker reads the output and finds a client-facing defect nothing was checking

At 18:04 Tucker pastes a block of the generated report back into the session:

> What the AI says about you that is not on your site
> We did not find these on your site.
> — The company's legal name is Reddoor Creative, LLC.
> — Reddoor Creative is a design agency.
> — The business is based in the Los Angeles area.
> …
> several of these things are on our site...

This is the most important prompt of the week and it contains no instruction. A
section of a **prospect-facing sales artefact** was asserting, in Reddoor's own
voice, that facts plainly present on the site were absent from it. No gate had
this in scope. No test could have: the section is a judgement, not a boolean.

The next morning (09-09 08:51) he specifies the fix as copy, not code:

> thought on the wording for "What the AI says about you that is not on your
> site" second line: change it to "these are claims that seem not to be sourced
> from your site"

and then, at 09:58, refines it again and explains _why_ in a way that is really a
statement about epistemics:

> I think let's undo the split, all can stay under the top level if we remove a
> bit from the heading … now the hedging is honest and necessary; there's a
> greyness in things that are said elsewhere but could be implied from our site.
> For instance "A man named Tim leads Reddoor Creative." I'm guessing AI got this
> from linkedin because tim is more active than erik there, but both tim and erik
> are listed on our site, so it's a bit overblown to say its not on our site,
> even though it flags real misleading information

That produced reddoor-website #172 (`copy(report): claims not sourced from your
site, rather than not found on it`, +5/−3) and #173 (`the heading claims nothing,
the hedged line carries it`, +94/−114). Two PRs, 0.9h and 0.2h cycle time.

**And it produced the whole second workstream of the week.** At 10:18 the same
morning, in the same breath as a UI request:

> where the back to the top button is, once the user is in the page proper, if
> it's not active I want a "start a conversation" button (red outline + text).
> **if we want to edit your generated copy before we send to someone, can we do
> that?**

Then at 10:52:

> is there a way we could integrate it with prismic? have a source report but any
> line of it can be overwritten? or do some thinking/investigation and come back
> with recs

The override layer exists because a generated artefact said something false about
Reddoor and the operator decided the right answer was a human override rather
than a better generator. MEASURED: from that question (09-09 10:52) to the design
spec approved ("spec is approved", 17:47) is **6h55m**; to two implementation
plans merged (#745, +3,000 lines) the same evening is **~8h**.

---

### 5. `claude-skills`: seven skills extracted, and a deliberate rule break

Tuesday morning, in reddoor-starter:

> I want to do a few more webflow converstions like we did with beachfront, would
> it make sense to build another offshoot of this starter repo to that purpose?

and immediately the constraint that shapes the answer:

> the thing is that I don't want to carry bloat into a new site, we jsut spent a
> lot of work breaking out the blux site before working on vlf since baking it in
> corrupted the starter

That is a belief formed by injury in an earlier week being applied correctly.
Over the next four prompts he pushes on the alternatives — "give me pro cons for
docs only vs the line seam?", "what exactly would the optional loader do?",
"Shouldn't slices be able to get that data through content relationships, or if
it's necessary site wide, in a store that we load in layout.ts?" — and lands on
no new template at all. Then:

> and where should this work live if I want it to be repeatable for new sites?
> … repeatable shouldn't be just skills yes? are the scripts all in place and
> acceptable?
> … understood, let's get the skills tight with the aim of starting a new site at
> the end of this session. pleas make a plan, take whatever time you need, and
> ask me any questions that you have

MEASURED OUTCOME: `reddoorla/claude-skills` created the same day. 16 commits on
09-08, **67 commits / 89 tracked files** at the end of the import, 83 of them
under `skills/`. `matching-a-page` and `rfp-analyze` came in via `git subtree
add` so their history survives; the other five had no history anywhere and got
one honest first commit each.

Three defects were found and fixed on the way in, and all three are the same
genre — code that had never been exercised the way it would now be exercised:

- **Entry-point checks silently no-op'd through a symlink.** Reached through a
  symlink, `process.argv[1]` keeps the symlink path while `import.meta.url` is
  the real one, so `import.meta.url === pathToFileURL(process.argv[1]).href` is
  **false** and the CLI exits 0 having done nothing, with no error. `page-diff.mjs`
  and `style-census.mjs` had the same shape and had simply never been run through
  a symlink — which is exactly what an installed skill is.
- **Exactly one machine-bound absolute path** existed across 83 files
  (`matching-a-page/SKILL.md:173`, importing Playwright from this laptop's
  `node_modules` by `file://`). A different class — 32 `~/Documents/GitHub`
  references — was _not_ caught by that search and had to be found by hand.
- **The repo's own gate could never run:** `node --test test/` is not a
  directory scan (commit `6d5b535`).

There is also a measured storage note worth keeping: `~/.claude/skills/matching-
a-page` was **354 MB**, ~71 MiB of it unreachable objects from an aborted
`git add`. Cloning through the transport path rather than hardlinking, then
`git gc --prune=now`, produced **212K** of `.git` with history intact.

**The deliberate rule break.** The whole import landed on `main` **directly,
without a PR**, because a squash merge would have destroyed the subtree history
that was the entire point of the import. The reason is written into the README
and the journal. FOR FABLE: this is a case where the merge contract and the goal
were in direct conflict and the resolution was an undocumented-until-now
exception. It worked, and it is the kind of thing that should be a named
exception in AUTONOMY.md rather than a decision re-derived each time.

---

### 6. The portfolio pin: nine commits, one Zoom, and a full circle

Tuesday 09:30, reddoor-website: "check discord, every page gets og images through
meta image yes?" The answer was no, and Tim's Discord ask (16:24 Tue) had two
parts: OG images for every page ("It shouldn't be the PNG of the debossed reddoor
logo. It looks super cheesy.") and a sticky per-project title on the portfolio
page, delivered as a **Dropbox screen recording**.

The OG half is clean engineering: satori + resvg-wasm, fonts bundled, the wasm
inlined, cards drawn **at build time** because a serverless function was the wrong
place (#162, #165). One correction from Tucker at 15:32 — "just use the title by
default for the text, if we want something else we'll add it ourselves" — turned
into #168 (`a generated card says the page's title, not invented copy`).

The sticky-pin half is the friction story. MEASURED sequence of commits on
09-08 alone:

| sha        | subject                                                            |
| ---------- | ------------------------------------------------------------------ |
| `e353d4e4` | pin each featured project's title block while it scrolls           |
| `978ce8e6` | bare-type pin, above everything, with room at both ends            |
| `ce7c562b` | pin sits under the fixed nav, above every page layer               |
| `d70797d5` | the pin is the name and the arrow only                             |
| `8545ca0a` | pin at subheading size, arrow centred and weighted to the type     |
| `90869b7a` | pin back at body size in the 1/5 gutter, arrow kept at type weight |
| `4ff46ac2` | stack the pin's arrow under the name                               |
| `affbe881` | red arrow on a translucent white disc in the pin                   |
| `d372af67` | the translucent pad goes behind the whole pin                      |
| `9ff2db15` | **drop the pad, the pin is bare type again**                       |

Ten commits in one day; the tenth returns to the fourth. The prompts that drive
them are short and explicitly revisionary:

> noo halo, and lets kill the media discriptors (just title+arrow)
> center the text vertically with the arrow and let's go with a bigger heading,
> try the h3 subheading from the homepage …
> **ok I preferred the old way, go back to that but keep the scaled down arrow**
> make the arrow red and bg-fff/30, p-4
> sorry not just the arrow, the whole pin with the title
> **hmmm go back to no bg for now**, merge into staging after that once ci is
> green and let me know

Then rounds 2 and 3 on Wed and Thu (#175, +486/−54, open **26.1 hours**), and on
Thursday 18:12 Tim writes: _"A couple of small notes, not sure what possible for
where the sticky title stops and starts. I may be getting too icky/nerdy about
it"_ → _"I'll can jump on a zoom or make a video"_ → Tucker: _"drawing is best, I
can hop on zoom if you prefer"_ → _"let's do a quick zoom."_

**COST, MEASURED:** across 09-08 → 09-10, reddoor-website took **72 commits**, of
which roughly 20 are the pin. Cycle time per iteration is minutes; the latency is
entirely in the Discord round-trip. Tucker's own message at 10:49 Wed shows he
had already priced it: _"remove the padding on the pin, I already know we're
going to get pinged for it not being flush with nav home link."_ He was pre-
empting a review round he could predict and could not avoid.

**FOR FABLE:** this is not an agent failure. Every agent turn here was correct
and fast. It is a **specification-channel** problem: pixel-level design intent
arriving as prose-in-Discord + a .mov, with no shared artefact to annotate. The
one thing that broke the loop was a Zoom call. Notably, a _different_ channel
already exists in this fleet and was not used here — the `markup-review` skill
works a MarkUp.io board of pins. INFERRED: it was not used because Tim was
reviewing a deploy preview, not a board.

---

### 7. 29 Navy: bootstrapped overnight, and what that proved wrong

Tuesday 17:21, a new session in a directory that did not exist yet:

> alright, ready to convert this site, what do you need from me to get runnin on
> this?

By 23:42 Tucker had read the plan set and issued the handoff that defines this
fleet's operating mode:

> ok, do BC, ask me any questions or permissions you need from me now, i'm going
> to sleep and want you to run as autonomously as possible

then at 23:46: "published, going to bed."

MEASURED: `29-navy` first commit 09-08, ten commits that day, and by the
following morning the repo had gone from `Initial commit` through bootstrap,
Prismic wiring, Netlify, a delivery workflow and a live deploy. The 29-navy
journal carries **six entries dated 09-08**, of which **three are corrections of
the entries above them** (`corrects the entry above` appears twice in the
headings). That is the honest-history rule working at high frequency, and it is
also a signal: on an overnight autonomous run, a third of the recorded findings
were wrong on first writing and caught on re-reading.

The plan itself, written for Beachfront, was wrong about 29 Navy in four ways
that the Phase 0 capture measured on Wednesday, and the journal is emphatic that
the _pattern_ matters more than any one:

1. **The matrix.** The recipe seeds `1440 / 834 / 390`. The reference's own
   stylesheet has twelve `@media` blocks whose three site-authored members are
   `max-width` 991, 767 and 479. The real matrix is `1440 / 991 / 767 / 390` —
   **the seed would have missed two of four bands.**
2. **The fonts.** The plan warned that all three Font Awesome faces must report
   `document.fonts.check` true. Two report false, correctly: of 190 elements on
   the live page, **0** compute to either, and the `FontFaceSet` lists both
   `unloaded`. "Had this been fixed, the fix would have been to a bug that does
   not exist."
3. **The first floor.** The plan counted ten `display: none` modals including
   `._1st-floor-modal`. Measured at 1440 it is `display: flex`, in flow,
   **1174×750 at (246, 1908)** — the default visible panel of a floor switcher. A
   rebuild hiding it would be ~750px short and the symptom would read as a layout
   bug. The journal calls this "the one that would have cost a day in Phase 5."
4. The probe order was wrong.

**Time pressure, stated:** the reference is a live Webflow site that dies at DNS
cutover, and Beachfront's reference _already_ died mid-campaign —
`harness.mjs --check-ref` against it still answers HTTP 404. So Phase 0 captured
**90 files, 13,667,608 bytes** with a tracked sha256 manifest, and nothing was
rewritten (an absolute CDN href stays absolute) because the capture is what
Phase 1 greps.

---

### 8. The match-harness saga: four lies in code that was reviewed three times

This is the week's centre of gravity and the journal covers it across **eight
entries dated 09-09 and five dated 09-10**. What follows is what the journal does
_not_ say: the shape of the failure, the cost, and the one sentence that explains
all four.

**The one sentence, from the 09-09 entry on #744:** _"Found by using the
`match-harness` recipe rather than reviewing it. Three adversarial review rounds
on #733 did not surface this; installing the harness on 29 Navy and running the
real gate against a real reference did, in one command."_

MEASURED: #733 was `+5,058 / −1` across 18 files, opened 19:15Z and merged
23:39Z Wed — **4h24m**. It carried 26 tests. It received **zero GitHub reviews**
(as did all 123 PRs this week; review is entirely in-session
`superpowers:code-reviewer` subagents — 34 invocations — plus adversarial
self-review). Within 24 hours of merge, four defects in it were found and fixed
in four separate PRs.

**Defect 1 — `applied` for an install git silently dropped (#734/#733).**
`matchHarness` writes 20 paths and commits through a shared `commit()` that
stages with `git add -A`. `git add -A` honours `.gitignore`, exits 0 either way,
and git cannot re-include a file whose **parent directory** is excluded.
Measured on a real repo whose `.gitignore` already carried `matching/`: **13 of
20 paths on disk, 0 of them in the commit, both git commands exit 0, result
`applied`.** What the operator is left with is worse than nothing — a
`/dev/match/[uid]` route and 83 lines of CLAUDE.md instructing the next agent to
run scripts that exist on one machine and on no other clone or CI runner.

The abandoned approach is the instructive part. A pre-write ignore preflight
(`git check-ignore` in `plan()`, before a byte is written) was designed, built,
tested — and **abandoned**, because it refuses two configurations that actually
work: the recipe's own appended block re-includes `!matching/*.sh` and
`!matching/*.mjs` _after_ the site's rule, and because the `matching` directory
itself is not excluded, git still descends into it. The question "will git take
this?" is only answerable after the final `.gitignore` exists. There is now a
**negative-control test** whose only job is to go red if someone re-adds that
preflight.

**Defect 2 — `census.sh` shipped a green nobody measured (#733, fixed via
beachfront#58).** One of seven files the recipe copies _verbatim_ into every
site. #733's 26 tests touched none of it. It printed `Phase 3 CLEAN — 0
undeclared type mismatches` and exited 0 **without measuring anything**, in seven
distinct ways (style-census absent; present but crashing; present but silent;
both pages rendering zero text; a typo'd page argument; an empty `pages` table;
a failing import). Five became vitest cases watched red first; two were measured
by hand in a scratch tree "because they have no test and I would otherwise have
been asserting them." The blast radius is why it was a blocker: **every site the
recipe installs gets this file, and the failure is silent in the flattering
direction** — it is the gate that catches the 11px footer line and the
cyan-vs-teal link the pixel diff is structurally blind to.

**Defect 3 — an unbounded `pnpm exec` inside every fleet clone (#737 filed).**
The format step called `formatWithPrettier` with neither `bin` nor `timeoutMs`,
which becomes `pnpm exec prettier --write …` with **no timeout, no process
group, and nothing to kill**. A cloned site has no `node_modules`
(`clone-if-needed.ts` contains neither `pnpm` nor `install`), so this is an
unrequested full install in a live client repo — and `pnpm exec` then falls
through to the _calling_ repo's binary and exits 0, reporting success for a
format the target never did. The defect class is **three call sites**, not one:
`health-endpoint/index.ts:83` and `smoke-suite/index.ts:224` do the same thing
and, MEASURED, are still on `main` as of this week's end.

**Defect 4 — `ALL DONE` over runs that never happened (#744).** The reproduction
is three lines:

```
########## home ##########
home exit=1
ALL DONE (smoke)
```

`gate.sh:120` was `echo "$page exit=$?"` — it printed the status and discarded
it. And `next.mjs` summed its denominator only over pages that produced a
parseable report, so **eight of nine pages could print `SCORE 160/160 regions
passing` while the ninth was never measured.**

**Defect 5 — `SCORE 12/3`, and "Backlog is empty" (#751).** `harness.mjs`
derived `TOTALS[page]` as `(anchors.length + 1) × MATRIX.length`, an exact
identity for an _anchored_ run and nothing at all without anchors. On the
untouched recipe seed page-diff produces **12** grid regions and `next.mjs`
printed `SCORE 12/3 regions passing`, then `No open geometry failures` and
`Backlog is empty`, exit 0. On 29 Navy's four-viewport matrix: `SCORE 16/4`.
The journal's line is the one to keep: _"The absurd fraction is the harmless
half — someone questions 16/4. Nobody questions 'Backlog is empty', and it
prints from the same run."_

And the expensive part: **two tests had asserted the defect as correct behaviour
since the recipe shipped**, one of them carrying the false derivation written
down as fact in a comment (`// 3 = (0 anchors + 1) × 3 viewports`). They passed
because the fixture supplied exactly 3 regions and the fiction `(0+1)×3` is also 3. _The fiction and the fact coincided, so nothing looked wrong._ Both fixtures
now use 12 regions against a fiction of 3 specifically so the two numbers can
never agree again.

Understated in the original issue and caught on the fix: `scored` sorted by
`pass / total`, and an unanchored page's ratio is **not bounded by 1**. A passing
page scored `16/4 = 4.0` and sorted _last_ (best); a failing one scored `0/3` and
sorted _first_, so `NEXT: about — worst page` printed an agenda of `grid-0-0`,
`grid-1-0` … — an instruction to fix geometry against regions page-diff invented.

**Defect 6 — installed sites could never be corrected (#739).** A recipe-owned
file that matches neither the new template nor a _recorded previous body_ is
FLAGGED, never overwritten. With zero terminators in the three marked blocks
(`.gitignore`, `.prettierignore`, `CLAUDE.md`), their contents could never be
corrected at all — and on `.gitignore` that is not staleness but a brick, because
it is a negated whitelist over `matching/*`. So: **fixing the recipe upstream
reached nobody**, and the fleet fix (#753/#758) was to start recording what had
been shipped.

**Two mechanics that cost real time and are worth not rediscovering:**

- The documented mutation loop — edit beachfront, regenerate, test, revert
  beachfront, regenerate — **does not restore `template.ts`**. The generator
  carries `MATCH_HARNESS_PREVIOUS` forward and appends the current on-disk body,
  so the second regeneration files the _mutant_ as a legitimate prior release.
  Measured: one mutate/revert cycle left `template.ts` **693 lines larger** than
  HEAD carrying two copies of the predicate. The only correct revert is
  `git checkout -- src/recipes/match-harness/template.ts`.
- `node matching/next.mjs | head` reports `$?` as **`head`'s** status under zsh —
  read as exit 0 when the real answer is 2. `${PIPESTATUS[0]}` is bash; zsh wants
  `$pipestatus[1]`. This cost a wrong reading _in the same hour it was written
  down_.

**AN ARCHITECTURAL ODDITY FOR FABLE, MEASURED:** the canonical source for the
harness template is a **client repository**. `template.ts` is generated by
`scripts/gen-match-harness-template.mjs` from `beachfront-dentistry/matching/`.
The 09-09 journal states the consequence plainly: _"anyone regenerating from a
stale beachfront clone silently reverts this fix while the generator cheerfully
prints `17 files, all round-trip verified`."_ And as of the corpus snapshot,
`beachfront-dentistry`'s main checkout is parked on branch `fix/p751`, not
`main`. The safety procedure is "regenerate first and confirm a byte-for-byte
no-op" — a discipline, not a mechanism.

---

### 9. Wednesday night: GitHub was the problem, and a throwaway PR proved it

22:20 Wed: "can you diagnose the actions issue?" → 22:34: "yes".

MEASURED artefacts: commit `66fd01e2` (`chore: probe whether Actions creates a
check suite for a new PR`) and PR **#752 `chore: CI probe (throwaway)`,
+0/−0, 0 files, state CLOSED**. And in Discord at 18:10 the same day, to Tim:
_"github is having issues again so currently on this branch instead of staging"_
— the deploy-preview link was handed over on a branch preview because the
staging pipeline was not producing runs.

FOR FABLE: this is a healthy pattern (build a minimal probe rather than reason
about a platform) and a cheap one — a zero-diff PR opened and closed. It is also
the second time this fleet has spent operator attention on GitHub-side flakiness
in a week, and there is no persistent record of it beyond a closed throwaway PR.

---

### 10. Thursday: the blank page with three unrelated causes

Tucker at 13:09 Thu, one line, three symptoms:

> ci failing, no content on the page only the nav, no favicon

They were three unrelated defects that happened to be visible at once, and each
is a different failure genre:

- **CI: a test that could only run on the machine that captured the reference.**
  `NavyContact.test.ts` read `matching/spec/index.html` at _module scope_ to
  derive its expectations from real markup. Sound reasoning — but `matching/*` is
  gitignored on purpose, so the file exists on every machine that ran the harness
  and on no CI runner. A module-scope read throws ENOENT during **collection**,
  taking the whole file down: CI reported `1 failed | 50 passed` and `422 passed`
  against **445 locally** — **23 assertions about the contact band silently
  stopped running**, and the failure named a missing file instead of anything
  about contact. The journal names the genre precisely: _"not a check that passed
  without evidence, but a check that vanished without saying so."_
- **Empty page: a belief corrected.** The previous entry had said `/` renders
  empty because the home document is not seeded, and treated that as the whole
  story. `customtypes/page/index.json` — the slice zone Prismic actually enforces
  — carried the nine template slices and **none of the five `navy_*` ones**.
  Seeding would have returned HTTP 200 and published a document with **zero
  slices**, and the page would have stayed exactly as empty _with the seed
  looking like it worked_. And a test named _"declares every field the documents
  set, so Prismic strips nothing"_ existed — it compares documents against slice
  **models**, all of which were present and correct. The **zone** is a separate
  declaration in a separate file and nothing compared anything to it.
- **Favicon: a placeholder that answered 200.** `static/favicon.png` was the
  template default (128×128, 8-bit grey+alpha, 1,571 bytes). It existed, it
  served, `curl` said `status=200 type=image/png`. _"Every check that asks 'does
  the icon resolve' was green while the tab looked blank."_ The test now asserts
  **byte equality** with the captured originals, "because existence is precisely
  what was already true."

Each new guard was broken on purpose before being kept.

---

### 11. The override layer: four instances of one bug, and three probes that proved nothing

**The store (#761, `feat/prospect-report-overrides`).** Three columns on
`prospect_audits`, a validator, two writers. Two things worth carrying:

_The migration split was proven rather than argued._ `migrate.ts` runs
`executeMultiple(m.sql)` in a try, swallows `duplicate column name`, then records
the marker **unconditionally**. Constructed against the real runner:

```
COMBINED, crash mid-run + lost marker, re-run:
  marker recorded=true; overrides_json=true edited_at=false opened_at=false
  → marker says applied, two columns permanently missing
SPLIT, same crash: all three applied, all markers present → survives
```

_One bug, four instances, and the pattern is the finding:_ **validate one object,
serialise a different one.** `Object.values()` on a non-plain object returns `[]`
and `[].every()` is vacuously true — `new Map([...])` returned `updated`, stored
`{}`, and stamped `edited_at`, the operator's whole map discarded and reported as
saved. A circular reference threw a `TypeError` out of a function declared to
return a three-way union. **2,288,891 characters** were accepted in one write
(the sibling path caps at 2,000). `__proto__` was stored verbatim and a consumer
in a separate repo using `Object.assign` measurably gets its prototype replaced.
Fixing them individually treats symptoms; the close was to build the stored map
from the fields the validator approved, **so the stored bytes are the checked
bytes by construction**.

Honest note in the entry: none of the four is reachable from the live path,
because the caller is an HTTP JSON body. They were fixed because the validator's
stated contract is that it is the only place a malformed value can be caught.

**The deploy gate nobody had checked (#762).** The plan said "Task 1 must be
deployed first." It was merged, and it was live — **on `staging` only**.
`reddoorla.com` builds `main` and was publishing `c662da3` = `origin/main`
exactly, where `fetchReport` still ended `return (await res.json()) as
AuditReport`. **That is a cast, not a parse**, so handed the new wrapper it does
not throw: it yields a report object whose every field is `undefined`. A
premature deploy would have produced **blank reports, silently, on every prospect
link already sitting in an inbox** — and on the PDF leave-behind with them,
because `renderReportPdf` captures the same route. No 500, no error page, nothing
a nightly catches.

Measured while resolving it: `main..staging` was **36 commits**, `staging..main`
4; a cherry-pick of the compat commit alone applied 5 of 6 files clean. The first
run of that probe failed **37 of 38 test files** with `TSCONFIG_ERROR` — the
absent generated `.svelte-kit/tsconfig.json` on a fresh worktree, a known trap
hit again. _"svelte-kit sync first, always."_

Also caught here: a read route that amplified into writes.
`touchProspectAuditOpened` stamped on every GET of an unauthenticated route rate-
limited at 120 req/min per IP — **~172,000 writes a day from a single address**,
into the Turso project the whole fleet shares, configured `overages: false`,
where crossing quota blocks reads _and_ writes for every site at once. Coalesced
to a five-minute window **inside the `WHERE` clause** so two concurrent opens
cannot both decide to write.

**Three probes that proved nothing (#764).** This is the entry a workflow reader
should read twice. Each of the first three attempts to prove the page renders the
new payload looked convincing:

- _Does the page name the business?_ Contaminated — the audit is of
  reddoorla.com and "Reddoor" is in the marketing site's own nav and footer.
- _Does the page contain the report's check copy?_ Contaminated **structurally** —
  the design doc already says check labels and reasons live in source across both
  repos, so a hit could be website-resident copy.
- _Does the page render this run's measured scores?_ Inconclusive, **and only
  because a control was included**: three of four scores matched, but the control
  number — chosen precisely because it is _not_ one of this run's scores —
  matched too. Bare number-matching against a 119 KB document proves nothing.
  _"Without the control this would have been reported as a pass."_

What discriminated was the **hydration payload**, because it is what the server's
`load()` produced rather than what a component chose to display.

**And the same shape one day later (#766).** The first run of the end-to-end edit
proof chose `siteChecks.data[0].why` as its subject — **a key whose text the
report does not render**. So "the edited text is not on the page" was true and
"the original is not on the page" was also true, and the output read as a clean
failure of the feature. MEASURED: of 230 candidate strings in that payload, only
**145 are rendered at all**. The generalisation is the keeper: _a probe that does
not verify its own subject is observable is not measuring the thing it names, and
it will fail in the direction that looks like a real finding._

Once fixed, the proof is six lines and every step is against production:

```text
PRECONDITION  original is on the live page ......... true
1. SAVE       POST /api/audit-report/:token/overrides  200 {"ok":true}
2. API        serves the override back, editedAt set .. true
3. PAGE       renders the edit, original gone ........ true
3b. PRINT     renders it too, so the PDF follows ..... true
4. REVERT     mark gone, original restored ........... true
```

---

### 12. The Netlify finding: a security property the platform quietly undid

The edit route takes `?k=<key>`, exchanges it for a cookie, and 303s to the bare
path — which is what is supposed to clear the key from the address bar. Measured
on the deploy preview, the `Location` header **still carried `?k=`**.

The first diagnosis was honest and inconclusive and was committed as such:
_"this repo defines no redirect rules, so something downstream appends it —
**cause not isolated** … **Someone should still find out why.**"_ The
client-side `replaceState` scrub went in as belt-and-braces.

Then it was isolated **with a control**: a marker param was added, and the 303
came back carrying `?k=<key>&zzzmarker=1` — the whole original query — and
**Netlify's own trailing-slash 308, which this repo does not author, preserved it
too**. Two redirects, one ours and one the platform's, both appending. So no
server-side `Location` can defeat it, and the comment in the code was rewritten
from `// BELT AND BRACES over the server redirect.` to `// THE ONLY THING THAT
CLEARS THE KEY FROM THE URL.`

The generalisation, quoted from the commit body: _"anywhere in the fleet that
strips a sensitive query parameter by redirecting to a bare path, on Netlify, is
not doing what it looks like it is doing."_

**AND HERE IS WHERE THE EVIDENCE DIVERGES FROM THE RECORD.** MEASURED at the
corpus snapshot (Sat 09-12): both journal commits (`20a27782`, `2c1b4088`) are on
`feat/report-edit-mode` and `staging`. `origin/main`'s `docs/workJournal.md`
contains **exactly one** `## 2026-09` entry — the 09-05 opener. `origin/staging`
is **15 commits ahead of `origin/main`**, last promotion #178 on Thu 09-10
22:37Z. So the week's single most transferable fleet-wide finding is not on the
branch a reader of that repo arrives at. The journal rule's value depends
entirely on the entry being where someone lands, and the staging→main promotion
flow silently defers that.

---

### 13. "the second time today I've had an agent try and invent a component"

Friday 09:20, 29-navy:

> slider is in a rough state right now, most of the time it's just grey

Twenty-one minutes later, the question that matters:

> clicking a slide should reset the autoplay timer. **Did you build your own
> slider or use the implementation we already had in reddoor starter?**

The journal's answer, in its own heading: _"I should have read the starter
first."_ `src/lib/components/Slider.svelte` was in that repo — 12KB, with tests,
shipped from the starter — referenced only by the a11y fixtures route. It already
had autoplay with pause-on-hover, pause-on-hidden-tab, APG focus handling,
reduced-motion, loop and fade modes, and an `autoplayEpoch` whose comment reads
_"Re-key the interval on swipe navigation so a gesture restarts the full delay"_ —
**precisely the feature being asked for.**

The entry is careful about what is and is not excused. The outcome (a separate
component) was probably right: this is a pixel-matched Webflow rebuild whose gate
compares against transcribed Webflow class names, and the starter's Slider owns
its own wrapper markup. **The process was not right**: the file was never opened,
so the logic sitting there was never copied, two answers were re-derived, and one
of them _was escalated to the operator as a decision only they could make_ — the
dot-nav target-size question. Re-tested against the starter's `h-6 min-w-6`
answer, the conclusion survived, but with a materially better statement of the
problem (the blocker is the 20px **pitch**, not the box) that would have been
available a day earlier.

At 10:05 Tucker generalises it:

> ok, slider looks good, but this is the second tyime today I've had an agent try
> and invent a component rather than using battletested code I've already built.
> **how do we fix this?**

MEASURED: the journal for #23 that afternoon is headed _"the third time $lib
solved it first."_ Three instances in one day.

**And then the correction that is the best workflow artefact of the week.** The
proposed answer was a CI audit. At 12:44:

> the worry here is that this feels retroactive, when the goal is to avoid doing
> duplicate work, so by the time you've run the check the cost of failing has
> already ocurred

The journal records the inversion in full: _"Correct, and it inverts the design.
I had optimised for **unevadable** when the goal is **never started**. A gate
that fails in CI saves the merge; it does not save the hour, and the hour is the
thing being wasted. Worse, I had ranked the three candidate designs by fleet
reach and evadability — both properties of a detector — and put discoverability
last, which was the only one of the three that fires before the work."_

What shipped instead (29-navy #25 +484, #26 +428/−31, reddoor-starter #124
+805/−1):

- `scripts/capability-index.mjs` → `docs/COMPONENTS.md`: **50 modules** from
  `src/lib`, each with its real prop/export names, test count, and first
  sentence. Pointed at from CLAUDE.md's Orientation table, so it is in front of
  an agent **before** any decision.
- A `UserPromptSubmit` hook that surfaces matched entries on the prompt, before
  anything is written.
- Both shipped to every new site via the starter.

Three design decisions inside it are worth keeping. **No `@provides` tags** — "a
tag nobody updates is worse than no tag, and the authoring tax falls on exactly
the person already not reading the directory"; prop names are the capability
surface and cannot drift because they _are_ the code. **Its own test caught the
first defect in it**: the generator began with an allowlist (components, actions,
utils, stores) and the test asserting the three actually-re-derived modules
appear failed immediately, because `transitions.ts` sits at the top level of
`src/lib` and exports `prefersReducedMotion`. _"An allowlist encodes a guess
about where people put things."_ 40 → 50 modules. And **a generated file cannot
also be a formatted file** — prettier realigns markdown tables, which rewrote
every row and left the freshness check failing forever against a file nobody had
edited.

The honest limit, stated: _"CLAUDE.md already said to check for existing work. I
read it at session start and re-derived three things anyway. The instruction was
never missing; the DATA was. … Recognition is a different mechanism from recall,
and only one of them had been tried."_

**One blocker was handed back to the operator and is still open:** `.claude/` —
where a `UserPromptSubmit` or `PreToolUse` hook lives, and hooks are the only
surface that can _interrupt_ before writing starts — is **gitignored at
`reddoor-starter/.gitignore:12`**. Shipping hooks fleet-wide needs that policy
changed. MEASURED: #26 landed the hook in 29-navy and #124 shipped the index and
its hook through the starter, so the mechanism exists; the fleet-wide gitignore
question is the remaining operator decision.

---

### 14. The false fail that looked like four phases of geometry failure

29 Navy's `Creative Lofts` region had been failing 34–38% for five phases. The
gate had been photographing this build on slide 1 and the reference on slide 5 of
6 — `gallery_roof1.jpg` against `gallery_29navy_interior.jpg` — because
`capture.mjs:42` sets `reducedMotion: "reduce"` on every capture, this build
honours it, and Webflow's slider ignores the media query and keeps advancing.

`heightDeltaFraction` was **exactly 0**, the anchors were identical, and the band
immediately below matched pixel for pixel. _"Everything measurable said 'the
geometry is right', and it was."_

The evidence that settled it was the **fail crop** — a kitchen on the left and a
rooftop in the middle — _"sitting in `matching/out-phase5b-home/` for a phase and
a half."_ The journal's line: **"Four viewports of consistent arithmetic got more
attention than the picture of the thing failing."**

Two beliefs corrected in the same entry: Phase 5 had recorded the cause as "the
freeze pins looping CSS animations, and a `setInterval` carousel is not one" —
and the reference bundle has **zero** `setInterval` calls (it autoplays on
recursive `setTimeout`), and the operative difference was never the freeze's
reach. And a diagnostic probe (`probe-anchor-parity.mjs`, itself ported from
beachfront because `next.mjs` prescribed a tool this harness had never installed)
produced a **near-convincing false positive**: it reported non-comparable
elements at every viewport because it selects over `body *` while the real cutter
uses a fixed tag list that does not contain `main`, and because
`regionsFromAnchors` cuts on the anchor's top **Y**, not its box. _"A probe that
models the thing it audits differently from the thing itself is worse than no
probe."_

**Honest accounting, quoted, because it is exactly the kind of thing this
retrospective should preserve:** _"The gate did not move because of anything drawn
or restyled this session. Every one of the 20 regions was already correct; the
measurement was reading two different pages. The slider motion work in #18 and
the preload/modal work in #17 were both real, but neither moved this number, and
anyone reading the score jump as evidence that they did would over-invest in
exactly the wrong place."_

Result: `Creative Lofts` to **0.0% at all four viewports; 20/20, zero floors,
zero masks, threshold 0.1** — from a one-line config change (`pinState` in the
shared skill).

Same PR, same day, a second instance of the week's recurring shape: the seeder's
own `--verify` printed _"the published ref carries what site-pages.js describes"_
while comparing slice **count and nothing else** — run over a write whose entire
purpose was two text fields, and passing without reading either.

---

### 15. Friday's three lying instruments, and a journal entry that invented two defects

The cockpit task (#768) is small — one line per audit row: `Edited 2 hours ago ·
Opened 40 minutes ago · read since you edited`. The rationale is not decoration:
the operator ruling on 09-09 was that a report stays editable after the link goes
out, which leaves the "don't rewrite what someone is reading" job to the
operator, who can only do it if the cockpit tells them. _"A signal collected and
never shown is indistinguishable from a signal never collected."_

**Three instruments lied in one session, all self-inflicted:**

1. `pnpm vitest run 2>&1 | grep -aE "Tests  |Test Files|FAIL" | head -3`
   **deadlocked the suite for eighteen minutes.** Three lines matched early,
   `head` exited, grep took SIGPIPE, and vitest hung behind the closed pipe. The
   three matching lines were test _names_ containing the word FAIL — e.g.
   _"restores the operator's branch even when the PUSH FAILS"_. _"A summary
   filter whose pattern also matches the corpus it is summarising is not a
   filter."_
2. `pnpm -C <worktree> vitest run` reported `VITEST_EXIT=1` in **forty seconds**
   having run no test — `spawn <path> EACCES`, pnpm having taken the directory as
   the command. _"A red that arrives faster than the suite can possibly run is a
   red about the harness, not the code."_
3. `prettier --check` failed on an end-to-end probe left untracked in the
   worktree.

Plus one real defect found **by reading the diff, not by any gate**: the new
function landed _between_ `auditRow`'s doc comment and `auditRow` itself,
orphaning a paragraph about token handling onto a function that handles no
tokens. _"Nothing type-checks or lints the claim that a JSDoc block still
describes the function beneath it."_

**And then the entry itself was wrong.** Its closing "still open" list said
_"Three length-leaking token compares are still live."_ MEASURED, from the
correction written at 12:46 the same afternoon: there is **one**, it is
deliberate and documented, and the list **named two**. `verifyFormsToken` digests
both operands to a fixed 32 bytes before comparing and says so in its own comment
— and the save endpoint shipped two days earlier carries a comment saying it
_deliberately mirrors_ that function for exactly that reason.
`/api/meeting-outcome` does short-circuit on length, and its comment states the
trade explicitly ("a length is not worth an allocation to hide") — _"re-litigating
a documented decision as a bug is how a review loses credibility."_

The diagnosis in the correction is the most useful sentence produced this week:

> Both entries in that list came from memory rather than from the file, in a
> session that had spent the whole day proving that instruments lie … Every one
> of those was caught by checking. This one was not checked because it was a
> claim about code I had already read, **which felt like knowing**.

**EVIDENCE DIVERGENCE, MEASURED:** the correction is commit `fcc72fe9` on branch
`docs/token-compare-correction`, PR **#769, still OPEN and unmerged** at the
corpus snapshot. `main`'s `docs/workJournal.md` ends at line 1975 and still
carries the uncorrected claim. The repo's own rule — _history is never edited to
be right; a later entry corrects it_ — has a merge-latency hole: the wrong claim
is on the default branch and the correction is not.

Three other PRs were also open at snapshot: #716 (vitest security), #771
(version packages), and 29-navy #2/#3 + beachfront #44/#45 + reddoor-starter
#118/#119 (the `sharp@<0.35.0` security pair, which MEMORY already flags as an
override-key shape that must not be bulk-merged).

---

### 16. The a11y summary that told eight sites their routes had not run

Friday's last merged PR (#770, closes #697) is a one-line bug with a long commit
body, and it is the week's cleanest example of a _false negative_ that invites an
expensive reaction.

The pass summary interpolated `a11yRoutes.length` — **the two dev fixtures** from
`configs/playwright-a11y.js` — while the list actually scanned was `axePages`,
built 60 lines earlier by merging those fixtures with the site's
`package.json#reddoor.a11yRoutes`. MEASURED: vida-legacy-foundation added eight
real routes and read **"across 2 routes"**. All ten pages had been scanned the
whole time.

The commit body states why a one-line bug got this much prose: _"conclude the key
is broken, revert it, lose exactly the coverage it exists to provide. Scanning
only fixtures is how a critical image-alt violation shipped to five production
pages on gallerysonder with CI green."_

And why no existing test could have caught it: _"telling '2' from '2 + 0' needs a
fixture whose config contributes routes."_ The new summary names the split —
`0 violations across 10 routes (2 fixtures + 8 from package.json)` — because "10
routes" alone still leaves an operator counting on their fingers.

---

### 17. The client lane, which ran the whole week in parallel and needed him constantly

While the two megasessions ran, a second, shallower stream consumed 40+ of
Tucker's typed prompts. It is worth separating because its friction profile is
completely different: short prompts, fast turnarounds, and **the operator as the
only channel between a client and the code**.

**vida-legacy-foundation (31 prompts, 17 commits).** Nicole and Erik's review
rounds arrive in Discord; Tucker relays. The prompts are almost all one line:
"check discord", "see nicoles notes in discord", "merge the pr on green",
"published and merged", "sent it to her". Two corrections stand out:

> there is tooling for this you've been using it all day, maint should have
> instructions for you

and, on the hero video:

> we have this implemented already, check other repos for how we do video. I'll
> upload to vimeo

That is the **same reinvention failure as the 29-navy slider**, on a different
day, in a different repo, caught the same way — by the operator recognising it.
Two of the three instances that produced the capability index came from this
lane, not the flagship one.

Friday 21:54, a verification Tucker ran himself:

> check the last session, did we get holly aldridge to two lines? it doesn't look
> like it took on the site

**gallerysonder (9 prompts, 8 commits).** The week's one pure client-comms
episode: Carlo (an external contractor) had wired GTM click triggers, and the
right answer was dataLayer events on successful submit. Tucker drafted a reply
and asked for edits, and the correction he issued is a tone correction, not a
technical one:

> just tell him what to do, they don't care why and hotjar needs Josh's go. **You
> apparently didn't catch the word brief in my ask**

MEASURED artefact: `feat(analytics): dataLayer events for successful form
submissions` (#98). The verification questions that followed are the operator
doing acceptance testing by hand: _"so if I rsvp on the site today and write
test, he's going to get it?"_

**songbook / caldea / Broken (personal).** 15, 5 and 15 commits. Songbook is an
iPad PWA for charts, driven by a `to-fix.md` file Tucker keeps open in the IDE —
"keep rolling through", "em dashes first", "do the last three together, I'm
stepping away from the computer for a bit". Caldea is prose (a novel), and it
carries the week's strictest scoping instruction:

> and do not make the line fixes, remember you are **only allowed to edit the
> tracker and work journal**

---

### 18. Saturday: the close-out, and the request that produced this document

29-navy #28 closes five pre-show items from one prompt ("is this site ready to
show?" → "remove the download pdf button. how would you deal with the ally and
and make an og image and add please. you should also activate turnstile and have
a look at what images it would make sense to route through prismic."). One
correction from Tucker — _"there's no form, you can remove the turnstile issue,
gate is accepted we are past matching, you can flip that toggle"_ — reproduces
the fleet's existing "no form, no Turnstile" operator ruling, which an agent had
to be told again.

Then at 10:53:

> Next week is going to be a meta work week … I also want a summary of all the
> work I've been running for the past few weeks across all repos, first from a
> mile high view project by project view and then calendarized, and then
> journaled as close to beat by beat as possible so I can give fable everything
> it needs to make recs about how to improve my workflow without it doing all the
> searching.

and the operating instruction that follows it is itself a workflow datapoint:

> go for it, do your best to run through everything autonomously and flag things
> that you need me for to be done in a second pass, **rather than pausing all the
> work on a blocker for one small thing**

---

## WHAT THE JOURNAL RECORDS THAT THE EVIDENCE DOES NOT FULLY SUPPORT

Listed separately because the brief asked for it. In every case the journal is
more right than wrong; these are gaps, lags and one self-caught error.

1. **"Three length-leaking token compares are still live" (09-11 task-6 entry) is
   false, and the journal says so — on an unmerged branch.** MEASURED: the
   correction is `fcc72fe9` on `docs/token-compare-correction`; PR #769 OPEN;
   `main`'s journal still carries the original claim at snapshot. The forward-
   pointer mechanism the repo designed for exactly this cannot help while the
   correcting entry is not on the branch a reader lands on.

2. **"Plan A is complete" was written twice before it was true.** The 09-11 task-6
   entry says so itself: _"That was wrong when it was written: task 6 had not been
   built, and I had said plan A was complete twice before catching it."_ Recorded
   here because it is a pattern (premature completion claims) rather than one slip.

3. **reddoor-website's only journal entry for this week is not on `main`.**
   MEASURED: `origin/main:docs/workJournal.md` has one `## 2026-09` heading
   (09-05). The Netlify query-preservation finding — explicitly generalised to
   "anywhere in the fleet" — lives on `staging`, which was 15 commits ahead at
   snapshot.

4. **The 09-09 entry on #733 states the eslint/prettier coverage claim as
   corrected, but the underlying coupling is unchanged.** `matching/*` in the
   recipe's generated `.gitignore` block is what keeps `prettier --check .` green
   over the captured reference; `.prettierignore` does not cover it, because
   Prettier 3 defaults `--ignore-path` to `.gitignore`. The fix records the
   mechanism; nothing tests that the mechanism keeps holding if the block changes.

5. **The 09-09 entry claims "no change was needed in beachfront-dentistry"**
   after a template regeneration no-op check. MEASURED at snapshot,
   `beachfront-dentistry`'s checkout is parked on `fix/p751`, not `main` — so a
   regeneration run today from that working copy is precisely the stale-source
   hazard the same entry warns about. Not a contradiction, but the safety claim
   depends on a checkout state nobody is asserting.

6. **`metrics.json` per-day session/tool figures for 09-11 understate the day by
   roughly an order of magnitude** (13 sessions / 353 tool calls against 38
   commits and 5 journal entries), because both megasessions are attributed to
   their start day. Any narrative built from `byDay.sessions` will get Friday
   badly wrong.

---

## MEASURED AGGREGATES FOR THE WEEK

| metric                                           | value                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Commits                                          | 306 (305 unique SHAs), 16 checkouts                                                                   |
| — by Tucker Lemos                                | 248                                                                                                   |
| — by `reddoor-renovate[bot]`                     | 57 (37 of them on Monday alone)                                                                       |
| PRs opened / merged                              | 123 / 92                                                                                              |
| **GitHub reviews on those PRs**                  | **0**                                                                                                 |
| PR cycle time, non-Renovate, reddoor-maintenance | median ≈ 0.2 h; 24 of 36 under 1 h                                                                    |
| Longest-held non-bot PR                          | reddoor-website #175 (Tim's round-2 pin), 26.1 h                                                      |
| CI runs / non-success                            | 737 / 16 (12 real failures, 4 lighthouse cancellations)                                               |
| Failing workflows                                | `ci` ×11, `release` ×1 (on `main`, 09-08)                                                             |
| Typed operator prompts                           | 209 (from 690 raw rows / 383 unique)                                                                  |
| Main sessions / subagent transcripts             | 48 / 249                                                                                              |
| Subagent invocations                             | 211 (`general-purpose` 172, `superpowers:code-reviewer` 34, `Explore` 5)                              |
| Skills invoked                                   | 36 (subagent-driven-development 8, TDD 7, brainstorming 6, code-review 5, writing-plans 5)            |
| Tool calls                                       | 16,000+ (Bash 14,722 — 92%; Edit 590; Read 412)                                                       |
| Interruptions (all sessions)                     | 9                                                                                                     |
| Models                                           | opus-5 (149 sessions), haiku-4.5 (56), opus-4.5 (54), **fable-5-1 (31, all on 09-07/08)**             |
| Work-journal entries written                     | 41 across reddoor-maintenance (21) and 29-navy (21 incl. the 09-08 set), +1 website, +1 claude-skills |
| Discord messages                                 | 111, 4 humans, 10 active channels                                                                     |

---

## FRICTION SIGNALS

Ordered by how much time the evidence says they cost.

1. **Review happens entirely inside the session; nothing external gates a merge.**
   0 GitHub reviews across 123 PRs; median maintenance cycle time ~0.2 h. The
   quality mechanism is `superpowers:code-reviewer` subagents (34) plus adversarial
   self-review — and MEASURED, _three adversarial review rounds on #733 surfaced
   none of the four defects that using it surfaced in one command._ The gap is not
   review intensity, it is that review and use are the same person at the same
   desk.

2. **Two megasessions carry the week (72.9 h and 88.2 h wall).** Consequences
   visible in the evidence: two "hit a session limit, continue" prompts, two
   "hit fable limit" model switches, at least three compaction summaries in the
   prompt stream, and per-day metrics that are unusable. A session that long is
   also a session whose early context is gone by the time the late claims are
   written — which is exactly the failure mode of the 09-11 token-compare entry
   ("a claim about code I had already read, which felt like knowing").

3. **Component reinvention, three instances in one day, two repos.** The operator
   caught all three. The fix that shipped (capability index + prompt hook) fires
   before the work, which is right — but it is advisory, and the enforcement
   surface (`.claude/` hooks) is gitignored in the starter, so the fleet-wide
   version is blocked on an operator policy decision that was still open at
   week's end.

4. **Design specification by Discord prose.** ~20 commits and one Zoom call to
   settle one sticky pin, with at least one full revert to an earlier design.
   Every agent turn was fast and correct; the latency was entirely in the
   human→human channel.

5. **Environment noise that costs a diagnosis every time.** Within one week:
   1,771 eslint errors from sibling `.worktrees/`; 49 `listen EPERM` suite
   failures from the Bash sandbox; 37 of 38 test files red from an absent
   `.svelte-kit/tsconfig.json` on a fresh worktree; an 18-minute vitest deadlock
   from `| head -3`; a 40-second `VITEST_EXIT=1` that ran no test; a zsh pipeline
   reporting `head`'s exit code. **Six separate instrument failures, none of them
   about the code.** Every one was correctly disqualified — but each cost a
   diagnosis, and the rule that saves them ("prove the instrument first") is
   applied by discipline, not by tooling.

6. **A client repo is a build input for a fleet recipe.** `template.ts` is
   generated from `beachfront-dentistry/matching/`, whose checkout is parked on a
   fix branch. The guard is a manual "regenerate and confirm a no-op" step. The
   generator prints `17 files, all round-trip verified` while silently reverting a
   fix, if run from a stale clone.

7. **Branch and worktree sprawl, and the operator can see it.** MEASURED:
   reddoor-website 38 branches / 8 worktrees; reddoor-maintenance 8 branches /
   4 worktrees. Tucker, Friday 09:52: _"what's this push pull chaos I'm seeing in
   my status bar (33 down 40 up). merged that pr"_, then _"you can do it, would
   like to get back to main."_

8. **Staging→main promotion defers both deploys and journal entries.** The #762
   entry named it once (_"merged is not deployed, and the branch that serves a
   report link is not the one most work lands on"_) and it recurred immediately:
   at snapshot, edit mode and the Netlify security finding are merged to
   `staging`, 15 commits from `main`.

9. **Repeated re-litigation of settled operator rulings.** The Turnstile ask on
   Saturday ("there's no form, you can remove the turnstile issue") reproduces a
   ruling already recorded in memory. Similar: `prismic-seed` was referenced in
   five files as a command that does not exist, and `next.mjs` prescribed a probe
   that was never installed in that repo — both "a command written down without
   checking it runs."

10. **Correction latency.** The journal's self-correcting design works, but the
    correction lands as a PR like anything else — and #769 sat unmerged while the
    wrong claim stayed on `main`.

---

## WHAT THIS WEEK PROVES ABOUT THE WORKFLOW

MEASURED, not editorial: **every one of the week's six significant defect
discoveries came from running the thing on real input, and none came from
review.** The check battery's URL-normalisation bug came from reading the dumps,
not the replay verdict. All four match-harness lies came from installing the
harness on 29 Navy. The blank page's three causes came from Tucker opening a
deploy preview. The report's false "not on your site" claims came from Tucker
reading the report. The a11y miscount came from a site adding eight routes. The
Netlify query leak came from checking a `Location` header that was assumed.

The counter-pressure this repo has built — prove the instrument, mutation-test
the guard, include a control — worked every time it was applied, and the two
places it was _not_ applied are the two things that went wrong: a journal claim
written from memory, and two tests that encoded a false derivation as a comment
and passed for weeks because the fiction and the fact happened to produce the
same number.
