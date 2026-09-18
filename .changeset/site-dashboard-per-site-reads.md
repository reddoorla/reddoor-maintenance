---
"@reddoorla/maintenance": patch
---

The `/s/:slug` dashboard reads its bounce, spam and dropped-lead figures with
per-site queries instead of building three fleet-wide aggregates per page load
and discarding every row but one site's. New index `0028` keeps the dead-letter
count off the payload-bearing rows.
