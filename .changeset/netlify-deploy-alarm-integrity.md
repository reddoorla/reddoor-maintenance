---
"@reddoorla/maintenance": patch
---

Fix: a transient Netlify API failure no longer clears a real "deploy errored" alarm from the cockpit's Broken band. The deploy probe previously used `null` as a single sentinel for both "couldn't read the API" and "site has no production deploy", so a network error / non-2xx / malformed response during the nightly sweep overwrote a genuine `error` deploy status to `null` — silently dropping a broken production site out of the Broken band ("all clear" while prod was down). The probe now returns a discriminated `NetlifyDeployFetch` (`{ ok: false }` for a read failure vs `{ ok: true, deploy }` for a real read), and on a read failure the audit returns no details so the Airtable writer leaves the prior `Deploy status` intact. A genuine empty deploy list still persists `null` (a real "none" verdict). The principle: an _alarm_ field preserves its prior value on an uncertain read, where a _pass-gate_ field clears.
