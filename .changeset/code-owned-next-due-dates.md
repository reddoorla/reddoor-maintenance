---
"@reddoorla/maintenance": minor
---

Scheduling: the "next maintenance / next testing" dates are now owned by the code, not an Airtable formula + automation. A new shared `nextDueDate(site, reports, type, today)` (the same `lastSent ?? anchor) + frequency` logic the scheduler already uses — extracted so `findDueReports` and the display can't drift) computes each site's true next-due date, and the nightly `report --due` sweep writes them to Airtable `Next maintenance at` / `Next testing at` date fields (best-effort, per-site isolated, and run even when nothing is due so the dates stay fresh).

This replaces the prior setup where an Airtable automation overwrote the `maintenance day` anchor with a `DATEADD(TODAY(), frequency)` formula value — which the scheduler then added the frequency to _again_, pushing the first post-announcement maintenance report a full cycle late. With the automation removed, `maintenance day` / `testing day` are clean operator-set anchors and the next-due dates shown in Airtable derive from the exact logic that drafts the reports. Operators should delete the old `next maintenance day` / `next testing day` formula fields (nothing in the code reads them).
