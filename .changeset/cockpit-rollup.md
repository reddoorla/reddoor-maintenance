---
"@reddoorla/maintenance": patch
---

Move the cockpit's two fleet-wide aggregates to the nightly digest (MED-16).

The fleet homepage recomputed both of its "since a window" numbers on **every page
load** — the 30-day spam roll-up and the 14-day notify-bounce counts. Both are
aggregates over the whole `submissions` table, which is the one unbounded-growth
table in the schema (append-only, one row per fleet lead forever), on the
operator's most-loaded page, against a store that meters **row scans**.

They now come from one row read by primary key, computed once by the nightly
digest and stored beside the digest snapshot under its own key.

**The trade is that the figures are up to 24h old, and the design pays for that
twice.** The strip is labelled with when it was taken (`· as of 2026-08-26 03:00
UTC`), because a stale number rendered as though it were live is worse than the
per-request cost it replaced. And an absent roll-up reads as **null, not zeros**:
every one of these numbers has a legitimate zero, so a reader handed
`{honeypot: 0, …}` cannot tell "nothing was screened out" from "the digest has
never run". The cockpit renders the strip as absent instead, the same distinction
`FLEET_SMOKE_UNMEASURED` exists to preserve. A malformed or older-shaped payload
reads as null too, since a different process writes it on a different schedule.

`DIGEST_STATE_WRITE` gains a **three-state** `rollup=1|0|absent` counter rather
than a boolean. `absent` means no Turso is configured, which is what every unit
test looks like — reporting that as `rollup=0` would train the eye to ignore the
one number that is supposed to catch a dead writer, which is exactly how #585 hid
for weeks. The writer is injectable for the same reason `digestState` is: without
a seam it would report `rollup=absent` forever in tests while looking healthy.

The two query-plan allowlist entries for these aggregates are re-justified rather
than removed — the functions still exist and still scan, they are simply **batch
only** now.
