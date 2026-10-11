---
"@reddoorla/maintenance": patch
---

`report --rerender` ("refresh preview") now writes the Search Console lookup it ran to the site's `site_health` row (`search_console_outcome`, `search_console_resolved`, `search_console_checked_at`), the same three cells a draft writes. An approved but unsent report runs the lookup on its own and records it without touching the report. When the lookup did not run (no credentials, the site not enrolled), nothing is written and the stored outcome stands. The result line names what happened: `lookup=resolved|no-property|soft-fail|not-run|no-row|write-failed`.
