---
"@reddoorla/maintenance": minor
---

The announcement email now shows the testing/maintenance checks as a **checkmark
list** (a green ✓ per item under each pace, mirroring the report's checklist) and
gains a **TRAFFIC & SEARCH** section — visitors for the last ~30 days with an
up/down trend vs the prior window, plus the page-1 Google position — fetched live
by the `announce` recipe via the report pipeline's soft-failing GA + Search Console
enrichment (`fetchGaUsers` / `fetchSearch`, now exported) and stored on the Reports
row (`ReportEnrichment`; `updateReportScores` extended for the reuse path).

Also fixes a latent send-path gap: `sendOne` re-rendered a sent Announcement WITHOUT
its cadence/improvements (they aren't stored on the row), silently dropping the whole
"WHAT TO EXPECT" section from the delivered email. A new `announcementSiteExtras(site)`
helper re-derives them from the Websites row and is shared by both the draft preview
and the send re-render, so the sent email matches what the operator reviewed.
