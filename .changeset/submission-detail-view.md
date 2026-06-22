---
"@reddoorla/maintenance": patch
---

The per-site dashboard now lets you inspect a submission, not just triage it. Each submission is an
expandable row revealing all stored fields — phone, full message, source URL, UTM, the per-site extra
fields, notify status, Resend message ID, and submission number — all HTML-escaped, with the source
URL run through `safeUrl`.
