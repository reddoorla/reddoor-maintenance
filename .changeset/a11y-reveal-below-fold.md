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
Animations, lets two frames and a task pass, looks again, and stops when none
are left or 5 s are spent. It has to look again, a frame later, because a
delayed Svelte 5 intro runs a placeholder animation first and starts the real
one in the placeholder's `onfinish`, which fires at the next rendering update. The routine is
`revealBelowFold` in `src/audits/util/reveal-below-fold.ts`. As with
`classifyRouteResponse`, the spec gets that function's own source through
`toString()`.

A new test runs the generated spec in real Chromium against two throwaway
sites. Every mutation below turns it red:

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
- Settle before the return to the top: an animation the return itself starts
  is measured at its start.
- One `getAnimations()` read and stop, or no frame wait between reads: the
  delayed two-stage intro (alone on its route) is measured mid-animation.
  Skipping the settle altogether also misses a plain two-second Web
  Animation.
- Waiting on infinite animations too: a spinner eats the whole budget.

**What each route's pass did is recorded.** The artifact gains
`reveals: [{ route, steps, stepPx, capped, scrollHeight, finalScrollY,
unsettled }]` beside `skipped`. A route whose pass hit the 400-step cap, left
animations running after 5 s, or did not get back to the top is named in the
summary (`reveal pass incomplete on …`) and moves the audit to `warn`. It never
causes a `fail`. A fixture route with an 8 s animation and a scroll listener
that fights the return produces that warn from the pass's own measurements.
The step cap is held by unit tests only, because reaching it takes a page some
200 screens tall.

**Violations inside cross-origin frames are counted, not failed.** The pass
brings lazy third-party iframes into load range, such as a Google Maps footer
embed or a YouTube player. Those documents' violations are not the site's to
fix, and whether axe reached them at all depended on injecting into them within
a 1 s window. axe still runs in its default mode, as on main. Afterwards, a
violation node whose target is nested inside a frame whose `src` is on another
origin is dropped. Every `frame-focusable-content` node is kept, because that
rule is the site's own defect: an `<iframe tabindex="-1">` whose document still
has something to focus, which axe can only see from inside the frame. Frames
with no `src`, `about:`/`data:`/`srcdoc` frames, and targets that cannot be
resolved stay the site's. The artifact gains `frameNodesDropped: [{ route,
count, rules }]`, and the summary names them as information
(`N violation nodes inside cross-origin frames not counted: …`). This never
changes the status.

Two other mechanisms were tried and rejected. `{ iframes: false }` is ignored
by @axe-core/playwright 4.13's default mode (verified: identical results).
Legacy mode skips cross-origin frames, but it also drops
`frame-focusable-content`.

**Uncaught errors from another origin are named, not failed.** Playwright
reports an exception thrown inside an out-of-process iframe as a `pageerror`
on the page, so a lazy embed that throws on load would have failed the site as
a critical `client-error`. Each error is now classified by the first `at <url>`
in its stack. An error whose URL is on another origin than the route being
visited goes into `thirdPartyErrors: [{ route, source, message }]`. It does not
fail; the summary names it by route and origin, and it moves a clean run to
`warn`. An error whose stack names no URL stays the site's. Every `client-error`
entry now carries `source`, the stack's first URL.

**Each route ends on `about:blank`.** Navigating to route B keeps route A's
document alive until B commits. An error that A's timers threw late therefore
used to be charged to B. Each route, in both the axe loop and the smoke loop,
now ends with a navigation to `about:blank`.

**New ways a site can turn red on this bump.** Each reflects something a reader
hits:

- Content that is mounted or revealed on scroll is now audited, including
  reveals and lazy-mounted components. Contrast debt there shows up now.
- An error the site's own code throws while the page is scrolled is a
  `client-error`, exactly as on load. The pass runs IntersectionObserver and
  scroll callbacks that never ran under the gate before; on roalson-interests
  it boots MapLibre. An error thrown while the pass was running is labelled
  `while the reveal pass ran: …` in the artifact and `(while the reveal pass
  ran)` in the summary. The label marks a time window, not a cause: a late
  hydration error can land inside it, and an error the pass triggers through
  async work can land after it.

**New ways a clean site can move to `warn`:** a reveal pass that stopped short,
and an uncaught error from another origin.

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
routes. Every route's reveal pass completed (4 to 55 steps, nothing capped or
left running, each ending back at the top), no frame nodes were dropped, and no
third-party errors were recorded.
