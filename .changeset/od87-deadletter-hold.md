---
"@reddoorla/maintenance": minor
---

A dead letter on a slug that resolves to a fleet site now waits two replay cycles (12 h from its oldest unreplayed row's `received_at`) before it alarms in the cockpit, the Needs-you feed and the digest; until then it shows on the site page as a `waiting:` chip. Once due it reads "N leads dead-lettered, the oldest not replayed for H h — the 6-hourly replay has not placed them; run `db replay-deadletters` to see why". A slug that resolves to no site still alarms at once (Operator decision 87).

The cockpit and `pm-cockpit` now resolve a dead letter's slug against every site, as the digest already did, so one on an archived or unrecognized-status site is held like any known site's and, once due, is listed under the site's own name with its page instead of as "resolves to NO fleet site". Migration 0044 adds `received_at` to the per-slug dead-letter index, and 0045 drops 0028's index, which 0044's covers.
