---
"@reddoorla/maintenance": minor
---

feat(cockpit): generic accept-key matcher for watch conditions + chip discoverability

Any amber Watch condition can now be accepted (muted) by the operator, not just
the three that had hardcoded accept branches. `assignTier` collects each active
watch condition as a structured candidate carrying a set of **stable accept
keys** (with human aliases — e.g. the Netlify/no-custom-domain watch accepts
`no custom domain`, `netlify`, `netlify.app`, `on netlify`) decoupled from the
volatile reason text, then a single generic matcher routes each to muted or
watching. Adding a future watch condition makes it acceptable with no new
branch.

The cockpit card now surfaces the exact accept token beside each watch chip
(`… · accept: "no custom domain"`, with a tooltip), so the operator can see
precisely what to enter — closing the discoverability gap where the mute token
never matched the displayed text.

`acceptedWatchConditions` parsing now tolerates both the Multiple-Select array
shape and a delimited long-text string, so the Airtable field can migrate to
free text with no code change.

Invariants preserved: acceptance is watch-only (the accept loop runs strictly
below the attention short-circuits, so it can never mute a red condition), keyed
on the stable signal token (accepting `performance` tolerates 82→78 but a drop
below the floor still alarms via its AttentionItem), and accepted conditions
still render as muted `✓ accepted:` chips.
