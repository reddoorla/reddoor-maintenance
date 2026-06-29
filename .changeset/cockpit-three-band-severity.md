---
"@reddoorla/maintenance": minor
---

Cockpit three-band severity. The fleet verdict bar goes from binary (green "All clear" / red "N need you") to four worst-band-wins states — green (all clear) / blue (waiting on your yes) / amber (watch) / red (broken) — with lower-band and healthy counts in the meta line. The Needs-you feed gains an amber **Watch** band between Broken and Waiting that surfaces self-patching vulns (a CVE Renovate is still auto-fixing, which previously hid under "All clear") and the whole former watch tier (degrading Lighthouse, stale repo, no custom domain). An exhausted vuln still escalates to red Broken.
