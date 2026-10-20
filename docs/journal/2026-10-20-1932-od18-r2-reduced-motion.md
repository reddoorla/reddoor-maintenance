## 2026-10-20 — OD 18 / #674: R2, the reduced-motion check (this PR)

The operator chose on 2026-10-20 to encode first the rules nobody reviews by eye, and R2 (reduced motion) leads them. This PR adds `src/audits/design-rules/` with R2 as its first rule. A page is loaded under an emulated `prefers-reduced-motion: reduce` and sampled at the top, at every half-viewport step and back at the top. It fails on a computed `animation-delay` or `transition-delay` above zero, or on any animation (CSS, transition or Web Animations API) with more than 20 ms left or no end. `scripts/design-rules.mts <url…>` runs it. Nothing runs it on its own: wiring it into the nightly audit or a site's CI is a later, per-repo step.

**Proved on known-good pages first.** On 2026-10-20 at 19:30Z, live www.beachfrontdentistry.com and vidalegacy.org both pass, with 21 and 13 samples. Beachfront carries df53dee's delay reset. Only then were the two failures read as findings:

- **reddoorla.com:** the hero arrow's infinite `pos-y-wiggle`, and a 1000 ms `transition-delay` on the opening image. There is no reset at all in `app.css`.
- **gallerysonder.com:** a delayed caption transition, and a 400 ms Web Animations API animation on the page wrapper, which no CSS reset can reach. Which component starts it was not traced; the site imports `svelte/transition` directly in about 19 places.

A research pass predicted both from source before the run.

**Corrected on contact: R2 has no real past page.** The brief asks for a check that fails on a real past page. The obvious one, beachfront at df53dee^ (the reset without delays), was built and served here. It passed, with 0 findings over 21 samples. The `delay-1000` components that the reset failed to zero were rendered by no route. A research pass over seven fleet repos found the same everywhere: the reduced-motion "fixes" in the record closed latent holes, and no past commit rendered the motion on a page. The two failing pages above are current, not past. So the brief's "fails on a real past page" is not met for R2 as written. The nearest are the test fixtures, which copy the starter's reset verbatim from before and after #135, and the two current pages.

**Review round 1 was dirty, and the false passes were the instrument's.**

- **False passes.** The false-pass lens reproduced pages that plainly break R2 and passed:
  - a 600 ms menu slide, because no duration was read;
  - an entrance that finished before `load`;
  - motion inside open shadow roots, which `document.getAnimations()` does not return in Chromium;
  - a same-origin iframe;
  - a paused reveal stuck at its first frame;
  - a delay on `::after`;
  - a delay only the phone breakpoint has;
  - a page that scrolls a container rather than the window;
  - a `requestAnimationFrame` tween;
  - a WAAPI fade a timer starts at 400 ms.
- **False fails.** The noise lens reproduced:
  - a scroll-driven progress bar reported as "no end";
  - an `animation-name` no `@keyframes` defines;
  - a list entry past the property count;
  - a 31 ms delay on gallerysonder's captions;
  - selector paths that `querySelector` rejects.

The check now:

- reads durations as well as delays, per name;
- walks open shadow roots and same-origin frames;
- runs at 390×844 as well as 1440×900;
- steps the page's own scroller when the window cannot scroll;
- waits 1.5 s and diffs the motion styles of every unanimated element;
- does not judge scroll-driven animations, and counts them in the note;
- floors everything at 50 ms;
- escapes its paths.

Each of those is held by a fixture and a mutation.

**Re-proved after the round**, live at 19:53Z. beachfront passes (42 samples, both widths) and vidalegacy.org passes (32). beachfront at df53dee^ still passes. gallerysonder fails with 12 findings and reddoorla.com with 241: the latter has no reset at all, so every hover and reveal duration counts.

**Mutations.** Each turns at least one test red:

| Mutation                                 | Red tests |
| ---------------------------------------- | --------- |
| ignoring `animation-delay` (the brief's) | 2         |
| ignoring durations                       | 5         |
| no shadow walk                           | 1         |
| no frames                                | 1         |
| no pseudo-elements                       | 1         |
| paused skipped                           | 1         |
| no script diff                           | 1         |
| no container scroll                      | 1         |
| lists not aligned to names               | 1         |
| scroll-driven judged                     | 1         |
| the delay fold dropped                   | 2         |
