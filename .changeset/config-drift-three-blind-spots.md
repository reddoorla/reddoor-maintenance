---
"@reddoorla/maintenance": patch
---

`sync-configs --fleet turso --dry` reports a roster row whose Status is outside the vocabulary (a retired name like `maintenance`) as `SKIPPED … status "maintenance" is not in the vocabulary`, where before the row was silently dropped: such rows now count toward `total` and the weekly drift run's skipped-share gate (#1607). `renovateActionGaps` reports a constant-false `if:` (`false`, `0`, `null` or an empty string, bare, YAML-quoted, in `${{ }}` or as a block) on the job that runs `renovatebot/github-action`, or on a step of that job using one of the three required actions; such a file used to read `CLEAN` with Renovate disabled. A site's own job or step, a key named `if` inside `env:`/`with:`, and a non-empty string such as `${{ 'false' }}` are not gaps. The new `rowsWithUnrecognizedStatus` and the `onUnrecognizedStatus` option of `fromTursoDb`/`resolveSites` expose the dropped rows to any sweep.
