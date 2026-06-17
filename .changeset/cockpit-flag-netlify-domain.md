---
"@reddoorla/maintenance": minor
---

Cockpit now flags a live (`maintenance`) site that is still served from its
default `*.netlify.app` host — i.e. it never got a custom domain. The site drops
to the 🟡 Watch tier with an "on `*.netlify.app` (no custom domain)" reason and a
new `no-domain` filter chip, surfacing a launch-completeness gap that was
otherwise invisible. A `launch period` site on `*.netlify.app` is left alone (no
domain yet is expected pre-launch). Adds a small `isNetlifyAppUrl(url)` URL
predicate (sibling of `isHttpUrl`) that matches the apex and any subdomain of
`netlify.app` without being fooled by look-alike hosts.
