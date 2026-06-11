---
"@reddoorla/maintenance": patch
---

fix(airtable): a Lighthouse miss no longer discards a site's a11y/deps/security results — those are written first, then the run still surfaces the Lighthouse failure (so the fleet gate keeps its signal without losing the other audits' data).
