---
"@reddoorla/maintenance": minor
---

A dead letter on a slug that resolves to a fleet site now waits two replay cycles (12 h from its oldest unreplayed row's `received_at`) before it alarms in the cockpit, the Needs-you feed and the digest; until then it shows on the site page as a `waiting:` chip. A slug that resolves to no site still alarms at once (Operator decision 87). Migration 0044 adds `received_at` to the per-slug dead-letter index, and 0045 drops 0028's index, which 0044's covers.
