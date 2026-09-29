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
reveal had started. On roalson-interests, once the page had hydrated, 17 of the
216 contrast nodes on `/dev/a11y-fixtures` went unmeasured, including all 9 in
the featured card.

Before axe runs, each scanned route is now scrolled from top to bottom in
half-viewport steps with `behavior: "instant"`, re-reading the page height at
every step. The spec then returns to the top and lets the reveals settle. The
settle runs after the return and loops: it waits on the running finite Web
Animations, looks again, and stops when none are left or 5 s are spent. It has
to look again because a delayed Svelte 5 intro runs a placeholder animation
first and starts the real one only when that ends. The routine is
`revealBelowFold` in `src/audits/util/reveal-below-fold.ts`. As with
`classifyRouteResponse`, the spec gets that function's own source through
`toString()`.

A new test runs the generated spec in real Chromium against a throwaway site.
Every mutation below turns it red:

- No scroll: the fixture's planted contrast failures below the fold come back
  as 0 violations. This is the defect.
- Whole-viewport steps: a reveal observed with a `-25%` bottom `rootMargin` is
  never seen.
- No `behavior: "instant"`: under the fixture's `scroll-behavior: smooth`,
  nothing is revealed at all.
- Height read once: content added by a reveal that lengthens the page is never
  reached.
- No return to the top: a fixed bar that is legible only while scrolled is
  measured at the wrong offset.
- A single `getAnimations()` read before the return: the delayed two-stage
  intro is measured mid-animation. Skipping the settle altogether also
  misses a plain two-second Web Animation.

**What each route's pass did is recorded.** The artifact gains
`reveals: [{ route, steps, stepPx, capped, scrollHeight, finalScrollY,
unsettled }]` beside `skipped`. A route whose pass hit the 400-step cap, left
animations running after 5 s, or did not get back to the top is named in the
summary (`reveal pass incomplete on …`) and moves the audit to `warn`. It never
causes a `fail`.

**Cross-origin frame contents are no longer audited.** The pass brings lazy
third-party iframes into load range, such as a Google Maps footer embed or a
YouTube player. Those documents' violations are not the site's to fix, and
whether they were audited at all depended on injecting axe within a 1 s window.
axe now runs in @axe-core/playwright's legacy mode, which skips a cross-origin
frame when it does not answer axe's ping within 500 ms. Same-origin frames are
still audited inside, and the `<iframe>` element itself is still audited in the
top document (`frame-title` and the rest). `{ iframes: false }` was not
used: the default mode ignores it (verified), and it would also drop
same-origin frames.

**New ways a site can turn red on this bump.** Each reflects something a reader
hits:

- Content that is mounted or revealed on scroll is now audited: reveals,
  lazy-mounted components, and the `<iframe>` element of a lazy embed. Contrast
  debt or a missing frame title there shows up now.
- An error thrown while the page is scrolled is a `client-error`, as on load.
  It is labelled `during the reveal pass: …` in the artifact and
  `(during the reveal pass)` in the summary. The pass runs
  IntersectionObserver and scroll callbacks that never ran under the gate
  before; on roalson-interests it boots MapLibre.

**Still audited hidden, as before:**

- A reveal that toggles both ways, hiding again when it leaves the viewport,
  is hidden again by the return to the top.
- A CSS-keyframe reveal whose visible state exists only as its `forwards` fill
  stays hidden, because the injected `animation:none!important` cancels the
  animation and leaves the element at its hidden base style.
- A reveal delayed only by a bare `setTimeout`.
- A page that scrolls an inner container instead of the window.

The audit also runs whatever state the page is in when `load` fires. Under
`vite dev` that is often before hydration, so a reveal that mounts only after
the pass has scrolled past it is hidden at mount and not revealed again. This
was not observed on roalson-interests, warm or cold, and is not addressed here.

On roalson-interests the bump keeps the audit green: 0 violations across 5
routes, and every route's reveal pass completed (4 to 55 steps, nothing capped
or left running, each ending back at the top).
