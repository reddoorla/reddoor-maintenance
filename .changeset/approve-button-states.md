---
"@reddoorla/maintenance": patch
---

approve button gets real feedback: a darker green success state, an in-flight
spinner, and hover/focus states across the site dashboard's controls.

- **Approved** is now `#14663c` instead of staying the idle `#2c7`, and it overrides
  the `:disabled` dimming — the button stays disabled after a successful approve, and
  a 60%-opacity "Approved" read as not-quite-finished. (It also lifts white-on-green
  contrast to ~7:1 for that state.)
- **Spinner** while the POST is in flight: a CSS `::after` ring, not injected markup —
  the handler is deliberately `textContent`/`title`-only so server strings can never
  become HTML, and a pseudo-element keeps that guarantee. The label goes transparent
  rather than being removed, so the button holds its width and the pending row never
  reflows mid-request. `aria-busy` carries the same news to screen readers, and both
  are cleared in a `finally` so no exit path can strand it spinning.
  `prefers-reduced-motion` slows the spin to 2.4s rather than freezing it — a stopped
  ring reads as a hung request.
- **Hover, active and focus-visible** on all four of the page's controls (approve,
  override toggle, override submit, trigger renovate), each `:not(:disabled)` so a
  dead button never invites a click. Keyboard focus was previously invisible on all of
  them.

Verified in a real browser across every state (idle/hover/loading/approved/disabled),
plus 17 new tests.
