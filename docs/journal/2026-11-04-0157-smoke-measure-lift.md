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

**Defects review found.** Round 1 had three majors and a minor, all reproduced before they were fixed. `will-change: filter` on an inline span is a containing block. `flow-root list-item` is a block container. The probe could be reached by page CSS and was unscaled under zoom. And no fixture pinned a resolved inset (5c and 5d now do). REVIEW_LATER

**What a visitor sees.** Nothing yet. The sites keep their inline copies until each adopts the export after the operator merges a release (#1934).
