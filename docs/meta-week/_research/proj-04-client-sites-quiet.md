# Cluster 04 — the quiet client sites

_Retrospective layer: mile-high, project by project. Window **2026-07-30 → 2026-09-12** (45 days).
Sixteen repositories: eleven client sites, one hosted micro-service, two RFP repos, two dead ones._

---

## Coverage, stated before anything is claimed

Three separate limits apply to this cluster, and two of them are severe enough that a
reader who does not know about them will draw the wrong conclusion.

**1. Transcripts retain only back to 2026-08-10.** For 2026-07-30 → 2026-08-09 there are no
sessions and no prompts. Everything said about those eleven days here is **reconstruction
from git, PRs and Actions runs**, and is labelled as such. The boundary is not even clean at
the day level: of the 26 sessions surviving on 2026-08-10, **all 26 have `cwd` in
`beachfront-dentistry`**, the earliest starting 16:02 UTC. Hedloc's four client-feedback
commits that day land between 17:49 and 22:12 UTC and have no transcript at all.

**2. Not one Claude Code session in the entire corpus ran inside any of these sixteen
repositories.** Measured: 3,469 sessions, zero with a `cwd` or `project` matching
`the-pointe*`, `*-burbank`, `1836dig`, `data-dynamiq`, `hedloc`, `erp-industrial`,
`medical-solutions-of-texas`, `la-homelessness-*`, `caltex-landing`, `vineyard-custom-homes`,
`reddoor-md-pdf`, `reddoor-rfp-analyses`, `reddoor-mailer` or `rfp-analyze`. Every session
that changed these repos ran from somewhere else — `reddoor-maintenance`, `reddoor-website`,
`reddoor-starter`, `revogen`, `vida-legacy-foundation`, `beachfront-dentistry`. **This
cluster is operated remotely.** That single fact organises everything below.

**3. Two collection gaps in the corpus itself.** `gh-errors.txt` records
`failed to get runs: Get ".../repos/reddoorla/hedloc/actions/runs?..." connection reset by
peer` and a GraphQL reset. So **hedloc shows 0 PRs and 0 runs, which is a scrape failure, not
a fact** — its own commit subjects carry PR numbers up to `#44`. Where a hedloc PR is
discussed below it is read out of the commit trailer, not out of `prs.jsonl`. Separately,
`airtable-Reports.json` holds only 17 rows total and `airtable-Submissions.json` 48, both of
which look like partial or superseded exports; see the caveat under _What the fleet record
says_.

---

## The one-paragraph version

267 commits across sixteen repositories in 45 days. **108 of them (40.4%) were written by
`reddoor-renovate[bot]`.** Another **112 (41.9%) were written by Tucker but are mechanically
identical across repos** — the same sweep commit, same message, landed in eleven or twelve
checkouts inside an hour. 13 more are hand-adjudicated dependency work. That leaves **34
commits (12.7%) of genuinely site-specific product work in the whole cluster, and 19 of
those 34 are in one repository, 17 of them on a single day.** Eleven of the sixteen repos
received **zero** site-specific commits in the entire window. 197 PRs were opened; 159 were
merged; **`nReviews` is 0 on every single one**. Human-authored PRs merged at a median of
**0.2 hours**; Renovate's merged at a median of **14.2 hours**, because Renovate merges
itself on its own twice-daily cron. CI ran 1,495 times at a 97.6% pass rate, and **985 of
those 1,495 runs (66%) are the Renovate workflow polling on a schedule** rather than anything
verifying a change.

This is what a working self-maintaining fleet looks like from the inside, and the interesting
material is almost entirely in the seams: the days the sweep hit something it did not expect,
and the one site where somebody actually sat down and built.

---

## The five fleet days

The clearest structural fact in this cluster is that the human commit days are the _same
days_ in nearly every repo. Strip the bot and you get this shape, repeated:

| day        | what landed                                                                     | repos reached (of 16) | authoring span               |
| ---------- | ------------------------------------------------------------------------------- | --------------------- | ---------------------------- |
| 2026-07-31 | Renovate cron → twice daily; `actions/checkout` v7; refs to fleet-current       | 10                    | — (pre-transcript)           |
| 2026-08-02 | `ci(renovate): authenticate as the reddoor-renovate GitHub App`                 | 11                    | 11:13:26 → 11:51:22 (38 min) |
| 2026-08-16 | `@reddoorla/maintenance ^0.81.0 → ^0.83.0`, then `prismic-ci` delivery workflow | 5, then 4             | 30s, then 32s                |
| 2026-08-20 | `ci: run on pushes to staging`                                                  | 12                    | 11:02:55 → 11:04:21 (86 s)   |
| 2026-09-01 | reusable workflow v1.4.1 (single smoke run), then the srcset cap                | 11, then 7            | 14 min, then 58 min          |
| 2026-09-02 | `pnpm → v11.11.0 [security]` (Renovate, unattended)                             | 12                    | 59 min                       |
| 2026-09-05 | `docs: adopt the work-journal convention`                                       | **16 of 16**          | 11:35 → 15:51 (4h16m)        |

The authoring spans are commit timestamps, not merge times — the 08-20 sweep did open twelve
`ci/run-on-staging` PRs and every one ran `pull_request` CI green before merging. The point is
the _authoring_: twelve repositories' worth of identical change written in 86 seconds is a
script, and the cost of the change is not in writing it.

Three of these sweeps are worth their own paragraph, because each one taught something.

### 2026-08-20 — "can we set ci to also run on staging? this is a fleet problem"

Tucker, 17:50 UTC, from the `reddoor-website` checkout:

> we talked about the status update already, fine as is and can we set ci to also run on
> staging? this is a fleet problem

The commit body that shipped to twelve repos says why, and it names the defect rather than
the feature:

> `pull_request:` already covers PRs against any branch, but work that reaches staging by
> direct push opens no PR and so runs nothing — a spec added on a feature branch can sit
> unverified until its eventual PR to main. **That is how a timezone-dependent assertion
> reached reddoor-website's main having never once run in CI.**
>
> Inert in a repo with no staging branch; this is here so the gap cannot reopen the day one
> is created.

None of these twelve repositories has a `staging` branch. The change is a no-op in all of
them, deliberately — it is a gap being pre-closed fleet-wide off the back of one real escape
in a repo outside this cluster. Note what this means for the instrument rule: **the guard
was installed everywhere and cannot pass or fail anywhere in this cluster**, because there is
no staging branch to push to. It is the correct call and it is also, right now, an untested
assertion in twelve repos.

### 2026-09-01 — one production bug on one site becomes a seven-repo image sweep

This one is fully visible in the transcripts and is the best example in the cluster of how
work propagates. It starts in `revogen`, not here, at 16:47 UTC:

> some photos don't seem to be loading in production, can youn look through this site?

Then, once the cause was found:

> yep continue on with the fleet fix

and later, asking for the blast radius before agreeing to it:

> what's the function loss on the downstream sites?

The finding, quoted from the commit that landed in the-pointe-burbank as #29:

> `<PrismicImage>` advertises every default width (up to 3840w) regardless of how big the
> source is, and without a `sizes` attribute the browser assumes 100vw — so it picks those
> top candidates and Prismic upscales on demand. Those variants are always a cache MISS, are
> expensive to generate, and show up as slow or failed images in production while the same
> asset's smaller variants serve fine. All 19 `PrismicImage` call sites in this repo were
> affected. Measured on a live fleet page, this is **~30% of image bytes per desktop
> pageview**, more on mobile, with no visual change — upscaling adds no detail.

It reached seven of the sixteen: caltex-landing, erp-industrial, hedloc, the-pointe-burbank,
the-tower-burbank, vineyard-custom-homes — and `the-pointe`, where it is **still sitting
unmerged on a local branch** (see _The three that cannot take a push_). The mechanical half
(`cappedWidths(field)`) came from the shared package; the `sizes` value per slot is described
in the commit as "the half only the site can know", which is why this could not be a pure
central fix.

**And the same PR tripped a fleet instrument on a site-specific assertion.** From its second
commit:

> `@reddoorla/maintenance` 0.90 adds `contextOptions: { reducedMotion: "reduce" }` to the
> shared Playwright config, emulating `prefers-reduced-motion` fleet-wide. That is the right
> default, and `app.css` correctly collapses the carousel cross-fade to an instant swap under
> it — but this gate asserts the cross-fade itself (two slides painted at once mid-transition),
> which by definition cannot happen when the fade is instant. It failed as
> "Expected length 2, Received 1". … **Surfaced by the dependency bump in this branch, not by
> the image markup.**

A correct fleet-wide default made a correct site-specific gate assert something impossible.
The fix was to opt that one test back into motion. This is the shape to watch for: _the
central default and the local gate were each individually right._

### 2026-09-05 — the work-journal sweep, and the archived-repo trap for the fourth time

Origin, 18:04 UTC, from the `vida-legacy-foundation` checkout:

> Also, add to the starter CLAUDE.md and all the other repos I have on this machine, I want
> every repo to maintain a workJournal, similar to the one that I have in smahre/Broken

This is the only sweep in the window that reached **16 of 16** — 28 commits over 4h16m,
because each repo took two commits (adopt the convention; then add the forward-pointer rule)
and one took three. It is also the sweep that ran headlong into the thing this cluster
uniquely contains: all three of the fleet's unpushable checkouts.

At 21:32 the same evening, Tucker:

> i feel like you consistently get hung up on archived repos, is there a way we can fix that?

That sentence is the direct ancestor of `scripts/fleet-repos.sh` and the CLAUDE.md section
"Before a fleet sweep, ask which repos can receive a push". The journal entry written that
day opens "Third time." — a sweep written, committed everywhere, and only at `git push`
discovering some repositories reject writes, with the work already done.

**One extra defect from this sweep, small and instructive.** `the-tower-burbank` is the only
repo of the sixteen carrying a third commit, `docs: format the journal so 'prettier --check'
passes`, and the only one whose `chore/work-journal` PR reds CI — twice, at 19:13 and 20:30
UTC on 09-05. The centrally-generated markdown was checked by each repo's _own_ prettier
config. That is the same defect class as the 08-16 `prismic-ci` rollout, where erp-industrial
needed `style: prettier-format the delivery workflow for this repo` because "this repo sets
`singleQuote: true`, and prismic-ci ran against a fresh clone with no `node_modules`, so it
could not resolve this repo's prettier", and the same class again as erp's earlier
`ci(renovate): make the workflow prettier-config-agnostic (plain YAML scalars)` —
"the quoted strings were rewritten differently by repos with singleQuote". **A fleet template
is authored once and formatted N times. Three separate incidents in one window.**

---

## The three that cannot take a push

This is the cluster that contains all three of the fleet's unpushable checkouts, and the
09-05 sweep left visible residue in every one. Measured with `git status -sb` and
`for-each-ref`, read-only:

- **`the-pointe`** — archived on GitHub. `chore/work-journal` is **ahead 2 of `origin/main`,
  unpushed**. Separately, `feat/prismic-capped-image-widths` holds the 09-01 srcset fix, also
  ahead 1 and never merged. `main` itself is `behind 4`. This repo has three worktrees and
  seven local branches, several of them Blux design work (`feat/blux-container-background`,
  `feat/cms-catalog-render`, `feat/design-pass-2-data-driven`, `fix/blux-grid-row-gutter`)
  parked at various points. It received 6 commits in the window; 3 of the 3 human-authored
  landed nowhere.
- **`reddoor-mailer`** — archived on GitHub. `chore/work-journal`, 2 commits, unpushed. It
  also carries **1,341 dirty files**, which on inspection is a committed `node_modules` being
  half-deleted. There is no README. Its function was absorbed into `reddoor-maintenance` long
  before this window.
- **`rfp-analyze`** — no `origin` at all. 4 commits in the window, all docs. The last two, on
  2026-09-08, are the only sign of intent in the whole repo: `docs(SKILL): rfp-handbook lives
in the estimates repo, not the starter's docs` and `docs: this repo is now a subtree of
reddoorla/claude-skills`. So its future is decided — it becomes a subtree — but the
  checkout is still sitting on `chore/work-journal` with no remote to push to.

The CLAUDE.md line that matters most here, because it is what makes this recur, is that
**archived is invisible from inside the clone**: `git remote -v` shows an ordinary URL,
`git ls-remote` succeeds, `git fetch` succeeds, and only `git push` fails, after every commit
already exists. Three separate sessions ran a fleet change to completion before finding out,
and one reported the cause wrongly as "dead remote".

---

## Repo by repo

### the-pointe-burbank — 40 commits (30 human, 10 bot), 11 active days, 28 PRs

The one repository in this cluster where somebody built something. It is a **frozen Blux
artifact** site — a Webflow-era design captured as a committed HTML/CSS artifact, rendered by
a SvelteKit route with Prismic supplying slot values. Airtable has it as `building`, replacing
an `archived` row called _The Pointe_.

**19 of the cluster's 34 site-specific commits are here, and 17 of them are on 2026-08-03.**
Seven PRs (#14–#20) opened and merged between 20:39 and 23:59 UTC that evening, each one
scoped to a single defect. Merged totals for the repo: **+8,045 / −2,127**, which is 39% of
all lines added across the cluster's 159 merged PRs.

The work is a Figma design review answered with measurements rather than adjustments. A
representative sample, all verbatim from commit bodies:

- Rule-mark spacing: "the box gaps read 10 and 34.5, but the painted rows were 18 above and
  45.5 below" — then an actual sweep, `margin 0 → 18/45.5`, `8 → 26/37.5`, `12 → 30/33.5`,
  `14 → 32/31.5 ← even`, landing "all four eyebrow marks within 3.5px, from 27.5px apart".
- Carousel arrow contrast measured as WCAG against the arrow's own box excluding the glyph:
  **2.53:1 median, 1.17:1 across its brightest tenth**, against the 3:1 that 1.4.11 asks for.
- The dissolve: "Both slides used to animate… two opacities meeting at .5 composite to
  `.5 + .5 x .5 = .75`: a quarter of the page's own light background showed THROUGH the middle
  of every transition."
- The preload trace: "the fade began at +5058ms and the response landed at +5078ms."
- Image weight, twice. Carousel only: three slides at 3960x2640 into a 1425x760 box, "3.4MB
  even as AVIF — 906 + 1103 + 1399 KB — roughly seven times the pixels the band can show";
  1103KB → 537KB at `w=2400`. Then all 50 images: "5.06MB of Prismic imagery, **4.03MB of it
  in files far larger than their box** — a 5774px original (1.34MB) into an 823px box, 5341px
  into a 1425px band, 2563px into 816px", with 24 of the 50 left alone because their source
  was already below what the box needed.
- The fallback colour for an unpainted slide: `rgb(63,62,40)`, "the mean colour of the three
  photographs (109,108,65 / 87,87,52 / 109,104,78, averaging 102,100,65) taken to 62%".

**The instrument episode, and it is the cleanest one in the cluster.** On 2026-07-31,
`refactor(frozen): offline gate renders the production artifact, not a copy`:

> `/dev/blux-frozen` imported its own `the-pointe.{html,style.css}` from beside the route
> rather than the `frozen/` artifacts the real page renders. The two had drifted: the route's
> copy was a three-minutes-older freeze run, missing five media bands' `data-loaded` /
> `data-media-int` / `position:relative` attributes. **Every guard that drives this route —
> the fidelity gate, the a11y suite — was therefore measuring markup production does not
> serve.** Nothing had broken yet (the drift is layout-inert: same 152 token keys, same four
> `/#N` hashlinks, and the two templates render to the same height once the footer spacer is
> repaired), but the gate cannot certify a file the site does not use.

Net −84KB of duplicated bytes. This is the mirror image of the repo's standing rule. The rule
says a gate that has only ever _failed_ is not evidence; this is a gate that had only ever
_passed_, on a subject three minutes stale from the one it names. Both are the same defect:
the instrument was never proven against the real thing.

**Two more false greens, found in one commit on 08-03**, and the commit says so under a
heading of its own — "Two defects found while testing this, both of which had a green test
over them":

> - Dropping the step from `steps()` failed nothing, because every end-to-end assertion ran
>   against CloudFront defaults the step deliberately ignores.
> - `substitute` emits `url('…')` WITH quotes, so appending to the raw capture put the
>   parameter after the closing quote — a url no browser would fetch. `toContain("&w=2400")`
>   passed on it happily.

A mutation-invisible pipeline step and a substring assertion that passes on a malformed URL.
Both were caught by deliberately deleting the step and re-reading the output, not by the suite.

**The dangerous-migration note**, from the 07-31 re-freeze, is worth preserving because it
describes a silent failure with a deliberately red guard:

> Slot keys shift, which is the dangerous part. Dropping the spacer renumbers h.t12–h.t16
> down one, so the committed template and the PUBLISHED Prismic document disagree until the
> migration release is republished — silently. Nothing errors; the footer just renders the
> right words in the wrong places, losing "818.502.6707" and "A Property Within" and growing a
> stray "[email protected]". … **It is red until the release is published, on purpose —
> deploying while it is red ships the scrambled footer.**

Verification, stated: "/dev/blux-frozen matches on **110 of 110 element boxes at BOTH 1440 and
390**, with identical page heights (14811 / 15583). 654 unit tests, 9 Playwright, lint,
svelte-check."

**State now:** last change 2026-09-05 (the work-journal sweep). Airtable `building`, so it
carries almost no fleet telemetry — only `Default Branch CI: passing`. One open Renovate PR
(#33, sharp 0.35.4 security) since 09-09. Everything after 08-03 in this repo is sweep traffic.

### hedloc — 25 commits (16 human, 9 bot), 11 active days, PR data missing from corpus

An oil-and-gas family investment site (Midland, Permian Basin), Airtable status `launching`,
`maintenence freq: None`. **The only repo in the cluster with live client traffic in the
window**, and the only one with a Discord channel that moved: `#hedloc-web`, 35 messages.

The client-facing loop on **2026-08-10** is measurable end to end, and it is fast. Discord
timestamps are UTC; commit author times below converted from −07:00:

| UTC   | event                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17:11 | Tucker asks internally: "'add gina to bio as my wife' did we get copy change or did he just want things written?"                                                                                                                 |
| 17:49 | commit `feat(home): put all landing copy on the hero, drop section headings (#33)`                                                                                                                                                |
| 18:04 | Tucker posts the preview: "should be all set, please review"                                                                                                                                                                      |
| 19:31 | Erik: "slide the two buttons that are just below the fold up above the fold… 100 px between the body copy and the buttons, and then another 100 px after, before the images start. But Make sure the buttons are above the fold." |
| 19:56 | commit `feat(home): move hero CTAs above the fold, 100px rhythm to images (#34)`                                                                                                                                                  |
| 20:01 | "updated, check if that's what you wanted" — **30 minutes request to reply**                                                                                                                                                      |
| 20:05 | Erik: "make the Contact Us page proportions the same as the executive team… so you don't have to scroll to see the contact form"                                                                                                  |
| 20:12 | commit `feat(contact): match hero proportions to executive team (#35)` — **7 minutes**                                                                                                                                            |
| 20:15 | Erik: "Anchor the image so that we either see more of the bookshelf or more of the coffee table, whichever one is more pleasing?"                                                                                                 |
| 20:41 | commit #36, `anchor hero image to the bookshelf crop`                                                                                                                                                                             |
| 22:12 | commit #37, `anchor hero to the couch`                                                                                                                                                                                            |
| 22:13 | "done"                                                                                                                                                                                                                            |

That last pair is the interesting one, because the client explicitly delegated the choice
("whichever one is more pleasing") and **the first answer was tried, shipped and then
replaced ninety minutes later**. #36's body records the reasoning for the road not taken —
"bookshelf chosen over coffee table for legibility of the heading against the wall" — and #37
generalises the mechanism rather than re-hardcoding: "Generalize `ScreenWidthImage`'s anchor
prop to accept a 0-100 percentage (keywords map to 0/50/100)… anchor the contact hero at 75%
so the couch is the focal band instead of the bookshelf."

**None of this has a transcript.** 2026-08-10 is the retention boundary and only
beachfront-dentistry sessions survive it. What the day cost in tokens, how many turns each
of those four changes took, whether any of them were one-shot — unknowable from this corpus.

**Hedloc is also the repo that merged the Renovate override-key trap.** On 2026-08-03,
Renovate opened `chore(deps): update dependency cookie@<0.7.0 to v2` in nine cluster repos
simultaneously. Eight closed it. Hedloc merged it as #25 — and needed #29 the same day:

> Renovate's weekly batch widened the vuln-wave override target to `'>=0.7.0 <3'`. pnpm keeps
> resolving 0.7.2 while the lockfile holds it, but **any fresh resolution (next lockfile
> maintenance) would jump to cookie 2.x — whose removed parse/serialize exports break every
> current `@sveltejs/kit` server build.** The org preset now holds cookie <2
> (reddoorla/.github#19); this restores the site's cap to match reality.

Measured across the cluster: **18 `cookie@…` PRs in `prs.jsonl`, 17 closed unmerged, 1 merged
(1836dig #8)** — plus hedloc's #25 and #31, invisible to that count because hedloc's PR scrape
failed. So the honest number is **20 of these PRs, 3 merged, 1 of which needed a same-day
corrective.** The failure mode is not that Renovate proposed a bad upgrade; it is that
Renovate **misread a pnpm override KEY as a dependency version** and the PR title looks
exactly like an ordinary bump. It came back a week later on 08-10 as "`cookie@<0.7.0` to v1"
in seven repos; that round was intentional and correct (widening `<1` to `<2` to match the
org preset), which is precisely what makes the class hard — the same title shape is sometimes
right.

**State now:** last change 2026-09-05. `launching`, deploy ready, CI passing, 1 low vuln, 9
deps outdated, no custom domain yet (`https://hedloc.netlify.app/`). No maintenance cadence
set.

### caltex-landing — 21 commits (14 human, 7 bot), 13 active days, 22 PRs

A maintained client site (`caltexmedical.com`, quarterly, next maintenance 2026-11-21) that
served in this window mostly as **the fleet's proving ground**. Two of its three
site-specific commits exist only to test other machinery:

**The Prismic headless-delivery proof, 2026-08-16.** `test(prismic): temporary probe field to
prove headless model delivery (#54)`, then `Revert "…" (#55)` the same day:

> Adds one Boolean field, `Main.delivery_probe`, to the `page` custom type. It is a throwaway:
> purely additive, unreferenced by any component, and removed by a follow-up PR as soon as
> delivery is proven. This is Task 32 steps 3-4 of the headless model-delivery plan — the
> end-to-end proof that a model edit rides code review and reaches Prismic on merge, **run
> against a real repository rather than asserted.**

This is the instrument rule applied correctly and deliberately: rather than trust that the
`prismic-models` CI job works, a disposable field was pushed through the whole path on a live
client site and then removed. Caltex is the only repo in the cluster with `prismic-models`
workflow runs — 4 of them, all success.

**The fleet audit catching a real defect, 2026-08-10.** `fix(seo): give each page a distinct
document title (#51)`: "All five routes served the identical `<title>Caltex Medical</title>`,
which fails the fleet audit's Titles & Meta check (no two routes may share a title) and reads
as one page to search engines." A nightly audit found it; a one-PR fix cleared it; Airtable
now reads `Titles & Meta OK: pass`. Worth naming because it is the loop working as designed,
and this cluster contains exactly one instance of it.

**State now:** last change 2026-09-05. All green — smoke pass, deploy ready, CI passing,
a11y violations 0, links OK, mobile OK, Prismic models pass, GA4 wired (481919081). **One
persistent `Security Vulns High: 1`** and two open Renovate sharp-security PRs (#62, #63)
untouched since 2026-09-09.

### vineyard-custom-homes — 21 commits (13 human, 8 bot), 12 active days, 24 PRs

Maintained (`vineyardconstruction.com`, quarterly, next 2026-10-05). No site-specific commits
at all in the window. Its human traffic is entirely dependency adjudication plus the sweeps,
and it is the repo that most clearly shows **the cost of Renovate's majors landing one at a
time versus together.**

`chore(deps): vite 8 stack — vite 8.2 + plugin-svelte 7.2 + svelte 5.56 + tailwind 4.3 (#48)`
on 08-03 says it plainly: "plugin 7 requires it + svelte >=5.46.4… Verified locally: build,
vite dev boot, svelte-check, and the a11y audit (pass) — **the audit's dev-server was exactly
what plugin-7-without-vite-8 broke.**" Renovate had opened `@sveltejs/vite-plugin-svelte to
v7` (#43) and a paired-majors attempt (#47) separately; both were closed in favour of the
hand-assembled quadruple. The measured evidence is in the CI record: `renovate/sveltejs-vite-
plugin-svelte-7.x` failed 08-03 01:29, `chore/svelte-556-vite-plugin-svelte-7` failed 08-03
15:03, and the merged #48 went green.

Also carries the `prettier-plugin-svelte v4` reformat (#53, 08-11), the same one-file
`ContactForm.svelte` change as erp-industrial, with the same honest note: "the textarea is
empty, so no rendered content changes."

**State now:** last change 2026-09-05. Green across the board, `Form E2E OK: pass`. **One
persistent high vuln, two open sharp-security PRs since 09-09.**

### medical-solutions-of-texas (MSOT) — 21 commits (11 human, 10 bot), 12 active days, 19 PRs

Maintained (`medicalsolutionsoftx.com`, quarterly, next 2026-11-21). **Zero site-specific
commits.** Ten of its eleven human commits are sweeps; the eleventh is
`style: apply prettier-plugin-svelte v4 formatting`.

MSOT's real activity in this window happened _outside_ its own repo, which is a pattern worth
flagging. On 2026-08-13 Erik posted in `#msot`:

> I just noticed on the MSOT site, when we're showcasing the end user graphics here, that
> slide one is a little bit shorter than slides two and three… Could you make those match up,
> please

and then, one minute later:

> **Sorry, MSOT portfolio page on Reddoor's site**

The request looked like a client-site bug and was a marketing-site bug. MSOT has no commit on
2026-08-13. Separately, MSOT's finished design is repeatedly used as the _reference_ for other
work — "look at how we do steps on MSOTs site, should be a similar fill" (08-16,
reddoor-website), and "sometimes we have the paper texture overlap partially with a slice, see
the msot site image" (08-12). **A quiet maintained site is still doing work as a design
precedent, and none of that shows up in its own repository.**

The one bit of client signal: 2026-08-05, `#msot`, "@everyone MSOT just won a huge contract
yesterday afternoon!!! You guys made them look legit and it paid off!"

**State now:** last change 2026-09-05. Smoke pass, form e2e pass, GA4 wired (481951114).
**One persistent high vuln, two open sharp-security PRs since 09-09.**

### erp-industrial — 21 commits (9 human, 12 bot), 12 active days, 19 PRs

Maintained (`erpfunds.com`, quarterly, next 2026-10-25, testing yearly). **Zero site-specific
commits.** The most bot-dominated repo in the cluster (12 of 21) and the one that surfaced the
**prettier-config collision** twice — once on the Renovate App workflow ("the quoted strings
were rewritten differently by repos with singleQuote" → rewrite as plain YAML scalars), once
on the prismic-ci workflow ("this repo sets `singleQuote: true`, and prismic-ci ran against a
fresh clone with no `node_modules`, so it could not resolve this repo's prettier **and said
so** — 'could not prettier-format written files — verify CI formatting'"). The second is a
tool degrading honestly instead of silently, which is the right behaviour and worth copying.

Five CI failures, the most of any repo: `maint/renovate-app-identity` (08-02),
`renovate/cookie-0.7.0-2.x` (08-03), `renovate/prettier-plugin-svelte-4.x` (08-10),
`chore/maintenance-0.83.0` and `maint/prismic-ci-…` (both 08-16). Every one is the formatting
or override-key class, not a product regression.

**State now:** last change on `main` 2026-09-05; four Renovate branch commits dated 09-07 sit
off `main` (pnpm v12, `@prismicio/svelte` v2, `slice-machine-ui` v2, `svelte-gestures` v5) —
**the largest un-landed major-version backlog in the cluster**, and Airtable agrees:
`Deps Major Behind: 2`, `Security Auto-Fix Attempts: 1`, `Security Vulns High: 1`. No open
sharp PR here, which (INFERRED, from the standing note on ghost vulnerabilities from deleted
lockfile manifests) is consistent with its high alert being one nothing can fix.

### data-dynamiq — 18 commits (8 human, 10 bot), 11 active days, 14 PRs

Maintained (`datadynamiq.com`, quarterly, next 2026-10-05). **Zero site-specific commits.**
All eight human commits are sweeps. Its distinguishing fact is an absence, stated by Tucker
on 2026-08-15 when a drift alarm fired:

> reddoor wireframer is placeholder, **data dynamiq has no prismic**, go ahead and fix the env,
> and that isn't drift, that's me actively working on the prismic on a new branch for reddoor

and on 08-13:

> 30 clean up data dynamiq after, i can make a prismic repo for it so everything is in line

Airtable now reads `Prismic Models Drift: "not a Prismic site (no repositoryName) — skipped"`,
which is the alarm correctly declining to fire. The standing hazard here — recorded elsewhere
and not re-derivable from this corpus — is that removing `slicemachine.config.json` from this
repo breaks its build even though it has no Prismic.

Four Renovate branch commits dated 09-07 sit off `main` (pnpm v12, `svelte-select` v6). Five
stale local branches still point at deleted upstreams (`ci/wire-smoke-tests`,
`feat/forms-dashboard-ingest`, `feat/turnstile-widget`, `fix/slider-title-clobber`,
`perf/bestpractices-cookies`), the oldest from 2026-06-15 — **the 09-01 "clean up the git
tree for them" pass did not reach this repo.**

**State now:** last change 2026-09-05. Green, `Security Vulns High: 1`, 10 deps outdated.

### 1836dig — 24 commits (14 human, 10 bot), 11 active days, 16 PRs

Maintained; `Launched at: 2026-07-31`, the only launch date inside this window. A Webflow
conversion — Tim, 2026-08-27 in `#website-maintenance`: "did you already switch over 1836?",
Tucker: "yes re 1836 and yep they're all on my list".

Its four site-specific commits are all on launch day and all infrastructure:
`feat: add smoke suite (test:smoke + playwright config + /health smoke routes)`,
`fix: run svelte-kit sync on install so the smoke suite can load its config`, and
`chore: put 1836dig on the org Renovate preset`. **The `svelte-kit sync` fix is the
cold-clone breakage that has bitten this fleet repeatedly** — an absent generated
`.svelte-kit/tsconfig.json` on a fresh checkout — and it is worth noting that it was
discovered here at launch, in a repo nobody has opened since.

1836dig is also the single repo that **merged** a `cookie@<0.7.0 to v2`-class PR from the
08-03 round (#8) while eight others closed theirs.

**State now:** last change 2026-09-05. Perfectly clean — 0 vulns of any severity, 8 deps
outdated, smoke pass, form e2e pass, next maintenance 2026-10-31. Two stale local branches
from launch day (`feat/smoke-suite`, `maint/smoke-suite-20260731T185616707Z`) and two
worktrees still checked out.

### la-homelessness-initiative — 16 commits (8 human, 8 bot), 10 active days, 14 PRs

Maintained (`lahomelessnessawareness.org`, quarterly, next 2026-10-05). **Zero site-specific
commits; all eight human commits are sweeps.** The quietest genuinely-maintained site in the
cluster. Three closed Renovate PRs (two cookie-class, one `typescript to v7` autoclosed at
+261/−60 after failing CI on 08-03). One stale local branch, `ci/wire-smoke-tests`.

**State now:** 0 vulns, all green, 8 deps outdated. Nothing to report is the report.

### la-homelessness-youth — 14 commits (8 human, 6 bot), 10 active days, 13 PRs

Maintained but `maintenence freq: None`, `Accepted Watch Conditions: ["no custom domain"]`,
served from `la-homelessness-youth.netlify.app`. **Zero site-specific commits.**

Its status is a deliberate anomaly and Tucker explained it on 2026-08-26:

> la homelessness youth is the original version of the site we liked better before the client
> asked to generalize the content, **we prefer linking to it as part of our portfolio**

So this is a _portfolio artifact kept alive on the fleet's infrastructure_, not a client
deliverable — which is why it has a GA4 property (500039567), CI, Renovate and smoke tests but
no maintenance cadence and no domain. The standing fleet rule that makes this work is that
`status=maintained` is what gates every sweep; to stop the reports without dropping the site
out of maintenance, the frequency is set to `None` rather than the status being changed.
Two `renovate` scheduled-workflow failures (08-05, 08-11) are the only red here.

### the-tower-burbank — 19 commits (9 human, 10 bot), 9 active days, 19 PRs

Airtable `building`, a rebuild of an `archived` row called _Tower Burbank_. **Zero
site-specific commits in the entire window** — every human commit is a sweep, and the repo's
only distinguishing event is being the one repo where the 09-05 journal sweep red CI on
prettier and needed a third commit.

It received the same 08-12 `chore(prismic): pull down remote-only custom types` treatment as
its sibling (`frozen_page` only; the-pointe-burbank also had `catalog_page`), and both failed
CI on branch `fix/pull-remote-only-custom-types` at exactly 22:24 on 08-12 — a paired failure
across two repos at the same minute, which is the signature of a two-repo sweep, not two bugs.

**State now:** last change 2026-09-05. Telemetry is almost empty because `building` sites are
outside the audit set: only `Default Branch CI: passing` and `Renovate Failing CIs: 0`. Two
open sharp-security PRs since 09-09.

### reddoor-md-pdf — 12 commits (5 human, 7 bot), 6 active days, 5 PRs

Not a client site: "A tiny SvelteKit app: paste markdown, get a Reddoor-branded PDF," hosted
on Render's free tier, mirroring `reddoor-starter`'s `pnpm export:rfp-pdf` pipeline. It has no
Airtable row at all — it is **infrastructure that lives outside the fleet record**.

Its whole window is one day of real work, 2026-08-10:
`Onboard reddoor-md-pdf to the maintenance loop: Renovate + CI + clear all 24 Dependabot
alerts (#1)`. Two details from that commit are worth carrying forward:

> Full lockfile regeneration with pnpm 11.8.0 (fleet-standard) resolves every alerted package
> at or past its patched version, **all within existing semver ranges — no direct dependency
> ranges changed** … brace-expansion 1.1.18 [runtime high, in-range refresh — **deliberately
> NOT the v5 widening Renovate sometimes proposes**]

and

> Dockerfile: pnpm 9 → 11.8.0 in both stages (**pnpm 9 does not read workspace-file
> overrides**, so its frozen install would reject the new lockfile)

Twenty-four alerts cleared by refreshing a lockfile, with the one trap Renovate reliably lays
— the `brace-expansion@<X to v5` override-key misread, the same family as the cookie
incident — explicitly declined. The CI job also sets `PUPPETEER_EXECUTABLE_PATH` to the
runner's Chrome "so real PDF rendering is exercised in CI", which is the instrument rule again:
the renderer test renders an actual PDF rather than asserting the code path was entered.

**State now:** last change 2026-09-05. One `workflow_dispatch` renovate failure on 08-10.
Two stale local branches from April. No fleet telemetry, because no Airtable row.

### reddoor-rfp-analyses — 3 commits (all human), 1 active day, 1 PR

The estimates archive: one folder per RFP, plus `_learnings/` post-mortems the `rfp-analyze`
skill reads to calibrate future estimates, plus `rfp-handbook.md` moved out of the public
starter because it is sales content. **Its only activity in the window is the 09-05
work-journal sweep.** No CI, no Renovate, no Actions runs at all. One dirty file at snapshot.

### rfp-analyze — 4 commits (all human), 2 active days, no remote

The Claude Code skill that produces the estimates that land in the repo above. No `origin`.
Two journal-sweep commits on 09-05, then on **2026-09-08 the only genuinely forward-looking
commits in this half of the cluster**: `docs(SKILL): rfp-handbook lives in the estimates repo,
not the starter's docs` and `docs: this repo is now a subtree of reddoorla/claude-skills`.
**This is also the single latest activity anywhere in the cluster** — everything else stopped
on 09-05.

### reddoor-mailer — 2 commits (both human), 1 active day, archived

Absorbed into `reddoor-maintenance` before this window. Its only window activity is the 09-05
journal sweep, which cannot be pushed. 1,341 dirty files, no README, a committed
`node_modules` mid-deletion. **This repo exists now only as a thing sweeps trip over.**

### the-pointe — 6 commits (5 human, 1 bot), 4 active days, archived

The original Blux/Prismic Pointe build, superseded by `the-pointe-burbank`. Received the
07-31 Renovate-cron sweep (pushed, as #29/#34, while it could still take one), then the 09-01
srcset fix and the 09-05 journal commits, **neither of which landed**. Seven local branches,
three worktrees, `main` four commits behind its own origin. Three CI failures, all in early
August, none since. Airtable's `The Pointe` row: `archived`, `maintenence freq: Yearly`, url
`thepointeburbank.com`.

---

## What the fleet record says, and what it does not

The Airtable operational record is unambiguous for every `maintained` site in this cluster on
2026-09-12: `Smoke OK: pass`, `Deploy status: ready`, `Default Branch CI: passing`,
`Uptime Reachable: pass`, `Titles & Meta OK: pass`, `Renovate Failing CIs: 0`. Deps outdated
range 8–14. Nothing is on fire.

Two things in that record deserve to be read carefully rather than at face value.

**The persistent high vulnerability.** Five sites read `Security Vulns High: 1` —
MSOT, Data Dynamiq, ERP Industrials, Vineyard, CalTex. Four of them have open Renovate
`sharp 0.35.4 [security]` PRs untouched since 2026-09-09, usually **two per repo** proposing
the same fix by different routes (`sharp to v0.35.4` at +120/−120 and
`sharp@<0.35.0 to ^0.35.4` at +307/−4). Nine such PRs are open across the cluster, three days
old at snapshot, and they are the only open PRs in the entire cluster. ERP and Data Dynamiq
carry the high alert with **no** open sharp PR — INFERRED, and consistent with the standing
finding that GitHub keeps a manifest in the dependency graph after the file is deleted, which
produces high alerts that no bump can clear. If that is what these are, the count will never
go to zero and the number is decoration.

**The two frozen tables.** `airtable-Submissions.json` contains 48 rows and **every one is
from 2026-06** — ERP 4, MSOT 4, Espada 6, Reddoor 5, Sonder 29. This is _not_ evidence that
no lead reached these sites in 45 days. Submissions moved to Turso under the hybrid-DB split
and Turso became authoritative on 2026-08-31; the Airtable table is a superseded shadow. **A
reader who treats this table as the lead record will conclude the forms are broken.** They are
not: MSOT, Vineyard, 1836dig and CalTex all read `Form E2E OK: pass`.

`airtable-Reports.json` holds 17 rows. Inside the window, three reports were sent, and **none
to any site in this cluster**: Sonder's July maintenance report (sent 07-31), five Beachfront
announcement test-sends on 08-24, and Sonder's August maintenance report (sent 09-01). The
cluster's last report was the 2026-07-06 announcement batch, before the window opened. This
is expected rather than a miss — the six quarterly sites have `Next maintenance at` dates of
2026-10-05, 10-25, 10-31 and 11-21 — but it is the mechanical reason these sites are quiet:
**the reporting cadence that produces client contact is quarterly, and no quarter turned over
during these 45 days.** The 17-row table may also be a partial export; treat the absence as
consistent with the schedule rather than as proof of it.

---

## Cross-cutting, for the downstream reader

**1. Fleet git sweeps and fleet audits are gated by different things, and they disagree.**
The git sweeps iterate a repo list: `the-pointe-burbank` and `the-tower-burbank` received
every one of the 08-02, 08-20, 09-01, 09-02 and 09-05 sweeps. The Airtable audits gate on
`Status == maintained`: both Burbank sites are `building` and carry only two populated
telemetry fields between them. So a repo can be fully swept and almost entirely unobserved at
the same time. `hedloc` sits in between at `launching` and gets more telemetry than `building`
but no maintenance cadence.

**2. A fleet template is authored once and formatted N times.** Three separate incidents in
one window — the Renovate App workflow (quoted YAML rewritten differently by singleQuote
repos), the prismic-ci workflow (erp's `singleQuote: true` on a fresh clone with no
`node_modules`), and the work journal itself (the-tower-burbank's markdown failing
`prettier --check`, twice, needing a third commit). The generalisable rule the fleet already
half-learned: **write sweep artifacts in the format-neutral form (plain YAML scalars), because
the consumer's formatter is a config you do not control.**

**3. Renovate's override-key misread is the single most expensive recurring class here.**
Twenty cookie PRs, three merged, one needing same-day repair, and a `brace-expansion` twin
explicitly declined in reddoor-md-pdf. What makes it costly is that the PR title of a
dangerous one and a correct one are the same shape: `cookie@<0.7.0 to v2` (wrong, widens the
cap past the kit-breaking major) and `cookie@<0.7.0 to v1` (right, aligns with the org preset)
are one character apart. The durable fix was not in any of these repos — it was the org
preset, `reddoorla/.github#19`, holding `cookie <2` centrally.

**4. Zero code review, 197 PRs.** `nReviews` is 0 on every PR in this cluster. Human PRs merge
at a median of 12 minutes; the only gate is CI. That is a defensible design for a
single-operator fleet, but it means **every claim in this cluster rests on a test suite, and
the test suites in this cluster demonstrably contain green checks that assert nothing** — the
frozen route's fidelity gate measuring a stale copy for an unknown period; a pipeline step
whose deletion failed nothing; a `toContain("&w=2400")` passing on a URL with the parameter
outside the quotes. All three were found by a human reading output or deliberately breaking
something, not by the suite.

**5. Bots outnumber product work 3:1 by commit, and 66% of CI is a scheduler talking to
itself.** 108 bot commits vs 34 site-specific. 913 of 1,495 runs are the `renovate` workflow
on `schedule`. The fleet's pass rate of 97.6% is measuring, overwhelmingly, its own
maintenance apparatus rather than anything a client would notice.

**6. The three unpushable repos are all in this cluster, and every sweep pays for them.** As
of 2026-09-12 there are unpushed commits sitting on `chore/work-journal` in `the-pointe`
(ahead 2), `reddoor-mailer` (2 commits), and `rfp-analyze` (no remote to push to), plus
`the-pointe`'s srcset fix stranded on `feat/prismic-capped-image-widths`. The operator's own
framing — "i feel like you consistently get hung up on archived repos, is there a way we can
fix that?" — is the correct read of a cost that had been paid at least four times by 09-05.

**7. What is not visible, and should not be reconstructed.** The 07-30 → 08-09 period is
git-only; the-pointe-burbank's entire re-freeze and design-review-round-2 work (2026-07-31,
+2,182/−79 in PR #4 alone) has no session record, and hedloc's 08-10 client sprint falls on
the wrong side of a boundary that cut mid-day. The commit bodies in those two repos are
unusually rich — measurements, sweeps, abandoned attempts — and they are, for that period,
**the only evidence that exists**. That is an argument for the commit-message discipline this
fleet already practices, independent of any journal.
