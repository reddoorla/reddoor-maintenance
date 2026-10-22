---
"@reddoorla/maintenance": patch
---

`sync-configs --fleet turso --dry` reports a roster row whose Status is outside the vocabulary (a retired name like `maintenance`) as `SKIPPED … status "maintenance" is not in the vocabulary`, where before the row was silently dropped: such rows now count toward `total` and the weekly drift run's skipped-share gate (#1607). The weekly run also goes red when found drift reached no issue: `gh issue create` failed, or both rewriting and commenting on the open issue failed. The new `rowsWithUnrecognizedStatus` and the `onUnrecognizedStatus` option of `fromTursoDb`/`resolveSites` expose the dropped rows to any sweep.
