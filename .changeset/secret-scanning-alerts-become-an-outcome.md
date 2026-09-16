---
"@reddoorla/maintenance": minor
---

protection-audit: an open secret-scanning alert is a gap

The sweep asked whether secret scanning is ENABLED — a question about the
detector, not about what it found. On 2026-09-12 a hand-run sweep turned up
five open alerts across five public repos, every one `resolution: null`, the
oldest 99 days, on repos this audit had been calling `covered` every night,
truthfully: both statuses were `enabled` and nothing anywhere watched the
outcome.

`secretScanningGaps` gains a third clause, fed by a new `openSecretAlerts`
read on the GitHub factory. A public repo with open alerts is a gap, named
with its count and its triage link, and carrying the remediation that is not
obvious — redacting the value at HEAD does not close an alert, because the
history of a public repo stays readable (beachfront's key was redacted in
`e30c756` and its alert stayed open the following 37 days).

`openSecretAlerts` answers `"unavailable"` for 403/404 instead of throwing,
and that reads as a gap, never as zero: the endpoint needs `security_events`,
so a scope failure would otherwise make this a third fleet instrument that is
green on a question it cannot fail. It counts alert ids rather than
`--jq length`, which prints once per page and would read 101 open alerts as
`100\n1`. Where scanning is off the clause is skipped — the endpoint 404s by
construction and the row already names that gap.

Both controls are in the test, PASS first, at the values the real org
returned on 2026-09-14: `erp-industrial` and `espada` at 0 alerts stay
`covered` (and the endpoint is proven to have been asked),
`beachfront-dentistry` at 1 is exactly one gap naming the repo.
