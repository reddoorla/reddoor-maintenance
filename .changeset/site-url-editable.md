---
"@reddoorla/maintenance": patch
---

A site's `url` is editable from the console. It was writable only at creation, and nowhere after.

`url` is the target **every** deployed audit drives — the inventory exposes it as `Site.deployedUrl`, so function-health, lighthouse, browser, domain and form-e2e all resolve against it. It was set by `ensure-site` and never again: it is not in `EDITABLE_SITE_FIELDS`, and the #643 freeze retired Airtable hand-editing. A site that moved — a rename, a staging host, a custom domain at launch — could not be corrected anywhere.

Found on `vida-legacy-foundation`, whose row points at a hostname that returns 404 while the real site is elsewhere. Any audit that ran against it was measuring nothing.

`kind: "url"` applies the same scheme allowlist the audit target itself uses, so a `file://` or `javascript:` value is rejected before the read — this value is handed to Chrome/lhci and fetched server-side. The render's allowlist-drift guard required the control too, so it is rendered first in the editor, above the contact fields.
