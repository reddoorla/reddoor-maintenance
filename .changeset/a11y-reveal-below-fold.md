---
"@reddoorla/maintenance": minor
---

a11y audit: the page is scrolled through before axe runs, so content revealed on scroll is audited in its revealed state (reddoorla/roalson-interests#100)

The generated spec navigated each route and ran axe at the top of the page. It
never scrolled. Anything a `use:animateIn`-style action hides until it first
intersects the viewport was still at the inline `opacity: 0` it waits in when
axe ran, and axe does not measure contrast through that: the text dropped out
of `color-contrast` (or came back `incomplete`), and the gate fails only on
violations. The injected `transition:none` sheet could not help, because no
reveal had started. On roalson-interests the homepage featured card starts at
1021.72px in a 900px viewport, so its seven text nodes went unmeasured. The
gate stayed green, but it was checking less of the page.

Before axe runs, each scanned route is now scrolled from top to bottom in
half-viewport steps. The spec waits for the reveals to settle, then returns to
the top. The routine is `revealBelowFold` in
`src/audits/util/reveal-below-fold.ts`. As with `classifyRouteResponse`, the spec
gets that function's own source through `toString()`, so the tests exercise the
code that ships rather than a transcription. A new test runs the generated spec
in real Chromium against a throwaway site, and three mutations turn it red:

- **No scroll.** The fixture's two planted contrast failures below the fold are
  reported as 0 violations. This is the defect.
- **Whole-viewport steps.** A reveal observed with a `-25%` bottom `rootMargin`,
  sitting in the bottom quarter of the second screen, is never observed. Half
  steps cover any bottom margin down to -50%.
- **No `behavior: "instant"`.** The fixture sets `scroll-behavior: smooth` on
  `html`, as sites do for readers who have not asked for reduced motion. Every
  `scrollTo` then starts an animation that the next one retargets, so the
  viewport never reaches the reveals and nothing is measured.

Settling waits for running finite Web Animations, bounded at 5 s, because Svelte
5 transitions run on the Web Animations API and the injected sheet cannot stop
them. A reveal delayed only by a bare `setTimeout` is not covered, and neither
is a page that scrolls an inner container instead of the window.

**This can turn a site red.** Below-the-fold content that was never measured
is measured now, so a site with contrast debt in revealed content will see it
on this bump. That debt existed before this change. The audit simply did not
see it.
