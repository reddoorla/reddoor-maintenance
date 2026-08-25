---
"@reddoorla/maintenance": patch
---

`report --due`: say so when the `site_schedule` dual-write has no mirror.

`writeNextDueDates` mirrors each next-due write into `site_schedule` through a
best-effort mirror that resolves from `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`.
Absent those, it returns null and the dual-write silently never runs — no
warning, no nonzero exit, only a missing `mirrored=` suffix that reads exactly
like a healthy run.

The `NEXT_DUE_WRITE` line now ends in `mirror=absent` in that case. Counters stay
off deliberately: `mirrored=0` would claim a write that returned nothing rather
than one that was never attempted.
