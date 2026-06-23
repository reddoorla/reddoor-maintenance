---
"@reddoorla/maintenance": minor
---

Trigger Renovate on sites the nightly security sweep flags with vulnerabilities, instead of waiting for the weekly schedule.

New `reddoor-maint renovate-dispatch --fleet` command: reads the Websites table, selects the active, repo-backed sites whose latest security audit found a **critical or high** vulnerability, and fires each one's `renovate.yml` `workflow_dispatch`. Renovate's OSV vulnerability alerts bypass its weekly schedule, so the remediation PR opens immediately and auto-merges per the shared preset — closing the detect→remediate gap from up to a week down to hours.

A repo that already has an open Renovate PR is skipped (remediation is in flight), so a persistent vuln doesn't re-fire a dispatch every night while its fix PR waits. (A vuln with no available fix produces no PR, so it would still re-dispatch nightly — an idempotent Renovate no-op.)

Wired as a best-effort follow-up step on `fleet-security.yml` (runs after the sweep writes fresh counts to Airtable). It reuses the existing `RENOVATE_TOKEN`, never fails the security job: a missing token clean-skips, and a per-repo dispatch failure (a repo without `renovate.yml`, or a token lacking `actions:write`) is surfaced as a warning. Moderate/low vulns are left to the normal weekly cadence.

Adds `GitHub.dispatchWorkflow(repo, workflow, ref)`.
