---
"@reddoorla/maintenance": minor
---

`launch-check <site>` reports whether a site is ready to launch, one line per step of `docs/runbooks/site-launch.md` (url, contact, schedule, header image, GA property, GA tag, privacy page, Search Console): `ok`, `missing` or `unverified`. `launch` now runs it before any GitHub write and refuses a site with any step not `ok`, unless that step is named in `--allow-missing`.
