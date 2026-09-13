# Week 02 — 2026-08-03 → 2026-08-09

**Headline:** A Webflow client site was rebuilt pixel-by-pixel against its own
live stylesheet and cut over to a hard billing deadline, while the fleet's
Monday dependency batch had to be held back by hand in six places — and the
week's two loudest lessons both came from instruments that were green about
things they structurally could not see.

---

## SOURCE COVERAGE — read this before believing any narrative detail

**There are NO Claude Code transcripts for this week.** Session retention
begins 2026-08-10. `sessions.jsonl` and `prompts.jsonl` both return **0 rows**
for every day 2026-08-03 → 2026-08-09 (verified; `metrics.json.byDay` agrees:
`sessions: 0, prompts: 0, toolCalls: 0` for all seven days). So there is not a
single verbatim operator prompt available from this week, and nothing here
about _how_ a session was steered in-flight is observed.

What IS measured, and what this chapter is built from:

| Source                                                              | Status for this week                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commits.jsonl`                                                     | **Full.** 278 rows / 271 unique SHAs.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Commit **bodies** (read directly from the checkouts with `git log`) | **Full, and unusually rich.** Tucker's commits this week routinely run 20–60 lines of prose with file:line citations and before/after measurements. This is the primary source.                                                                                                                                                                                                                                                                                           |
| `prs.jsonl`                                                         | **Full.** 122 opened, 93 merged in-window.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `runs.jsonl`                                                        | **Partial — a real gap.** The extract is capped at ~300 runs per repo, so `reddoor-maintenance` only reaches back to **2026-09-04** and `reddoor-website` to **2026-08-22**: there is **no CI-run data at all for the central repo this week**. `hedloc` failed to fetch entirely (`gh-errors.txt`: connection reset). `scriptorium-setup`, `claude-skills`, `caldea`, `espada`, `gallerysonder` have no runs rows at any date. Site-repo runs for this week ARE present. |
| `discord-messages.jsonl`                                            | **Present — 175 messages in-window.** This is the only direct record of what the operator said to anyone during this week, and it carries the launch deadline.                                                                                                                                                                                                                                                                                                            |
| `airtable-*.json`                                                   | **Snapshot of 2026-09-12, not history.** Useless for reconstructing this week's state. `airtable-Submissions.json` holds 48 rows, **none in August** — so the two form incidents described below cannot be corroborated from Airtable, only from the commits that fixed them.                                                                                                                                                                                             |
| Agent memory files (`~/.claude/projects/…/memory/`)                 | **Six files carry `modified:` timestamps inside this week.** These were written _contemporaneously by the agent sessions themselves_ and are treated here as period sources, clearly labelled — they are not transcripts, but they are not later reconstruction either.                                                                                                                                                                                                   |
| `docs/workJournal.md`                                               | **Does not cover this week.** Its earliest entry is 2026-09-05.                                                                                                                                                                                                                                                                                                                                                                                                           |

Everything below is either (a) quoted from a commit body or a Discord message,
(b) an arithmetic aggregate over the corpus, or (c) explicitly marked
INFERRED. Where a claim rests only on a commit message, the commit message is
the evidence and I say so — commit prose is the operator's own account, not an
independent one.

---

## CALENDAR

| Day       | Commits (unique) | Repos with commits | PRs opened / merged | CI runs (fail) | Sessions | Prompts |
| --------- | ---------------- | ------------------ | ------------------- | -------------- | -------- | ------- |
| Mon 08-03 | 166 (173 rows)   | 25                 | 111 / 82            | 257 (23)       | 0        | 0       |
| Tue 08-04 | 26               | 3                  | 7 / 8               | 60 (1)         | 0        | 0       |
| Wed 08-05 | 46               | 3                  | 0 / 0               | 48 (16)        | 0        | 0       |
| Thu 08-06 | 14               | 2                  | 0 / 0               | 71 (37)        | 0        | 0       |
| Fri 08-07 | 15               | 1                  | 0 / 0               | 34 (0)         | 0        | 0       |
| Sat 08-08 | 4                | 4                  | 4 / 3               | 39 (0)         | 0        | 0       |
| Sun 08-09 | 0                | 0                  | 0 / 0               | 33 (0)         | 0        | 0       |

Commit rows vs unique SHAs: 278 vs 271. The seven duplicates are four starter
commits that appear in `reddoor-starter`, `reddoor-starter-blux` and
`beachfront-dentistry` at once, because all three share the template's
history. Per-repo totals below are _rows_; fleet totals are deduplicated.

**Commits by repo (rows, in-window):** beachfront-dentistry 90 ·
scriptorium-setup 45 · the-pointe-burbank 19 · reddoor-maintenance 14 ·
claude-skills 11 · caldea 10 · reddoorla-dot-github 9 · 1836dig 8 ·
alamo-anatomy 7 · espada 7 · gallerysonder 6 · canvas-starter 5 ·
medical-solutions-of-texas 5 · reddoor-website 5 · revogen 5 ·
the-tower-burbank 5 · hedloc 4 · la-homelessness-initiative 4 ·
reddoor-starter 4 · reddoor-starter-blux 4 · erp-industrial 3 ·
vineyard-custom-homes 3 · data-dynamiq 2 · la-homelessness-youth 2 ·
caltex-landing 1.

**Authorship:** 194 rows Tucker Lemos, 84 rows `reddoor-renovate[bot]`. So
roughly 30% of the week's commit volume is the bot merging its own dependency
PRs in-run, concentrated almost entirely on Monday.

**Working spans (first → last Tucker-authored commit, local time):**

- 08-03 07:37 → 22:04 (14h27m, 93 commits)
- 08-04 09:01 → 22:33 (13h32m, 26 commits)
- 08-05 01:19 → 22:41 (21h22m wall, 46 commits — the 01:19–02:02 block is the tail of Tuesday's session)
- 08-06 00:17 → 10:56 (the 00:17–01:01 block is Tuesday night's tail; the day's real work is 09:12–10:56)
- 08-07 09:30 → 17:39 (8h09m, 15 commits)
- 08-08 / 08-09 — no human commits at all.

These spans are _commit_ spans, not session spans, and with no transcripts
there is no way to know how much of the gap between commits was working time.
They are the ceiling, not the measurement.

### Per-day notes

**Mon 08-03 — the biggest day in the corpus (166 unique commits, 25 repos).**
Three things ran in parallel: the weekly Renovate batch landing fleet-wide and
having to be fought (six preset changes in `reddoorla-dot-github` between 07:37
and 10:52), a four-site vite-8 migration wave, and the frozen-page design-review
round on the-pointe-burbank. In the background, a brand-new repo —
`scriptorium-setup` — went from an empty design spec at 10:34 to 33 commits by
22:04. 257 CI runs, 23 failures, every failure a Renovate branch or a rejected
migration attempt.

**Tue 08-04 — beachfront takes over.** Five PRs merged into beachfront between
16:36 and 20:41 UTC, then PR #17 opens at 20:25 UTC and stays open for the next
68 hours. scriptorium adds 12 more commits (09:01–15:14) and then stops for
good this week. the-pointe closes out with two carousel/imagery PRs.

**Wed 08-05 — the deepest single day of work in the whole seven weeks.** 44
beachfront commits between 01:19 and 22:41, all on one branch, all
gate-measured. The day contains the week's most important self-correction (the
CLAUDE.md rules commit at 12:16) and the style-census run from 192 mismatches
down to 0. 16 CI failures, all on that one branch.

**Thu 08-06 — the Prismic round-trip reckoning.** 13 commits, 09:12–10:56,
after a 00:17–01:01 tail. Five slice-model fields were being silently dropped
by the Prismic Migration API; the day is spent finding them, building the
push/verify tooling, and clearing a leaked API key out of the newly-tracked
`matching/` directory. 37 CI failures — the highest of the week — all on PR
#17's branch.

**Fri 08-07 — improvements, audits, launch.** 15 commits 09:30–17:39. PR #17
merges at 09:29 local, then a 44-item verified improvements backlog is worked
through: a11y, SEO, structured data, perf, dead links, a real WCAG failure
escalated rather than suppressed. PR #18 merges at 17:45 local; DNS is switched
at 17:49. **Zero CI failures all day.**

**Sat 08-08 — Renovate only.** Four `@sveltejs/kit 2.70.2 [security]` bumps
(alamo-anatomy, espada, gallerysonder, revogen) merged by the bot between 12:21
and 12:48 UTC. No human commits.

**Sun 08-09 — nothing.** 0 commits, 33 scheduled CI runs, all green.

---

## BEATS

### 1. Monday morning: the dependency batch that had to be held back six times

_Sources: commit bodies in `reddoorla-dot-github`, site-repo commits, PR states,
and the memory file `brace-expansion-advisory-2026-08-03.md` (written
2026-08-03T18:45Z)._

The fleet preset lives in `reddoorla/.github` and Renovate's cron is
`before 6pm on monday`. The batch arrived and six separate holds had to be
written into the preset before lunch. Each hold's commit body names the
specific breakage, which makes this an unusually legible record of what a
weekly batch actually costs.

**07:37 — TypeScript 7.** `allowedVersions <7.0.0`, because "every one
hard-fails CI with 'typescript-eslint does not support TS 7.0.'
(hedloc#27, caltex-landing#45)". MEASURED: the TS-7 branches red CI in
caltex-landing, canvas-starter, la-homelessness-initiative,
la-homelessness-youth and the-tower-burbank on 08-03 (`runs.jsonl`), and every
`typescript to v7` PR in the corpus is `CLOSED — autoclosed`.

**07:53 → 08:07 — the cookie override, merged before it was understood.** This
is the sharpest fourteen minutes of the week. At 07:53:29 and 07:53:34 the PR
`chore(deps): update dependency cookie@<0.7.0 to v2` **merged** into `espada`
(#53) and `hedloc` (#25). At 07:56:38 the preset gained a fleet-wide hold
(`.github#19`). At 08:07:09 and 08:07:14, both sites got a corrective commit:
`fix(deps): re-cap the cookie override below 1 (defuse the <3 widening)`.

The espada commit body explains what the merged PR actually did:

> Renovate's weekly batch widened the vuln-wave override target to
> `'>=0.7.0 <3'`. pnpm keeps resolving 0.7.2 while the lockfile holds it, but
> any fresh resolution (next lockfile maintenance) would jump to cookie 2.x —
> whose removed parse/serialize exports break every current @sveltejs/kit
> server build.

**Belief corrected on contact:** a Renovate PR titled "update dependency
cookie@<0.7.0 to v2" is not a dependency upgrade at all — it is a rewrite of a
pnpm **override key**, and the key names the range being overridden _away from_.
The PR looks like a bump and is a time bomb: nothing breaks at merge, because
the lockfile still pins 0.7.2; it detonates at the next `lockFileMaintenance`
regen. Two repos merged it. Every other repo's copy of the same PR is `CLOSED`
in the corpus (alamo-anatomy #38, beachfront #11, canvas-starter #9,
data-dynamiq #37, erp-industrial #43, gallerysonder #73,
la-homelessness-initiative #31, medical-solutions-of-texas #49,
reddoor-starter #98, reddoor-website #121, revogen #55, the-pointe-burbank #11,
the-tower-burbank #5, vineyard-custom-homes #46) — fourteen closes and two
merges, which is what a correct rule applied after two mistakes looks like.

The same class struck again the same day inside the central repo. The memory
file written that evening is unambiguous:

> ⭐⭐ **DO NOT merge the `brace-expansion@... to v5` security PRs Renovate
> opens against pnpm overrides** (reddoor-maintenance#495/#496, closed
> 2026-08-03). Renovate reads the pnpm override **key**
> (`brace-expansion@<1.1.16`) as if it were a resolved dependency at a
> vulnerable version. It isn't … Merging would WIDEN the cap to `<6`, and the
> three separate ranges exist precisely because three minimatch majors coexist
> (3.1.5, 9.0.9, 10.2.6), each needing its own brace-expansion major.

And the reach analysis that made it a non-emergency, which is the part worth
keeping: `pnpm why --prod` traces the path as `@reddoorla/maintenance` →
typescript-eslint → eslint → minimatch@10 → brace-expansion. "eslint never runs
in a deployed site, and the vuln needs _attacker-controlled glob patterns_ — our
glob patterns are authored config." The clearing action was a lockfile refresh
of 11 open lock-file-maintenance PRs, "census-verified: all lockfile-only, all
resolving 5.0.9, no cookie-override jump" — i.e. each one was _read_ before it
was merged, specifically because of what had happened four hours earlier.

**08:12 → 10:21 — the preset used as a two-hour mutex.** At 08:12:03 a hold went
in on `@sveltejs/vite-plugin-svelte` below 7: "Plugin 7 needs vite 8 (rolldown)

- svelte >=5.46.4. Fleet sites on vite 6/7 can never green these PRs (the plugin
  silently fails to register — 'No loader is configured for .svelte' in the a11y
  audit's dev server)". At 10:21:48 the hold came back out again: "the vite-8 wave
  landed … All four lagging sites (espada, vineyard, gallerysonder, revogen) are
  now on the starter stack". **Hold duration: 2h09m.** That is a deliberate and
  reusable pattern — the fleet preset as a temporary brake while a migration wave
  is prepared by hand, then released. The removal commit also names the cost of
  leaving it: "The hold was also freezing plugin updates on the ~15 sites already
  on 7.x."

**10:39 — a hold that did not cover its own surface.** `.github#22`:

> The 11.8.x pnpm hold matched only depType packageManager, so Renovate bumped
> pnpm/action-setup's `version:` input to 11.18.0 in reddoor-maintenance#492
> while packageManager stayed held at 11.8.0 — action-setup hard-errors on the
> mismatch.

The follow-on fix (central #494, merged 10:46) deleted the pins entirely rather
than re-pinning them: "packageManager is the single source". Net diff **0
additions, 14 deletions across 7 files**. This is the same lesson the fleet has
recorded before — a hold scoped by `matchDepTypes` misses the dependency's other
manager — arriving again, from the actions surface this time.

**10:52 — `@libsql/client` held at 0.8.x**, because "`@libsql/kysely-libsql@0.4.1`
(latest) hard-depends on `@libsql/client ^0.8.0`; bumping the direct client dep
to 0.17 forks the tree into two incompatible Client types and fails typecheck".

**Honest accounting:** six preset changes, two bad merges corrected in 14
minutes, one hold raised and lowered inside two hours, and 23 red CI runs across
13 site repos — all before 11am on a Monday, for a batch that in principle
merges itself. Whatever the fleet's automation buys, it did not buy this
morning back.

---

### 2. The vite-8 wave: a first attempt abandoned in favour of a bigger one

_Sources: PR records and commit bodies, `espada`/`revogen`/`vineyard-custom-homes`/`gallerysonder`._

MEASURED, from `prs.jsonl`: three near-identical PRs titled
`chore(deps): svelte 5.56.8 + @sveltejs/vite-plugin-svelte 7 (paired majors)`
were opened on 08-03 (gallerysonder #75, +25/−41; revogen #56, +76/−92;
vineyard-custom-homes #47, +83/−114) and **all three were CLOSED**. Three
replacements titled `vite 8 stack (rolldown)` were opened and **all three
merged** (gallerysonder #76, +355/−169; revogen #57, +345/−67; vineyard #48,
+358/−81). `runs.jsonl` shows CI failures on branch
`chore/svelte-556-vite-plugin-svelte-7` in both revogen and vineyard on 08-03.

So the first model of the problem — _pair the two majors and the plugin will
register_ — was tried, failed CI, and was abandoned within the same morning for
a model four to five times the diff size: vite 8.2 (rolldown) + plugin-svelte
7.2 + svelte 5.56 + tailwind 4.3. gallerysonder needed one extra change nobody
had predicted: the hold-removal commit records that it "switched off the
rolldown-incompatible postcss route" to `@tailwindcss/vite`.

The espada commit body names the evidence that closed it, and it is worth
quoting because it is the _reason_ this migration could be trusted at all:

> Verified locally: build, vite dev boot, svelte-check, and the a11y audit
> (pass) — the audit's dev-server was exactly what plugin-7-without-vite-8
> broke.

The failing symptom and the verifying instrument were the same thing. That is
the cheapest possible verification and it was available because the fleet
already runs an a11y audit against a live dev server.

---

### 3. The-pointe-burbank: a design round where the agent over-read the client

_Sources: commit bodies in `the-pointe-burbank`, 08-03/08-04._

This is a Blux-frozen page — a Webflow-era export re-rendered from a baked
artifact — and it was in design-review round 4 against Figma pins from Nicole
(internal design). Five PRs landed on 08-03 between 13:03 and 19:13.

**The correction.** Round 4 shipped animated underlines on the nav items. At
14:26 they were reverted, and the commit body is the clearest instance this week
of an agent generalising a client comment past its scope:

> The nav lines were mine, not Nicole's. Her 51:42 comment — "could this
> underline come in like the other double line graphic?" — is pinned on the FIT
> Health Club BODY link; round 4 read it as covering links generally and gave
> the nav the same treatment on top. Asked to take them off.

Diff of the revert: +41/−121 across 4 files — the pseudo-element, its scaleX
draw, the per-item stagger, its reduced-motion gate, the `rd-nav-run` class and
a scroll-position trigger all came back out. The body-link draw-in, which is
what the comment actually asked for, stayed. **The lesson is scope, not
quality:** the work was good and the mechanism was sound; it was applied to an
element nobody asked about, and a human had to say so.

The same shape recurred an hour later on the LEED badge: "Round 4 read Nicole's
'could you make the image 10% smaller?' (Figma 51:24) literally and took 10% off
the width. The badge still stood a third taller than the building icons beside
it, because it is the only square artwork in a row of 67.92%/68.18% ones — equal
width in that row is not equal size to the eye." The re-fix sized to _height
parity_ and then checked against ink rather than boxes: "Measured at 4x on the
deploy preview, the icons' ink runs 67.5/67.0/73.0 tall and the badge fills 95.5%
of its square, so 72.8px of box reads as 69.6px of ink: inside the 6px spread the
icons already have between themselves, 0.4px off their mean."

**The false green.** At 16:11, `fix(frozen): un-park a carousel slide when it is
shown`. Clicking either arrow appeared to do nothing; slides 2 and 3 went blank.
`show()` toggled display, opacity and pointer-events but not the freeze's baked
`transform`, so an activated slide rendered one or two full track-widths to the
left, inside `overflow:hidden`. Two things made it invisible:

> Why the existing tests all passed: the state machine WAS correct, and the 13
> unit tests only ever asserted state. The three new ones fail against the old
> `show()`; the old ones still pass against it.
>
> Why manual checking missed it: under `vite dev` the committed slot defaults
> point at Blux CloudFront and `img-src` blocks that host, so every slide is a
> blank box — **a slide parked off-screen and a slide with no photograph look
> identical.**

And the file's own comment asserted the opposite of the truth: that the baked
transforms were "inert track geometry, not a position this reads or writes". A
comment that is wrong is worse than no comment, because it is the thing a
reader checks instead of the code.

**The flash that took four attempts.** The carousel cross-fade showed a white
flash, and the fix arrived in four commits over five hours, each one honest that
the previous had not closed it:

1. **17:14 — preload + true dissolve.** Traced on the preview: "the fade began
   at +5058ms and the response landed at +5078ms". Also a compositing error:
   both slides were animating, and "two opacities meeting at .5 composite to
   .5 + .5×.5 = .75: a quarter of the page's own light background showed
   THROUGH the middle of every transition."
2. **18:12 — a readiness gate.** "Preloading warms the cache but gates nothing,
   so the flash survived it on any connection slow enough to lose the race.
   Reproduced under 1.6Mbps throttling: the fade ran all 600ms with every slide
   reporting `complete === false`." Waits on `decode()` as well as `load`,
   because "a downloaded 3960×2640 JPEG still has to become a bitmap".
3. **18:25 — stop racing, shorten the race.** "the three slides ship at their
   origin resolution, 3960×2640, into a 1425×760 box. Measured on the deploy
   preview they cost 3.4MB even as AVIF — 906 + 1103 + 1399 KB — roughly seven
   times the pixels the band can show." `w=2400` took 1103KB → 537KB.
4. **18:32 — accept the residual and make it survivable.** "the gate has to give
   up eventually or a broken image would freeze the slider, and under 1.6Mbps
   throttling the 4s cap still expires first." Backdrop set to `rgb(63,62,40)`,
   the mean of the three photographs' own colours taken to 62%, "so an unpainted
   slide reads as the picture not being there yet rather than as a hole".

Two more green-test defects fell out of step 3, and they are the same class as
the carousel state tests:

> - Dropping the step from `steps()` failed nothing, because every end-to-end
>   assertion ran against CloudFront defaults the step deliberately ignores.
> - `substitute` emits `url('…')` WITH quotes, so appending to the raw capture
>   put the parameter after the closing quote — a url no browser would fetch.
>   `toContain("&w=2400")` passed on it happily.

An assertion that matches a substring of a URL cannot tell a valid URL from a
broken one. Both are now asserted as the whole url, quotes included.

**Generalised the same evening.** At 19:02 the per-image fix was extended to all
50 images — "5.06MB of Prismic imagery, 4.03MB of it in files far larger than
their box — a 5774px original (1.34MB) into an 823px box" — and at 19:13 the
mechanism was pushed upstream into the central repo (#506,
`feat(blux): freeze records each image's painted box`). The load-bearing fact,
stated twice:

> The size cannot be derived from the markup — Blux sets it in CSS, so an
> element carrying `width:5774px` renders into an 823px box.

…and its corollary, which is the kind of thing only a measurement finds:
"image CDNs upscale past the widest render that exists rather than refusing — a
123px badge asked for 900px goes from 4.9KB to 30KB". 24 of the 50 slots were
therefore left alone.

---

### 4. Beachfront Dentistry: 90 commits, six pages, and a discipline that had to be mechanised

This is the spine of the week. `beachfront-dentistry` is a pixel-match rebuild
of a live Webflow site into SvelteKit + Prismic, governed by the
`matching-a-page` skill, and it ran from 08-03 through 08-07 against a client
deadline that appears in Discord.

#### 4a. The deadline was real and it was a renewal date

From `#website-maintenance` and `#reddoor-project-list` (Discord, MEASURED):

- 08-04 17:31 UTC — Tim: _"I was going to add an two articles to the beachfront
  CMS, should I wait?"_
- 08-04 17:33 UTC — **Tucker: "yeah I would wait, should cutover from webflow on
  thursday"**
- 08-06 20:55 UTC — Tucker posts `https://deploy-preview-17--beachfront-dentistry-rd.netlify.app/`
- 08-06 21:43 UTC — Tim: _"1. Is this ready for review/comments? 2. **This renews
  on August 8** so if we can get it close enough I say we switch it and then
  tighten it up"_
- 08-07 21:22 UTC — Tim: _"I have made 90% of my comments and invtied you to the
  DNS. If we can switch over ASAP today and I cancel we save $40."_
- 08-07 21:25 UTC — Tucker: _"popping it over, working on the rest when I'm back
  in monday"_
- 08-07 21:33 UTC — Tucker: _"will be a little bit, I need to set the forms to
  live too so they aren't missing leads over the weekend"_
- 08-08 00:49 UTC — **Tucker: "dns is switched over"**

So: Thursday was the plan, Friday evening was the cutover, and the forcing
function was a $40 Webflow renewal. The last beachfront commit before the DNS
switch is `4403220f` at 17:39 local (00:39 UTC) — **ten minutes** before the
"dns is switched over" message.

#### 4b. The four discipline rules — the week's most important commit

At 12:16 on 08-05, after roughly 30 hours of matching work, Tucker committed a
`CLAUDE.md` to the beachfront repo. The commit body opens by answering a
question:

> **Answering "are you using the skill or winging it?" honestly:** the gates and
> the ledger were run faithfully, but four parts of the matching-a-page skill had
> drifted, and each drift cost real rework.

That question is the only near-verbatim operator utterance available from this
week outside Discord, and it is preserved because the agent wrote it into the
commit. (PROVENANCE: it appears inside a commit body, quoted by the agent. It is
not from a transcript — there are none — so it is the agent's report of what was
asked, not a recording.)

The four drifts, as recorded:

> 1. `matching/SPEC.md` — the Phase 1 deliverable — was never written for the
>    nav pages. That is why live's root-font ladder, the `.content-width` ladder
>    and `.hero.group-photo`'s own height ladder were each found reactively,
>    after the region had already failed several rounds.
> 2. Geometry fixes were applied from probed rects rather than the reference
>    stylesheet. **The two fixes that landed first-try came from grepping
>    `beachfront.css`; both fixes that had to be reverted came from a probe.**
> 3. Phases 5 and 6 never ran on the nav pages.
> 4. The 3-strike stop rule was blown on services `top` and yfv `top`.

And the response, which is the reusable part:

> Written rules did not hold on their own, so each is now a check that fails.

- `matching/gate.sh` **exits 2** on any page with no `## <page>` section in
  SPEC.md, "so a refused page cannot be reported as a score."
- `matching/strikes.mjs` reconstructs every region's history from the
  `out-*/report.json` corpus and exits 1 while any failing region has been flat
  across 3+ runs. Critically, it is honest about its own limits: "report.json
  cannot record intent, so it measures **stalls** (an upper bound on attempts)
  rather than claiming to count them."

**And it was proven on known-good input before its verdicts were used.** Run
against the existing corpus, strikes.mjs "independently confirms both admitted
stalls plus the ask-the-doctor grid: atd 'Beyond the Smile' 79–83% flat across
5–7 runs, yfv `top` 76.2% @834 flat across 6." A stall the operator already knew
about was the calibration input. That is the repo's central rule applied
correctly and without being asked.

Each rule ships with an **operator's challenge** — the sentence Tucker can say
that the rule makes answerable: _"which line of beachfront.css says that?"_,
_"show me the SPEC section for that region"_, _"how many runs has that region
been flat?"_, _"paste the gate header."_ This is a notable design move: the check
exists to make a one-line human audit cheap, not to replace it.

A fifth rule landed four hours later (16:51), and its diagnosis of _why_ is
unusually candid:

> **rule 5 — a commit is a checkpoint, not a stopping point.** … The failure was
> habitual rather than deliberate — a turn ends when user-facing prose gets
> written, and 'I just committed something good' is exactly the moment that
> invites writing it.

That is a statement about agent turn-taking dynamics, written by the agent. For
the downstream reader it is probably the single most transferable sentence in
the week: _the model's natural stopping point is the commit, and the commit is
not where the work ends._ `matching/next.mjs` was built to exit 1 while any real
failure remains, so the round continues while it does.

**And next.mjs shipped with a false green of its own, caught on its second use:**

> it ranked run directories by mtime without checking their meta, so a
> `--mask-photos` DIAGNOSTIC became the 'latest' report and yfv's top region read
> 43.9% when the unmasked gate had it passing at 1.3%. It now skips any run
> carrying masks, media neutralisation, truncation, or a threshold other than
> 0.10 — **a diagnostic is never the state of the page.**

#### 4c. The measured arc

Every gate score below is quoted from a commit body. MEASURED; the underlying
`out-*/report.json` runs were git-ignored until 08-05 22:16 so they are not in
the corpus, only their reported numbers.

Region gates (regions passing, threshold 0.10, matrix 1440/834/390, no masks):

| Page                           | Start (08-04/05) | End (08-07)                                   |
| ------------------------------ | ---------------- | --------------------------------------------- |
| home                           | 17/27            | **24/27**                                     |
| your-first-visit               | 5/24             | **21/24**                                     |
| services                       | 4/15             | **13/15**                                     |
| our-team                       | 6/15             | **13/15**                                     |
| ask-the-doctor                 | 7/15             | **13/15**                                     |
| contact                        | 5/12             | **10/12**                                     |
| detail templates (svc/team/qa) | —                | 27/30, then qa 13/15 · svc 12/15 · team 13/15 |

Style census (undeclared type mismatches across 9 pages × 3 viewports):
**192 → 124 → 100 → 57 → 48 → 0** across six commits on 08-05 between 20:14
and 21:41. The residual open failures at the end are almost all declared floors
— the cross-origin Google Maps iframe "Chromium will not composite in a
full-page capture" — plus one operator-ACKed copy decision.

#### 4d. The single systemic trap, and what it cost

Stated in the beachfront CLAUDE.md as a standing project fact, and visible as
the cause behind at least eight separate commits:

> **Live's root-font ladder is the systemic trap.** An inline `<style>` steps
> `html{font-size}` to 40px ≥993 / 32px 769–992 / 24px ≤768, while the Webflow
> class rules break at 991/767/479. Every rem value therefore has THREE sizes.
> Calibrate md at **834, never 768**; lg at **1200/1440, never 992**. **Most
> defects on this project were a two-tier ladder keyed at 768, leaving the whole
> 768–991 band rendering the desktop value.**

The 08-05 commit `fix(tablet)` states it as a shape: "Three defects with one
shape: live sizes these components in REM against a root font that steps
40/32/24 at 992/768/480, so each has THREE sizes. Ours had two, keyed at 768,
which left the entire 768–991 band rendering the desktop value."

**Belief corrected on contact, and it cost the most:** the Webflow tablet band
is not "mobile at a bigger size" nor "desktop at a smaller size"; it is a third
independent value, and any number read by measuring live at exactly 768px is
3/4 of live's real value in that band. The `claude-skills` repo took this
upstream the same day: "Webflow's real min-width breakpoints are 480/768/992 and
each element carries its OWN per-breakpoint px — the root 24/32/40 'scaling' is a
red herring, most step at 480."

#### 4e. Five episodes where the gate itself was the defect

These are the highest-value items for a reader trying to understand how this
workflow fails.

**(i) The CSP-blocked photograph.** 08-05 01:19: "svelte.config.js `img-src`
never allowed `cdn.prod.website-files.com`, so every `/dev/match` hero photo was
CSP-blocked and the gate diffed a BLACK band against live's photograph."
Correcting it moved our-team `top` from 58.7% → 17.8% @1440, 76.3% → 18.9% @834,
69.8% → 20.5% @390. **The gate had been comparing a black rectangle to a
photograph and reporting the difference as a layout defect.**

**(ii) The gate cutting the two pages at different elements.** 08-05 15:16: the
ask-the-doctor "Beyond the Smile" region "sat at 79–83% across 8 gate runs, was
carried as ACK-REQUIRED/unexplained since 2026-08-04, and **which this ledger
twice diagnosed wrongly** (first 'large-area colour delta', then 'vertically
offset grid'). It was a missing wrapper element." Live's `.qa-text` collapses to
a 320px box; ours was a bare 80px `<h3>`; "page-diff cut live at that 320px box
and cut us at the bare 80px `<h3>` — 220px apart, comparing every atd region
against the wrong content. 220/635 = 34.6%, exactly the `top` region's reported
height delta." The closing line is the method:

> What found this was not a better probe of the same thing but a different
> question: **what element does the gate actually cut on, on each side?**

**(iii) The anchor finder's selector list.** 08-05 18:25: "page-diff's anchor
finder only queries `h1-h6,p,a,li,span,div,section,button`. `article` is not in
that list, so our `<article>` card was skipped and the 'General Dentistry' cut
landed on the card's inner 60% block, 80px lower — the region measured 680
against live's 800 and **the pixel score was comparing misaligned windows**
(18–19%)." Same root cause as (ii), found independently on another page.

**(iv) The pixel gate is blind to sticky positioning.** 08-06 01:00: live's hand
mark is `position:sticky; top:0; height:10rem`. "A full-page screenshot renders
sticky elements at their UN-STUCK position, so the pixel gate scores the two as
identical; only scrolling to the section and shooting the viewport shows it.
home.md recorded the rule in Phase 1 and nothing until now had checked it."

**(v) The pixel gate is blind to everything behind a click.** 08-07 16:43, the
last real bug of the launch, reported by Tim in Discord at 21:26 UTC (_"the
'ask the doctor' modules on the home page, text is getting caught off when you
click on the title"_) and fixed 2h17m later:

> ```
> 1440  box 120px  answer 193px  CLIPPED 73px
>  834  box  96px  answer 172px  CLIPPED 76px
>  390  box  72px  answer 183px  CLIPPED 111px   (61% of it hidden)
> ```
>
> Live gives the home (teaser) variant of that box TWO heights:
> `.qa-text.m-2 { height: 3rem }` :7292 and
> `.qa-text.m-2.active { height: 8rem }` :7303. Only the collapsed 3rem was ever
> implemented …
>
> **WHY NOTHING CAUGHT IT** — every gate here (page-diff, style-census,
> text-diff, gate-published) measures the page in its DEFAULT state. This defect
> existed only after a click: the matching skill's Phase 5 blind spot, which had
> no mechanical check at all.

The new test asserts _rendered geometry_, not class names — "because the bug was
content not fitting its container and only measuring both can see that" — and it
asserts the box still clips "so it cannot pass vacuously". It was verified to
fail against the pre-fix component "at all three viewports with the exact numbers
above."

**Honest accounting on this one:** a paying client found a visible bug on the
home page on launch day, after five days of gate-measured work in which the gate
score for that page was 24/27. The score was not wrong; it was answering a
different question.

#### 4f. The Prismic Migration API drops fields silently, at HTTP 200

The 08-06 morning block (09:12–10:56) is a single defect class worked to the
bottom. The published `page` documents rendered **24–43% differently** from the
matched `/dev/match/*` routes on three pages.

> Cause: the Migration API validates a document against the slice models
> registered in Prismic and **DROPS every undeclared field — silently, with a 200.** The fixtures set four fields that no model declared, so the published
> docs fell back to component defaults.

Four fields: `heading_style`, `image_position`, `hero_wash` (Hero) and `layout`
(Carousel). Then a **fifth** was found by the dry run: `order_uids`, "which
carries live's your-first-visit slider order … Stripped, that page fell back to
the our-team ordering." And a second, distinct loss: "the Migration API strips
`\n` out of StructuredText on WRITE", which cost the closing CTA band its three
hard-broken lines — **168px shorter on four of the five nav routes**, and 168 of
home's 316.

**Why every gate stayed green through all of it:**

> all of them run against `/dev/match/*`, which reads the fixture object directly
> and never round-trips through Prismic's validation.

The response was three layers, each proven to fail before being trusted:

1. `beachfront-pages.test.ts` fails when a fixture carries a field its local
   model does not declare — "Verified failing — removing carousel `review.layout`
   fails the third case — before being verified passing."
2. A recognised limit stated plainly: that test "CANNOT catch this class: it
   compares the fixture to the LOCAL model, and the local model was right. **The
   binding constraint is the REMOTE model, which needs the network.**" Hence
   `push-slice-models.mjs` and `push-custom-types.mjs`, and `seed-pages.mjs`
   asserting models are in sync _before_ writing anything — "Verified failing — a
   bogus local field makes it refuse and name the field — before verified
   passing."
3. `test(matching): gate the PUBLISHED routes against their fixture twins`
   (08-07 16:02), which is the check for the blind spot itself. Its opening line
   is the general lesson:

   > CLAUDE.md has said since the migration defects that after any seed you must
   > "diff a real route against its `/dev/match/*` twin rather than assuming they
   > agree" — **but that was a thing to remember, not a thing to run. This is the
   > script.**

   Result on the published release: all five core pages, Δh 0/0/0 and 0 text
   lost at all three viewports.

**A belief corrected in passing, and it unblocked the whole day:** "The write
token DOES carry the Custom Types API scope (`GET /slices` → 200) — **the earlier
403 was the Slice Machine session in `~/.prismic`, not the token.** So the whole
push/seed round is scriptable after all." A day earlier the same work had been
recorded as needing Slice Machine's UI.

**A near-miss worth recording.** Comparing raw model JSON "called all 30 models
'different', burying the 3 that were", because Prismic's serializer reorders
keys, adds `"select": null`, and returns an `imageUrl` per variation that is `""`
on disk. Normalising took 30 → 3. And: "The `imageUrl` one was not cosmetic: a
push REPLACES the model, so sending the local `""` would have blanked **all 42
slice previews** in the editor UI as a side effect of adding a field."

#### 4g. The secret in the spec, and CI's first red in two days

08-06 10:10, three reds traced to one commit — the `.gitignore` change that
started tracking `matching/`:

1. **GitHub secret-scanning alert #1 — a Google Maps API key, publicly leaked in
   a public repo**, at `matching/spec-sections/contact.md:500` and
   `matching/SPEC.md:7356`. It was _live's own key_, "lifted verbatim while
   documenting the contact page's tile URLs". Redacted, with the honest
   follow-up: "the tip is clean but **HISTORY IS NOT**, and the repo is public,
   so rotation/referrer-restriction of that key is the only real remediation."
   A pattern sweep across the tree for Google/Stripe/Slack/Mapbox/SendGrid/private
   keys found nothing else.
2. **prettier** — the ignore change added 230 unformatted files, 189 of which
   failed `prettier --check`.
3. **`pnpm build` hard-failed on prerender**: `/ask-the-doctor` links to `#hero`
   and nothing carried that id — "a dead link that the prerenderer, correctly,
   refuses to ship."

The decision on the 189 files is worth noting as a small piece of taste:
"Formatting rather than adding `matching/` to `.prettierignore`: **they are
tracked source now**".

A separate honest-accounting line in the same commit: the one smoke failure seen
mid-round "appeared immediately after a build and passed 3/3 on clean re-runs …
Not a code defect; worth watching on CI." Called a flake, and labelled as a
_claim_ rather than a finding.

#### 4h. PR #17: the shape of a long branch

MEASURED, from `prs.jsonl` and `runs.jsonl`:

- Opened **2026-08-04 20:25Z**, merged **2026-08-07 16:29Z** — **68 hours 4
  minutes** open.
- **+47,824 / −840 across 288 files.** (Most of that is the 228-file, 2.4MB
  `matching/` corpus finally being tracked at 08-05 22:16.)
- **0 reviews, 1 comment.**
- **52 failing CI runs** on `feat/detail-templates-and-footer`, between
  2026-08-05 09:03Z and 2026-08-06 17:39Z. That is essentially the entire life
  of the branch red, in a 33-hour span with failures landing every 10–30 minutes.
- The branch went green on 08-06 17:39Z and merged 22 hours later.

INFERRED (stated as inference): the 52 reds are not 52 distinct defects. The
commit record shows the branch was being pushed after every gate round while
`prettier --check`, `svelte-check` and `pnpm build` were only being run locally
at round boundaries; the three reds diagnosed at 08-06 10:10 account for the
class. The observable cost is that **CI carried no signal for this branch for 33
hours** — any genuinely new failure arriving in that window would have been
indistinguishable from the standing red.

The merge commit chose history over tidiness, and says why:

> Merged rather than squashed: each commit body cites the file:line its fix came
> from, which is the project's evidence trail.

#### 4i. Launch day: the improvements backlog, and one escalation

08-07 opens with `docs: add the verified improvements backlog` — "44 items from a
six-dimension audit (accessibility, SEO, performance, UX, code health, editor
experience), each put through a **separate skeptic pass** that opened the cited
file and rejected anything inaccurate, already done, out of scope, or larger than
a few hours." Nine of them shipped the same day. Highlights, all measured:

- **A landscape lockout on every phone.** `LandscapeModal` fired on
  `(pointer: coarse)` AND `(orientation: landscape) and (max-width: 1023px)` and
  was "an opaque black `aria-modal='true'` overlay with no close button, no
  Escape handler, no focus trap and nothing reachable behind it." WCAG 2.1 SC
  1.3.4. It was also _harsher than the reference_ — live fires a dismissible
  `alert()`. "It came from the starter's initial commit, not a matching round,
  and **no gate viewport is landscape-shaped so nothing ever exercised it.**"
- **Four of six nav pages shipped with no `<h1>`** — verified against the built
  pages, not by inspection.
- **4.8MB of hero video preloaded before hydration**, racing the poster image the
  same component preloads at `fetchpriority="high"` a few lines above: "it
  competed with its own LCP image". And `menu-beach.jpg`, a 5472×3648 camera
  original at 2.20MB used under a 92%-opaque wash, re-encoded to 156KB (−93.1%)
  — "Not judged by eye — composited both versions under that exact wash and
  diffed: **0.000% of pixels differ** at 1440×900 AND at 2560×1440 retina."
- **Zero structured data** (`grep -c application/ld+json build/index.html` → 0)
  on a single-location dental practice, while `Seo.svelte` had accepted a
  `jsonLd` prop and `organizationJsonLd()` had existed the whole time. "So this
  is wiring, not authoring."
- **Every booking failure was discarded silently.** "a visitor whose booking was
  rejected saw the modal sit completely unchanged … **that is a patient lost with
  no trace at either end** — no lead in the dashboard, no error on screen."
  Verified by running the new 13-test suite against the old component: **7 of 13
  fail.**
- **18 absolute cross-links across 9 paths, 5 of which 404** — and a launch
  blocker, because SvelteKit's prerenderer crawls same-origin links and
  `kit.prerender.origin` comes from Netlify's `URL`. "Point the real domain at
  the site and those links become internal, get crawled, and the build fails on
  the first 404 … **CI passes only because GitHub Actions sets no URL.**" One of
  the repairs could not have been found by any link checker: an anchor reading
  "When tooth pain is a dental emergency" pointed at a _different_ article that
  returns 200. "Anchor text wins."

**The escalation, and it is the right one.** The a11y suite had "audited three
`/dev/*` FIXTURE routes and not one page a patient can reach", and "had been
green all project". Pointed at the real pages, it immediately found a WCAG 2.1
AA 1.4.3 failure:

> Live's brand cyan `#129ecc` on its own pale band `#e7f5fa` measures **2.77:1**
> against a 3:1 large-text threshold — **missed by 0.23**. One root cause, every
> failing node identical: /services 4 nodes, /our-team 11 nodes,
> /your-first-visit 4 nodes.
>
> **NOT fixed here, and NOT suppressed.** … On a pixel-matching rebuild that is a
> brand-colour decision, so it goes to the operator with measurements rather than
> being taken unilaterally: `#0f8fb8` is 3.34:1 (minimal move from the brand), the
> existing `--primary-deep #0e7799` is 4.58:1.

And the suite was built so that the recorded exception cannot rot: "the rule list
is asserted per page AND the exact colour pair is asserted, so a contrast failure
with any OTHER pair fails … Verified both guards bite."

**A related honest note from the same day:** an earlier ACK ("footer color is
fine", 2026-08-03) "was scoped to one heading, and this is the same swap across
three pages' most prominent headings." The commit refuses to let a narrow
approval widen itself. That is the correct handling of an operator ACK and it is
worth holding up as a pattern.

Finally, at 17:39 — ten minutes before DNS — `chore(fleet): clear the two audits
that block onboarding`. The lint one is a nice instance of two instruments
disagreeing about the same files:

> the fleet's lint audit calls `prettier.resolveConfig()` and this repo had no
> prettier config at all, so it resolved to `{}` and checked `.svelte` files
> WITHOUT `prettier-plugin-svelte`, reporting them unformatted. **Our own CLI
> passed the plugin by flag, so `npm run lint` was green while the audit would
> not have been.**

---

### 5. Two forms incidents, and a probe that passed on the day the form was failing

_Sources: `reddoor-maintenance` commit bodies for #498 and #505, both 2026-08-03.
The Airtable Submissions extract holds no August rows, so the incidents are
attested only by the commits that fixed them._

**Incident one — a real lead reported as failed.** At 12:32:

> A 1836dig visitor was shown the form's failure copy on 2026-08-03 while the
> lead was already stored (`sub_f4f195ff`) and the operator email delivered. The
> site's 8s abort budget fired before central responded; central persists the row
> BEFORE its best-effort tail, so past the insert an abort reports failure for a
> submission that succeeded.

The 8s budget "was calibrated against a 10s Netlify sync limit;
`SYNCHRONOUS_FUNCTION_TIMEOUT` is now 30, and **8s never cleared a cold call
(~5–7s measured)**." Raised to 20s, with the pin test derived from the platform
constant rather than the number.

**And here is the false green.** The nightly form end-to-end probe:

> Its testMode submissions short-circuit before the classifier, insert and Resend
> call, so a green verdict could not see the slow path — **it recorded a clean
> pass the same day the form was failing for visitors.**

The fix does not make the probe assert a pass/fail it cannot judge; it makes it
**report budget headroom** and raise `BUDGET_THIN` as a GitHub warning, "the
persisted verdict stays 'pass' because the form works." An instrument that cannot
see a failure mode should say what it _can_ see, not louder.

**Incident two — a client received a test lead.** At 16:54 (#505, closing #502):

> Test-submitting a live client form emails the client. The only thing standing
> between that and a safe test is one Airtable Status cell, and nothing reported
> its state … On 2026-08-03 **the flip never landed, a real client received one,
> and email cannot be recalled.** A guard whose state you cannot see is a guard
> you will eventually assume is on.

The design of the fix is the lesson:

- **Asking is free.** `forms-notify-target <site>` is read-only by default —
  "asking must never be riskier than not asking."
- **A write returning is not evidence.** `--set on` flips the guard and then
  **re-reads the row**; an unconfirmed flip "prints NOT CONFIRMED, says not to
  test-submit, and exits non-zero rather than reporting success." That is the
  exact mechanism by which the incident happened.
- **No second copy of the rules.** Every address reported "comes back out of
  `resolveRecipients` itself … so this cannot drift into a second, confidently-
  wrong copy of the routing rules."
- **Guard the inverse failure too.** `--set off` requires an explicit
  `--restore <status>` and never infers one, and the command refuses to flip any
  site that is not `maintenance`.

Verification: "3582 tests; the read-back guard, the pre-write reporting path, the
status check and the exit code **each mutation-tested (mutation confirmed
applied, then confirmed caught)**; and a real read-only run against live Airtable,
which correctly identifies 1836dig's client — the address that received the errant
email — and warns."

---

### 6. Nine repos frozen for a week, green the whole time

_Source: `renovate-app-migration-orphaned-branches.md` (memory, written
2026-08-03T23:15Z) and reddoor-maintenance #503, merged 16:14 local._

The largest silent failure of the week. Nine fleet repos — alamo-anatomy,
caltex-landing, gallerysonder, espada, hedloc, data-dynamiq,
medical-solutions-of-texas, revogen, la-homelessness-initiative — "had **all
non-major updates silently frozen since 2026-07-27** — including
`@reddoorla/maintenance`, `@sveltejs/kit`, `vite`, `@playwright/test`,
`svelte-check` and `node`. **CI was green, the cockpit was clean, and no alarm
fired.**"

Root cause: an unintended consequence of the 08-02 GitHub App identity
migration. Each repo still had a leftover `renovate/all-minor-patch` branch whose
tip commit was authored by the retired PAT identity `renovate-bot`. Renovate, now
running as `reddoor-renovate[bot]`, "compares the branch's last commit author to
its own identity, concludes a human edited the branch, and files it under **'PR
Edited (Blocked)' — 'Renovate will no longer make changes.'**"

Perfect correlation confirmed it: "all 9 blocked repos had `renovate-bot` tips
dated 07-27; every healthy repo had a `reddoor-renovate[bot]` tip dated 08-03 or
no branch at all."

**The detection gap, stated exactly right in #503's commit body:**

> protection-audit's renovate surface asked only 'did the workflow run and
> succeed?'. On 2026-08-03 nine repos answered yes to that while shipping zero
> dependency updates for a week … **A liveness probe structurally cannot see this
> — the workflow is doing its job, it is just not permitted to do anything.** So
> read the outcome Renovate itself publishes: its Dependency Dashboard, the one
> place it admits to having given up on a branch.

**A belief corrected, explicitly retracted in the memory file:** an earlier PR
(#501) had attributed fleet drift to "Renovate can't cross a 0.x minor / in-range
counts as up to date". The memory says flatly: "That is WRONG as a cause — the
dashboard proves Renovate detects the update and wants it
(`@reddoorla/maintenance ^0.75.0` → `[Updates: ^0.79.0]`). The blocker was the
orphaned branch." It then keeps the true part of the wrong diagnosis: "A pre-1.0
caret IS still a real constraint worth fixing — 1.0.0 or `rangeStrategy: 'bump'`
— but it was not what froze these repos."

**And the adversarial review of the new detector found four defects that each
cost real behaviour**, which is the most instructive part:

1. **`renovate-bot` is GitHub type `User`, not `Bot`.** "The obvious 'flag
   bot-authored tips' rule would have missed this exact incident." Detection keys
   on machine identity by login/email, **with a staleness backstop
   (`BLOCKED_STALE_DAYS`) so identity drift degrades detection to slower, never
   blind.**
2. **"PR Edited (Blocked)" is not by itself a fault.** It is equally Renovate
   saying _a human owns this branch now_ — and pushing a commit onto an open
   Renovate PR is routine here: **16 such PRs across 14 repos in one day.**
   "Alarming on all of them would fire nightly on healthy in-flight work and
   prescribe deleting the operator's commits."
3. **Renovate renamed the heading in 43.0.0** (`Edited/Blocked` → `PR Edited
(Blocked)`), and the fleet takes its Renovate major from whatever
   `renovatebot/github-action` bakes in — "so the next rename arrives via an
   ordinary dependency PR Renovate merges in-run." Both spellings parse, and
   unknown sections alarm: _"couldn't check" must never read as "healthy"_.
4. **`gh api repos/X/issues` needs `--paginate`.** The dashboard is created at
   onboarding, so it is typically the _oldest_ open issue, and the title filter
   runs client-side after the page cut. "Proven against `renovatebot/renovate`
   itself (dashboard = issue #2958 from 2018), which read `{present:false}` →
   clean without it."

And then the instrument was proven both ways before being trusted: "Real-run
verified against reddoorla: 27 repos, no probe errors, no false positives (gaps=2
are the two newly-public repos' missing rulesets)" **and** "the full chain run live
against three genuinely-blocked third-party repos, which now fire correctly." A
gate that has only ever passed is as untested as one that has only ever failed;
this one was shown to do both.

Mutation testing caught the worst of it: "a broken jq selector, a dropped
`--paginate`, and unwired section parsing **all shipped green through the full
suite**."

---

### 7. Two config bugs found by reading, not by failing

Both merged 08-03 into `reddoor-maintenance`, and both are the same shape: a
fix that was applied in one place years ago and never propagated to the place
sites actually consume.

**#500 — vite binding to a port nothing probes.** "Both shared configs pin a
fixed 5173 and then leave vite free to drift off it. The audits fixed this for
themselves a while back … but the configs SITES consume directly never got the
same treatment." Consequences, in ascending order of nastiness:

- playwright-a11y fails _loudly but uselessly_: "the run dies on 'Timed out
  waiting 120000ms from config.webServer' — **two minutes naming neither the port
  nor the squatter**."
- **And it had already cost real work:** "That is what it looked like on
  the-pointe-burbank, where it read as an environment problem and was written off
  as such; **it was masking a genuinely failing gate test across two rounds of
  work**, because `tests/gate` only runs under this suite."
- lighthouse fails _silently_: `startServerReadyPattern: "ready in"` "matches
  vite's banner whatever port it settled on, while `url` stays pinned to 5173. A
  squatter therefore means vite comes up on 5174, announces itself, lighthouse
  reads 'ready', and then collects from 5173: **it audits the squatter and
  reports those scores as the site's.**"

This is the exact failure that the smoke audit's free-port allocation was built
to stop ("caltex's suite running against erp-industrial's dev server") surviving
in the config a site gets when it consumes the shared lighthouserc directly.

**#497 — an eslint rule that was right in general and wrong here.**
`eslint-plugin-svelte` 3.20+ permits only `error` in `+error.svelte`, "but
SvelteKit passes merged layout `data` to error pages (reddoorla.com's live 404
renders from it), and kit generates no `./$types` for `+error` so the prop is
typed by hand. The rule has no options (`schema: []`), so the fix is a
files-scoped off-switch." Surfaced by a lockfile refresh moving the plugin
3.19→3.22 — i.e. Renovate's ordinary weekly churn shipping a behaviour change
inside a patch-looking bump.

---

### 8. The side project that ran in parallel all Monday and Tuesday

_Source: `scriptorium-setup` (45 commits 08-03/08-04) and `caldea` (10 commits)._

This belongs in the record because it is 16% of the week's commit volume and it
is not client work at all. `scriptorium-setup` is a personal writing appliance: a
2012 MacBook (A1398) running Debian + cage + foot + micro, autologin to a
fullscreen terminal, for drafting the `caldea` novel. It went from nothing to a
working, sandbox-tested machine image in about 20 working hours over two days.

The arc is legible from the commits alone. Design spec 10:34 → adversarially
verified plan 11:02 → ship/pull scripts → menu → micro + foot config → `/etc`
configs → systemd units → idempotent bootstrap → README/runbook, all by 12:40.
Then three **review rounds** in sequence, each of which found things a first pass
does not:

- 13:05 "Final-review findings: without a vendored `.gitconfig` the first F5
  commit fails (unable to auto-detect email); offline installs had no package
  lists before `apt install git`; F5 was double-bound."
- 13:43 "Confirmed by **adversarial review with refutation**: bootstrap never
  installed sudo (dies on root-password installs); pull-repos permanently skipped
  repos cloned before their first commit; ship would commit conflict markers or
  detached-HEAD strays; **cage without `-s` disabled the documented Ctrl+Alt+F2
  rescue path**."
- 19:38 "pre-install review — brick paths, a data-loss race, install-day aborts".

**The pivotal commit is 15:31: `feat: containerised sandbox; verify the editor
layer for real`**, and its second sentence is the whole point: _"That retires
what the last commit could only claim."_ `sandbox/run.sh` runs the software layer
in a container on the Mac, pushing to a bare repo inside the container "so
nothing reaches GitHub", and `sandbox/verify.sh` drives micro headlessly inside
tmux and asserts on the **rendered screen** — ESC[1m for headings, ESC[3m for
italic, `[ro]` refusing the write, the picker listing 1..16 in order. It
immediately caught a real defect nobody had claimed: "micro labels each tab with
the path it is handed, so absolute paths filled the tab bar and truncated all
three to `/home/tucker/writing/cald…`."

The sandbox then grew from **9 → 12 → 13 → 17 → 20 → 22 → 26 → 27 checks** across
Tuesday, and it repeatedly caught defects that reading could not:

- "F2 and F4 were **permanently rewriting `settings.json`**. micro persists any
  option changed through the GLOBAL setter, and because the toggled value equals
  its own built-in default it did not merely add a line — **it DELETED the shipped
  `"statusline": false`.**" Caught by a check that md5s `settings.json` across a
  clean quit.
- "`write_conf` returned 1 whenever it cleared a value — `[ -n "$2" ] && printf`
  as the last command. Harmless in the menu, **fatal anywhere under `set -e`**."
- "The sandbox suite caught **my own bad assertion**: I asserted F4-off would move
  the view back, which it should not — turning it off just stops pinning."

**A belief corrected on contact, with arithmetic.** 16:39,
`feat: fix the measure — 125 columns was never a prose line`:

> Worked out what the panel actually gives: 2880px at ~221 DPI, cage running it
> unscaled, Courier Prime's advance measured off the TTF at 0.5996em. So
> `cell width px = 0.5996 × size × 3.06` — and size=12 with pad=56 was 125
> columns. micro softwraps at the pane edge, which made every line 125
> characters, **against a typographic ideal of 45–75.**

**A verification trick worth stealing.** keyd is a kernel evdev remapper and
cannot run in a container or on macOS — no `/dev/input`, no uinput, no Linux
kernel. "But keyd ships `t/test-io.c`, which runs the mapping engine over a
config and a key-event list with neither devices nor root. The script builds it
at v2.5.0 and feeds it the real config … **Both mutations fail it as they
should.**" The impossible-to-test layer was tested by finding the vendor's own
engine-level harness.

And a failure mode designed out rather than tested: the session reset was keyed
off a tmpfs marker, which "had a silent, **permanent** failure mode.
`XDG_RUNTIME_DIR` is not guaranteed to be set under agetty autologin, and the
fallback put the marker in `~/.local/state` — where it survives reboots. The
session would then never reset again … and **nothing on screen would say why**."
Re-keyed off `/proc/sys/kernel/random/boot_id`.

`caldea` itself — 10 commits, "catching up the outline", "renumbering chapters in
the outline, adding 15", "restasis is a fun new word" — is the actual writing,
and it is the reason the machine exists. Two of scriptorium's fixes came
straight out of it: "sort -V in the picker. Plain sort orders a chaptered book 1,
10, 11 … 2, which put chapter 2 tenth in the list", and "resume from a breadcrumb,
not newest mtime. Week 0 is an outlining week, so the newest-modified file is the
outline and [enter] would keep reopening it instead of the chapter."

---

### 9. The skill itself was reworked, hardened, and calibrated — on Monday morning

_Source: `claude-skills` commit bodies, 07:41–17:30 on 08-03 plus one on 08-05._

Before any beachfront work happened this week, the `matching-a-page` skill was
rewritten. The v2 commit body is the diagnosis:

> The v1 doc had grown as a changelog: every Beachfront round appended a lesson,
> but the workflow a fresh model must follow was scattered across it, and **every
> historical miss was a skipped/nonexistent STEP, not a detection gap.** v2
> restructures the same lessons into a procedure **a less capable model can
> execute.**

Then, at 08:06, `harden: kill the silent-degradation paths found by the
adversarial review`, whose first line is the cleanest statement of this repo's
governing rule anywhere in the corpus:

> **Every change closes a verified way a run could look green while lying.**

The list is long and every item is a real false-green mechanism: unresolved
`--sections` anchors "used to be silently dropped, merging two sections into one
mislabelled region with zero signal"; "regions FAIL on >5% ref/cand height delta
— the pixel diff scores only the overlapping area, so a region missing its bottom
sub-block could PASS"; "region-count truncation forces overall FAIL (was: a note,
then PASS)"; "`report.json` + the table header now stamp the full run config …
so a pasted run is self-describing and **a `--threshold 0.25` pass can't read as
standard**"; "`--k=v` now works in text-diff (**`--vw=390` silently ran at
1440**)"; "`--flag true` no longer silently DISABLES a boolean flag"; "masking
runs AFTER lazy-scroll (lazy-loaded images used to escape it)"; "the harness
itself did the 700px jumps its own docs condemn"; "CLI entry guard via
`pathToFileURL` (**percent-encoded paths silently no-op'd with exit 0**)".

At 10:17 the hardened harness was **calibrated against a known-good pair before
being used on anything new** — precisely the rule this repo is built on:

> Calibration run (live beachfrontdentistry.com vs the 15/16 local branch) before
> trusting the reworked harness on a fresh page. It caught:
>
> - **MASK FLAKE:** mask-photos wrote inline styles, which a hydrating framework
>   re-writes AFTER masking — one run's cand cards captured photographic while
>   ref's were masked (**20.8% fake fail**); the next run was clean. Masking now
>   marks elements with data attributes + an injected `!important` stylesheet,
>   which hydration can't wipe. **Reproduced, fixed, re-run = region back to its
>   0.2% baseline.**
> - HEIGHT GATE floor: pure fraction over-failed short regions (**12px on a 207px
>   strip = 5.8%**); now fails only >5% AND >24px.
>
> **Calibration verdict:** the hardened harness reproduces the old baseline where
> the old baseline was right, and surfaced 4 real Beachfront deltas the old
> harness structurally could not see … plus ~15 real type-tuple misses …
> **that five human review rounds never caught.** 24/24 tests green.

A 20.8% "failure" that was the instrument, and a flake that alternated
run-to-run: without the calibration run against a known-good pair, that number
would have been chased as a defect in the page.

The rest of Monday fed traps back up from the live beachfront rounds — the
Tailwind v4 single-breakpoint-override ordering bug ("overriding one
`--breakpoint-*` in `@theme` re-registers it out of order (md: bleeds past lg: at
desktop and **silently regressed a shipped 1440 match**)"), the order-swap trap
("a card whose elements are in the wrong vertical ORDER … passes both
style-census (type tuples are order-blind) and page-diff (a photo mask over the
avatar hides it)"), and the composite-region lesson ("a probe-verified,
live-matching fix can leave the region mm identical to the decimal — **the fix is
correct, the region number is the wrong instrument**").

And on 08-05 20:31, the fix that unlocked the census sweep, landed in the skill
repo rather than the site:

> The census keys on TEXT, not on elements … so the old rule — fail whenever the
> two sides' style SETS differ — reported a byte-identical element as a mismatch
> whenever any same-text sibling differed. **Driving a project's census to zero,
> that noise is indistinguishable from a real defect.**
>
> On the beachfront-dentistry rebuild this split 100 undifferentiated rows into
> **69 real mismatches and 31 collisions.**

---

### 10. Things that were tried and abandoned, or deliberately not done

Collected because they are the cheapest thing to lose and the most expensive to
re-walk.

- **Paired svelte+plugin majors without vite 8** (three PRs, closed, CI red).
  Replaced by the full vite-8/rolldown stack. To revive: you cannot; plugin 7
  requires vite 8.
- **The sticky hand-mark fix on beachfront home.** "The obvious fix is attempted
  and REVERTED: `md:sticky md:h-[320px] lg:h-[400px]` reproduces live's computed
  box exactly, but adds 400px of flow height to our list container — home fell
  24/27 → 23/27 … **Live absorbs that 400px somewhere our DOM does not**, so the
  next attempt needs live's list container measured _with the anchor in it_
  rather than the anchor alone."
- **Attempt 4 on the three-strikes home region, half kept and half reverted.**
  "REVERTED, a no-op: `h-full justify-center` on the link list … there is nothing
  to centre, because our column is exactly as tall as its content. **A change
  that provably did nothing is an unevidenced edit, not a partial fix.**" And the
  stop: "Blocked on evidence I could not get in this pass … **Stopped rather than
  swing a fifth time.**"
- **The `mjml` v5 security bump (central #489), closed deliberately.** Memory,
  written 17:22 on 08-03: the traversal "requires attacker-controlled MJML
  source"; here mjml renders three operator-authored templates with
  `validationLevel: strict`, no `<mj-include>`, every interpolation through
  `escapeXml`, and submission content never reaches mjml. "**Why not merge
  anyway:** the only patched version is a 5.x ALPHA, and mjml renders every
  client email — an alpha regression there is a worse expected loss than an
  unreachable vuln."
- **Carrying live's `<br>` splits into the CMS text**, retired on 08-06: the
  Migration API's `\n` stripping "would eat those breaks too."
- **Two dead `href="#"` form CTAs on beachfront**, presented as three options;
  "**Tucker chose remove**", with the fields left in the slice models so
  restoring the button "is one edit in Prismic the day a real URL exists — no
  code change."
- **Hiding micro's tab bar**: "TabList.Display draws it whenever more than one
  tab is open and there is no setting to suppress it … **Documented rather than
  worked around.**"

---

## FRICTION SIGNALS

Ranked roughly by how much time they cost, with the measurement that supports
each.

1. **A 68-hour, 288-file, zero-review PR that was CI-red for 33 of those hours
   (52 failing runs).** No signal was available from CI on the main line of work
   for a day and a half.
2. **Gates that measure the wrong surface.** Five distinct instances in one week:
   CSP-blocked reference images, anchor-cut mismatch (twice, two different
   causes), sticky-position blindness, and default-state-only measurement. Each
   cost multiple failed rounds _before_ being recognised as an instrument
   problem, and one (atd "Beyond the Smile") was misdiagnosed twice in the ledger
   before the right question was asked.
3. **Renovate's weekly batch as an unpaid Monday tax.** Six preset changes, two
   bad merges reverted in 14 minutes, 23 red CI runs, and a whole migration wave
   run by hand — all before 11am. Two of the PRs (`cookie`, `brace-expansion`)
   are actively dangerous and _look_ routine.
4. **Silent freezes with green everything.** Nine repos shipping zero updates for
   a week, invisible to a liveness probe by construction.
5. **The Prismic Migration API's silent, HTTP-200 field drops.** Five fields and
   a `\n`-stripping behaviour, each of which shipped a visible defect while every
   local gate stayed green, because no gate crossed the network.
6. **Agent over-generalising a scoped human comment** (the-pointe nav underlines;
   the LEED badge read literally). Both needed the operator to say "that wasn't
   what I meant".
7. **The agent's own stopping bias**, named in the repo: "a turn ends when
   user-facing prose gets written, and 'I just committed something good' is
   exactly the moment that invites writing it." Mechanised into `next.mjs`.
8. **Tooling papercuts that ate whole rounds:** `next.mjs` ranking by mtime and
   picking a masked diagnostic as the page's state; `gate.sh` accepting a
   hyphenated round tag that `next.mjs` then mis-split, so "the run was silently
   never counted — next.mjs kept scoring an older report for the page I had just
   changed"; a vite port drift that "masked a genuinely failing gate test across
   two rounds of work"; the `out*/` capture dirs "caused the git-add hang".
9. **A Google Maps API key committed into a public repo** as a side effect of
   starting to track the spec directory. History is still dirty; the only real
   remediation is key rotation.
10. **No independent review anywhere.** Every PR this week has `nReviews: 0`. The
    quality control is the commit-body evidence standard and the operator's spot
    challenges, both of which are real but neither of which is a second reader.

---

## WHAT A DOWNSTREAM READER SHOULD TAKE FROM THIS WEEK

- **The single most effective intervention of the week was turning four written
  rules into four programs that exit non-zero**, after the rules had demonstrably
  failed to hold on their own for two days. Each program was calibrated against a
  known-good input (an already-admitted stall) before its verdicts were used.
- **The second most effective was pairing every check with the one-line question
  the operator can now ask.** The gates exist to make human audit cheap, not to
  remove the human.
- **The recurring failure mode is not bad code; it is an instrument answering a
  different question than the one being asked**, and reporting green. Seven
  separate instances in seven days, across four repos and three technologies.
- **Coverage caveat, restated:** there are no transcripts for this week. Every
  narrative claim above traces to a commit body, a PR record, a run record, a
  Discord message, or a contemporaneous agent memory file. Where an agent's own
  prose is the only witness — which is most of §4 and §8 — it is the operator's
  account of his own work, and it is unusually detailed, but it is not
  independent.
