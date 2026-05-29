---
"@reddoorla/maintenance": minor
---

CLI now auto-loads credentials from `~/.config/reddoor-maint/credentials.env` (respects `$XDG_CONFIG_HOME`) at startup, so `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`, `DASHBOARD_PASSWORD` etc. follow the operator into any cwd — no more `cd` back into the maintenance repo to pick up `.env`. Shell-exported env vars still win over file values; missing/unreadable file is a silent no-op.

When `AIRTABLE_PAT` or `AIRTABLE_BASE_ID` is missing, the error now points at the file path: `AIRTABLE_PAT not set. Export it in your shell or put it in /Users/<you>/.config/reddoor-maint/credentials.env as AIRTABLE_PAT=...`
