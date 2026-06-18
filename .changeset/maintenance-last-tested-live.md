---
"@reddoorla/maintenance": patch
---

The Maintenance report's "Last Tested" date now reflects the real last automated test. It reads
the live `Last lighthouse audit at` timestamp on the Websites row — stamped every time
`audit lighthouse --write-airtable` refreshes the scores — instead of the hand-set `testing day`
scheduling anchor (which went stale and could show a date months out of date). `testing day` is
unchanged; it remains the recurrence anchor used by the due-report scheduler. A site that has
never been audited leaves the line blank, exactly as before.
