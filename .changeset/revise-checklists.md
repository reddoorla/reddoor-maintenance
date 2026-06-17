---
"@reddoorla/maintenance": minor
---

Revise the maintenance and testing checklists (the operator gate + client-email
lines, kept in sync). Maintenance stays 6 items but is sharpened: `Reviewed Logs`
→ "Deploy & Function Health", `DNS Checked` → "Domain, DNS & SSL" (absorbs SSL),
`Reviewed Certificate` is cut (Netlify auto-renews — it overlapped), and a new
"Uptime Checked" is added. Testing grows 6 → 7: `Package Updates` → "Verified
After Updates", `Animation Functionality` → "Interactions & Animations",
`Bottlenecks` is cut (overlapped automated Lighthouse Performance), and two items
are added — "Page Titles & Meta" (catches the recurring empty-title regression)
and "Links & Navigation". `ALL_CHECKLIST_FIELDS` is now 13; "Google Indexed"
stays at maintenance index 3 so the email keeps injecting the live search
position. The two cut Airtable columns are retired (renamed, no longer read) and
can be deleted in the UI.
