---
"@reddoorla/maintenance": patch
---

alerts: stop calling a transitive-only vuln episode "auto-fix failed"

Sonder's digest said "2 critical/high vulns — auto-fix failed (5×)" (2026-08-10)
when both HIGHs (brace-expansion, nanoid) were TRANSITIVE — Renovate's vuln
alerts had no direct dep to bump, every nightly dispatch was a green no-op, and
the real fix was Monday's lockfile-maintenance window. Two honesty fixes, both
driven by the Dependabot `dependency.relationship` field now threaded through
DependabotAlert → security audit → the persisted `Security advisories` JSON
(no new Airtable field): the auto-fix-attempts counter no longer increments when
every open critical/high advisory is proven transitive (a known no-op dispatch
is not a failed attempt), and collectVulnAlerts titles such sites
"transitive-only, fix rides the weekly lockfile window" instead of escalating a
stale counter to "auto-fix failed" (no forced-critical, no digest-email
inclusion — the amber cockpit Watch still shows them). Missing/unknown
relationship data never mutes: those sites keep the old increment + escalation.
