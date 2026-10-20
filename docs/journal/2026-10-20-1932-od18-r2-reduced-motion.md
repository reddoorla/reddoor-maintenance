## 2026-10-20 — OD 18 / #674: R2, the reduced-motion check (this PR)

The operator chose on 2026-10-20 to encode first the rules nobody reviews by eye, and R2 (reduced motion) leads them. This PR adds `src/audits/design-rules/` with R2 as its first rule, and `scripts/design-rules.mts <url…>` to run it. Nothing runs it on its own: wiring it into the nightly audit or a site's CI is a later, per-repo step.

What it reads, after two dirty review rounds:

- **Where.** Under an emulated `reduce`, at 1440×900 and 390×844, at the top, at every half-viewport step (the window's, or the page's own scroller's), back at the top, and through a last 1.5 s. Open shadow roots and the page's own frames (same origin, srcdoc, about:blank) are read with it.
- **What fails.**
  - Delays and durations above 50 ms, per animation name or transition property. Colour-only transitions, unknown keyframe names and names the page pauses are ignored.
  - Running animations, CSS or WAAPI, `view()` reveals included.
  - A paused animation that holds its element hidden.
  - Motion a script drives frame by frame: an inline motion value that changes at two consecutive reads 100 ms apart.

**Proved on known-good pages first, and again after each round.** The round-4 head, live at 22:22Z:

| Page                        | Result                 |
| --------------------------- | ---------------------- |
| www.beachfrontdentistry.com | **PASS**, 152 samples  |
| vidalegacy.org              | **PASS**, 122 samples  |
| gallerysonder.com           | **FAIL**, 15 findings  |
| reddoorla.com               | **FAIL**, 184 findings |

gallerysonder's 15 findings: eight Web Animations API fades at 400 ms, and seven caption transition delays at 700 ms, at 390 px only.

reddoorla.com's 184 findings:

- six infinite `pos-y-wiggle` arrows;
- two Web Animations;
- 13 transition delays at 1000 ms;
- six animation durations;
- 157 transition durations of motion properties.

The note names the fix: no `prefers-reduced-motion` reset reaches 163 elements.

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
- **Abandoned:** a planned split of the sampler into full and light reads. Once the frame timeout was in, the full sampler took about 30 s a page, and the split script had silently not applied anyway; the tests and mutations below ran against the unsplit code.

**Mutations.** Each turns at least one test red:

| Mutation                                    | Red tests |
| ------------------------------------------- | --------- |
| ignoring `animation-delay` (the brief's)    | 5         |
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
| no scroll-linked read                       | 1         |
| `scroll()` never judged                     | 1         |
| no slow-stepper read                        | 1         |
| the stepper rule without distinct values    | 1         |
| a foreign frame document kept               | 1         |
| transition durations for any property       | 1         |
| scale kept in the scripted read             | 1         |

The suite is 62 tests, 30 s of test time, run concurrently.
