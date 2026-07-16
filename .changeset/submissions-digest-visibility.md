---
"@reddoorla/maintenance": patch
---

Submissions & digest visibility. (a) The nightly digest gains a "Submissions"
telemetry section (new genuine leads vs auto-filtered spam over the window, with
a per-site breakdown when nonzero); it rides only when the digest already sends,
so the no-noise skip rule is unchanged. (b) The cockpit "📥 N new" counts split
actionable leads (contact/inquiry/reserve) from newsletter/rsvp signups so a
newsletter backlog can't drown real leads. (c) `/submissions` spam-reason facet
tokens (including the turnstile reasons) become clickable filter chips backed by
a `reason` query param. (d) The per-site page `/s/<slug>` now shows that site's
active alarm/watch context at the top, reusing the cockpit's own collectors +
`assignTier` (no forked logic). (e) Markup/accessibility fixes on `/submissions`
rows (valid list nesting; larger coarse-pointer tap targets).
