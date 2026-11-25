---
"@reddoorla/maintenance": minor
---

Leads by period and a Reddoor contact on every report (P1-127). Client reports (Maintenance and Testing) gain a LEADS block after ANALYTICS: leads in the last 30 complete Pacific days against the 30 before, captured at draft, refreshed on a pre-approval re-render, frozen at approval. The site page gains a Leads panel (30 days, the 30 before, six months, all time) and `/submissions` gains "Since <date>" links. A new per-site `reddoor_contact` (migration 0064; reports gain `leads_current`/`leads_previous`, 0065–0066) is always CC'd on report email, after the per-site CC and before info@, and is never replaced by Report recipients (To); the approve gate warns when it is empty and fails when it is malformed.
