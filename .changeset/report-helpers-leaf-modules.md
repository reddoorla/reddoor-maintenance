---
"@reddoorla/maintenance": patch
---

The report addressing helpers (`parseAddresses`, `isProbablyEmail`, `withGlobalCc`, `GLOBAL_REPORT_CC`) and `rendersCommentary` now live in leaf modules, so importing them no longer loads the send pipeline or MJML. The old modules re-export them; nothing a caller imports changes.
