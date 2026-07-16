---
"@reddoorla/maintenance": patch
---

Three cockpit-honesty fixes. (1) Pre-launch mute pierce: a "launch period"
site still mutes expected pre-launch noise (early Lighthouse, errored deploy,
Renovate/analytics warnings), but a genuine alarm — any critical-severity item
or default-branch CI red — now re-tiers the site to attention through the
normal machinery (needs-you broken band, red verdict), matching what the daily
digest already surfaced; muted noise is also filtered off the card's chips.
(2) Legacy-status visibility: "legacy" joins the Status union; archived
(legacy/deprecated) rows render as a neutral collapsed cockpit lane + an
"N archived" verdict term, and a Status cell outside the union (typo/renamed
option) surfaces as an amber watch row instead of silently vanishing the site
— without nulling the cell, which would make it schedulable-by-default.
(3) Auto-fix counter reset: renovate-dispatch --fleet now runs counter
bookkeeping even when there is nothing to dispatch (the reset-on-clean branch
was unreachable on a fully-clean fleet — Alamo sat at 7 from a long-closed
episode), and the reset applies regardless of visibility/repo so archived
sites can't hold stale counters.
