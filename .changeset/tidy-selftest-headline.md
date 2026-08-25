---
"@reddoorla/maintenance": patch
---

fix(selftest): apply the report-type headline to the preview header

`selftest email` downscaled the stored header directly, skipping the
`applyReportTypeHeadline` step `orchestrate.ts` performs. Since the stored header is
the clean plate, every preview shipped a header with an empty headline band — the
artifact meant to catch a bad header was itself wrong, and matched no real send.
