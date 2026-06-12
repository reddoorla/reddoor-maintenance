---
"@reddoorla/maintenance": minor
---

feat(alerts): the daily digest now surfaces fleet problems (M5 slice 1). The "Needs attention" section — empty since M3 — lists every site currently carrying a critical/high security vuln and every report that bounced or complained, **grouped by site, severity-ordered (critical first), and badged NEW or WORSE** versus the prior run. The hybrid snapshot never silently drops a standing problem, while the badges land the eye on what changed. Prior state lives in a single "Digest State" Airtable record (one read + write per run); a resolved problem clears even on a no-noise skip day, so a recurrence correctly re-badges NEW. Two zero-infra signals ship here; Renovate-PRs-failing-CI and Lighthouse regression follow on the same framework.
