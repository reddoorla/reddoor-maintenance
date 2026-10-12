---
"@reddoorla/maintenance": patch
---

form-e2e waits for hydration (`html[data-hydrated]`, else a 5 s settle after `load`) before it fills and injects its `testMode` marker, so `refilled` no longer reports the probe's own pre-hydration wipe as a site re-render. A refill without the marker seen is flagged "hydration unconfirmed" (#1148).
