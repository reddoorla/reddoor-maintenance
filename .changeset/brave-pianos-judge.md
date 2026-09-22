---
"@reddoorla/maintenance": minor
---

a11y audit: a crashed axe rule is a failure, not a pass (#888)

When an axe rule throws, axe does not fail it. It files one node under
`incomplete` carrying an `error-occurred` check and **skips the rule for the
whole page**, leaving `violations` empty — so an audit gated on violations goes
green having measured nothing.

That is what hid a 1.73:1 label on roalson-interests on 2026-09-18. axe 4.13.0
could not parse `oklch(0.205 0 none)` (Tailwind 4.3 gives 13 palette entries a
`none` hue, and the starter's Hero uses `bg-neutral-900`), so it skipped
color-contrast entirely. The page reported **0** contrast nodes where it should
have reported **61**, and two real failures were invisible. There is no axe
release that fixes the parse.

Two defences, because the two shapes fail differently:

- **A rule that ERRORS is now a violation**, `rule-errored`, carrying axe's own
  message. The summary prints that message rather than just the rule id,
  because "rule-errored on a11y fixtures" tells an operator nothing while
  "Unable to parse color oklch(0.205 0 none)" tells them exactly what to change.
- **A scanned route that produced no `color-contrast` entry in `passes` is a
  `warn`.** An empty violations list cannot distinguish "all legible" from
  "never looked"; `passes` is the positive evidence that separates them. This
  is a warn and never a fail, because a route can legitimately have no text to
  contrast and failing a site for a property it does not have is the mirror of
  the mistake #900 was about.

A skipped route is never called unmeasured — it was never scanned, and
reporting one absence as two problems would be its own kind of noise. An
artifact carrying no `measured` array at all (an older spec) downgrades
nothing: "I could not tell" is not "it was not measured".

Each property is proven by mutation: removing the warn, removing the
skipped-route exclusion, or defaulting a missing `measured` array to
"unmeasured" each fails specific tests. The pass control is a run where both
routes measured contrast and found nothing, which must still read `pass`.
