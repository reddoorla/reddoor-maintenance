# Design-review rules, mined (2026-09-29, for #674)

What this is: the first output #674 asks for. It lists candidate rules about how a Reddoor site should
look and behave. Each rule is mined from review notes that already exist and each is
stated so that a running page could be checked against it. **No code yet** (operator, 2026-09-29).
This file is the list to accept or cut. It is not a spec.

## Operator decisions, 2026-09-29

- **Full-bleed opt-in: `data-bleed`.** Accepted. Rules 1, 8 and 16 read it, and nothing else counts as full-bleed.
- **Rule 23 (art-directed crops) is not a rule.** It moves to Flags, as something worth raising in review. The number stays retired so the other rule numbers keep their meaning.
- **No other numbered rule was cut.**
- **Single-site rules:** six kept, three cut. The cuts are the scroll-follower that must never jump, the column gutter ("we want them flush for some designs"), and mobile-is-not-the-comp-scaled-down.
- **Seen once:** five kept, the rest left out.

## How it was mined, and what it could not see

A cloud session could read these sources, and they are what this list is built from:

- **This repo:** `docs/workJournal.md` (all 5,749 lines), `docs/meta-week/**`, `docs/morning-reports/`,
  `docs/superpowers/specs/`, `docs/palette-rollout-2026-09-29.md`, and BACKLOG. The richest
  part is `docs/meta-week/_data/commits.jsonl`, the fleet's commit subjects.
- **Eight fleet repos**, all public: reddoor-website, beachfront-dentistry, gallerysonder,
  vida-legacy-foundation, roalson-interests, 29-navy, reddoor-starter and reddoor-starter-blux. For each one
  this pass read every issue and PR body (954 in total), every human issue/PR comment (179), `CLAUDE.md`,
  `docs/*.md`, the repo's journal, and code comments that state a layout rule. Beachfront's and 29-navy's
  `matching/LEDGER.md` hold the verbatim MarkUp pins from Tim and the operator's directives, round by
  round. It is the nearest thing to the design-review corpus that a cloud session can reach.

It could **not** reach three sources. They are the **second pass, and it needs a laptop session**:

- **Discord.** The bot token is only in the laptop's `.env`. Most of the human voice below
  is Discord relayed through a PR body ("Tim, Discord 2026-03 …"). The channels themselves would
  add the notes that never became a PR.
- **Figma comments.** This session had no Figma connection. Nicole's comments appear here only where a PR
  or journal entry quoted them.
- **MarkUp boards**, beyond what the ledgers transcribed. Also `reddoorla/claude-skills`: it is
  private and was not attached, and it holds the markup-review and matching skills.

On how the evidence was gathered: PR review _line_ comments are **zero** on all eight repos. Design review never
happened in GitHub's review UI. It reaches the repos as agent-written fix PRs and journal entries that
quote the reviewer, which is why the citations below are mostly PR bodies. A quote attributed to a
person (Tim, Nicole, Erik, Tucker) is that person's words, as the PR or ledger recorded them.

Seven read-only agents did the mining, one per source group. Their quotes were then spot-checked: 44 were
grepped against the sources, and every one was genuine. Three matched only after un-wrapping a line
break, and one only after grepping the file its citation actually named. One deliberately wrong probe was
included, and it missed as it should.

## Ranking

The rules are ranked by **frequency × testability**. Frequency counts distinct instances across the sources,
with extra weight for a rule seen on several sites. Testability has three levels:

- **fully testable**: a script can say red or green on a page with no human in the loop.
- **partly testable**: a script can find the candidates, or check part of the rule, but some cases need an eye.
- **judgment-only**: goes in the starter's written guide, not the gate (#674, "the two outputs").

Every rule gives its instance count and the number of sites it was seen on.

## Where a checker would read "content width" and "full-bleed"

The seed rule depends on this, and the mining turned up a finding: **neither starter has an explicit
full-bleed marker.** There is no class, data attribute or prop for it. Full-bleed is implicit: an element
is full-bleed when it sits in a band's `<section>` but outside that band's content box.

- **Native starter, content box:** `ContentBand.svelte:37` (`mx-auto w-full {contentClass}`). Each slice
  chooses its own `max-w-2xl…7xl px-6`, so the native starter has **no single content width**, and
  "aligned" has to be judged per band. `ContentWidth.svelte:27` (`max-w-[1220px] xl:max-w-[1440px] mx-[4%]`)
  exists, and a passed `class` never replaces its gutter classes, but no slice uses it.
- **Screen-wide in practice:** `w-screen` and `sizes="100vw"` (ScreenWidthMedia, VimeoBanner,
  HeroBackgroundImage). These are the closest thing to an opt-in today.
- **Blux track:** `BandContent.svelte` (max-width 1280, 4% gutters), and `.blux-grid__cells` /
  `.blux-section__cells` in `blux-layout.css:25-36`.
- **reddoor-website** has a real primitive: `ContentWidth` plus `RailRow`, with one five-column grid.
  **roalson-interests** has `mx-auto max-w-[1440px] px-5 sm:px-8 xl:px-20` and one two-column grid
  ("ruling C3").
- **Trap:** the native starter's `body { overflow-x: clip }` plus `scrollbar-gutter: stable` means an
  overshooting `100vw` element is clipped rather than scrolled. A horizontal-scroll check therefore
  cannot see an overhang; only comparing boxes against the content box can.

So rule 1 comes with a prerequisite: an explicit full-bleed opt-in in both starters. **Decided on 2026-09-29:
`data-bleed`.** Until the starters carry it, a checker would have to infer intent from `w-screen`, and #674 says
full-bleed should never be inferred. Adding it to the starters is a change to those repos, so it lands there,
not here.

---

## The ranked rules

### 1. Every block aligns to the content edge (or the site's shared column line) unless it is deliberately full-bleed. "Almost aligned" is a defect.

This is the issue's seed, and the evidence confirms it is the most-restated note: **≈30 instances on 5 sites.**

- beachfront-dentistry `matching/LEDGER.md:2579`, 2026-08-10, Tim's pin: "Should left align to headline above."
- beachfront-dentistry PR #24, 2026-08-11: "the five independently-computed left gutters (hero, hero CTA, card grid, FIJI label, footer) now all derive from live's single `.content-width` model"
- reddoor-website `AUDIT_NOTES.md:27`, 2026-09-03, Tucker: "kill the maxwidths you've built for the rest of the content, that's what the contentwidth is for"
- roalson-interests `src/lib/slices/FeaturedProperties/index.svelte:75`: "THE CARD'S LEFT EDGE IS THE SITE'S COLUMN LINE, not the comp's 512."

Also: meta-week `_data/commits.jsonl` has 11 `fix(gutter)`-style subjects (e.g. :594, 2026-08-11, "the hero name and the menu join the content width — Tim's last two pins"); Tucker in `04-journal-beat-by-beat.md:4300` ("not being flush with nav home link"); reddoor-website PRs #128, #142, #166, #213 and #218.

- **Check:** at each viewport, read the content box's inner left and right edges (per band in the native
  starter, site-wide where one exists). For every visible block, assert that its left edge equals the content
  edge, or a shared column line, within 1px. The other allowed case is a full-bleed opt-in, where the block
  spans 0…layout width. Anything in between fails. Also compare the left x of named anchors (logo, h1,
  first card, footer heading) with each other: beachfront's gutters agreed at 1440 and splayed to
  "24/48/60/73/80" at 1294 (`LEDGER.md:2458-2467`). **Fully testable** once the opt-in exists.
- **False-positive risk:** high without an explicit opt-in.
  - Full-bleed bands, and centred elements, which the operator says stay centred ("nav should still have
    links centered like before", beachfront `LEDGER.md:3515`; `commits.jsonl:593` "H2's gutter alignment was a misread").
  - Art-directed overhangs: 29-navy and roalson portrait overhangs, and reddoor-website's paper-texture bleed, which is `-inset-x-2` on purpose.
  - Running prose that stops a column short (rule 22).

### 2. All motion honours `prefers-reduced-motion`. Durations _and_ delays go to zero, JS/WAAPI transitions are included, and the page lands on the final, content-bearing frame.

**≈35 instances on all 8 repos.**

- reddoor-starter PR #135, 2026-09-16: "A zero-length animation that still waits out its delay is "nothing happens, then it pops""
- beachfront-dentistry `src/lib/transitions.ts:13`: "Svelte's JS-driven transitions (Web Animations API) do NOT honor the CSS `prefers-reduced-motion` reset in app.css."
- vida-legacy-foundation `src/lib/slices/HeartHero/index.svelte:137`: "Reduced motion lands on the FINAL frame, not the first."
- roalson-interests issue #38, 2026-09-21: "Either is defensible; both on one page is not. Decide once and align the other."

- **Check:** emulate `reducedMotion: 'reduce'`. Assert that `document.getAnimations()` is empty or finished
  after load and after each scroll step. Assert that no element's computed `transition-delay` or `animation-delay`
  is above 0 on the menu, sliders and reveals. Assert that scroll-driven heroes render their end state. Also
  sample the first frame after a triggered transition (#135: `fly({ y: 22 })` painted its 22px offset for
  one frame). **Fully testable.**
- **False-positive risk:** low. The trap runs the other way:
  - The shared Playwright config forces `reduce`, so any test of the _full-motion_ path passes vacuously
    unless it opts out (reddoor-starter #141; meta-week `04-journal:1640`: "every spec that believed it ran
    reduced was running with motion ON").
  - Motion that is "size, not motion" is allowed (roalson `workJournal.md:11219`).
  - Webflow references ignore the setting, so a reference comparison run under `reduce` gives false fails.

### 3. Text meets AA (4.5:1, or 3:1 for large text and UI parts) against the ground actually painted under it, in every state

That means over photos, textures and blends, on each band, under a transparent nav, after reveals settle, and on hover and open.

**≈40 instances on all 8 repos.** It is the largest cluster, and axe misses most of it.

- reddoor-website PR #128, 2026-08-12: "Three AA failures were found by measuring composited pixels, none of which axe can catch structurally"
- 29-navy PR #28, 2026-09-12: "**Auditing `/` at rest would have found neither.** Both need an interaction."
- roalson-interests `docs/workJournal.md:11136`, 2026-09-28: "The gate had floors and no ceilings, so nothing said "no darker than needed". The client saw it before a test did."
- reddoor-maintenance `docs/workJournal.md:5044`, 2026-09-29: "A live fixture with two below-fold reveals at 2.32:1 came back as 0 violations: a green gate over two failures."

Also:

- vida PRs #11, #17, #20 and #21 ("any clamped type carrying a marginal colour needs checking at its **floor**").
- beachfront `LEDGER.md:5` (brand cyan darkened below 24px).
- The transparent nav's legibility over its first band: vida #21 and #44, roalson #20 and #45, reddoor-website IndustryHero scrim.

- **Check:**
  1. Run axe after `revealBelowFold` settles (it exists: `src/audits/util/reveal-below-fold.ts`), and treat
     "0 contrast nodes measured on a text route" as a failure of the instrument, not a pass.
  2. Supplement axe with a composited-pixel check. For each text node over a `background-image`, a video or a
     blend, screenshot its box with the text hidden, take the 90th-percentile-bright pixel (reddoor-website
     `workJournal.md:1369`), and compute the ratio.
  3. Repeat in hover and open states: hover every control, open every popup (29-navy `tests/a11y/home.spec.ts`
     does this).
  4. For a transparent nav, sample the pixels under the bar at several scroll positions.

  **Partly testable.** The pixel method is sound, but a photo an editor has not uploaded yet cannot be tested.

- **False-positive risk:** medium.
  - Logos are exempt.
  - Operator-accepted exceptions exist and must be encoded as named pairs, not as a blanket skip: roalson map
    road casings (#119, "do not "fix" it in a later sweep without going back to the operator") and dimmed
    pins (#205).
  - `mix-blend-plus-lighter` makes axe throw (vida; Operator decisions 23).
  - The scrim should also have a _ceiling_ (roalson "dark cloud", #201).

### 4. Nothing needs JavaScript to become visible, and nothing is visible and dead before it arrives

Reveal states ship in the markup, with a no-JS release and a fail-safe. A control that cannot work without JS is hidden or quiet.

**≈25 instances on 5 sites.**

- reddoor-starter PR #141, 2026-09-16: "Content painted in final position, sat there, then dropped half its height and vanished when `use:animateIn` ran at hydration."
- vida-legacy-foundation PR #52, 2026-09-03: "With no script the stats band read **"0+", "0 people", "0%", "0 lives"** — not merely unanimated but _wrong_."
- roalson-interests issue #47, 2026-09-21 (title): "Carousel arrows and progress bar are visible and dead when script is on and the bundle never arrives"
- vida-legacy-foundation PR #50, 2026-09-03: "Frame 0 of this hero is a green field with a small closed heart and _nothing else_"

Also: reddoor-starter `docs/accessibility.md:181`; roalson `docs/accessibility.md:18`; meta-week `commits.jsonl:565` and `:611` (beachfront's reveal fail-safe).

- **Check:** load every route with JS disabled. Assert that every `[data-reveal]` / animate-in element and its
  ancestors compute `opacity: 1` and `visibility: visible` (opacity does not inherit as a computed value, so walk
  the ancestors), and that no stat reads `0`. Separately, block the app bundle with script _on_, and assert that every visible
  control is either functional (e.g. a link fallback) or `inert`. **Fully testable** (reddoor-starter
  `tests/interaction/reveal-no-js.spec.ts` is the shape).
- **False-positive risk:** low. Above-the-fold heroes that are deliberately not reveal-wrapped pass anyway.
  "Bundle never arrives" is an accepted residual on roalson (ruling C4), so that half may need to be a warning.

### 5. Text never clips or collides. A box grows to hold its real content, a label wraps inside its pill, and a design aspect ratio is a floor, not a cage.

**≈20 instances on 4 sites.**

- vida-legacy-foundation PR #53, 2026-09-04: "A real multi-sentence bio was cut off — **166px hidden below the card's edge**, no scrollbar"
- beachfront-dentistry `matching/LEDGER.md:4573`, 2026-09-02: "a label which WRAPS does not grow the pill — the second line lands on the first line's baseline and the words paint on top of each other."
- meta-week `04-journal-beat-by-beat.md:1067`, 2026-08-07, Tim on launch day: "text is getting caught off when you click on the title"
- vida-legacy-foundation PR #33, 2026-09-03: "**A pill grows instead of overrunning.** At 320px the stats band's "register to be an organ donor" hung 69px past the card"

- **Check:**
  - For every element with `overflow: hidden|clip` that contains text, assert `scrollHeight <= clientHeight + 1`
    and `scrollWidth <= clientWidth + 1`.
  - For every text node, assert that its line boxes (`Range.getClientRects()`) do not intersect another text
    node's.
  - Run it after expanding every accordion and card, with the longest real CMS copy, across the width sweep
    (rule 10). beachfront's `tests/interaction/pill-label.spec.ts` and vida #74's viewport walk are the shapes.

  **Fully testable.**

- **False-positive risk:** medium.
  - Deliberate line clamps (beachfront's bio "clamps at three lines", `commits.jsonl:614`) need an opt-in
    marker (`-webkit-line-clamp` is detectable).
  - Marquee and ticker overflow is intended.

### 6. Nothing covers content or controls it should not

This covers floating pins, sticky bars, decorative waves, map furniture and popovers. Stacking is explicit, and decorative layers take no taps.

**≈20 instances on 5 sites.**

- beachfront-dentistry PR #29, 2026-08-13: "Read Reviews opened underneath the footer wave … **0% of the "Read Reviews" button was hittable at 360px**"
- reddoor-website PR #166, 2026-09-08, Tucker: "make sure the pin floats on top of everything z-index wise … (two pins should never touch)"
- roalson-interests issue #182, 2026-09-28 (title): "Compact /properties map on 398–485px phones: the Seguin land pin sits under the − button"
- meta-week `commits.jsonl:569`, 2026-08-12 (beachfront): "the wave was sitting on the label below 768, and the spec couldn't see it"

Also: reddoor-website #224 and #225; roalson #188, and #80's comment ("drops it to its own row rather than over the text"); vida's dark overlay (#66).

- **Check:** for every interactive element, hit-test its centre and four inset corners with
  `document.elementFromPoint`. The hit must be the element or its descendant. For text, hit-test sample points
  in each line box and require that no floating or decorative element owns them. Run it at each viewport and at
  several scroll depths, and with each overlay open. axe's `color-contrast` "incomplete: bgOverlap" is a free
  secondary detector (roalson #124). **Fully testable.**
- **False-positive risk:** medium.
  - Deliberate overlaps drawn by the comp: beachfront /our-team, where "Meet/Our" sits on the wave, is
    operator-ACKed with `data-wave-overlap`.
  - Hero text over imagery (that is rule 3's job, not this one's).
  - Needs an opt-in attribute for sanctioned overlaps.

### 7. No page is wider than the phone, and a full-bleed element never leaves a strip or a sideways scroll

`100vw` counts the scrollbar gutter.

**≈15 instances on 6 sites.**

- reddoor-website PR #220, 2026-09-28: "**Pages were 8 px wider than a phone** … The cause is the paper-texture bleed's deliberate `-inset-x-2` overhang."
- roalson-interests PR #194, 2026-09-29: "full-window overlays cover the scrollbar gutter. `100vw` does not, measured."
- beachfront-dentistry PR #29, 2026-08-13: "`/services` scrolled sideways below 375px — the grid had no tier below the narrowest gated width."
- 29-navy PR #12, 2026-09-10: "**15px of page width read as a 47% hero defect.** `scrollbar-gutter: stable` reserves the gutter INSIDE the body"

- **Check:**
  - `documentElement.scrollWidth <= innerWidth` at 320–767. This already exists fleet-wide in
    `src/audits/browser.ts:852` and `src/prospect/site-checks.ts` (`mobile-overflow`).
  - Because `body` often clips, also assert that no element's right edge exceeds the layout width, which a
    `position:fixed; inset:0` probe reports (reddoor-starter #142).
  - With a classic 15px scrollbar (headless Chromium), count pixels in the rightmost 15px column for a
    band-coloured strip (roalson #194: a box check passed while the strip still showed).

  **Fully testable.**

- **False-positive risk:** low. A deliberate bleed is fine when it is clipped with `overflow-x: clip` on its section, and the check should then pass.

### 8. A full-bleed band really runs edge to edge. No wrapper, max-width or 1440 cap may quietly narrow it, and it is never judged inside a content-width wrapper.

**≈12 instances on 4 sites.**

- vida-legacy-foundation PR #11, 2026-09-02: "A **nested `<main>`** (the layout already renders one) at `max-w-3xl`, capping every full-bleed slice to 768px."
- vida-legacy-foundation `docs/workJournal.md:102`, Tucker: "there are two mains, one of which is at a capped width so nothing is displayign right"
- roalson-interests `docs/workJournal.md:5208`, 2026-09-21: "`max-w-3xl` wrapper, which squeezes the card to **425.89 at a 1440 viewport**"
- vida-legacy-foundation PR #29, 2026-09-03: "the ground runs edge to edge on a wide screen instead of stopping at 1440."

- **Check:** at 1920 and 2560, every element carrying the full-bleed opt-in (see "Where a checker would read"),
  and every band `<section>`'s background layer, spans 0…layout width. Also assert exactly one `<main>` per page
  (reddoor-starter #158 found a second on /contact, and the axe gate does not catch it). **Fully testable.**
- **False-positive risk:** low once the opt-in exists. A deliberately capped "boxed" band would need to say so.

### 9. A heading's level is chosen for the document outline, and its visual size is pinned separately

Each page has one `h1` and no skipped levels. Eyebrows and decorative watermarks are not headings.

**≈25 instances on 7 sites.**

- reddoor-website `README.md:43`: "when changing a heading's level for a11y, pin its visual with a `.type-*` class (including `font-family` and every responsive step)."
- gallerysonder PR #22, 2026-06-17: "decoupling the _semantic_ heading outline from the _visual_ type scale, **without changing a single style**"
- meta-week `_research/proj-02-reddoor-website.md:537`, 2026-08-20: "Five `<h1>`s on the home page … no `<h1>` at all on `/about`"
- vida-legacy-foundation PR #19, 2026-09-02: "Fixing the label at `h3` would leave the board group starting at `h3` under the page `h1` — a skipped level axe flags."

Also: `RichTextHeading.svelte` with the `aria-level` pattern on beachfront, roalson and the starter; meta-week `commits.jsonl:1834` ("the watermark is decoration, not a heading").

- **Check:**
  - (a) _Outline_ (fully testable): exactly one level-1 heading, and no level skips (taking `aria-level` into
    account). Run axe's best-practice tags `page-has-heading-one` and `heading-order`. The fleet a11y audit
    filters these out today (`src/audits/a11y.ts:654` uses wcag tags only), which is why they went unseen.
  - (b) _Decoupling_ (partly testable): for a heading whose level changed in a diff, assert that computed
    `font-family`, `font-size`, `font-weight` and `line-height` are identical at every breakpoint before and after.
    That needs two builds, so it is a PR-time check, not a page check.
- **False-positive risk:** low for (a), except empty headings rendered from blank CMS fields (rule 15 covers those).

### 10. Layout holds at every width, not only at the comp's widths or the gate's sample widths

Nothing is keyed to the comp's own 1440, because a maximized 1440 window is about 1425 of viewport.

**≈20 instances on 6 sites.**

- beachfront-dentistry `matching/LEDGER.md:3479`, 2026-08-11: "The gate never saw this defect because its matrix (1440/834/390) samples exactly the three widths where left-20 happened to agree."
- vida-legacy-foundation PR #34, 2026-09-03: "The 4-up grid was gated on the comp's 1440, and a maximized 1440 window is 1425 of viewport once the scrollbar is paid — so it fell to 2x2 on the client's own screen."
- roalson-interests `docs/workJournal.md:3292`, 2026-09-21: "A defect found by sweeping the widths the comp does not draw, with every test green."
- meta-week `04-journal-beat-by-beat.md:955`, 2026-08-05: "a two-tier ladder keyed at 768, leaving the whole 768–991 band rendering the desktop value."

- **Check:** this is less a rule of its own than the viewport list every other rule runs on.
  - Sweep 320, 360, 375, 390, 480, 700, 767, 820, 834, 900, 991, 1024, 1100, 1200, 1280, 1294, 1425 (1440 minus a
    classic scrollbar), 1440, 1512, 1920 and 2560, plus one landscape phone (a landscape lockout shipped because
    "no gate viewport is landscape-shaped", `04-journal:1189`).
  - The rule-specific assertion: the column count at 1425 equals the count at 1440 (vida), and headline line
    counts change only at declared breakpoints (roalson #162).

  **Fully testable** as a harness property.

- **False-positive risk:** none of its own. Its cost is runtime.

### 11. Every tap target is at least 24×24 CSS px (the house pattern is 44×44), and the whole card is the hit area its hover promises

**≈15 instances on 7 sites.**

- reddoor-starter issue #123, 2026-09-11: "the rendered hit area is exactly the 20×20 SVG."
- gallerysonder PR #33, 2026-06-22: "The footer home/logo link was a 12px target. Now `h-6` (≥24px)"
- 29-navy PR #23, 2026-09-11: "the whole box should be clickable, not just the text"
- beachfront-dentistry PR #29, 2026-08-13: "Services sub-links were under the 24px AA target height."

- **Check:**
  - Run axe `target-size` (WCAG 2.5.8) plus a direct check that each interactive element's box, including
    `::after` hit extensions, is at least 24×24 unless it is inline in a sentence.
  - For cards with a hover state, hit-test the card's corners and centre (rule 6's method), and require that
    they activate the same link.

  **Fully testable** for size, **partly testable** for "the hover promises it".

- **False-positive risk:** low. Inline text links are exempt under 2.5.8.

### 12. Keyboard focus is always visible: the ring contrasts (≥3:1) with the ground it is drawn on, is not clipped, and is never under a pinned bar

**≈15 instances on 5 sites.**

- roalson-interests PR #23, 2026-09-21: "The keyboard focus ring was garnet on every ground — 1:1 on `bg-primary`, 1.48:1 on `bg-dark`."
- reddoor-starter PR #133, 2026-09-16: "every element without its own ring fell back to the UA's 1px hairline — invisible on a dark nav or over a photo hero"
- roalson-interests `docs/workJournal.md:3635`, 2026-09-21: "The pinned bar hid whatever the browser focused, on every route."
- beachfront-dentistry PR #38, 2026-09-01: "**White ring on the logo** — our focus ring. `trapFocus` focused the overlay's first focusable"

- **Check:**
  - Tab through each page. For every focused element, screenshot its box plus a few px, focused and unfocused.
    Require that the diff forms a ring whose colour contrasts ≥3:1 with the adjacent unfocused pixels, and that
    the ring is not cut by an ancestor's `overflow: hidden`.
  - Require that the focused element's rect does not intersect the fixed header's rect (WCAG 2.4.11).
  - Separately, flag `outline-style: none` without a replacement in forced-colours mode (Tailwind v4
    `outline-none` vs `outline-hidden`, reddoor-starter #133).

  **Partly testable.** The ring detection is heuristic, as `audit-check-backlog.md:342` already notes.

- **False-positive risk:** medium. Some custom focus treatments are fills, not rings, so the diff has to accept a fill change that itself meets 3:1.

### 13. Every image asks for the size it is shown at, and no source is upscaled

`sizes` matches the rendered box, and the source is at least the box × DPR.

**≈12 instances on 5 sites.**

- reddoor-starter PR #109, 2026-09-01: "Worst observed: a 40px source offered at `3840w` — a **96x blow-up** on the Burbank sites."
- reddoor-website PR #201, 2026-09-17: "every grid that shows it was displaying a 3.8× upscale — visibly soft next to eleven crisp neighbours"
- vida-legacy-foundation PR #33, 2026-09-03: "letting `object-cover` blow it up 2.8× onto a forehead."
- roalson-interests issue #82, 2026-09-22 (title): "Hero clip is a 720p master upscaled 1.13x at 1440"

- **Check:**
  - For every `<img>` after load, assert `naturalWidth >= renderedWidth × devicePixelRatio × 0.9` (using the
    `object-fit: cover` scale where it applies) at 1× and 2× DPR.
  - For `<video>`, check `videoWidth` the same way.
  - Assert that `sizes` is present on every `srcset` image and that `sizes="100vw"` appears only on elements that
    are actually screen-wide.

  **Fully testable.**

- **False-positive risk:** low. The weak spot is a small logo that only exists as a raster file: reddoor-website #201 was a supplied asset, so a failure there is a request to the client, not a code fix.

### 14. A media box takes its shape from its media or a declared default, never an assumed ratio that letterboxes or collapses

A cover-cropped frame is fully covered.

**≈10 instances on 3 sites.**

- reddoor-website PR #130, 2026-08-13: "**No slideshow on this site is 16:9** — the published sets run 1.29 to 1.62 — so every one was laid into a box wider than any of its own content"
- reddoor-website PR #129, 2026-08-13: "A full-bleed video on `/portfolio/msot` rendered as a **1440x150 letterbox slot**."
- reddoor-starter PR #66, 2026-07-16: "Media's inline sizing beat the cover classes and left the frame partially uncovered"

- **Check:**
  - For each `<img>`/`<video>`/`<iframe>` inside a media box, compare the box ratio with the media's natural
    ratio. With `object-fit: contain`, fail if the letterbox bars exceed about 5% of the box.
  - With `cover`, assert the media's painted rect covers the box.
  - Fail any iframe or video box under 200px tall at ≥1024 wide.

  **Fully testable.**

- **False-positive risk:** medium. reddoor-website #130 says "losing artwork from a portfolio piece is a decision for whoever owns the work", so a genuine outlier letterboxes on purpose. Such cases need an allow-list, not a code fix.

### 15. Empty or unauthored CMS content renders nothing, and no control or label promises something that is not there

That means no blank heading, no `href="#"`, no "Company Name", and no "+" on a card with no bio.

**≈20 instances on 6 sites.**

- reddoor-starter PR #80, 2026-07-24: "every production migrated site published a generic `© YEAR Company Name` placeholder instead of its actual footer."
- gallerysonder PR #25, 2026-06-18: "A blank CMS gallery row … rendered a broken `<img src="">` whose alt fallback — `"Gallery Sonder"` — displayed as visible text"
- vida-legacy-foundation PR #19, 2026-09-02: "drawn **only when a bio is authored** — the affordance never lies."
- beachfront-dentistry PR #16, 2026-08-04: "The Registration-Form / Download-Forms links are `#` placeholders"

Also: reddoor-website #59 (a heading rendered even with a blank label); gallerysonder #65 ("Dead RSVP button"); 29-navy PR #28 (four PDF links serving a 906-byte not-found page).

- **Check:**
  - Static and DOM scans for `href="#"` and `href=""`, `<img src="">`, headings and buttons with empty
    accessible names, and a list of placeholder strings (`Company Name`, `Lorem`, `© 2023`).
  - Resolve every same-site link and downloadable asset and fail on 404 or not-found pages (a
    `Content-Type`/size sanity check catches the 906-byte "PDF").
  - Render the a11y-fixtures route with every optional field blank (`src/recipes/a11y-fixtures-page/` exists).

  **Fully testable** for the mechanical half, **partly testable** for "affordance lies", which needs a list of
  affordances per component.

- **False-positive risk:** medium.
  - The operator decided that dangling nav links to unbuilt pages stay, to show a WIP (composition-hospitality, `workJournal.md:3046`).
  - Placeholder tokens are deliberately loud in the starter (`NEW-SITE.md:31`).

### 16. Pinned and sticky elements rest below the fixed bar, not under it, and start and stop at designed points

A pinned header never hides the focused element.

**≈12 instances on 4 sites.**

- vida-legacy-foundation PR #47, 2026-09-03: "Every slide-over band held at `top: 0` — the top of the **screen** — which put it under the fixed 70px bar"
- meta-week `commits.jsonl:1777`, 2026-09-09 (reddoor-website): "Gallery Sonder's pin stops at its heading, not at the CTA"
- meta-week `04-journal-beat-by-beat.md:4292`, 2026-09-10, Tim: "not sure what possible for where the sticky title stops and starts."
- roalson-interests PR #61, 2026-09-22 (title): "a pinned bar that hid whatever the browser focused"

- **Check:**
  - For every element with `position: sticky`, scroll through its container and assert that, while stuck, its
    top is at least the fixed header's bottom (the `--nav-h` / `--usable-top` token).
  - Assert that `scroll-padding-top` is at least the header height.
  - Start and stop points compare against a named anchor (a heading's top, the group's end). That comparison is
    only **partly testable**, because the anchor is a design choice.
- **False-positive risk:** medium. Full-bleed "runway" heroes deliberately sit under a transparent bar (vida `docs/layout.md:87-89`), so they need the opt-in.

### 17. Hover and press states fire only on real intent, never move layout or text weight, speak one language per button type, and have a touch equivalent

**≈18 instances on 5 sites.**

- beachfront-dentistry PR #38, 2026-09-01: "Three pins were one bug class: hover states firing without intent"
- gallerysonder PR #67, 2026-08-01: "Hovering a name in a NameList moved the whole section." (CLS 0.357–0.479 on hover)
- reddoor-starter PR #144, 2026-09-16: "`hover:` compiles behind `@media (hover: hover)` and never applies on a phone"
- meta-week `commits.jsonl:572`, 2026-08-12 (beachfront): "one hover language — the CTA fills instead of fading, and answers a press"

- **Check:**
  - Sweep the pointer over every interactive element and record `layout-shift` entries (require 0; gallerysonder
    `tests/smoke/namelist-hover.spec.ts`) and glyph box changes (require 0).
  - After mount with a resting pointer, and after an overlay opens under the cursor, assert no element matches
    `:hover` styling.
  - Assert that touch-pressed elements get a state (`data-pressed`), and that no essential control is reachable
    only through `:hover` (reddoor-website: a pause control "behind `hover` and `focus-within`, and **touch has
    neither**").

  **Partly testable.** "One language per button type" needs a component inventory.

- **False-positive risk:** medium. Deliberate hover animations (a raise, a draw-in) change the box. Only layout shift of _other_ elements should fail.

### 18. Nothing jumps

Space for late content is reserved at SSR, and locking scroll for an overlay does not change the page width.

**≈10 instances on 4 sites.**

- gallerysonder PR #26, 2026-06-18: "At SSR the spacer is `0`; after hydration it jumps to its real height, pushing the section (and everything below) down"
- reddoor-starter PR #138, 2026-09-16: "everything below the widget, the submit button included, drops ~65px out from under the cursor"
- gallerysonder PR #28, 2026-06-18: "on lock every full-bleed `w-screen` shape jumped sideways"

- **Check:**
  - CLS under 0.02 from load through a full scroll, and during form submit with errors.
  - Open each overlay and assert that `document.body.getBoundingClientRect().width` and every full-bleed
    element's left edge are unchanged. This needs a classic scrollbar; it passes vacuously on macOS, as
    reddoor-starter #160 found.

  **Fully testable.**

- **False-positive risk:** low.

### 19. Adjacent painted layers meet without a seam

No hairline, no strip of the band behind, no white overscroll, no gap in a slide-over stack.

**≈15 instances on 4 sites.**

- vida-legacy-foundation PR #36, 2026-09-03: "there's a little gap that lets us see through to the image behind, make sure there's a lil overlap so its solid blue"
- beachfront-dentistry `matching/LEDGER.md:4012`, 2026-09-01: "still showing a line when I load the page in Safari"
- roalson-interests PR #86, 2026-09-22, the operator: "extend the bg of the top and bottom past the screen so trying to scroll past doesn't show white."
- reddoor-website `docs/workJournal.md:662`, 2026-09-15: "the list sat on a 236px strip of plain white between two paper bands on a phone"

- **Check:**
  - The two-colour probe (vida): repaint the layer _behind_ a joint in two colours, screenshot both across
    several scroll positions and viewport heights, and fail on any pixel that differs at the seam.
  - For stacking by computed offsets, assert a ≥1px overlap at each joint.
  - Overscroll colour can only be checked on a real device, because headless Chromium cannot rubber-band
    (roalson #98 was a false green).

  **Partly testable.** Seams are intermittent and engine-specific, as the Safari-only hairline shows.

- **False-positive risk:** low when the probe is used. A single screenshot proves nothing.

### 20. Anything that moves on its own has a visible pause that freezes all of it, and nothing autoplays under reduced motion

**≈10 instances on 3 sites.**

- reddoor-website `docs/workJournal.md:1355`, 2026-09-28: "pausing freezes the zoom as well as the advance (`animation-play-state`), because a still-moving picture behind a "paused" control is not paused."
- roalson-interests `docs/accessibility.md:14`: "Anything that autoplays draws a **Pause / Play control, first in the carousel's tab order** (WCAG 2.2.2)"
- roalson-interests issue #81, 2026-09-22 (title): "Background video: two components still autoplay a loop with no pause control (WCAG 2.2.2)"

- **Check:**
  - Find everything that moves for more than 5 seconds: autoplaying `<video>`, running `getAnimations()`, and
    carousels whose DOM mutates on a timer.
  - Require a focusable control with an accessible name matching /pause|stop/.
  - Activate it and assert that every animation's `playState` is `paused` and that video `paused === true`.
  - Under `reduce`, assert nothing is running.

  **Fully testable.**

- **False-positive risk:** low. The operator decided the roalson homepage band does not pause on hover (`pauseOnHover: false`), and that does not conflict with this rule.

### 21. Colour, type, breakpoint and ease come only from the design system's tokens and named type styles, and every token actually emits CSS

**≈20 instances on 5 sites.**

- reddoor-website `AUDIT_NOTES.md:31`, 2026-09-03, Tucker: "use our heading styles, they're defined for a reason"
- roalson-interests issue #193, 2026-09-29: "SectionGrid's logo tiles carried `bg-surface`, but this repo never declared `--color-surface`, so the class emitted no CSS"
- vida-legacy-foundation PR #33, 2026-09-03: "A px value — and an arbitrary `min-[1440px]:` variant — is emitted _before_ the rem-valued defaults, so `sm:grid-cols-2` silently won at every width."
- reddoor-starter `docs/workJournal.md:264`, 2026-09-17: "the declared 560/1340 are dead — the second site to rediscover this, after the Beachfront note."

Also:

- roalson #58 (default-palette greys) and #183 (`ease-fast-slow` emits no CSS).
- reddoor-website #79 (`text-[100px]` rendering at 80px: element CSS outside `@layer base`).
- vida's Figma cap-height trim per text style (`docs/figma-cap-height-trim.md:40`).

- **Check:**
  - (a) _Static, fully testable:_ every utility class used in `src/` produces a rule in the built CSS (roalson
    `src/theme-utilities.test.ts` is the shape), and custom breakpoints are `--breakpoint-*` in rem.
  - (b) _On the page, partly testable:_ collect each text node's computed `font-family`/`font-size`/`line-height`
    tuple per breakpoint and each painted `color`/`background-color`, and fail on any value outside the site's
    token set. That needs the token set exported per site.
- **False-positive risk:** medium for (b). Photos, third-party embeds and the map are out of scope and must be excluded.

### 22. Running prose keeps a readable measure (about 45–85 characters a line), even where the structure around it runs to the grid edge

**≈6 instances on 3 sites.**

- reddoor-website PR #216, 2026-09-23: "So prose sits on a `.measure` cap of 80ch … **Structure reaches the gutter; text keeps its measure.**"
- beachfront-dentistry `matching/LEDGER.md:2866`, 2026-08-10, Tim: "This text width is way too long. I want this to be 70% width || Or maybe a max width of 700 pixels"
- vida-legacy-foundation PR #38, 2026-09-03: "The pop-up's text column is capped at the comp's 680px measure while there is no picture beside it."

- **Check:** for each paragraph of at least 3 lines, divide the text length by the number of line boxes and assert
  the result is ≤ ~85 at every viewport. reddoor-website #216 measured /about at 77–81 and a proportional column
  at 116. **Fully testable.**
- **False-positive risk:** medium. This is in tension with rule 1 and with Tucker's "kill the maxwidths" (reddoor-website audit report, which deliberately runs full width). Captions and legal text are exceptions.

### 23. (Moved to Flags: not a rule. Operator, 2026-09-29.)

### 24. A blend layer is isolated, and nothing above it inside its stacking context carries transform, opacity or filter

The issue's seed rule.

**≈6 instances on 3 sites.** This is thinner than the issue expected.

- reddoor-website `src/lib/slices/IndustryHero/index.svelte:79`: "any ancestor carrying transform/opacity/filter (an entrance animation, say) collapses mix-blend-multiply into an opaque box."
- reddoor-website `docs/workJournal.md:1357`, 2026-09-28: "without their own stacking context they painted over the navy multiply wash, the mobile band fade and the nav scrim — the phone showed a hard photo edge"
- beachfront-dentistry `matching/LEDGER.md:4245`, 2026-09-01: "(a transform makes a stacking context) — and I1's fix was to release that transform on `transitionend`."

- **Check:** the DOM scan in #674 works. For each element with a computed `mix-blend-mode` other than `normal`,
  walk the ancestors to the nearest `isolation: isolate`. Fail if any of them carries a non-identity
  `transform`, `opacity < 1` or a `filter`, including _during_ entrance animations, so sample during reveal as
  well. **Fully testable.** Both starters' bands already set `isolate`, so the fixture passes by construction.
- **False-positive risk:** low. `mix-blend-plus-lighter` is a separate problem (it makes axe throw), filed as Operator decisions 23.

### 25. A row of cards stays level however the names wrap, because alignment is reserved in layout, never typed as a line break

**≈8 instances on 2 sites.**

- vida-legacy-foundation `CLAUDE.md:204`: "**A hand-typed line break cannot align a row of cards.** … the alignment comes from `sm:min-h-[2lh]` reserving two lines."
- vida-legacy-foundation PR #72, 2026-09-11, Erik: "Any problem with inserting a line break between Holly and Aldridge so that the leadership team name blocks all align?"
- meta-week `commits.jsonl:507`, 2026-09-02 (beachfront): "the name may run 12px into the card's padding, so the slider row stays level"

- **Check:** for each grid or flex row of cards at the widths where they sit side by side, assert that the first
  line box of each card's body copy has the same top (±1px) in every locale. Measure the text lines, not the box
  heights: vida #74 notes that `min-h` guarantees the boxes either way. **Fully testable.**
- **False-positive risk:** medium. Some boards are deliberately ragged, and vida #74 says nobody decided on that grid's alignment. Rows need an opt-in.

---

## Single-site rules (kept by the operator, 2026-09-29)

Each is evidenced mainly on one site. The operator kept these six and cut three: the scroll-follower that must never jump, the column gutter ("we want them flush for some designs"), and mobile-is-not-the-comp-scaled-down.

- **Labels sit on the baseline of the text beside them, then 1px higher.** Seen 4× on reddoor-website: #213, #217, and
  `RailRow.svelte:39` quoting Tim: "the baseline of this text should align to the baseline of the headline to the right".
  Tim's follow-up (#217): "It's technically perfect … but it's visually feeling low … can you move it 1 px up".
  _Fully testable_ with a zero-height inline-block marker. Measure with reduced motion on (`workJournal.md:1306`, where a 13px phantom defect came from a live transform).
- **Typographic quotes only, and an opening quote hangs.** Seen 3× on reddoor-website. #202, Tim: "How do we correct it so it only
  uses the beautiful apostrophes?" Tim asked in 2026-03 and again on 2026-09-17 (`Testimonial/index.svelte:95`).
  _Fully testable:_ scan the prerendered HTML for straight `'` and `"` in text nodes.
- **Logos in a grid are optically balanced:** centred in their cells, sized per logo, and consistent across
  colourways. Seen 5× on reddoor-website (#201, #226, #227, #230). #227, Tim: "can you center each column? … the Enzo's logo
  looks odd left aligned". _Partly testable:_ the centring within 1px is testable, but "optically equal" is judgment.
- **Every string a visitor reads is in the page's language,** including the skip link, dialog names and validation
  messages. Seen 5× on vida (#34, #45, #62: "English shipped to Spanish readers three separate times, each round found
  by eye"). _Fully testable_ with per-locale aria snapshots (`tests/__aria__/`). This only matters for bilingual sites.
- **The wave divider is one clean period, and nothing touches it.** Seen 5+4× on beachfront (`LEDGER.md:3534`, "sine should be only
  up/down on each page landing at the same height"; `tests/interaction/wave-divider.spec.ts` `MIN_CLEARANCE = 8`)
  and once on gallerysonder (#27). The clearance half is really rule 6.
- **Modals are centred, keep a side gutter, scroll-lock the page, and show a cue when the sheet scrolls.** Seen on the starter and on vida
  (reddoor-starter #142: "the open modal's gaps were **16px left and 737px right**"; vida #28, #43).
  _Fully testable_ (`tests/interaction/modal-centring.spec.ts` exists in both starters). This could be promoted to the main list.

## Rules for the written guide (judgment-only, or about the process rather than the page)

These go in the starter's written guide, per #674. A model can read them but cannot be graded on them.

- **Match the comp by measurement, not by eye. Every fix cites its source number.** Seen on vida `CLAUDE.md:179`,
  29-navy `CLAUDE.md:268`, reddoor-starter #82 and #115, and Tucker in meta-week `week-03:456` ("we're supposed to match the figma
  exactly, that's why its there"). The match harness (`src/recipes/match-harness/`) and `scripts/figma-compare/`
  are the instruments. The rule itself needs a comp, so it is not a page property.
- **Translate Figma's model before comparing numbers.** Figma trims text boxes to cap height, per text style rather
  than per family (vida #28, #65; reddoor-starter #117). Strokes sit inside the box (roalson #72).
- **Every departure from the comp is deliberate and written down with its reason.** Seen on vida #21, 29-navy #22,
  reddoor-website #128 ("Deviations from the board — all deliberate"), and 29-navy's and beachfront's `LEDGER.md`.
- **Where the comp draws nothing, design from the system and list each invention for the designer.** Seen on roalson #61, #162
  and `docs/stage-a-inventory.md:46`.
- **When a designer's number breaks a site floor, ship the nearest passing value and tell them.** Seen on beachfront #38:
  "Told him the number on the pin rather than rounding it quietly."
- **A design pin applies to the element it is anchored on.** Seen in meta-week `04-journal:853`: "Her 51:42 comment … is
  pinned on the FIT Health Club BODY link", which became a nav-wide change that had to be reverted.
- **Never redraw an asset in CSS when the file exists. Ship the file.** This line is in the CLAUDE.md of vida, 29-navy,
  roalson and reddoor-starter.
- **A call to action is worded the same everywhere, and one offer shows per view.** Seen on beachfront `LEDGER.md:2989`
  ("Everywhere that says 'book an appointment', it needs to say 'request'"), roalson #88 (every portfolio button says Properties), and reddoor-website #78 and #174 ("two of
  the same CTA in view at once reads as a mistake"). _Partly testable_ (a label inventory), but which label is right is judgment.
- **A change promised to be invisible is proven pixel-identical.** Tucker, revogen (meta-week `proj-03:577`): "make sure to
  check in future that the pixels don't change if you promise a change of this nature."
- **Icon strokes match the weight of the type beside them.** Seen on reddoor-website #42 and #166.
- **Alignment and size are judged on painted ink, not CSS boxes.** Seen on the-pointe (Nicole, meta-week `04-journal:868`: "equal width
  in that row is not equal size to the eye") and reddoor-website `commits.jsonl:1968` ("centre step numerals on their ink").

## Seen once (kept by the operator, 2026-09-29)

The operator kept five of the sixteen and left the rest.

- **Only one floating control holds a screen corner at a time,** inset 24px (reddoor-website #174, `workJournal.md:914`, 2026-09-09).
- **Page transitions flash white or brand colour, never black.** beachfront `LEDGER.md:2940`, 2026-08-10: "it goes black and then loads the next page".
- **A manual carousel turn animates like an automatic one.** roalson, the operator, `workJournal.md:9122`, 2026-09-23.
- **User navigation on a carousel restarts the autoplay delay.** 29-navy #22, 2026-09-11.
- **Hidden images (popups, floor plans) are warmed after load so they do not pop in.** 29-navy #17, 2026-09-10.

## Flags (worth raising in review, not rules)

### F1 (was rule 23). Each image is art-directed per breakpoint: a phone gets a portrait crop anchored on the subject, not the CMS auto-crop or the desktop master

**≈15 instances on 4 sites.**

- vida-legacy-foundation `src/lib/components/HeroBackgroundImage.svelte:6`: "on a phone a full-bleed hero is PORTRAIT while the master is landscape (hence the optional art-directed <source>"
- reddoor-website `docs/workJournal.md:332`, 2026-09-14: "The smoke test that refuses an untouched auto-crop as the phone backdrop is what makes the distinct mobile crop a requirement rather than a habit."
- meta-week `_research/proj-04-client-sites-quiet.md:323`, 2026-08-10, Erik (hedloc): "Anchor the image so that we either see more of the bookshelf or more of the coffee table, whichever one is more pleasing?"

- **Check:**
  - On a full-bleed hero at 390×664, assert that the image served is a distinct portrait-ratio rendition (from a
    `<picture><source media>` or a Prismic thumbnail other than the main one), not the landscape master scaled
    by `object-cover`.
  - Assert that `object-position` is set, not the default `50% 50%`, wherever the author provided a focal point.

  **Partly testable.** Whether the crop is _good_ (the face, the couch) is judgment.

- **False-positive risk:** medium. A band that keeps the comp's landscape shape at every width needs no portrait source (vida `docs/layout.md:209`).

## What the seeds turned into

- **"Blocks align to the content width unless explicitly full-bleed"** is confirmed as the top rule (rule 1). It needs an explicit opt-in first, because none exists today.
- **"A container class passed from outside must not collapse the page gutter"** has **no recorded defect** in any
  source this pass could read. reddoor-starter's `ContentWidth` already protects its gutter against a passed
  `class`. Whether the note came from Discord remains a question for the second pass. Until then it does not qualify under #674's
  own bar ("fail on at least one real page").
- **"Blend modes and transforms"** is confirmed but thin (rule 24): about 6 instances, all reddoor-website plus one on beachfront.
- **"Heading level and visual size are decoupled"** is confirmed and broad (rule 9). The cheapest half is enabling axe's
  best-practice heading rules, which the fleet filter excludes today.
- **"Motion respects reduced-motion"** is confirmed as the broadest rule (rule 2, all 8 repos).

## Already built somewhere, to reuse rather than rewrite

- `src/audits/browser.ts:852`: mobile horizontal overflow (rule 7, first half).
- `src/prospect/site-checks.ts` (`mobile-overflow`, h1 checks) and `src/prospect/crawl.ts:876` (text under 12px).
- `src/audits/util/reveal-below-fold.ts`: settles scroll reveals before axe (rule 3).
- `src/audits/util/contrast-unmeasured.ts`: reports contrast axe could not measure (rules 3, 24).
- `src/recipes/a11y-fixtures-page/`: the route that renders every slice state (rule 15).
- `src/recipes/match-harness/`: the comp and reference fidelity gates (guide rule 1).
- In the site repos: `industry-width.spec.ts` and `industry-mobile.spec.ts` (reddoor-website); `pill-label.spec.ts` and
  `wave-divider.spec.ts` (beachfront); `namelist-hover.spec.ts` (gallerysonder); `modal-centring.spec.ts` and
  `reveal-no-js.spec.ts` (starters); `tests/a11y/home.spec.ts` hover and open (29-navy); `theme-utilities.test.ts` and
  `focus-floor.test.ts` (roalson). Each is one site's version of a rule above, and a ready-made fixture for
  "fails on a real past page".

## The second pass: what it needs

The pass reads Discord, Figma comments and the MarkUp boards, and it re-reads `reddoorla/claude-skills`.
`claude-skills` is no longer blocked: it attached to a cloud session on 2026-09-29. The other three need
credentials, network access, and one decision about where the corpus lives.

**Where it runs.** There are two options:

- **On the laptop.** Everything is already there: `DISCORD_BOT_KEY` in the repo `.env`, and `MARKUP_API_KEY` in
  `~/.config/reddoor-maint/credentials.env`. Discord calls have to run unsandboxed, because `discord.com` is off
  the sandbox allowlist. Figma still needs a token.
- **In the cloud.** The environment needs three read-only secrets and matching network access:
  - `DISCORD_BOT_KEY`, with `discord.com` allowed;
  - `FIGMA_TOKEN`, with `api.figma.com` allowed. It is a personal access token with `file_content:read` and
    `file_comments:read`.
  - `MARKUP_API_KEY`, with MarkUp's API host allowed.

**Inputs from the operator:**

1. **Which Figma files.** The Figma API cannot list every file. It needs the team ID, or the project IDs, that
   hold the client comps. Pinned comments are read per file.
2. **Scope of Discord.** The default is every project channel in the guild, over its whole history. A date floor
   would cut the cost. The five members are all Reddoor, so the corpus is colleague notes, not client voice.
3. **Where the raw corpus lives.** #674 says the mined corpus cannot go in a public repo, and this repo is
   public. Only rules and synthetic fixtures are committed here. On the laptop the corpus can live in
   `~/.config/reddoor-maint/`. A cloud session keeps nothing, so from the cloud it needs a private repo to push
   to.

**What it produces:**

- new instances added to the existing rules;
- rules that surface for the first time;
- a specific search for the gutter-collapse seed, which has no instance in any source read so far.
