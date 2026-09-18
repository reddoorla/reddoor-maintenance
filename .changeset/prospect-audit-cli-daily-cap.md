---
"@reddoorla/maintenance": patch
---

The prospect-audit daily cap now brakes the CLI as well as the dashboard —
until now `PROSPECT_AUDIT_DAILY_CAP` was enforced only in the dashboard
dispatch path, while every batch run went through the CLI. Both paths share one
count and one refusal message; a run with no database to count against says so
loudly instead of passing in silence.
