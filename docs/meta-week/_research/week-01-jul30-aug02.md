# Week 01 — 2026-07-30 (Thu) to 2026-08-02 (Sun)

> **This chapter is a RECONSTRUCTION.** Claude Code transcripts retain back only
> to **2026-08-10**. For this week there are **0 sessions and 0 prompts** in the
> corpus (`metrics.json.byDay` shows `sessions: 0, prompts: 0, toolCalls: 0`
> for all four days). Nothing here is sourced from a transcript. Everything is
> read from: git commit bodies in the local clones, the PR record
> (`prs.jsonl`), GitHub Actions runs (`runs.jsonl`), and Discord
> (`discord-messages.jsonl`).
>
> The single mitigating fact is that **this repo's commit bodies are unusually
> long and confessional** — many are 20–60 lines of prose stating the defect,
> the measurement, the mutation test and the belief that turned out wrong. They
> are the closest thing to a transcript that exists for this week, and where an
> agent's own first-person admission appears below ("I reported it shipped…"),
> it is quoted from a commit body, not from a session.
>
> **The work journal does not cover this week either.** `docs/workJournal.md`
> was opened on **2026-09-05**, and its first entry says so explicitly: "the
> journal starts today, so this entry is a deliberately coarse summary written
> from the commit log rather than from memory. Detail below this line is
> trustworthy; detail above it is not." Week 1 is above that line.

**Timezone note, because the sources disagree.** Commit timestamps in the
clones are **local (PDT, UTC−7)**. PR, Actions-run and Discord timestamps in the
corpus are **UTC**. Every time in this chapter is converted to **local**. This
matters more than it sounds: 29 PRs that the raw corpus files under "2026-08-01"
were actually opened on **Friday evening 07-31**, and a naive by-UTC-day reading
invents a busy Saturday that did not happen.

**Two source gaps to respect.** (1) `runs.jsonl` is capped at ~300 runs per
repo, so **reddoor-maintenance's run history only reaches back to 2026-09-04** —
there are **zero Actions runs for the central repo in this week**, and the
"0 runs on Thursday" line in the calendar below is a collection artifact, not a
quiet day. (2) `hedloc` has **no runs at all** in the corpus; the collector
errored on it (`gh-errors.txt`: `failed to get runs: .../reddoorla/hedloc/actions/runs`).

---

## CALENDAR

| Local day      | Commits | Repos touched   | PRs opened / merged | CI runs (site repos only) / non-success | Sessions | Prompts |
| -------------- | ------- | --------------- | ------------------- | --------------------------------------- | -------- | ------- |
| Thu 2026-07-30 | 15      | 2               | 3 / 3               | 0 / 0 _(collection gap)_                | **0**    | **0**   |
| Fri 2026-07-31 | 84      | 22              | 47 / 43             | 61 / 3                                  | **0**    | **0**   |
| Sat 2026-08-01 | 3       | 3               | 1 / 1               | 25 / 1                                  | **0**    | **0**   |
| Sun 2026-08-02 | 36      | 24              | 69 / 25             | 102 / 13                                | **0**    | **0**   |
| **Week**       | **138** | **25 distinct** | **120 / 72**        | **188 / 17**                            | **0**    | **0**   |

All 138 commits are authored `Tucker Lemos` except one: `the-pointe`
`9cdec8c9`, authored `Renovate Bot` on 08-01. Every one of the 120 PRs is
authored `tucksravin`. **There is not a single `reddoor-renovate[bot]` commit in
this week** — the first one lands 2026-08-03, which is the point of Sunday's
work and the subject of the last beat.

**Thu 07-30** — 12:08 to 19:56. Two repos only. Three central PRs
(#469 report-cron credentials, #470 dead dashboard script, #471 approve-button
states), then the entire evening in `claude-skills` scaffolding the
`matching-a-page` page-diff harness — 11 commits between 16:37 and 16:52,
then two more at 19:07 and 19:56.

**Fri 07-31** — 10:36 to 22:29, the week's spine. 84 commits across 22 repos.
Morning: `gallerysonder` remediation (#59 newsletter, #61 cookie dialog, #60
hero) and the fleet smoke fix (#472, #473, 1836dig#1). Midday: the header-image
generator, designed and shipped inside one working day (#476, 16 commits,
+3474/−19 over 27 files). Afternoon: blux freeze fixes (#474, #475) feeding
`the-pointe-burbank`'s re-freeze. Evening: the auto-merge governance sweep
(.github#11 then #12, central #478 and #480) fanning out one-line CI/Renovate
changes to 15 site repos.

**Sat 08-01** — 3 commits, 08:09 to 13:40. The only working commit is
`9a11507d` (a11y real-route scanning) on a branch; `b4766c2f` is Friday night's
gallerysonder PR merging at 08:09, and `9cdec8c9` is Renovate. The day's real
output was **not committed anywhere**: two later commit bodies record that a
protection sweep was applied **by hand** this day, finding "six repos uncovered,
one with no protection at all," and that `.github` "sat with zero protection
until 2026-08-01."

**Sun 08-02** — 10:28 to 21:16. 36 commits, 24 repos. Morning: the a11y route
opt-in lands (#481); the ruleset self-healing + nightly protection alarm lands
(#483, +1459/−0); Renovate moves to a GitHub App (#484) and fans out to 19
repos. Afternoon/evening: page-diff harness hardening, `ulti-grid` rewrite,
the protection sweep widened (#486), the ci.yml clobber disarmed (#487).

---

## BEATS

### 1. A dashboard that rendered perfectly and did nothing (Thu, #470)

The per-site operator dashboard had every control dead. Approve, both override
controls, Trigger Renovate, the site-details selects — none of them had a
handler attached, and had not for some unknown period.

The cause is a single character. In `renderSiteDashboardHtml`, the line
`b.title = data.blockers.join("\n")` sat **inside a TypeScript template
literal**, so `\n` was consumed at build time and a literal newline was emitted
into the served HTML, inside a string literal. The browser refused to parse the
entire `<script>` element.

What makes this the week's cleanest specimen of the house rule is the commit
body's own accounting of why nobody noticed:

> The failure was invisible by construction. The button rendered enabled (the
> health gate was clear and approveBlockers was empty — both correct), the
> preflight chip was green, and the click did nothing at all. Server-side
> everything checked out: the endpoint is deployed and path-routed, its env is
> present, CSRF allows same-origin and rejects cross-site. Nothing anywhere
> reported an error, because a parse failure in an inline block is silent
> outside devtools.

Every instrument pointed at this page was green, and every one of them was
measuring something real — just not the thing that was broken. The fix took
3 minutes wall-clock from PR open to merge (22:39→22:42 UTC). The _guard_ is
the valuable part: a test that extracts every inline `<script>` from every
dashboard page and compiles each with `new Function`, **and asserts a block was
actually found**, "so a renderer that stops emitting one can't make the test
vacuously green." It was run red first: it failed on both site-dashboard cases
and passed on cockpit + submissions, which is what localised the bug.

Cost of the trap recurring: the follow-up PR #471, 21 minutes later, adds
approve-button states and its body carries a standing note — "All CSS additions
avoid backslash escapes and the comments avoid backticks — both would break out
of the enclosing template literal, which is exactly what killed this script
block in #470." The #470 body also records that **the first attempt at the fix
failed to compile** because the explanatory comment itself contained backticks.

### 2. "Name the gap when it has none" (Thu, #469)

The daily report cron drafted reports with blank Google Analytics and Search
Console numbers. `daily-reports.yml`'s drafting step passed only
`AIRTABLE_PAT` + `AIRTABLE_BASE_ID`; **no GA credentials existed anywhere in
`.github/workflows/`**, so `readGaConfig()` returned null on every scheduled run
and both fetches took their not-configured early return.

The downstream silence is the point. `analyticsSection()` renders `""` with no
data, so the **entire ANALYTICS section vanished from the client email**; the
maintenance template fell back to the bare "Google Indexed" label instead of
"Page 1 Google Result (#N)"; and the dashboard rendered a bare amber "needs you"
pill with an empty note. It was found on Sonder's 2026-07 maintenance report —
Search Console in fact had the site at **#2**.

The design response is the one worth carrying forward: `fetchSearch`'s single
skip was split in two. An un-enrolled site stays a true skip. An **enrolled**
site with no credentials becomes `notConfigured`, and the evidence record emits
an honest `unknown` naming the environment gap rather than vanishing. The flag
was made **required, not optional**, so the compiler forces every construction
site to state which case it is — "it caught the no-IO render path immediately."

_(Forward note, MEASURED and outside this window: this same file is the subject
of CLAUDE.md's 2026-08-12 lesson, where a CI gate built on `report --preview`
reported "GA credentials did not resolve" twice with total confidence while
doing no IO at all. The credentials were fine. The instrument-proving rule in
this repo was written out of that later failure, not this one.)_

### 3. A page-matching harness scaffolded in 11 minutes, then spent four days being wrong (Thu evening → Sun, `claude-skills`)

At 16:37 Thursday the `matching-a-page` skill is scaffolded; by 16:52 there are
**11 commits** — PNG crop/composite utils, per-region perceptual diff
(pixelmatch + mean ΔE), DOM-section splitting, deterministic capture, a
computed-CSS dump, a ranked report, the CLI, and the SKILL.md. Eleven commits in
fifteen minutes is not eleven units of thought; it is one design executed as a
scripted commit sequence.

Everything after that is the harness being corrected by contact with real work,
and the corrections are all of one kind: **the instrument rewarded the wrong
answer.**

- **07-30 19:07, `--neutralize-media`.** A per-region frame-diff cannot measure
  a region backed by a moving video: "two independently-decoded players never
  land on the same frame (live players often ignore programmatic seeks), so the
  mismatch stays high however faithful the build." Proven on the Beachfront
  rebuild, whose hero is an autoplay flyover.
- **07-30 19:56, rule 1 sharpened.** "computed color on img/svg lies" — hard-won
  on the Beachfront hamburger (cyan from a computed `<img>` color that wasn't
  the rendered pixels) and the hero wave (`rotate(180)` lived on the parent
  wrapper, invisible in the child svg's computed box).
- **07-31 13:38, the Definition-of-Done gate.** This is the agent confessing in
  its own commit body: _"after a mobile-only pass on a build, I reported it
  shipped without ever re-running the desktop diff — and desktop was still at
  50% on a region I'd 'fixed'. The harness had caught it the instant it was run;
  what failed was discipline."_ The gate now states that "the reference (a
  page-diff PASS) is the definition of done, not the user's verbal defect list."
- **07-31 18:11, the pixel floor.** The same source photo served through a
  different image pipeline (CMS re-export, different CDN, `?auto=format,compress`)
  differs by a uniform **~10–15 ΔE** of resampling noise — "enough to pin a
  region at 30–55% mismatch even when crop/box/position are pixel-aligned." The
  skill now requires confirming it by provenance _and_ fixing all the chrome
  underneath first, "so the floor isn't used as an excuse to skip real bugs."
- **07-31 22:29, the worst one.** Scroll-reveal animations run 1–3s; shooting
  500ms later captured the reference at **opacity 0.44–0.89** with an unfinished
  `translateY`. Consequence, stated plainly: _"faithful work scored as mismatch
  and a near-white wash tuned to the faded frame scored as a match."_ An
  instrument that actively pays out for the wrong build. Fixed by waiting 3s +
  `document.getAnimations()` settling.
- **08-02 10:28, the demotion.** Pixel diff is moved from the top of the pyramid
  to **L3**, because it "structurally cannot see small text in big regions (a
  missing footer legal line never moved a region over threshold) or opacity-0
  interaction states (in either direction)." A new L1 content-parity gate
  (`text-diff.mjs`) multiset-diffs rendered text; the order becomes
  L1 content → L2 geometry → L3 pixels → L4 hover/click state probes.

**The belief corrected on contact:** the harness was built on the premise that a
perceptual pixel diff is the ground truth for "does this match." Four days of
real use established that it is the _third_ most reliable layer, and that in at
least two named conditions it scores backwards. Nothing in the original eleven
commits could have found that; only the Beachfront and Webflow rebuilds did.

### 4. Three retractions in one repository (Fri, `gallerysonder` #59–#68)

Eleven PRs landed on gallerysonder between Friday 10:36 and Saturday 08:09, all
from what the commit bodies call "the outstanding-work sweep" and "the external
site audit." The interesting thing is not the volume. It is that **three
separate claims made inside this sweep were retracted by the same sweep.**

**Retraction one — the hero fix that was wrong about its own cause (#60, 88
minutes open).** Commit one removed a `translate-y-[22%] lg:translate-y-[18%]`
offset from all 24 hero text elements and verified it: "4 routes × 5 breakpoints
(375/768/1440/1920/2560): every hero measures pastWrap=0, no overhang anywhere."
Commit two opens _"Replaces the previous commit's approach."_ Removing the
translate left the letters ~0.2em short of the edge — that dead space is real
(half-leading plus descent) and the nudge had been correcting for it. The actual
bug was the **unit**: a percentage in `translate` resolves against the element's
own border box, which for a heading is `lines × line-height`, so a wrapped title
got nudged two or three times too far. Measured, homepage at 900px tall,
baseline to screen edge: `390px 3 lines −25.6px`, `1440px 2 lines −17.2px`,
`1280px 2 lines −14.2px`, `1920px 3 lines −45.3px`. The replacement is
`calc(0.5lh - 0.3333em)`, where `0.3333em` is (ascent − descent)/2 for
commuters-sans; the same 24 elements now land within **0.16px** of the edge at
six widths, wrapped or not.

**Retraction two — "nothing links to them" (#62, 275 minutes open).** Commit one
404s 15 roster-stub artist documents and drops them from the sitemap (64 URLs →
49; artist URLs 34 → 19), on the stated basis that nothing links to them.
Commit two: _"My earlier claim that nothing links to the roster stubs was wrong:
the reference scan behind it enumerated document types by hand and left out
`artwork` — 198 documents, more than the rest of the repo combined."_ Every one
of the 15 stubs is the target of at least one artwork's `artist` relationship,
so the change had converted an empty page into a **broken** one, reproduced on
`/exhibitions/keeping-things-whole` where four artworks credited a now-404 page.

**Retraction three — the test that was vacuous, twice (#62 again).** The
lightbox test added in commit two "passed vacuously — the tile clicks silently
failed and it asserted over an empty list, so it went green while four dead
links sat on the page." Three page-specific hazards were fixed. Then commit
three, from a five-lens adversarial review, finds it **still vacuous**:
`linked` was always `[]`, because the gallery truncates to four tiles behind a
"Show More" button that gates on loop index rather than scroll — and on that
exhibition all four visible artworks credit stubs, while the two that _do_ get a
link sit at index 4 and 5, behind the button. The test "still caught a straight
revert of the Lightbox guard, but the link branch never ran."

That same review also killed a product hole: the 404 was skipped whenever an
`io.prismic.preview` cookie was present, keyed on **mere presence**, so a
hand-set `io.prismic.preview={"_tracker":"abc123"}` returned **200** with the
three empty `<h1>`s the branch existed to remove.

**What this costs, stated as workflow:** a fix, a wrong justification for the
fix, a test that certified the fix while testing nothing, and a review that
caught both. Four rounds on one PR. The corrective the repo adopted is visible
in the third commit's new test — instead of enumerating the four channels that
can emit an artist URL (the enumeration is what went wrong), it **crawls every
sitemap page's rendered HTML for `/artists/` hrefs**. Read the output, don't
enumerate the inputs.

### 5. The nightly smoke suite had been failing 9 of 11 sites behind a green run (Fri, #473)

`playwright.config.ts` resolves `tsconfig.json`, which extends the **generated**
`./.svelte-kit/tsconfig.json`. The fleet smoke audit clones fresh, runs
`pnpm install --frozen-lockfile`, then `pnpm test:smoke` — and no fleet repo
carried a `prepare` script, so nothing ever ran `svelte-kit sync`. Playwright
aborted while loading its own config, **before running a single test**.

The concealment mechanism is the part to keep:

> Nine of eleven live sites were recording Smoke OK=fail for this reason. It
> stayed invisible because `fleet-smoke.yml` gates on `FLEET_WRITE_SUMMARY`,
> which counts rows **WRITTEN**, not rows **passing** — a failing site is still
> written, so the nightly reported success throughout.

A green nightly that means "all measured," not "all passed." The fix was placed
centrally rather than as 11 per-repo `prepare` scripts ("one change covers every
site, and AUTONOMY.md makes multi-repo mutations a human-reviewed operation")
and verified **A/B on a cold clone of data-dynamiq**: smoke fail before, smoke
pass after. The same day, `1836dig` got the suite at all (#1) with its own
cold-tree verification.

Its sibling, #472, is the same disease in the form-e2e probe: the probe
hard-coded `/contact`, which 404s on a one-page site, so the audit recorded
`formPresent:false` — _"checked, no contact form"_ — a verdict that is **n/a
rather than a failure**, "so nothing went red and the site's only conversion
path sat unmonitored while the cockpit looked clean." 1836dig, launched that
day, is exactly that shape.

### 6. The header-image generator: design, plan and ship inside one working day (Fri, #476)

Design doc committed 11:45, implementation plan 12:36, first code 12:41, PR
merged 14:49. Sixteen commits, **+3474/−19 across 27 files**, four minutes from
PR open to merge.

The motivating number is in the design doc: **34 of 44 Websites rows have no
header image**, which hard-fails preflight ("the send will throw") and was
blocking 1836dig's launch report. Measured cost of automating it: ~4.3s warm
capture + 184ms composite → 57 captures/year across the fleet, "~4 minutes of
compute annually."

Four things in this PR are worth a downstream reader's attention, and three of
them are instruments failing.

**The geometry was wrong and content-based detection could never find it.** The
plan shipped `SCREEN = x282 y1856 w1394 h871`, "confirmed 16:10 to within 0.03%
by a density-profile diff of two real headers." Thirteen minutes later it was
retracted: that rect spans the laptop's outer panel — covering the bezel on
three sides while falling **~29px short at the bottom**, so the plate's baked-in
ERP screenshot survived as a visible strip under every site's content. The
correction names why the first method was structurally incapable: "a
screenshot's own dark or flat regions read the same as the frame. The bezel can:
it is perfectly flat black (luminance 0.0) and content-independent." Correct rect
`x=302 y=1913 w=1349 h=844` (aspect 1.5983), cross-checked by the
photo-to-flat-black transition landing at y=2756, exactly y+h−1.

**A dist gate that could not fail.** `test:dist`'s loader check "cannot catch a
missing dist copy. The walk-up resolver prefers the `src/` layout, which exists
in this checkout and never ships." Proved by **deleting**
`dist/reports/header-image/assets/plate.png` — the `loadPlate` ENOENT check
**still passed**. Replaced with a direct `existsSync` assertion per shipped
asset, re-verified two ways (against a dist with the plate removed, and with the
tsup copy disabled).

**A feature that would have looked shipped while never once running.**
`daily-reports.yml` — the workflow where the draft-time header refresh actually
executes — **installed no browser at all**. `chromium.launch()` would have thrown
every night, "and because `refreshHeaderImage` swallows its errors by design,
the feature would have looked shipped while never once running." The
best-effort-by-design choice that makes the feature safe is the same choice that
makes its absence silent.

**Typography solved by sweep, not by eye.** Initial values (size 62, weight 300)
"rendered visibly small and light next to the hand-made headers. Rather than
eyeball it, swept sizes 62–88 at weights 300/400 and compared the rendered ink
box against Sonder's original. Exactly one combination matches: size 80, weight
400, baseline 3020, x 280 … with dx=0 dy=0 dw=0 dh=0."

And one measurement that made it into the fleet's standing memory:
`waitUntil: "networkidle"` **never fires on 4 of 14 live fleet sites** (ERP
Industrials, Vineyard, Revogen, 1836dig — chat widgets, analytics polling,
websockets hold connections open), so `page.goto` threw and those sites could
never get a header image at all. `load` succeeded 14/14 in **346–1205ms**.

The last commit is a self-inflicted cost worth naming: task 10's draft-time
refresh gate was `base !== null`, and `draft.test.ts` passes a _fake_ base — so
all 38 cases opened the refresh and paid a real chromium launch plus a failing
DNS lookup each. Nothing went red, because the refresh swallows its errors.
"The suite just went from milliseconds to **11.54s**." Fixed to ~0.25s with an
injected opt-out, pinned by three wiring tests in both directions and verified
by mutation.

### 7. A workaround, its upstream fix, and the deletion of the workaround — in eight hours (Fri, #474/#475 → the-pointe-burbank #5)

13:42 — `the-pointe-burbank` lands design-review round 2 and a refactor so the
offline gate renders the production artifact rather than a copy.
14:11 — it commits `docs(frozen): mark SPACER_SLOTS as temporary, pending the
upstream freeze fix`.
14:24 and 14:25 — the two upstream fixes merge in central.
16:24 — maintenance 0.76.0 releases (#467).
21:04 — `the-pointe-burbank` #5 re-freezes on 0.76.0 and **deletes**
`SPACER_SLOTS` and `restoreSpacerSlots` rather than updating them.

The upstream defect (#475) is a good one. A page builder emits blank rows as
content — a list item holding `&nbsp;` — and the freeze tokenized those like any
other text leaf, turning layout into a Prismic Rich Text field. Rich Text cannot
store a whitespace-only value: it round-trips to `""`, the row collapses to its
padding, "and the page silently loses a line of vertical rhythm." Measured cost:
**24px of footer on the-pointe**, between "Lic. 00852254" and the next contact
block. And the reason the obvious guard didn't catch it: `rawText.trim()` "could
not see this: for a `&nbsp;` leaf it trims to the literal string `&nbsp;`, which
is not empty, so the leaf looked like copy." Deciding on the **decoded** text
catches `&nbsp;`, `&#160;`, `&#xa0;`, `&emsp;`, `&thinsp;` and a raw U+00A0 at
once. Verified by round-tripping the real artifact: 94 tokenized leaves become
93, the dropped value is `" &nbsp;"`, 5 keys shift (h.t12–h.t16) in 1 of 15
sections.

The re-freeze PR then names its own dangerous edge honestly: dropping the spacer
renumbers slot keys, "so the committed template and the PUBLISHED Prismic
document disagree until the migration release is republished — **silently**.
Nothing errors; the footer just renders the right words in the wrong places,
losing '818.502.6707' and 'A Property Within' and growing a stray
'[email protected]'." The guard is a gate spec that is **red on purpose** until
the release is published, because deploying while it is red ships the scrambled
footer.

It took **249 minutes and three CI failures** on `frozen/refreeze-0.76`
(23:55, 02:09, 02:47 UTC) to land. It closes with a fidelity number: the offline
render matches production on **110 of 110 element boxes at both 1440 and 390**,
page heights 14811 / 15583.

Round 3 of the same PR is the best example in the week of _measuring the thing
the client actually sees_. Five of Nicole's eleven open Figma comments, each
measured as **ink, not boxes**: the rule-mark gaps "read 10 and 34.5, but the
painted rows were 18 above and 45.5 below, because the eyebrow's descent space
and the 50/70 heading's leading overhang both hide inside the box model." And
because `.rd-rule-box` is inline-block, a top margin closes the gap from both
sides at once, so it was **swept rather than solved**: margin 0 → 18/45.5,
8 → 26/37.5, 12 → 30/33.5, **14 → 32/31.5 ← even**. Same method on the
Incentives button gap: padding 40 → 49.3px visible white, 20 → 29.3, **15 →
24.3 ← half**. And one first-attempt error caught by reading computed styles
back: targeting the wrapper instead of the `.blocks0container` "added a second
outer 8%, narrowing the copy column by 28px and reflowing it."

The one piece of pure waste in the episode: PR #6, `chore: drop a scratch
screenshot committed by mistake` — `gap11-crop.png` "landed in the repo root
because the probe script ran with the shell cwd reset there, and a `git add -A`
swept it into the commit." That is the `git add <paths>` not `-A` lesson being
re-learned at the cost of one PR.

### 8. A fix that could not work, shipped as a fix, and corrected 2h36m later (Fri evening, `.github` #11 → #12)

This is the week's textbook instance of the repo's cardinal rule, and it is
worth the downstream reader's full attention because the _first_ PR is honest
about being a guess and ships anyway.

**17:03 — .github#11.** Six fleet repos were found with an
`actions/checkout` v4→v7 PR — Renovate's own body labels it `major` — sitting
with GitHub **platform auto-merge ENABLED**, one rebase away from landing
unreviewed across the fleet. The commit body says: "The major rule has carried
`automerge: false` since the preset's first commit, so config drift does not
explain it and **the enablement path was not reproduced**. Rather than guess at
the mechanism, state the intent explicitly." `platformAutomerge: false` is added
to the majors and graph-reshaping rules. Merged in **0 minutes**.

**19:39 — .github#12.** _"`platformAutomerge` was still true in the two places
that actually used it — `packageRules[0]` (patch/minor) and
`lockFileMaintenance`. The earlier change only touched the majors and
graph-reshaping rules, which never used it, so **it was inert against the real
path**."_

A fix that had never been shown to change any outcome, merged instantly, and was
in fact a no-op on the only paths that mattered. Two and a half hours of false
safety. The same PR then finds the deeper truth — no Renovate config can prevent
a flag someone else sets, because platform auto-merge "is a per-PR flag any
write-access account can arm" — which is what makes central #478 the real fix:
`self-updating` now **disables** `allow_auto_merge` at the repo level and
reports the correction as an action, "a drift alarm rather than a drift source."
Merges move _inside_ Renovate's own run, where the packageRules actually govern.
Which in turn is why the cron went from weekly to twice daily across 15 repos
that evening: **the cron is now the merge cadence, not the PR-creation cadence.**

#12 also catches a second silent no-op that had nothing to do with the incident:
the preset's schedule said `before 11am on monday` against a cron that starts
hours late, which "produced **zero routine PRs fleet-wide on 3 of the last 6
Mondays**." Widened to 6pm with an explicit UTC timezone.

**And one more, an hour later (#480).** `templates.ts` pinned the shared
`ci.yml` at `@78c4da64` (v1.0.0) while all 12 fleet repos carry `@4a32c3d0`
(v1.3.0). "Running `sync-configs` would have regressed every repo's CI by three
minor versions — past the v1.3.0 fix bumping `pnpm/action-setup` for the pnpm
11.12+ self-installer break, which is exactly the class of breakage that pin was
meant to prevent." The body names its own lineage honestly: "Same class as the
mutable `actions/checkout@v4` ref fixed in #478; **that change only covered the
refs it was briefed on and missed this one.**"

Three PRs in one evening, each fixing the previous one's blind spot. The pattern
is not carelessness — it is that a briefed scope becomes the boundary of the
search, every time.

### 9. The quiet Saturday, and a "queue is empty" that was a pagination default (Sat 08-01)

Three commits, one of them a bot. But two commit bodies written the next day
record what actually happened on Saturday, and it was not committed:

- "every hand-applied ruleset sweep regrows its gap at the next onboard
  (**2026-08-01: six repos uncovered, one with no protection at all**)"
- "`.github` (no Airtable row) sat with zero protection until 2026-08-01"

So Saturday was a **manual** fleet protection sweep done through the GitHub UI or
ad-hoc `gh` calls, leaving no repository trace. That is a visibility hole in this
corpus and, by the next day's own argument, in the workflow: the fix that landed
Sunday exists precisely because a hand sweep "regrows its gap at the next
onboard."

One more Saturday artifact, recorded inside Sunday's #483: the new
`listOrgRepos` wrapper is `--paginate`, and the reason is named — "the
30-per-page default is the trap behind the **2026-07-31 false 'queue is empty'**."
An agent asked GitHub for the org's repos, got page one, and reported the queue
clear. Same shape as everything else this week: a query that returned
successfully and answered a narrower question than the one asked.

### 10. The a11y audit had never scanned a real page (Sun, #481 + gallerysonder#68)

> The a11y audit only ever axe-scanned two synthetic fixture pages,
> `/dev/a11y-fixtures` and `/dev/animate-in`. **No real page was ever checked.**
> That is how five production pages on gallerysonder shipped a hero `<img>` with
> no alt attribute — axe rates it critical — with CI green the whole time.

A gate that had been green for its entire life over a surface that contained
none of the product. The fix is deliberately **opt-in** (`package.json#reddoor.a11yRoutes`),
and the reasoning is a good model of fleet-scale restraint: "the shared CI
workflow runs this audit with `--fail-on-violations` and most of the fleet
carries pre-existing accessibility debt, so switching everyone over centrally
would red every repo at once. A site adopts it once its own routes are clean —
gallerysonder's are, verified at **0 violations across 11 routes**." Real routes
are scanned **in addition to** the fixtures, because the fixtures exercise
design-system components in isolation, which no real page covers.

gallerysonder's side of it (#68, open 597 minutes — Friday 22:12 to Saturday
08:09, i.e. overnight) adds two limits _measured rather than assumed_, which is
the difference between a gate and a claim:

- "axe does **NOT** catch the empty-href class of bug. Reintroducing GridImage's
  `href=""` leaves all ten a11y tests green — that problem lived in axe's
  needs-review bucket, which this gate reports but does not fail on."
- Growing the route manifest surfaced that `/rsvp/*` pages "render no nav and no
  footer at all, so a visitor arriving from an invite has no route into the
  site. Left as-is — that is a design decision, not a bug — but recorded."

**Honest accounting, MEASURED, six weeks later:** this feature's summary line was
still wrong on **2026-09-12** — `9f5fc898 fix(a11y): the summary counts the
routes that ran, not the fixture defaults (#770)`, tracked as #697. The gate
worked; its self-report did not, for six weeks.

### 11. An alarm that shipped dead in its own wiring (Sun, #483 → #486)

#483 is the week's largest single addition: **+1459/−0 across 13 files**, merged
**3 minutes** after the PR opened. It adds ruleset self-healing plus a nightly
org-wide protection-coverage sweep with its own tracking issue.

Its fifth commit is the one to read. A four-lens adversarial review produced 12
confirmed findings deduplicating to 6 defects, and the first is described in the
body as "**the exact silent-green class this feature exists to kill, in its own
wiring**":

> the fleet-security protection step piped through `tee` without `pipefail`
> (Actions' default shell is `bash -e {0}` — no pipefail), so the audit's
> `exit 1` was **swallowed forever**: the gap issue could never file AND the
> "clean sweep" close step ran every night, converting real standing alarms into
> false "Recovered" closes.

Three of the six defects "shipped the alarm dead." The others are the same
family: an empty `RENOVATE_TOKEN` in CI took the CLI's local-dev clean-skip
(exit 0) and read as a clean sweep; `rulesetGaps` ignored
`conditions.ref_name.exclude`, so `exclude: ["refs/heads/main"]` neutralized an
entire ruleset while reading **zero gaps** (heal no-op, audit COVERED); and
`listRepoRulesets` fabricated a `NaN` row from a tab-less output line. The
auto-close now requires the literal `PROTECTION_AUDIT gaps=0` machine line —
**positive evidence of a verified sweep, never step outcome alone.**

Also recorded, and worth its own line: `updateRuleset` uses **PUT, not PATCH**,
because "PATCH 404s on this endpoint, verified live 2026-08-01 — a PATCH
implementation would silently no-op every heal."

Five hours later, #486 widens the same sweep, and its own first commit gets an
adversarial pass that finds four more defects, the headline one being the same
disease again: liveness was judged on run **existence**, "so a revoked App key
(every cron tick creates a fresh FAILING run) read as covered forever." Now
filtered to `status=success`. The first live widened sweep found **two never-run
repos** (beachfront-dentistry, the-tower-burbank) and **two 5–6 days stale**
(canvas-starter, the-pointe-burbank), and closed at
`PROTECTION_AUDIT gaps=0 covered=19 skipped=8 total=27`.

One design detail here is the best single idea of the week for a downstream
reader: the two known-pending gaps got an `ACCEPTED_GAPS` list that is
PR-reviewed, repo+surface-scoped, reasoned, and **expiring (2026-08-16)** —
reported as SKIPPED with the annotation, never as covered — because the
alternative "would have commented the tracking issue nightly, **training the
channel to be ignored**."

### 12. Renovate becomes a GitHub App; two repos red on a prettier setting (Sun, #484/#485)

The motivation in #484's body is precise about what a shared human credential
costs: `RENOVATE_TOKEN` was Tucker's own PAT, so "the audit trail cannot tell
Renovate from a human (**the 2026-07-26 unreviewed-major forensics took hours
for exactly this reason**), a fleet-write credential rides every cron run, and
27 repos' schedules drain the operator's personal API quota."

**The hard human dependency is stated in the first line of the commit:** "DRAFT
until the operator creates the App (`docs/runbooks/renovate-app-identity.md`,
Phase 1, ~20 min, **cannot be done headless**) — one `__RENOVATE_BOT_UID__`
placeholder is filled at finalize." The PR sat 31 minutes between open and merge
while a human clicked through GitHub's App creation UI. Everything downstream —
19 site-repo PRs in 22 minutes, 18:11 to 18:33 UTC — was blocked on that.

Then the rollout hit a divergence nobody had modelled. **gallerysonder and
erp-industrial red their CI** because their prettier configs use `singleQuote`,
so the template's double-quoted `cron` / `RENOVATE_USERNAME` /
`RENOVATE_GIT_AUTHOR` got flagged — "while quoting them the other way would flip
the failure onto the 19 shared-config repos." The resolution is elegant and
small: **plain YAML scalars have no quotes for either config to normalize**,
making the canonical bytes prettier-config-agnostic. Verified by YAML-parsing
both forms deep-equal (the cron stays the string `"0 */12 * * *"`; brackets in
bot names are legal mid-scalar in block context).

Timing, MEASURED: erp-industrial#38 opened and failed CI at 11:16 local; central
#485 (+6/−6, 2 files) opened 18:48Z and merged 18:51Z; erp-industrial#38 merged
at 18:51Z, 35 minutes after its failure. **the-pointe did not recover** — it
failed twice (11:28 and 11:47 local) and its PR #35 was closed unmerged at
12:14. `the-pointe` is one of the fleet's archived repositories (per CLAUDE.md),
and it is the only repo in the 20-repo sweep left behind. _(MEASURED: #35 closed
unmerged after two CI failures. INFERRED: that it was left behind deliberately
rather than retried — no retry PR exists in the corpus.)_

**A second, smaller rework of the same shape, the night before.** PRs titled
`chore(deps): bring ci, renovate and node refs to fleet-current` were opened
across the fleet. Vineyard's merged (+4/−4, 3 files). The identical PRs in
`the-pointe` (#33) and `la-homelessness-youth` (#10) were **closed unmerged 11
minutes later** (+9/−3, 1 file each) and replaced by a narrower
`chore(ci): run renovate twice daily and pin checkout to v7` (+2/−2, 1 file),
which merged in 3 minutes. _(MEASURED: the sizes, the closes, the 11-minute gap.
INFERRED: the broad change did not apply to those two repos' divergent workflow
files. The abandoned `chore/fleet-current-refs` branch was deleted on close and
no longer exists locally, so the cause cannot be read from the repo.)_

### 13. The armed clobber, and what the week left running for Monday (Sun evening, #487)

The last central PR of the week removes something rather than adding it, and the
reasoning is the best argument in the corpus for _not_ centralising a config:

> Every live fleet `ci.yml` carries per-site values (netlify-site, node-version,
> permissions) that the bare canonical template lacked, so any content heal was
> an **ARMED CLOBBER**: a green, auto-mergeable PR stripping those values —
> fleet-wide once `new-site` started invoking `self-updating` at bootstrap.

The self-healing machinery built over the preceding two days would, at the next
bootstrap, have quietly deleted every site's own CI configuration via a PR that
passed every check. The ci.yml template is deleted entirely, ownership is split
(the starter clone provides the shape; Renovate's github-actions manager bumps
the pinned reusable-workflow ref), and **a tripwire test now fails if anyone
re-adds a ci template.** A review finding in the same PR catches the
documentation half: five surfaces still promised that `self-updating`
bootstraps "CI + Renovate," so "an operator with a broken ci.yml would run
`self-updating` expecting a restore and read the no-op as a heal."

The second half of #487 is a one-line joke with a real point: "the brain that
updates the fleet never updated itself (**zero Renovate PRs ever**)." Renovate
is planted on the central repo, on the same App identity, for the first time.

**And the bill arrived the same evening.** The cadence change (weekly → twice
daily) and the App identity together meant Renovate started running on Sunday
night. Between 18:26 and 20:25 local on 08-02, **8 CI failures across 7 repos**
on branches named `renovate/typescript-7.x`, `renovate/cookie-0.7.0-2.x` and
`renovate/sveltejs-vite-plugin-svelte-7.x`. On Monday 08-03 — outside this
window, but the direct consequence and MEASURED — the corpus records **257
Actions runs, the highest single day of the entire seven-week corpus** (next
highest: 160), and `.github` takes **five emergency Renovate holds in under
three hours** (07:37 TypeScript <7, 07:56 cookie <2, 08:12 vite-plugin-svelte
<7, 10:39 pnpm hold widened past `depType`, 10:52 `@libsql/client` held at
0.8.x).

That is the honest accounting for the week: the Renovate governance work was
correct, well-reasoned and well-verified, and its immediate effect was to
convert a weekly trickle into a flood that needed five hand-written holds to
survive. Nothing in the week's design work anticipated that the ecosystem had
three simultaneous majors waiting (TS 7 / cookie 2 / vite-plugin-svelte 7) that
the fleet structurally could not take.

### 14. What Tucker was doing while this ran

There are no prompts, so the only direct record of the operator's own words this
week is Discord. Two things stand out.

**He was not in the code.** Across 07-30 to 08-01 his Discord traffic is
entirely client and internal scoping — hedloc copy revisions, Vida Legacy
donation-page architecture, and a long Sonder estimate thread with Nicole and
Tim. On the one technical call he makes, it is a judgment an agent should never
make alone: _"I'm not going to ever build something by hand that takes financial
information, we don't want that liability."_

**And he says out loud what the week's shape implies.** Friday 11:09 local, in
`#sonder`, asked for an hours estimate:

> "my hours are really weird now, because a lot of it is having claude running
> in the background and being available to answer questions, review what's going
> on, I'm going to mostly budget time by days more than anything else"

That sentence is the workflow. 84 commits across 22 repos on Friday, and the
operator's self-description of his role in it is "running in the background …
available to answer questions, review what's going on."

**Where he actually had to be present, MEASURED:** the GitHub App creation
(#484, ~20 min, "cannot be done headless"), and the two `chore(release): version
packages` PRs — human-merge-only under the merge-authority policy — which sat
**2318 minutes (38.6h)** and **1529 minutes (25.5h)** respectively. Those two
numbers are the week's clearest measure of where the loop waits on a person:
not on review of the work, but on a release button.

### 15. One measurable, unexplained change in the middle of the week

Every central-repo commit through Sunday 10:28 carries
`Co-Authored-By: Claude Opus 5 (1M context)` (12 merged PRs: #469–#481).
Every central-repo commit from Sunday 10:36 onward carries
`Co-authored-by: Claude Fable 5` (5 merged PRs: #483–#487).

The split is clean and falls exactly at the boundary between the week's
**product** work (dashboard, reports, audits, blux, header images) and its
**fleet-governance** work (rulesets, protection audit, Renovate App, clobber
disarm). MEASURED: the trailer change and its timestamp. INFERRED and
**unverifiable from this corpus**: whether that was a deliberate model choice
for a different kind of task, a session boundary, or a harness default — there
are no transcripts, so the reason is not recoverable. Both trailers appear
earlier in the repo's history (Fable 5 back to 2026-07-02), so this is not a
first-use event.

---

## Week-level friction summary (for the downstream reader)

1. **The dominant failure mode is not bugs; it is instruments that return
   successfully while answering a narrower question than the one asked.** Seven
   distinct instances this week: a green nightly counting rows written not rows
   passing (#473); an a11y gate over two synthetic fixtures (#481); a dist gate
   whose resolver preferred the `src/` layout that never ships (#476); a
   `tee`-without-`pipefail` that swallowed an alarm's exit code and then
   auto-closed the alarm's own tracking issue (#483); a liveness probe counting
   run existence so a revoked key read as healthy (#486); a lightbox test
   asserting over an empty array, twice (gallerysonder#62); and a
   `platformAutomerge` change applied to the rules that never used it (.github#11).
2. **Scope-as-briefed becomes the boundary of the search.** #480 states it
   outright about #478. The gallerysonder stub scan enumerated document types by
   hand and missed the largest type. Both corrected by switching from
   _enumerating inputs_ to _reading outputs_.
3. **Adversarial review is the highest-yield step in this workflow, by a wide
   margin.** Three PRs this week (#483, #486, gallerysonder#62) each had a
   review pass that found defects the implementation and its tests had both
   certified as fine — 12, 4 and 5 confirmed findings respectively, several of
   them "shipped the alarm dead."
4. **Rework is cheap and frequent inside a PR, and that is working as intended.**
   The hero fix, the artist stubs, the screen rect, the first fix attempt in
   #470 — all self-corrected before merge, with the retraction written into the
   commit body. The expensive rework is the kind that escapes: #478→#480,
   .github#11→#12, #483→#486.
5. **The human is the bottleneck in exactly two places, and neither is
   judgment**: a GitHub App that cannot be created headlessly (~20 min of
   clicking, blocking a 20-repo rollout), and release-merge approval (38.6h and
   25.5h of PR wall-time).
6. **Fleet-wide rollouts discover per-repo divergence at CI time, not at plan
   time.** Two of nineteen repos red on a prettier `singleQuote` setting; two
   others had their broad-change PRs closed and replaced with narrow ones. There
   is no pre-flight that asks "does the canonical byte sequence survive every
   target's own formatter."
7. **Automation cadence changes have unmodelled blast radius.** Weekly → twice
   daily plus App identity produced 8 red CI runs on Sunday night and the single
   busiest Actions day in the entire seven-week corpus on Monday, requiring five
   emergency holds.
