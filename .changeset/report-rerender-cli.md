---
"@reddoorla/maintenance": patch
---

`report --rerender <id>`: regenerate an unsent report's stored HTML.

The console preview serves the body stored at draft time, so commentary edited
afterwards never appeared. This regenerates it through the same renderer the send
uses, so the preview is what the client will actually receive.

The assembly that built `ReportData` inline inside `sendOne` is lifted into
`renderReportFromRow`, which both now go through — a preview whose only job is
fidelity is worthless if it renders through a second path that agrees with the
sender by coincidence.

Header bytes come from Turso (design D5) when stored, falling back to the
Airtable attachment. A SENT report is refused before any work: its stored body is
the record of what the client received.

Runs as a CLI rather than in a Netlify function because rendering needs sharp, a
native module no function bundles — and approximating the header geometry to
avoid it would trade away the exact fidelity a preview exists to provide.
