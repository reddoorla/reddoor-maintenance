---
"@reddoorla/maintenance": patch
---

Maintenance email: refresh the "testing" placeholder. The blurred-tests teaser image is replaced with the new design (the frosted testing checklist behind a "Request Testing Upgrade" button + invitation copy), and the "Last Tested: <date>" line beneath it is removed. The new image is exported at 2× (1200×1362, ~470 KB — lighter than the prior 590 KB asset) and keeps the same `blurredTests.jpg` filename/cid, so the swap is asset-only. The underlying `lastTestedDate` field is still computed and stored on the Airtable Report row (and used by the dashboard); only the email line is gone.
