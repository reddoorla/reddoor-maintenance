---
"@reddoorla/maintenance": patch
---

Fix: don't offer a commentary box on report types that ignore it.

#596 added a commentary editor to every unsent report. Only Maintenance and
Testing render commentary — `buildAnnouncementMjml` and `buildLaunchMjml` never
reference the field — so on those two types an operator could write commentary,
see it save, preview it, and find nothing, with no explanation.

`rendersCommentary(type)` now lives beside the template dispatch it mirrors, and
a test renders EVERY report type through the real MJML pipeline with a marker in
the commentary, asserting presence matches the predicate. A template that starts
or stops using commentary fails that test rather than quietly disagreeing.
