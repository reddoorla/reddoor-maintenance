---
"@reddoorla/maintenance": minor
---

Blux pipeline hardening from the first live conversion: emit now coerces rich text to each slice's allowed block types, flattens deep section trees into sequential slices, skips empty pages, and drops non-image assets from image fields (all recorded as plan diagnostics); `blux emit --probe` reconstructs + HEAD-probes CDN URLs for used assets the HTML scrape missed; the migration runner is rewritten on the raw Prismic APIs — upserts documents by uid, reuses already-uploaded assets, and surfaces full validation details.
