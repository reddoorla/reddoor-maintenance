---
"@reddoorla/maintenance": patch
---

Dashboard: the fleet-refresh spinner now shows live detail for the long
Lighthouse sweep — the current build phase (setting up → building → installing
browsers → auditing the fleet…), elapsed time, a per-workflow ETA, and a
view-run link while running. Adds `currentRunStep` to the GitHub REST client.
