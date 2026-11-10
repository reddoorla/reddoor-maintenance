---
"@reddoorla/maintenance": patch
---

browser audit: retries for a navigation that threw now come from one budget of 3 per site, shared by the desktop and mobile probes. Once a site has spent it, a thrown navigation stands as the fail its first try returned. A site whose every route hangs now pays at most 30 s for retries instead of up to 12.5 minutes, which kept fleet-lighthouse's 75-minute audit step from overrunning (#2030).
