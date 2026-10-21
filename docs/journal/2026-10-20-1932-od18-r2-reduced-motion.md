## 2026-10-20 — OD 18 / #674: R2, the reduced-motion check (this PR)

The operator chose on 2026-10-20 to encode first the rules nobody reviews by eye, and R2 (reduced motion) leads them. This PR adds `src/audits/design-rules/` with R2 as its first rule, and `scripts/design-rules.mts <url…>` to run it. Nothing runs it on its own: wiring it into the nightly audit or a site's CI is a later, per-repo step.

What it reads, after five dirty review rounds and the operator's call on the fifth:

- **Where.** Under an emulated `reduce`, at 1440×900 and 390×844, at the top, at every half-viewport step (the window's, or the page's own scroller's), back at the top, and through a last 1.5 s. Open shadow roots and the page's own frames (same origin, srcdoc, about:blank) are read with it.
- **What fails.**
  - Delays above 50 ms, whatever they delay, and durations above 50 ms on what moves, per animation name or transition property. Fades (opacity only), colour transitions, unknown keyframe names and names the page pauses are not judged by duration.
  - Running animations that are not fades, CSS or WAAPI, scroll-driven ones included unless they only change size.
  - A finite animation paused short of its end.
  - `scroll-behavior: smooth`, and a video playing.
  - Motion a script drives: an inline motion value that changes at two consecutive reads 100 ms apart, or four times in the last wait. A script parallax is not covered.

**Proved on known-good pages first, and again after each round.** The code as it lands, after the operator's round-5 answers, live from 23:33Z to 23:39Z:

| Page                        | Result                                             |
| --------------------------- | -------------------------------------------------- |
| www.beachfrontdentistry.com | **PASS** in 7 of 7 measured runs, 152 samples each |
| vidalegacy.org              | **PASS**, 122 samples                              |
| the prepare-then-show page  | **PASS** (round 5's false fail)                    |
| gallerysonder.com           | **FAIL**, 7 findings                               |
| reddoorla.com               | **FAIL**, 100 findings                             |

One more beachfront run read UNMEASURED on a 30 s page-load timeout and was re-run, as the check is meant to say rather than guess.

gallerysonder's 7 findings are caption transition delays at 700 ms, which its durations-only reset leaves. Its eight 400 ms Web Animations are fades, so they no longer count.

reddoorla.com's 100 findings, from a page with no reset at all:

- 74 transition durations of motion properties;
- 13 transition delays at 1000 ms;
- six animation durations, and six infinite `pos-y-wiggle` arrows;
- one Web Animation.

The note names the fix: no `prefers-reduced-motion` reset reaches 80 elements. Before the fade ruling, at 23:06Z, the same page gave 196 findings and 175 elements.

Counts move from run to run with what a live page loads, which is why every number here carries its time. At 21:20Z, the round-3 head gave gallerysonder 20 findings, five of them inside Vimeo's player. The round-3 review traced those five to a cross-origin frame sampled while it was still loading, a false fail now fixed.

**Corrected on contact: R2 has no real past page.** The brief asks for a check that fails on a real past page. The obvious one is beachfront at df53dee^, whose reset zeroed durations but not delays. I built and served it here, and it passes, because no route renders the `delay-1000` components that reset missed. A research pass over seven fleet repos, from source, found the same everywhere: the reduced-motion fixes on record closed latent holes, and no past commit rendered the motion on a page. So the brief's bar is not met for R2 as written. The nearest are fixtures that copy the starter's reset verbatim from before and after #135, and the two current pages.

**The review rounds.**

- **Round 1** found the first version blind. It read no durations and no shadow roots, frames, pseudo-elements or phone breakpoint, and it had no way to see a script tween. It was also noisy: scroll-driven progress bars, dead keyframe names, a 31 ms delay, and paths `querySelector` rejected.
- **Round 2** found that round 1's additions were too broad.
  - The scripted-motion diff missed real tweens: it skipped any element with a finished fill animation, and under the standard reset every inline write starts a 0.01 ms transition.
  - The same diff flagged one-off changes: a lazy-image class landing, late layout, a debounced header, a snapping carousel.
  - The duration check failed every hover colour fade.
  - One cross-origin Typekit sheet switched off the keyframes filter on every fleet page.
  - `@import`ed and `:host` keyframes were missed.
  - srcdoc frames counted as cross-origin.
  - A paused marquee, which is the honouring behaviour, failed.
- **The redesign that came out of round 2:**
  - scripted motion means consecutive changes, tracked by element identity;
  - keyframes are collected from every root first;
  - font hosts are exempt from the unreadable-sheet rule;
  - colour-only transitions don't count;
  - paused animations count only when they hide content.
- **A hang.** While re-proving that version live, one beachfront run did not finish in 11 minutes. A frame with an empty URL never answers `evaluate`. Frames now get 1 s and are counted as not sampled.
- **Round 3** found the redesign still short on the rule's own text, with fixes for each:
  - **False passes:**
    - a finite entrance paused at its first frame;
    - a script parallax;
    - a `scroll()` hero (the size-only exemption had covered every `scroll()` animation);
    - an escaped keyframe name;
    - a 4 fps ticker.
  - **False fails:**
    - a still-loading Vimeo frame judged as the site's;
    - Tailwind v4's `transition-colors`;
    - a faint paused marquee;
    - a `scaleX` progress bar.
  - **Unheld behaviour:**
    - the per-step window;
    - the cap;
    - the frame timeout;
    - most scripted channels;
    - the font-host exemption;
    - the running colour filter.
  - **Admitted rather than built:**
    - a script's delay before it shows an element, which a read cannot tell from a slide swap;
    - an element re-created every frame;
    - two snaps 100 ms apart.
  - **Fit:** the suite now runs concurrently, from 97 s of test time to 30 s.
  - **Put to the operator, not recorded and moved past:** the missing real past page, and whether opacity-only transitions count.
- **Round 4** was dirty again, with the same pattern: each round's widening left an edge the next lens found.
  - **False passes:**
    - a `view()` hero zoom (a uniform `scale()` was read as size, like a progress bar's `scaleX`);
    - a hero parallax that moves only for the hero's height (two fresh steps, from the top window's baseline);
    - `scroll-behavior: smooth` left on;
    - an autoplaying video;
    - a line drawn by its dash offset and an image wiped in by `clip-path`, whose transitions were not on the motion list;
    - `margin-right` and `margin-bottom` tweens.
  - **Unheld behaviour:** `transition: all`, opacity and margin durations, a hiding header (it must pass), the size-only note, the reset hint's threshold, the CLI's severity order.
  - **A defect in the note:** the reset hint counted findings, so one element with both a transition and an animation duration counted twice. It counts elements now.
  - **Usage:** an unknown option such as `--jsno` was read as a URL; it is now a usage error.
  - **Admitted rather than built:** an element's own vertical scroll (the page's own scroller moves with every step), SMIL, and three known false fails: what a script moves with the scroll to show progress or to stay put reads as parallax.
  - **Not built:** a running transform transition as its own fixture. Finite running findings fold into the duration finding by design, so no test could tell the running read from the duration read.
- **Round 5** was dirty, the fifth in a row, so it went to the operator instead of a sixth round (workspace `decisions/2026-10-20-2317-od18-r2-round-five-dirty.md`). Both blocking findings were in round 4's scroll-linked read, the one meant to catch a script parallax:
  - **The known-good page failed intermittently.** The defensive lens ran www.beachfrontdentistry.com 7 times; 2 failed, on `.ask-the-doctor-headshot img`, a lazy fade-in that never moves. My one run at 23:03Z had passed, which is how a two-in-seven failure gets past a single proof. A plain 12-block page whose script prepares each block below the fold and shows it on entry failed every run, with 10× "parallax". The read counted any element that took a fresh value at two scroll steps running, and prepare-then-show is exactly that.
  - **A progress bar written as `scale(x, 1)`** read as parallax; only `scaleX`/`scaleY` counted as one-axis.
  - **The cut lens was clean**, with four minors: a stale doc comment, the about:blank frame label with no test, `filter` and `background-position` on the motion list with no fixture, and `style.scale` read with no fixture.
- **The operator's answers, 2026-10-20, by AskUserQuestion:**
  - **Cut the scroll-linked read and land.** It is gone, with its two tests. A script parallax is now in the header's "not covered" list; a CSS `scroll()` or `view()` parallax is still caught. The prepare-then-show page is a fixture that must pass.
  - **The stand-in is accepted** for the real-past-page bar, for R2 only.
  - **Fades are not motion.** An animation whose keyframes change only opacity, an opacity transition, and a script tweening only opacity are no longer judged by duration or by running. A delay still counts whatever it delays: R2's text says delays go to zero, and the brief's own mutation fixture is an opacity entrance held by its `animation-delay`. I recorded that reading in the decision file, because it is mine and not the operator's words.
  - Folded with the cut: `scale(x, 1)` counts as one-axis in both places, the motion list is one constant, `filter` is off it, `background-position` and `style.scale` have fixtures, and the doc comment is current. The about:blank label stays untested; it only names a frame.
- **Abandoned:** a planned split of the sampler into full and light reads. Once the frame timeout was in, the full sampler took about 30 s a page, and the split script had silently not applied anyway; the tests and mutations below ran against the unsplit code.

**Mutations.** Each turns at least one test red. Three rows went with the cut read (no scroll-linked read, parallax needing three steps, no top-window baseline):

| Mutation                                    | Red tests |
| ------------------------------------------- | --------- |
| ignoring `animation-delay` (the brief's)    | 7         |
| ignoring durations                          | 5         |
| no shadow walk                              | 1         |
| no frames                                   | 1         |
| no pseudo-elements                          | 1         |
| paused animations skipped                   | 1         |
| no script diff                              | 1         |
| no container scroll                         | 1         |
| lists not aligned to names                  | 1         |
| scroll-driven judged                        | 1         |
| the delay fold dropped                      | 2         |
| any second change counted as scripted       | 1         |
| colour transitions judged                   | 1         |
| paused names read statically                | 1         |
| every paused animation reported             | 1         |
| `@import` not followed                      | 1         |
| `@media` not walked                         | 1         |
| `view()` not judged                         | 1         |
| cross-origin frames sampled                 | 1         |
| no per-step window                          | 1         |
| endless running folded                      | 1         |
| the cap always reported                     | 1         |
| a per-step window of one read               | 1         |
| no step cap                                 | 1         |
| silent frames not counted                   | 1         |
| unreadable sheets never make names unknown  | 1         |
| running colour transitions judged           | 1         |
| one scripted channel (`translate`) not read | 1         |
| a frame's `scroll()` count not merged       | 1         |
| paused finite animations allowed            | 1         |
| escaped keyframe names not kept             | 1         |
| `scroll()` never judged                     | 1         |
| no slow-stepper read                        | 1         |
| the stepper rule without distinct values    | 1         |
| a foreign frame document kept               | 1         |
| transition durations for any property       | 1         |
| scale kept in the scripted read             | 1         |
| smooth scrolling not read                   | 1         |
| a playing video not read                    | 1         |
| dash offset and clip-path not motion        | 1         |
| a uniform `scale()` read as size            | 1         |
| `margin-right` not read                     | 1         |
| the reset hint counts findings              | 1         |
| an unknown option read as a URL             | 1         |
| a fade's keyframes judged by duration       | 1         |
| a running or paused fade judged             | 1         |
| `scale(x, 1)` not one-axis                  | 1         |
| `background-position` not motion            | 1         |
| the `scale` property not read               | 1         |

The suite is 72 tests, run concurrently.
