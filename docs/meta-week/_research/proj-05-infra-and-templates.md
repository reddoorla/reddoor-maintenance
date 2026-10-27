# Cluster 05 — Infrastructure and templates

`reddoor-starter` · `reddoor-starter-blux` · `canvas-starter` · `claude-skills` ·
`reddoorla-dot-github` · `scriptorium-setup`

Window: 2026-07-30 → 2026-09-12 (7 weeks). Audience: a model with no other
context. Written to the house style of
`reddoor-maintenance/docs/workJournal.md` — why over what, measured numbers
exactly, defects named, beliefs corrected on contact, honest accounting.

---

## What this cluster is

Five of these six repos are the meta-layer of a ~30-repo web agency fleet: the
template a client site is generated from, the frozen fork of that template that
still carries a pixel-migration render layer, a public interaction prototype
that was scaffolded from the template and never promoted, the org-level
`.github` repo holding the reusable CI workflow and the Renovate preset every
other repo extends, and the repo that finally gave Claude Code skills a remote
and a version. None of them serve a client. All of them are load-bearing for
every repo that does.

The sixth, `scriptorium-setup`, is not infrastructure for the fleet at all —
it is the complete configuration of a physical writing appliance (a 2015
MacBook Pro reinstalled as a Debian machine that boots into a fullscreen
terminal and nothing else) that Tucker writes fiction on. It is in this cluster
because it is the same shape of artifact — a repo whose product is a
_machine's_ configuration rather than a page — and because it turns out to be
the single busiest repo here by commit count.

### Coverage, stated before any claim is made

**Transcripts retain only back to 2026-08-10.** For 2026-07-30 → 2026-08-09
there are no prompts and no session records; only commits, PRs and Actions runs
survive. Everything said about that period below is **RECONSTRUCTION from git**
and is labelled.

That caveat is unusually expensive here. Of the 255 commit rows this cluster
contributes to `commits.jsonl`, **107 (42%) fall in the blind window**, and
**2026-08-03 alone carries 65 of them (25% of the cluster's entire seven-week
output)** — the single biggest day in this cluster by a factor of 2.8 over the
next, and completely unobserved. Three separate things were built or rebuilt
that day (the writing appliance, the page-matching harness, and six Renovate
version holds) and there is no record of how any of them was directed.

**A second, narrower gap sits _inside_ the visible period, and it is not the
brief's.** No session transcript in the corpus covers 2026-09-08 between 00:00
and 16:29 local. The earliest session file that day starts at 16:29. In that
unobserved span, ~45 commits landed across five repos, including **20 of
`claude-skills`' 52 window commits — the entire creation of the repo**
(`5f5ed0b` at 15:37 through `ecec604` at 17:39). Checked rather than assumed:
`~/.claude/projects/` holds 39 project directories and **none** of them is
`claude-skills` or any `~/.claude/skills/*` path. So the gap is in what was
recorded on the machine, not in how the corpus was extracted. The narrative for
that repo below is reconstructed from its commit messages and its own work
journal, which are unusually good, but it is not transcript evidence.

### Cluster totals (MEASURED)

|                                    | value                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| commit rows in `commits.jsonl`     | 255 (242 distinct SHAs — see note)                                                  |
| commits on `main` in window        | 228 rows / **214 distinct** (203 human, 25 Renovate bot)                            |
| PRs opened                         | 82 — 71 merged, 6 closed unmerged, 5 open at Sep 12                                 |
| PR authors                         | `tucksravin` 53, `app/reddoor-renovate` 29                                          |
| PR line churn                      | +10,583 / −34,000                                                                   |
| **GitHub reviews on those 82 PRs** | **0**                                                                               |
| merge latency, merged PRs          | median **0.53 h**; 37/71 under an hour, 25 under ten minutes; mean 13.5 h           |
| operator-bearing sessions          | **7** (2 in `reddoor-starter`, 5 in `scriptorium-setup`); 0 in the other four repos |
| CI runs                            | 479 — 475 success, 4 failure (0.8%)                                                 |

**Note on the double-count:** `reddoor-starter` and `reddoor-starter-blux` share
**13 identical SHAs** across all branches in the window (**14** counting `main`
only), because blux is a full-history snapshot of the starter taken at `82d93b0`
on 2026-08-31. Any per-repo commit count that adds those two repos together
double-counts them. This is exactly the kind of
thing the corpus cannot know and a reader would otherwise get wrong.

**Note on "0 reviews":** the review function exists, it just does not happen on
GitHub. The 2026-09-01 `reddoor-starter` session invoked the
`superpowers:code-reviewer` subagent **14 times** and `general-purpose` 47
times. Review is in-session and pre-merge; the PR is a record of a decision
already made, which is why the median merge latency is 32 minutes.

---

## reddoor-starter — the native template

**What it is.** The GitHub template every Reddoor client site is generated
from: SvelteKit 2 / Svelte 5 runes / Tailwind v4 / Prismic + Slice Machine on
`adapter-netlify`, pnpm 11, vitest, Playwright + axe. `/new-site <slug>` clones
it; `reddoor-maintenance` then opens PRs against the result forever after.

**Measured.** 30 commits on `main` in window (24 human, 6 Renovate), 12 active
days, 2026-07-31 → 2026-09-11. 29 PRs opened, 25 merged, 2 closed, 2 open. 167
Actions runs, 1 failure (`ci` on `feat/cms-reply-copy`, 2026-09-03). Two
operator-bearing sessions only: **2026-09-01, 21.4 hours, 55 operator messages,
1,004 tool calls**, and **2026-09-08 17:56 → 07:26, 13.5 hours, 28 operator
messages**. Both ran across a model switch mid-session ("hit fable limit,
continue"; "hit fable limit, back on opus now").

### The two days, and why they were different days

Everything human in this repo happened on those two dates. The Renovate traffic
in between (Aug 3, 11, 12, 20, 31) is the fleet's Monday cadence and needs no
narrative.

**2026-09-01 was triggered by a client, not a plan.** The opening prompt is the
whole context:

> "it happened, we have our first new site to add to the fleet! 1) do a deep
> review of our structure and see if there's anything we should change before
> building our site, and then 2) look into vlf in discord and my email"

The template had never been run for a genuinely new client. Reviewing it
_before_ that run produced seven merged PRs in one day and found three defects
that had been green the whole time:

- **#107 — `prettier --check .` had never checked a single Svelte file.** The
  repo had no `.prettierrc.json`. Without a config file, prettier cannot
  resolve `prettier-plugin-svelte` and silently skips `.svelte` rather than
  failing, and the reusable CI workflow's command is exactly
  `pnpm exec prettier --check .` with no `--plugin` flag. **Proved with a
  control**, which is the part worth keeping: a deliberately mangled component
  _passed_ CI's command and _failed_ the local one. That is the instrument
  proven before its verdict was trusted.
- **#106's `catch { error(404) }`** in both content loaders turned every
  Prismic failure — outage, bad token, wrong repo name, parse error — into a
  clean 404. Narrowed to Prismic's `NotFoundError` so a genuine miss still 404s
  and everything else becomes a loud 5xx or a failed prerender.
- **#110 — `reducedMotion` in `playwright.config.ts` had been inert since
  ~June.** It was set at top-level `use` instead of `use.contextOptions`, where
  Playwright silently drops it. Adopting the shared config (~114 lines down to 9) is the first time reduced motion has actually applied in this repo's smoke
  suite. The fix was upstreamed as `reddoor-maintenance#660`.

**#106 is the largest single change in the cluster and the most consequential
design decision in it.** `refactor(template): native-only starter` is **242
files changed, +1,453 / −29,941; 178 files deleted, 9 added** (measured from
`git diff 82d93b0..ac7660f`). The slice library went **28 → 9** and custom
types **7 → 1**. What came out was the "Blux" layer — a frozen-render pipeline
for pixel-faithful migration of an existing catalog site, built through July and
proven on `the-pointe-burbank`. It had been baked into the template, and a
clone therefore inherited a catalog probe on every page load plus 19 slices no
client would use.

The operator's framing on 09-08, when asked whether to build a _third_
template, is the rule this cluster now runs on:

> "I don't want to carry bloat into a new site, we jsut spent a lot of work
> breaking out the blux site before working on vlf since baking it in corrupted
> the starter"

**2026-09-08 started as a question and never became a template change at all.**
The operator asked whether more Webflow→SvelteKit conversions (after
`beachfront-dentistry`) justified another starter fork. The session argued it
out over eight exchanges and the answer was no. What is worth recording is that
the operator's own challenge changed the design:

> "Shouldn't slices be able to get that data through content relationships, or
> if it's necessary site wide, in a store that we load in layout.ts?"

The journal records this plainly — the instinct "was better than the
assistant's proposal and changed the design". The proposed "three-line seam" in
`page-load` was rejected as the same species as the two document-type probes
that #106 had just deleted, and the rule was generalised: **the template ships
no hook whose default does work, and no field an editor cannot fill.** The
Webflow pipeline went to four other places instead (importer in
`reddoor-maintenance`, round scripts in a `match-harness` recipe, the phase
protocol in the `matching-a-page` skill, round rules in each site's own
`CLAUDE.md`), and this repo got one orientation row in a doc (#122).

The same entry corrects the 2026-08-31 track-split spec, which said the Webflow
importer targets the native `page` type. **That was a third true** — the
importer also emits `person`, `news_article` and `collection_item`, and
Beachfront renders them through a `CollectionList` slice that exists only in
the Blux track. Believing the old sentence would have made "point the importer
at a native clone" sound like a small job.

### The ten rules, and the retrospective that produced them

On 2026-09-05 the operator asked, from the Vida Legacy Foundation checkout:

> "Review these sessions, how we built this site against the figma and create a
> timeline of everything you did, and put it into one document. And then make
> recommendations on what we can change process-wise to improve for the next
> site. Also, add to the starter CLAUDE.md and all the other repos I have on
> this machine, I want every repo to maintain a workJournal, similar to the one
> that I have in smahre/Broken"

then, an hour later: _"what are the ten recommendations, where do I read?"_ and
_"do all ten, and then do a review of the whole process with a comparative
research step for how other people are doing this currently"_.

That single instruction is the origin of **23 commits across this cluster on
2026-09-05** — the second-biggest day here — and of the journal convention now
in all six repos. It produced #115, whose costliest rule is stated bluntly: _"a
pass needs positive evidence, never the absence of an error"_ — **"not one bug
but a shape that survived three corrections in a row, each fix reintroducing it
one step along until the last one survived by exactly one error code."**

#115 also shipped `pkg.reddoor.a11yRoutes: ["/"]` as a default, and the reason
is the purest false-green in this cluster: **absent, the axe audit scans the two
`/dev/a11y-fixtures` routes and no page of the site, while every PR reports
"axe 0 violations". One site ran four days that way**, and a prior incident
(recorded in the fleet's own comment on that key) let a critical `image-alt`
violation ship to five production pages with CI green.

And it found that the journal rule shipped six weeks earlier was **half a
mechanism**. "Never rewrite an entry; correct it in a later one" is right, and
fails at the only moment it matters — the correction goes to the bottom of the
file and a reader lands in the middle. The fix is one line under a superseded
heading, `> Superseded in part by <date> — <title>.`, justified as _navigation,
not content_. The evidence it was needed showed up by accident: the sweep found
`a-budget`'s `CLAUDE.md` already doing it by hand, uncommitted. Somebody hit
the problem and invented the fix locally.

### The capability index (#124, 2026-09-11) — the last thing that landed here

Ported from `29-navy` after **three re-derivations in two days**: `Slider.svelte`
rebuilt as a slice-local carousel, `actions/trapFocus.ts` re-implemented as six
hand-rolled dialogs, and `transitions.ts`'s `prefersReducedMotion` copied
verbatim into two slices. All three ship from this starter.

`scripts/capability-index.mjs` generates `docs/COMPONENTS.md` — 48 modules from
`src/lib` with their real prop/export names, test counts, and first sentence.
The design argument is the operator's and is worth quoting because it is a
general one about where a control belongs: _"by the time you've run the check
the cost is already paid."_ A CI gate fires after the component is written; a
prompt-time hook fires before. So the artifact is a **list, not a gate**, and
`scripts/hooks/reuse-context.mjs` is a `UserPromptSubmit` hook that prints
matching rows before the agent plans. It never blocks a tool call — _"one false
refusal makes the mechanism something to route around"_ — and it is **not
enabled by default**, because `.claude/` is gitignored machine-wide on at least
one maintainer's setup.

Three details in that commit are instrument discipline applied without being
asked. `vite.config.ts` now globs `scripts/**/*.test.{js,ts}`, because **"a
repo-invariant test that never runs is a comment."** The generated header
adapts to whether `matching/harness.json` exists (29 of 30 fleet repos have no
harness) and **both branches are asserted from either kind of repo**, so the
branch that runs _there_ is not left unverified by the one running _here_.
`docs/COMPONENTS.md` is in `.prettierignore` because prettier realigns markdown
tables, which would red a freshness check against a file nobody edited.

### Honest accounting

The `CLAUDE.md` in this repo is now **255 lines**. The 09-05 journal entry
argued — citing Gloaguen et al., ETH Zurich, arXiv:2602.11988, 138 tasks, four
agents: developer-written context files buy **+4% task success for +19%
inference cost** — that it "should stay closer to [194 lines] than to 963". Six
days later #124 added to it. The direction the entry warned about is the
direction the file has moved.

**State at Sep 12:** `main` at `310df15`, clean, CI green. Two open PRs, both
`sharp` security bumps from 2026-09-09, both **correctly held** — `sharp` is
named in the org preset's never-auto-merge rule and requires a human plus a
green Netlify deploy preview.

---

## reddoor-starter-blux — the frozen render track

**What it is.** A full-history snapshot of `reddoor-starter` taken 2026-08-31
at `82d93b0`, kept alive solely because it carries the Blux render layer the
native template deleted the next day. 139 tracked files match `blux`. It is the
render target of `reddoor-maintenance/src/blux` and what
`/new-site <slug> --track blux` clones.

**Measured.** 21 commits on `main` in window (14 human, 7 Renovate) — but only
**7 of the 21 are this fork's own** (6 human, 1 Renovate); the other 14 are
shared SHAs inherited from the starter's pre-split history. Its own seven are
the bootstrap, the merge-landmine warning, the v1.4.1 workflow bump, capped
srcset widths, a pnpm security bump, CMS reply copy, and the journal. 9 PRs (6 merged, 1 closed, 2 open). 44
Actions runs, **0 failures**. **Zero sessions, zero operator prompts** — every
change here was made from another repo's session.

### The landmine, which is the reason the repo exists in this form

The fork was created on 08-31 with an instruction that `git merge starter/main`
was the way to take shared improvements. **Verified 2026-09-01 and reversed the
same day (#2):** that merge applies the native template's **178 Blux deletions
as clean, conflict-free removals**. Only `README.md` conflicts, so nothing
warns you — `src/lib/blux*`, every `Blux*` slice and the the-pointe fidelity
gates are silently stripped. The rule is now cherry-pick, never merge, and it
is stated in the README banner, in this repo's `CLAUDE.md` (#8), and in the
central repo's.

I re-derived the 178 independently from `git diff --diff-filter=D 82d93b0
ac7660f | wc -l`. It matches.

### The finding this cluster's own records do not carry (MEASURED, today)

Making adoption manual has a cost, and seven weeks in it is visible. Since the
split the native starter has merged **#107, #110, #111, #115, #117, #122 and
#124**; none of them has been cherry-picked here. Two of those are the
false-green fixes described above, and **both defects are still live in this
repo**:

- `.prettierrc.json` — **ABSENT**. `package.json`'s `lint` script still carries
  `--plugin prettier-plugin-svelte`, so it works locally; the reusable workflow
  this repo pins (`ci.yml@8f9852c`, v1.4.1) runs bare `pnpm exec prettier
--check .`.
- `reddoor.a11yRoutes` — **ABSENT** from `package.json`, while
  `src/routes/dev/a11y-fixtures/` is present.

I am labelling this **INFERRED from a mechanism proven elsewhere**, not
measured end-to-end: the preconditions are measured (file absent, script
present, workflow pin read from disk) and the mechanism was proven with a
control in #107 and #115 — but I did not run prettier or the axe audit here,
because the brief is read-only and forbids running suites. What would settle it
in two minutes: mangle one `.svelte` file in a scratch clone and run CI's exact
command; and run the a11y audit and read which routes it names.

`canvas-starter` is in exactly the same state on both counts, and pins the same
workflow SHA.

**State at Sep 12:** `main` at `6b032e8`, untouched for a week. Two open `sharp`
PRs, held by the same preset rule as the starter's.

---

## canvas-starter — a prototype on life support

**What it is.** A public prototype of a 2D "navigating a canvas" interaction:
full-viewport slides on a grid where one gesture (arrows / WASD / wheel /
swipe) moves exactly one cell toward a filled neighbour and the whole board
glides. Inspired by bodeyco.com, extended from one scroll axis to two.
Scaffolded from `reddoor-starter` with Prismic left as an inert stub rather
than deleted, so it could be promoted to a template if the interaction felt
right. Deployed as `canvas-starter-591`.

**Measured.** 15 commits on `main` in window — **7 human, 8 Renovate**. 18 PRs,
12 of them Renovate's. 139 Actions runs, 3 failures. Zero sessions, zero
prompts.

**The whole interaction was built on 2026-07-24, before this window opens.**
Inside the window, exactly **two** commits touched anything but CI or
dependencies, and neither touched the canvas: #20 capped Prismic srcset widths
across the _inherited_ starter slices, which the canvas route does not use, and
a docs commit. Everything else is Renovate, a Netlify site-name fix, CI running
on `staging`, and the v1.4.1 workflow bump.

This is the cheapest and most honest thing in the cluster to say plainly: **a
dormant prototype still consumes 89 Renovate runs and 12 bot PRs per seven
weeks, plus the human attention to merge them.** Nobody has extended the
interaction since the day it was written. `slicemachine.config.json` still holds
the `your-prismic-repo-name` sentinel — that is the design, not neglect; the
Prismic delivery pipeline correctly excludes it for exactly that reason.

Two of its three CI failures are the tidiest self-inflicted wound available:
the 2026-09-05 journal sweep added `docs/workJournal.md`, `prettier --check`
failed on the markdown, and the next commit is literally
`docs: format the journal so prettier --check passes`.

---

## reddoorla-dot-github — the org preset, and the correction that made it honest

**What it is.** GitHub's org-level `.github` repository. Two things every other
repo consumes: reusable workflows (`ci.yml`, `prismic-models.yml`) that site
repos call **by 40-hex SHA**, and `renovate-config.json`, the preset every repo
extends as `github>reddoorla/.github:renovate-config`. No application code, no
`package.json`, nothing to build — 117 lines of YAML and JSON that run in other
people's repositories.

**Measured.** 21 commits on `main` in window (17 human, 4 Renovate), 9 active
days. 22 PRs, **all 22 merged, none closed unmerged, none open**. 129 Actions
runs, **0 failures** — the only repo in the cluster with a perfect record, which
is what you would expect of a repo whose CI only validates JSON.

**The August work is almost entirely version holds learned from breakage**, and
five of them land on 2026-08-03 alone — in the blind window, so **RECONSTRUCTED
from commit subjects**: TypeScript below 7 "until typescript-eslint supports
it" (#18), `cookie` below 2 "until @sveltejs/kit supports it" (#19),
`@libsql/client` at 0.8.x "kysely-libsql supports nothing newer" (#23),
`@sveltejs/vite-plugin-svelte` below 7 "pending the vite-8 wave" (#20) — and
then **#21 removing that last hold the same day**, three weeks early relative to
its own stated condition, because the wave landed. A hold that names its exit
condition gets removed; one that does not becomes permanent.

### #28 and #29 — the cluster's canonical false claim, and its retraction

This is the episode the fleet's `CLAUDE.md` cites, and it is worth restating
precisely because the correction is the valuable half.

**#28 (2026-08-12) fixed a real defect.** The preset's `schedule` is
Monday-only, and Renovate can only create, rebase or merge a branch inside that
window — verified in the preset's own prose from a real log line:
`caltex-landing`'s 12:52 UTC run recorded `Repository finished / result: done`
with zero branch activity. Pair that with a top-level `minimumReleaseAge` and an
automerge-eligible group can miss its own window: the PR opens Monday carrying a
pending `renovate/stability-days` status, the status clears Tuesday, and
Renovate will not touch the branch again until the following Monday. Observed on
`reddoor-maintenance#509`, which sat green, `CLEAN` and unmerged across four
Renovate runs including two manual dispatches. The fix is
`prCreation: not-pending` with `internalChecksFilter: strict`.

**#28 also shipped a wrong blast-radius claim**, and #29 retracted it **19
minutes later** (created 18:31:49Z, corrected 19:23:03Z, merged 19:25:38Z).
#28 said "18 non-major PRs across the fleet sat CI-green, CLEAN and unmerged".
**16 of those 17 site PRs were never automerge-eligible at all**: under
`group:allNonMajor`, `@reddoorla/maintenance` was grouped into each one, and the
never-auto-merge `packageRule` therefore applied to the entire grouped branch.
They were correctly awaiting a human and a green Netlify preview, exactly as
designed. Only `#509` — the one group with no held package in it — was actually
subject to the window/age interaction.

The generalised invariant now sits in the preset's `description` array as the
fourth of four entries: **"A PR that is green, CLEAN and unmerged is far more
often a rule working than a rule broken."** The dot-github journal names the
structural reason that correction had to be crammed into a JSON `description`
field: _"there was nowhere chronological to put it, which is roughly the gap
this file closes."_

**That rule is presently load-bearing, and I can show it.** Read from
`renovate-config.json` on disk today: packageRule 3 names
`["@reddoorla/maintenance", "sharp", "@zerodevx/svelte-img", "vite-imagetools",
"imagetools-core", "@sveltejs/enhanced-img"]` with `automerge: false`, on the
stated grounds that _"An @reddoorla/maintenance minor bump silently broke
Netlify builds via an undeclared transitive sharp (fleet sharp fixes, 2026-06):
GitHub Actions built green while Netlify failed."_ **All five PRs open in this
cluster at Sep 12 are `sharp` security bumps.** They are not stuck. They are
that rule, doing the thing it was written to do, in the three template repos
that feed every client site.

**Consumers and drift (from the repo's own 09-05 journal, so SECOND-HAND but
dated):** 17 site repos on `ci.yml@v1.4.1`, 3 still on `v1.2.0`, 2 on `v1.3.0`,
8 calling `prismic-models.yml@v1.4.0`. Tags measured locally: v1.0.0 06-08,
v1.2.0 06-16, v1.3.0 07-14, v1.4.0 08-14, v1.4.1 09-01.

**One corpus defect to flag.** `commits.jsonl` was built from local checkouts,
and this checkout is behind origin: **PR #33 (`fix(ci): stop apt from reading
Google's Chrome repo during browser install`) was merged 2026-09-09T18:47Z and
its commit is absent from the corpus**, as are the tags after v1.4.1. A
transcript quote from 2026-09-11 names `reddoorla/.github ci.yml v1.4.2`, so
that tag exists remotely. Any count of this repo's September activity taken from
the corpus alone is short by at least one commit and one tag.

---

## claude-skills — seven skills stop being loose directories

**What it is.** The seven Claude Code skills the fleet runs on, one directory
each: `matching-a-page`, `rfp-analyze`, `new-site`, `figma-slices`,
`markup-review`, `evening-review`, `svelte4-to-5-upgrade`. Private. Installed
by `install.sh`, which symlinks `skills/<name>` into `~/.claude/skills/<name>`.

**Measured.** 52 commits on `main` in window, **100% human, 0 bot**, 9 active
days. 2 PRs (both merged, both 2026-09-11). **0 Actions runs — the repo has no
`.github/` directory at all**, which its own README states as an open item:
_"No CI. `npm test` is the whole gate and runs locally."_ 0 sessions, 0 prompts.

**The commit count needs a caveat the corpus cannot supply.** Of the 52, **30
predate the repo**: they are the original history of `~/.claude/skills/
matching-a-page` (12 commits on 07-30, 3 on 07-31, 4 on 08-02, 10 on 08-03, 1
on 08-05) plus `rfp-analyze`'s, which came in on 2026-09-08 via
`git subtree add` with their original SHAs and paths preserved. Checked: those
commits touch root paths (`page-diff.mjs`, `lib/report.mjs`, `SKILL.md`), not
`skills/…`. So a reader who sees "claude-skills, first commit 2026-07-30" and
concludes the repo existed in July is wrong — it existed for four days.

The imported 07-30 → 08-03 history is itself the `matching-a-page` harness
being built and then reworked twice in the blind window (`rework: v2 — rigid
phased workflow (spec extraction → 4 gates → adversarial self-review)`,
`rework: v2.1 — close the adversarial-review findings`, `harden: kill the
silent-degradation paths found by the adversarial review`). **RECONSTRUCTED**;
no transcript.

### Why the repo happened, and what it cost to find out

The reason is not tidiness, and the journal says so: the matching harness that
a site-bootstrap plan installs into a site repo **has to locate `page-diff.mjs`
somewhere**, and until 09-08 "somewhere" was a directory on one laptop with no
remote, no version, and no way for a site to say which report-format version it
was scoring against. **Five of the seven skills existed in exactly one place on
earth.**

The import found three defects that would all have shipped silently, and the
third is the one this cluster should be read for.

1. **The symlink entry-point bug (`c570465`).** Reached through a symlink,
   `process.argv[1]` keeps the symlink path while `import.meta.url` is the real
   one, so the idiomatic
   `import.meta.url === pathToFileURL(process.argv[1]).href` is **false** — and
   the CLI exits **0 having done nothing, with no error**. `page-diff.mjs` and
   `style-census.mjs` both had it and had simply never been run through a
   symlink; the whole point of the new repo is that from now on they always
   are. Factored into `lib/is-main.mjs` and mutation-tested. Two other CLIs
   turned out to have **no** guard at all — top-level bodies, symlink-safe by
   construction — and each now carries a comment saying why, because the obvious
   "consistency" fix would break them.
2. **Machine dependence (`90597a3`).** Exactly one absolute `/Users/…` path
   existed across 83 tracked skill files. The `~/Documents/GitHub` references
   were a different class and were **not caught by that search**: 32 of them,
   moved by hand to `$REDDOOR_REPOS` / `$SKILL_DIR`. The plan predicted ~25.
3. **`6d5b535` — the repo's own gate could never have run.** `node --test
test/` does not scan a directory on Node 22+: positional arguments became
   glob patterns, so node resolves `test/` to a single entry module and dies
   `MODULE_NOT_FOUND`. **The script was red on a completely green tree from the
   moment it was written**, and would have stayed red until someone ran it — at
   which point the obvious reading is "the tests are broken", not "the runner
   never found them". `node --test test/*.test.mjs` is correct on Node 20 and 24. Root suite is 6/0; `matching-a-page`'s own suite, unchanged, is 31/31.

### The best-executed evidence discipline anywhere in this cluster

Three things happened here that a downstream reader should treat as the
template for how to close a migration.

**One piece of evidence was rejected before it was used.** The obvious
verification — run `bash matching/gate.sh` in the Beachfront repo, "does it
still load?" — proves nothing, because `gate.sh:31` `PD=…` is a bare shell
assignment that succeeds whether or not the file exists, and line 41's
`TAG="${1:?usage…}"` aborts before `PD` is ever used. **The output is
byte-identical with `~/.claude/skills` deleted.** What replaced it was
`test -f "$PD" && node "$PD" --version` on the exact string the script assigns.

**A check that could not be made from inside the session was left open rather
than claimed.** The cut-over needed a cold-start confirmation that a fresh
session discovers the symlinked skills. "This session picked them up
immediately" is not evidence about a cold start "and cannot be made into
evidence from inside itself." It was written down as outstanding and closed in a
**separate entry from a different session** — and even then the listing alone
was ruled insufficient, because _a name in a skill menu is a claim about
discovery, not about whether the target resolves or its code runs_ — which is
precisely the failure mode the `is-main` fix had demonstrated hours earlier. What
made it enough was `readlink -f` resolving into the clone plus
`page-diff.mjs --version` printing `page-diff 0.1.0 report-schema 1` through the
link: _"an artifact a working system makes, not the absence of a complaint."_

**And the instrument was then observed catching something nobody planted.** The
first draft of that journal entry quoted the `readlink` output in full, and
`npm test` went red on it — the machine-path guard added earlier the same day is
repo-wide, not scoped to `skills/`. It fired on prose. That is the "prove the
instrument" rule satisfied in the positive direction, by accident, and recorded
as evidence rather than as an annoyance.

**One defect found and deliberately not fixed**, with the class named:
`skills/rfp-analyze/templates/estimates-repo/CLAUDE.md:8` still points the
handbook at `~/Documents/GitHub/reddoor-starter/docs/rfp-handbook.md` — stale
twice over (the file moved, and the path is hard-coded). The sweep read every
skill's `SKILL.md` and `README.md`; this is a template emitted into a
_generated_ repo, so it fell outside the class as the class was drawn. The
lesson is stated generally: **"every skill's own docs" is not the same set as
"every file a skill writes into someone else's repo."**

**One design decision recorded twice on purpose.** `REPORT_SCHEMA` is spread as
`meta: { ...meta, schemaVersion: REPORT_SCHEMA }`, the **reverse** of what the
consuming plan specifies, and it should stay reversed: with the plan's order a
caller's `meta` silently overrides `schemaVersion`, and _"a field that can be
set by the thing it is meant to police is not a version, it is a suggestion."_
The reasoning is in the journal **and** in a comment at `lib/report.mjs:74`,
because whoever executes that plan will be looking at the line, not the file.

**Storage detail worth keeping:** `~/.claude/skills/matching-a-page` was 354 MB,
~71 MiB of it unreachable `.git` objects from an aborted `git add`. Cloning
through the transport path rather than hardlinking, then `git gc --prune=now`,
produced **212K of `.git` with history intact**. The plan predicted 216K.

**State at Sep 12:** `main` at `093eb73`, clean. Two merged PRs since (#3 froze
looping animation before capture; #4 pins stateful widgets on both pages). Still
no CI, by acknowledged choice.

---

## scriptorium-setup — the busiest repo here, and it is not a website

**What it is.** The entire configuration of a writing appliance: a 15″ Retina
MacBook Pro (A1398) reinstalled with Debian, booting straight into a fullscreen
`foot` terminal running the `micro` editor, with **no browser installed**.
`bootstrap.sh` copies `etc/` and `home/` onto the machine on install day;
`sbin/config-sync` re-applies them from a `git pull` at every boot afterwards.
**A push to this repo is a deploy.** `repos.txt` lists one writing repo,
`tucksravin/caldea` — a novel.

**Measured.** **89 commits on `main` in window, all human, 0 bot** — the highest
commit count of any repo in this cluster. 8 active days, 2026-08-03 →
2026-09-06. 2 PRs (both merged; everything else committed straight to `main`,
which is the convention here). **0 Actions runs — no `.github/` directory**;
the gate is `tests/run-tests.sh` over 10 shell test files, run locally. Five
operator-bearing sessions: 08-16 (94 min), 08-18→19 (**1,120 min / 18.7 h**),
08-20 (4 min), 08-30 (84 min), 09-06 (**864 min**). Models skew cheap:
haiku-4-5 and opus-4-5 26 files each, sonnet-5 12, opus-5 6.

### The two build days (RECONSTRUCTION — blind window)

**2026-08-03 carries 33 commits**, and the subjects read as a whole machine in a
day: design spec, implementation plan (`plan: implementation plan, adversarially
verified (3-agent pass + live test runs)`), the `scriptorium` menu, `ship`,
`pull-repos`, the `/etc` layer (keyd mapping Cmd to Ctrl, GRUB, rescue
console), systemd units, idempotent `bootstrap.sh`, foot/micro typography with
vendored OFL fonts, and a containerised sandbox to "verify the editor layer for
real". **2026-08-04 adds 12** — brightness keys, daily target, week log, health
and wi-fi screens, typewriter mode, session clock.

Two commits from that day are worth naming even without a transcript, because
they are the same bash-3.2 class the fleet keeps rediscovering:
`fix: sandbox/run.sh fails on macOS bash 3.2` and `test: preserve exit status
through EXIT trap (bash 3.2 masks set -e aborts)` — the second being a test
harness that was silently swallowing failures.

### The field-support sessions, which are where the interesting failure lives

**2026-08-16** opens with a report that is wrong in a specific, instructive way:

> "our wifi went out yesterday, now the scriptorium connects but I get the error
> that it's offline. same pattern on my phone hotspot and home wifi"

Three commits that day: the wi-fi check _"asks after a hostname google
deleted"_; `micro keeps its own clipboard, so a cut can never lose the words`;
and `the surface outwaits the panel at boot`. The middle one is the highest-stakes
bug in the repo — on a machine with no browser and no second window, a cut that
loses text is unrecoverable.

**2026-08-18→19 (34 commits, an 18.7-hour session)** is the second design cycle:
`sbin/config-sync`, the over-the-air update path. What it does is stated as
refusals, which is the right shape for a thing that can brick a machine nobody
can SSH into: it **refuses a commit whose scripts do not parse**, **reverts a
config that left no working menu** (within the same boot if systemd gives up on
the surface, otherwise at the next boot), and **promotes only a config the menu
confirmed**. Plus the Apple Option accent table — _"is that possible. mostly
need accents (áéó) for poetry stress"_ — **proven by compiling the real keymap
with `xkbcli` rather than by typing at it**. One commit in that run is literally
`test: a fixture that can tell bash -n from sh -n`, and another is
`docs: name where the array fixture actually bites, and verify it there`: the
instrument being proven before its verdict is used, in a repo with no CI at all.

### The three-entry episode that is the best worked example in the cluster

**09-05 → 09-06, "can't push from home wifi", diagnosed wrong, then right.**

- **Entry 1 (09-05, no commit).** Diagnosed entirely from the Mac because the
  machine never answered on the LAN. Ruled the network **out** with positive
  checks (GitHub answered on 22 and 443, `ssh -T` authenticated, probe returned
  204, no IPv6 default route at all so the "connected but v6 hangs" mode is
  excluded). Formed a belief — a Mac-side merge moved `main`, so the machine's
  push is a non-fast-forward and `ship` prints "offline" for every push failure
  alike — and then **explicitly declined to record it as fact**: _"no memory
  written as fact, no journal claim of a root cause: the one thing that would
  settle it — `git -C ~/writing/caldea push` unsilenced at the machine — was
  unreachable."_ The entry names both outcomes in advance and says which one
  would falsify it.
- **Entry 2 (09-06).** At the machine: `ahead 2, behind 1`. `git fetch` returned
  0 **on the home network, the one that "could not push"**, first try. Rebase
  replayed both chapter commits without conflict; `git push` landed
  `58b75d7..da65416`. **"The network was never involved."** Generalised
  immediately: _any Mac-side push to a writing repo — a fleet sweep, a docs PR —
  makes the writer's next ship read as offline_, because `[p]` is `--ff-only`
  and cannot clear a divergence. The 09-05 fleet-wide journal sweep set this
  trap itself.
- **Entry 3 (09-06, #2).** The fixes, and a belief corrected on contact **inside
  the fix for the misdiagnosis**. The first draft matched `*"access rights"*` to
  detect a refused SSH key. An experiment against a real dead remote — rather
  than memory — printed `fatal: Could not read from remote repository. Please
make sure you have the correct access rights`. So git says "access rights" for
  an **unreachable** remote, and that match **would have filed every dead
  network as a bad key: the same class of misdiagnosis the whole commit exists
  to remove, reintroduced by the fix for it.**

Three more things from that entry that generalise beyond a writing machine:

- **"Written" and "deployed" are separated by a push, and an uncommitted file is
  invisible to every part of the update path."** The file-picker 0-index change
  had been written on 2026-08-30, noted as uncommitted by the 09-05 entry, and
  never left the Mac. The operator asked _"did the 'file list starts on 0'
  change ever get implemented? not seeing it on device"_ — a week later.
- **The picker's existing test was satisfied by the bug.** Its one assertion was
  "row count equals file count", which an off-by-one satisfies exactly as
  happily, and whose only symptom is **opening the wrong chapter, on a machine
  with no other way to look**. The new test walks every row, asserts the number
  opens the file printed beside it, and that one past the end opens nothing —
  _"Confirmed failing against the 1-based version before landing, which is the
  only reason to believe it tests anything."_
- **A fix was considered and abandoned with its revival cost written down.**
  Making `[p]` rebase would prevent this divergence class outright, and is the
  wrong trade: `pull-repos` is shared with `repo-sync.service`, which runs
  non-interactive at boot, so a prose rebase conflict would leave a writing repo
  mid-rebase — _"trading a legible message for a stuck repo nobody is present to
  unstick."_ Reviving it means splitting the interactive path from the boot path
  first.

**And the honest accounting is explicit:** _"None of this prevents the
divergence. It only stops the machine from blaming the network for it."_

**State at Sep 12:** `main` at `8ac6df1`, clean. Verified under the machine's
real `/bin/sh` (dash), not just the Mac's bash — and **none of it is live until
the machine reboots**; last seen running `2257d34`.

---

## Cross-cutting, for the downstream reader

**1. Four of six repos have no session record at all, and the two that do
account for only 7 operator-bearing sessions.** `reddoor-starter-blux`,
`canvas-starter`, `claude-skills` and `reddoorla-dot-github` were changed
entirely from _other_ repos' checkouts — mostly `vida-legacy-foundation`,
`29-navy` and `prismic-types-headless-delivery`. Any analysis that maps effort
by cwd will report these four as dead and will be wrong. The infrastructure
layer is worked on **from inside whatever client problem exposed it**, which is
also why its fixes are so well-motivated and so unevenly propagated.

**2. The false-green is this cluster's dominant defect class, and it has a
consistent signature: a check whose blindness is exactly complementary to the
bug it is aimed at.** Six distinct instances in seven weeks —
`prettier --check` silently skipping every `.svelte` file for want of a config;
the axe gate scanning two dev fixtures and reporting "0 violations" for a whole
site, for four days; `node --test test/` unable to find any test on Node 22+, red
on a green tree since the day it was written; Playwright's `reducedMotion` set
one nesting level too shallow and dropped in silence since June; a CLI entry
guard that exits 0 and prints nothing when reached through a symlink; a picker
test satisfied by the off-by-one it existed to catch. The starter's own journal
names the shape better than a rule can: _"An absent check is visibly absent. A
check blind in precisely the configuration that breaks reads as green
diligence."_ The follow-on question it proposes — **"under what invocation was
the evidence produced, and is that the invocation that fails?"** — is not yet in
any `CLAUDE.md`.

**3. Instrument-proving is practised well when someone remembers to, and there
is no mechanism that makes them.** The good instances are outstanding: a
deliberately mangled `.svelte` file proving the prettier gate; a real dead
remote printing its actual text rather than trusting memory about git's wording;
`test -f "$PD" && node "$PD" --version` replacing a `gate.sh` invocation that
would be byte-identical with the skills directory deleted; a cold-start check
deferred to a different session because it could not honestly be made from
inside the one that changed the thing. All of these were chosen by the author.
Every false green in point 2 was also authored by someone who had read the rule.

**4. The Blux split traded one failure mode for a slower one, and nobody has
re-checked the trade.** Forking removed 178 files of dead weight from every new
client site — clearly correct. It also made shared improvements a manual
cherry-pick, and seven weeks later **7 starter improvements are unadopted in
blux, including both false-green fixes from point 2**; `canvas-starter` is in
the same state. The split's own guard rail (cherry-pick, never merge) is
extremely well documented; the split's _cost_ (adoption lag) has no instrument
at all. A one-line diff of `.prettierrc.json` / `a11yRoutes` presence across the
three template repos would have surfaced it in seconds, and nothing runs it.

**5. Bot traffic is a real tax on repos nobody is developing.** Across the
cluster, Renovate authored **29 of 82 PRs (35%)** and **25 of 228 main-branch
commit rows (11%)**, and generated **286 of 479 Actions runs (60%)**. In `canvas-starter`
— a prototype last extended on 2026-07-24 — the ratio is 12 of 18 PRs and 89 of
139 runs. The preset is well tuned (five named holds, a Monday window, a
never-auto-merge class) and the cost is still non-zero.

**6. Green-and-unmerged is the rule working, and the cluster now proves it
rather than asserting it.** All five PRs open at Sep 12 are `sharp` security
bumps in the three template repos. `sharp` is named in the preset's
`automerge: false` rule, on evidence from a 2026-06 incident where _GitHub
Actions built green while Netlify failed_. This is #29's correction still
holding six weeks later, and it is the single easiest thing for a downstream
reader to get wrong.

**7. Review is in-session, not on GitHub — and the median PR merges in 32
minutes.** Zero of 82 PRs received a GitHub review. The 2026-09-01 session
instead ran `superpowers:code-reviewer` 14 times and `general-purpose` 47 times
before opening anything. This is coherent and it is fast, but it means the PR
record contains no independent verification signal at all: every merge gate that
exists is one the same session built, ran and read.

**8. The journal convention is six days old in these repos and is already
producing the material this retrospective is made of.** It came from one
operator sentence on 2026-09-05 — _"I want every repo to maintain a workJournal,
similar to the one that I have in smahre/Broken"_ — and its most valuable
property is not the prose but the forward pointer, which was added within hours
of the convention because the rule as first written was **half a mechanism**: a
correction at the bottom of a file does not reach a reader who lands in the
middle. Four of this cluster's six repos now carry a journal whose first entry
honestly labels itself a backfill and says where the trust boundary is.

**9. The operator's interventions are consistently the highest-leverage events
in the record.** _"Shouldn't slices be able to get that data through content
relationships…"_ changed a design and prevented a third template. _"I don't want
to carry bloat into a new site"_ is the constraint the whole native-ize serves.
_"i feel like you consistently get hung up on archived repos, is there a way we
can fix that?"_ produced `fleet-repos.sh`. _"by the time you've run the check
the cost is already paid"_ turned a proposed CI gate into a prompt-time hook.
Each is short, each is a challenge rather than an instruction, and each landed
in the design rather than in the backlog.
