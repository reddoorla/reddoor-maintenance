## 2026-10-20 — OD 18 / #674: R2, the reduced-motion check (this PR)

The operator chose on 2026-10-20 to encode first the rules nobody reviews by eye, and R2 (reduced motion) leads them. This PR adds `src/audits/design-rules/` with R2 as its first rule. A page is loaded under an emulated `prefers-reduced-motion: reduce` and sampled at the top, at every half-viewport step and back at the top. It fails on a computed `animation-delay` or `transition-delay` above zero, or on any animation (CSS, transition or Web Animations API) with more than 20 ms left or no end. `scripts/design-rules.mts <url…>` runs it. Nothing runs it on its own: wiring it into the nightly audit or a site's CI is a later, per-repo step.

**Proved on known-good pages first.** On 2026-10-20 at 19:30Z, live www.beachfrontdentistry.com and vidalegacy.org both pass, with 21 and 13 samples. Beachfront carries df53dee's delay reset. Only then were the two failures read as findings:

- **reddoorla.com:** the hero arrow's infinite `pos-y-wiggle`, and a 1000 ms `transition-delay` on the opening image. There is no reset at all in `app.css`.
- **gallerysonder.com:** a delayed caption transition, and a 400 ms Web Animations API animation on the page wrapper, which no CSS reset can reach. Which component starts it was not traced; the site imports `svelte/transition` directly in about 19 places.

A research pass predicted both from source before the run.

**Corrected on contact: R2 has no real past page.** The brief asks for a check that fails on a real past page. The obvious one, beachfront at df53dee^ (the reset without delays), was built and served here. It passed, with 0 findings over 21 samples. The `delay-1000` components that the reset failed to zero were rendered by no route. A research pass over seven fleet repos found the same everywhere: the reduced-motion "fixes" in the record closed latent holes, and no past commit rendered the motion on a page. The two failing pages above are current, not past. So the brief's "fails on a real past page" is not met for R2 as written. The nearest are the test fixtures, which copy the starter's reset verbatim from before and after #135, and the two current pages.

**Mutations.** Ignoring `animation-delay` (the brief's) turns 2 tests red. Not scrolling turns 1 red, ignoring running animations 3, and dropping the emulation check 2.
