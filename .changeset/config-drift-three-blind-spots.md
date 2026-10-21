---
"@reddoorla/maintenance": patch
---

`sync-configs --fleet turso --dry` reports a roster row whose Status is outside the vocabulary (a retired name like `maintenance`) as `SKIPPED … status "maintenance" is not in the vocabulary`, where before the row was silently dropped: such rows now count toward `total` and the weekly drift run's skipped-share gate (#1607). `renovateActionGaps` reports a constant-false `if:` (`false`, `0`, `''`, `null`, bare, quoted or in `${{ }}`) on any job or step of a site's `renovate.yml`, which used to read `CLEAN` with Renovate disabled. The new `rowsWithUnrecognizedStatus` and the `onUnrecognizedStatus` option of `fromTursoDb`/`resolveSites` expose the dropped rows to any sweep.
