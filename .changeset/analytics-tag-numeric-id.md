---
"@reddoorla/maintenance": patch
---

`analytics-tag` refuses a numeric `--measurement-id` (or `--production-host`) with its exit-2 explanation instead of crashing with `opts.measurementId?.trim is not a function`. cac hands a numeric option value over as a number, and the numeric property ID is exactly what this flag gets confused with.
