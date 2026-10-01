---
"@reddoorla/maintenance": minor
---

The report scheduler pushes a Maintenance report back one Maintenance cycle when a Testing report for the same site is sent within a month of its due date, measured from the later of the due date and that Testing report. An approved Testing report not yet sent counts for three days after its approval, since `daily-reports` drafts before it sends.
