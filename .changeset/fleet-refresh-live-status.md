---
"@reddoorla/maintenance": minor
---

Dashboard: the "Refresh fleet state" button now follows its runs live. After
dispatch the cockpit polls the actual fleet-security + fleet-lighthouse runs
(per-workflow spinner → ✓/✗), auto-reloads onto fresh numbers when both succeed,
links the run on failure, and resumes the spinner across a manual reload.
Adds `GET /api/fleet/refresh/status`, a `listWorkflowRuns` REST method, and the
pure `summarizeFleetRunStatus`.
