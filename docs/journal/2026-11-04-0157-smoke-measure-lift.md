# 2026-11-04 — The fleet's mobile-overflow `measure()` moves into maintenance, with #1892's six findings fixed (#1892)

Where it landed: this PR (branch `claude/1892-measure-lift`), which closes https://github.com/reddoorla/reddoor-maintenance/issues/1892. Follow-ups: https://github.com/reddoorla/reddoor-maintenance/issues/1934 (each site adopts the export after a release) and https://github.com/reddoorla/reddoor-maintenance/issues/1933 (the holes #1892 left out of scope). The operator's choice is workspace `decisions/2026-11-03-2231-1892-measure-has-no-maintenance-home.md`, option 1. The brief is workspace `briefs/2026-11-04-1892-measure-lift.md`.

**Why.** The cut-text check existed only as copies inline in each site's `tests/smoke/mobile-overflow.spec.ts`. #1892 found six holes in it after five review rounds, and none of the later ports fixed them. Fixing the check once, with fixtures in maintenance's CI, needed somewhere to keep it: `@reddoorla/maintenance/smoke`.

**The source.** Composition's copy at `63f5fcb` (11-03) was diffed against Williamson's, the one #1892 cites. The 151-line bodies are identical but for how the returned object is laid out. The first commit is that body unchanged, apart from indentation.

**Proving the instrument.** The fixture test checks every label against paint before asking `measure()`. It screenshots the screen's last two columns with the text and again with the text made transparent. On the unfixed lift, all 8 known-good fixtures passed, and every finding's fixture was red on the verdict alone.

**Beliefs corrected on contact.**

- **#1892's finding 1 was half wrong.** Text in an anonymous block beside a block child does get its ellipsis in Chromium (seen in a screenshot), so the proposed "no block-level sibling" clause would have made a false failure. It was dropped, and fixture 1b guards it.
- **"A box the visitor can scroll hides nothing" overstated the code.** A plain `overflow-x: auto` row holding one long line is reported cut by the site copy. That is #1892's out-of-scope scroll-container item, now in #1933.
- **My first fixtures for findings 4 to 6a were built wrong.** I wrote them with the clip inside the screen and the text cut at the clip. The instrument reports that as cut by design, because the visitor sees text cut mid-word. A false failure is a clip that leaves nothing of the line, and the fixtures were rebuilt that way, with a check that no text pixel paints anywhere. A known-good fixture now pins the rule.

**Finding 5 went to a probe, not a comment.** The `-` test had failed twice, on `calc()` and on `margin-box`. Once the browser resolves the insets, both become one rule. Review round 1 then found that page CSS (`div:empty { display: none }`) and `zoom` reached the first probe. It now sits in a shadow root under an `all: initial` host and works in CSS pixels scaled to the box's screen rect. Inside a full-width section, the zoom error happened to give the right verdict, so its fixture is the reviewer's wide page, exactly.

**Mutations.** Each fix was reverted on its own against the final code, and each revert turned its own fixtures red and nothing else (the table is in the PR). A `keepNames` build turns the new dist check red with `__name is not defined`. Playwright sends the function to the page as source text, so a bundler helper breaks it only once built.

**Defects review found.** Round 1 had three majors and a minor, all reproduced before they were fixed. `will-change: filter` on an inline span is a containing block. `flow-root list-item` is a block container. The probe could be reached by page CSS and was unscaled under zoom. And no fixture pinned a resolved inset (5c and 5d now do).

Rounds 2 to 6 were all dirty, and every finding was rebuilt here as a fixture that was red before its fix. The work moved to a second session at 300k tokens of context, after round 2.

- **Round 2: two majors.**
  - `insetRect` applied the insets to the axis-aligned bounding rect. On `scaleX(-1)` with `inset(0 0 0 50%)` it kept the wrong half, so a cut line read fine. On a mirrored, turned or skewed box, or under one, the clip now narrows only to the border box, as the site copy did. It does not narrow at all for a negative inset or a margin box (5g to 5k).
  - `-webkit-box` and `-webkit-inline-box` lay out as flex boxes and draw no ellipsis (1d, 1e).
- **Round 3: one major, a regression.** A clipping box's padding box came from `clientWidth`, which is in CSS pixels, against a rect in screen pixels. Under `zoom: 2` the section came out half as wide as it paints. Once round 1 scaled the inset, a zoomed inset inside a section left nothing, so cut text read fine. The site copy caught it. Both sides now use one screen-per-CSS-pixel ratio (5l, 5m).
- **Round 4: two majors, both made by round 3's ratio.**
  - An outer `<svg>` has no offset size, so its ratio was 1 under zoom (4b).
  - A turned box's bounding rect is wider than the box, so the ratio stretched a rotated truncate box past the screen and its ellipsis read cut (1h). On a turned box the ratio is now 1, as in the site copy.
- **Round 5: one major and a nit.**
  - The major: text whose parent is `display: contents` was never measured, because `checkVisibility()` is false on a box-less element (7a, 7b, with the control 7c). It is fixed on the branch, but it is a hole the site copy has too, not one of the six, and it came after the fifth round. Whether to land without a sixth round went to the operator: workspace `decisions/2026-11-04-0315-1892-measure-round-5-hold.md`.
  - The nit: the inset probe makes inset-heavy pages about 4× slower. It is filed as https://github.com/reddoorla/reddoor-maintenance/issues/1937.
  - Folded in with the nit: `scripts/smoke-dist.mjs`'s pages now carry a doctype. They ran in quirks mode, where `clientWidth` is not the screen's.
- **Round 6, which the operator asked for: two majors, both in round 5's visibility gate, both shared with the site copy.**
  - A `display: contents` span set back to `visibility: visible` under a hidden box paints, but it was skipped, because the nearest box was asked about `visibility` (7d).
  - Slotted text under a hidden or `opacity: 0` wrapper around its `<slot>` was checked against its light-DOM host, which paints, so it read cut (7e, 7f).
  - Fixed: the gate starts from the slot, and `visibility` is read only from the text's own parent. Whether to land without a seventh round went back to the operator: workspace `decisions/2026-11-04-0352-1892-measure-round-6-hold.md`.

**More beliefs corrected on contact.**

- **Round 2's suggested control was wrong against paint.** Tailwind's `line-clamp-1` with `white-space: nowrap` added paints cut, with no ellipsis. `-webkit-line-clamp` makes `display` compute as `flow-root` and `text-overflow` as `clip` in this Chromium. So the line-clamp gate the review proposed was not needed: a computed `-webkit-box` is never clamped. Tailwind's own `line-clamp-1` (no `nowrap`) is the fine control, 1f.
- **Round 3's fix made round 4's defects.** Scaling every padding box by the bounding rect was right for zoom and a positive scale, and wrong for the two cases where the rect does not measure the box. The lesson is the one #1892 started from: each geometry rule needs its own fixture against paint, because the reasoning that justified the rule did not cover its edges.

**What a visitor sees.** Nothing yet. The sites keep their inline copies until each adopts the export after the operator merges a release (#1934).

Usage (first session, read 2026-11-04 01:58 UTC, slightly low): $6.17, 1185/81889 tokens, 14646108/279789 cache, rate limit allowed
Usage (second session, read 2026-11-04 03:18 UTC): $10.05, 2581/159131 tokens, 18699631/544648 cache, rate limit allowed
