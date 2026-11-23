---
"@reddoorla/maintenance": minor
---

Add `reddoor-maint content-check` (P1-120 phase 2): warns on NEW hard-coded visitor-facing content (copy, headings, buttons, images and alt text, video IDs and posters, links, phone numbers, addresses, emails, hours, testimonials, team members, SEO and social links) in a SvelteKit site's `src/routes` and `src/lib`. Fallbacks behind a Prismic field, legal pages, `/dev/*` routes and decorative labels are never reported. A committed `content-check.baseline.json` holds today's literals so only new ones warn; `content-check.json` holds a site's exemptions and the `"mode": "fail"` switch (off by default). `--init` writes the CI workflow, pinned to this release, the settings and the baseline. `svelte` moves from a dev dependency to a dependency, for its parser.
