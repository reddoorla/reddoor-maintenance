---
"@reddoorla/maintenance": minor
---

Reframe the announcement email (shipped in 0.42.0) from "your new monthly report"
to an ongoing site-care message. It now states each client's **testing and
maintenance cadence**, read from the Websites row (`testing freq` /
`maintenence freq`) and rendered as a "WHAT TO EXPECT" section (e.g. "Full site
testing — every quarter"); a `None` pace is omitted so no cadence is over-claimed.
The score preview is framed as the latest full site test. Adds `ReportCadence` /
`ReportFrequency` types and `ReportData.cadence`; the `announce` recipe passes
each site's frequencies and uses a "Your testing & maintenance schedule for
<site>" subject.
