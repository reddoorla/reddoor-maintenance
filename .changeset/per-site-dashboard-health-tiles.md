---
"@reddoorla/maintenance": minor
---

Per-site dashboard at `/s/<slug>?t=<token>` now shows a "Site Health" section with three tiles (Accessibility issues, Dependency updates, Security alerts) alongside the existing Lighthouse scores. Deps tile gains a "N major behind" sub-line when relevant; Security tile gains a `C/H/M/L` severity breakdown when total > 0. A "Last audited Xd ago" line under the URL completes the picture.

Empty state surfaces a clear operator hint (`run reddoor-maint audit --write-airtable from the site checkout`) for sites that haven't been audited since Phase 2c shipped. Onboarding-status indicator stays operator-only — fleet page only.
