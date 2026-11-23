---
"@reddoorla/maintenance": minor
---

prospect audit: a finished run is now a DRAFT, and no prospect can open it until a person approves it. `prospect_audits` gains `approved_at`, `approved_by`, `withdrawn_at`, `withdrawn_by` and `superseded_by` (migrations 0059 to 0063). `/api/audit-report/:token` 404s a draft unless the caller presents `PROSPECT_EDIT_TOKEN` as its bearer, 404s a withdrawn report to everyone, and answers 410 `{ supersededBy }` for a superseded report while the newer one is live. New command `prospect-audit-review --token=<token> --approve | --withdraw | --supersede-by=<token> --by <name>` (`--partial` to approve a partial run). Override entries accept `hidden: true`, which takes a finding, fix, assertion or source off the report. The CLI's last line and the internal email say "draft, not approved", and "do not send" for a partial run; no PDF is printed at save time, because a draft has no public print page. The cockpit's /audits list shows each report's state.
