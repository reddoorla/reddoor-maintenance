---
"@reddoorla/maintenance": minor
---

New `search-console-recheck --fleet --write-back` command (P1-48). It re-runs a report draft's Search Console lookup for every `maintained` site whose stored outcome is `no-property`, and writes the same three `site_health` cells a draft writes. Until now only a draft wrote them, so a property fixed after a site's last draft kept its cockpit watch until the next draft. A soft-fail writes nothing, so the stored answer stands. A no-property control runs first, and if it misreads, nothing is written and the command exits 1. The command also exits 1, writing nothing, when no Search Console credentials are configured. The nightly `fleet-lighthouse` workflow runs it.
