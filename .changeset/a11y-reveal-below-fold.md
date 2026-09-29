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

A second group of mutations holds the attribution rules above:

- Classifying errors by stack URL, or falling back to the stack's origin when
  a cross-origin frame on the page shares it (the Vimeo shape), fails the
  library tests.
- No downgrade at all fails a lazy embed's error test.
- Calling every child frame cross-origin fails the same-origin frame and
  srcdoc facade tests. This applies to BOTH checks: their violation nodes
  must be kept, and their thrown errors must stay the site's.
- Checking only the outermost frame, or reading the `src` attribute, fails the
  wrapper-frame and facade tests.
- Treating a frame path that cannot be resolved as cross-origin fails a unit
  test with fake frames. No element, no frame, a throw, and no answer must
  all keep the node.
- Reading a frame without a time limit, or not settling the hydration smoke's
  errors, fails a live site whose home page crashes next to a lazy iframe that
  never loads. The first times out; the second loses the crash.

The exact length of the waits between steps and between settle reads, two
frames and a task, is a margin that no test holds.

**What each route's pass did is recorded.** The artifact gains
`reveals: [{ route, steps, stepPx, capped, scrollHeight, finalScrollY,
unsettled }]` beside `skipped`. A route whose pass hit the 400-step cap, left
animations running after 5 s, or did not get back to the top is named in the
summary (`reveal pass incomplete on …`) and moves the audit to `warn`. It never
causes a `fail`. A fixture route with an 8 s animation and a scroll listener
that fights the return produces that warn from the pass's own measurements.
The step cap is held by unit tests only, because reaching it takes a page some
200 screens tall.

**The rule for anything not counted against the site: positive evidence only.**
The pass brings lazy third-party iframes into load range, such as a Google Maps
footer embed or a YouTube player. What happens inside them is not the site's to
fix. But a thing is treated as the third party's only on positive evidence that
it happened inside a cross-origin frame. "Cannot tell" is always the site's,
and nothing moved out of the site's count is silent.

**Violations inside cross-origin frames are counted, not failed.** axe still
runs in its default mode, as on main. Afterwards, the spec walks each nested
violation node's frame path, stepping into shadow roots and through same-origin
wrapper frames. It asks each frame for the URL it actually loaded, so redirects
are followed and a srcdoc facade reads as `about:srcdoc`. A node is dropped only
if a frame on that path loaded an http(s) document from another origin.

Kept as the site's:

- every `frame-focusable-content` node. That rule is the site's own defect: an
  `<iframe tabindex="-1">` whose document still has something to focus, which
  axe can only see from inside the frame;
- a srcdoc facade over a cross-origin `src`;
- `about:`, `data:` and `blob:` frames;
- anything that cannot be resolved.

The artifact gains `frameNodesDropped: [{ route, count, rules }]`, and the
summary names them as information
(`N violation nodes inside cross-origin frames not counted: …`). This never
changes the status.

Two other mechanisms were tried and rejected. `{ iframes: false }` is ignored
by @axe-core/playwright 4.13's default mode (verified: identical results).
Legacy mode skips cross-origin frames, but it also drops
`frame-focusable-content`.

**Uncaught errors thrown inside cross-origin frames are named, not failed.**
Playwright reports an exception thrown inside an out-of-process iframe as a
`pageerror` on the page, so a lazy embed that throws on load would have failed
the site as a critical `client-error`.

Every frame now keeps its own log of uncaught errors and rejections. The spec
installs it with `page.addInitScript`, before each frame's first script runs.
A route's errors are settled against those logs when the route ends. An error
goes into `thirdPartyErrors: [{ route, frame, source, message }]` only when a
cross-origin frame's own log recorded the same message, and only as many times
as that frame recorded it beyond the site's own frames. The error does not
fail; the summary names it by route and by the origin of the frame that logged
it, and it moves a clean run to `warn`.

**Where the stack starts is never evidence.** A site that crashes inside a
library it loaded into its own page from another origin (Vimeo's `player.js`,
Turnstile's `api.js`, Google Maps) has a stack that starts on that origin, and
it is still the site's crash and still fails. Every `client-error` entry
carries `source`, the stack's first URL, for the reader only.

The browser can hide an error's message from the frame it happened in. These
cases move nothing:

- A site frame logged a hidden `Script error.`, or its log could not be read
  at all. Nothing on that route moves.
- A rejection inside a cross-origin script leaves no entry anywhere, because
  Chromium fires no `unhandledrejection` for it. Nothing can match it, so it
  stays the site's.
- An embed's error that its own window saw only as `Script error.` cannot be
  matched either, so it stays the site's and fails.

**Every frame read is bounded, and nothing held is dropped.** A lazy iframe
that has not loaded is still listed by Playwright, with an empty URL and no
document. That happens below the fold on the hydration smoke, which runs no
reveal pass, and for a `display: none` iframe anywhere. Reading its log would
wait forever, which would turn any uncaught error on such a page into a
5-minute hang with the crash unnamed. So:

- frames with no document are skipped;
- every other read, and every step of the frame-path walk, gives up after 2 s.
  A cross-origin frame that does not answer is no evidence, and a site frame
  that does not answer counts as a hidden entry;
- after the last route, anything still held is settled as the site's.

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
  `while the reveal pass ran: …` in the artifact and
  `(while the reveal pass ran)` in the summary. The label marks a time window,
  not a cause: a late hydration error can land inside it, and an error the
  pass triggers through async work can land after it.

**New ways a clean site can move to `warn`:** a reveal pass that stopped short,
and an uncaught error that a cross-origin frame's own log recorded.

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
