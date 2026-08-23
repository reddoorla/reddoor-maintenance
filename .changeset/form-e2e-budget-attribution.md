---
"@reddoorla/maintenance": patch
---

Key the form-e2e `BUDGET_THIN` warning on the span the budget actually governs.

`INGEST_TIMEOUT_MS` aborts the site→central fetch — which lives inside the form
action's POST — and nothing else. The warning compared it against click→banner,
a span that also contains Turnstile's token round-trip and the browser's render
of the success banner. On 2026-08-17 vineyard-custom-homes warned at 16.9s
click→banner while its own function answered in 0.25s warm / 2.0s cold: the
check was reporting page-render time as abort risk.

The runner now stamps `postElapsedMs` (click → the action's POST response) as a
side-effect of the response capture it already performs, and the thin check
compares that. No POST observed → no claim: the check does not fall back to
click→banner, which would quietly reintroduce the over-warn for exactly the runs
where attribution is least knowable. A pre-click POST (an analytics beacon
matching the capture before the submit) leaves the timing unstamped rather than
computing an epoch-sized "elapsed" that would trip the warning it exists to fix.

A genuinely slow POST still warns — the 1836dig failure mode is unchanged.
