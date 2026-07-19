---
"@reddoorla/maintenance": patch
---

browser audit: flag unsubstituted SvelteKit placeholders + require a visible `<main>` on mobile

The `browser` audit now warns when a sampled route ships a literal `%sveltekit.*%` token
(a broken `app.html` — e.g. a placeholder named in a comment before the real one, which the
naive first-match template substitution fills, leaving the real token unrendered). It also
requires a visible `<main>`/`[role=main]` on the mobile checks, mirroring desktop, so a
fully-blank render can no longer pass mobile on status + no-overflow alone. Both close the gap
that let a blank/corrupt homepage slip past the sweep.
