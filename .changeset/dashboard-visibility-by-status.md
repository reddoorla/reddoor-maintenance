---
"@reddoorla/maintenance": patch
---

Dashboard cockpit visibility is now derived from site `Status` (shown when `maintenance` or `launch period`) instead of the vestigial per-site `Dashboard Token` field. The `dashboardToken` field is removed from `WebsiteRow`; the Airtable `Dashboard Token` column can be deleted.
