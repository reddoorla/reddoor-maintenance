## 2026-10-19 — Both Williamson rows are `maintained`, with no Launch email (#1404 follow-up)

> Follows 2026-10-19 — Williamson close-out (`2026-10-19-1327-williamson-close-out.md`), which ended with the operator's `launch` and two go-live approvals still to come.

The operator ran `launch` on both sites from the laptop, from the folder that holds the checkouts. Each run ended `drafted (awaiting approval)`. Each bootstrap required `ci / ci` on `main` and created the ruleset "main: reviewed changes only", the step the cloud session's GitHub App had been refused. The audits read P96 A100 BP100 SEO100 (Construction) and P99 A100 BP100 SEO92 (Homes). That run printed no `readiness` line, which current `main` prints, so the laptop's `reddoor-maintenance` build is probably older than #1372. It changed nothing here, because `launch-check` had read READY 8/8 on both at 13:15Z.

Then the operator decided Williamson gets no Launch email, only the Maintenance email when it falls due, and asked for the drafts to go. They were withdrawn at 14:07Z through the dashboard's own `withdrawReport` and the "Don't send" write, the same as the button, not deleted. A withdrawn draft consumes only its own type's cycle (`src/reports/due.ts`), so the Maintenance schedule was untouched.

The catch the decision carried: sending the Launch email is the only thing that flips a row to `maintained`. A `building` row never drafts a Maintenance report (`ELIGIBLE_STATUSES`, `src/reports/due.ts`) and is never swept by the nightlies. So withdrawing the drafts alone would have left the Maintenance email waiting forever. On the operator's yes, both rows' Status was set to `maintained` through the dashboard's `setSiteDetail`, the Status field on `/s/<slug>`. "Launched at" stays blank, since only the send stamps it. Read back through `nextDueDates`, the first Quarterly Maintenance report falls due 2027-01-14 on both. The nightlies cover both sites from tonight.

Still the operator's: D0, Webflow billing and then the domains.
