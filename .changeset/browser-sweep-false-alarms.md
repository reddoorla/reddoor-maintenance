---
"@reddoorla/maintenance": patch
---

fix(audits): stop the browser sweep crying wolf — verified reachability + honest titles-meta

The 2026-07-16 sweeps failed "Titles & Meta OK" on 10 of 11 live sites and "Uptime Reachable" on
3, while every site answered 200 to a plain fetch. Root cause: hosts' bot protection (Netlify
WAF) serves 403 challenge interstitials to the headless-browser probe burst — status 403, title =
the bare domain, no meta — poisoning both verdicts, with two amplifiers in route discovery
(asset URLs like a homepage-linked PDF sampled as "routes", and `/a` + `/a/` sampled as two
routes → guaranteed duplicate-title fail). Fixes:

- Route discovery samples only real page routes: asset/file extensions filtered, trailing
  slashes normalized.
- Every browser-side unreachable/title-less observation is re-verified with a plain fetch (with
  cooldown retries for WAF-shaped statuses) BEFORE a fail verdict can persist; only a confirmed
  non-2xx/timeout keeps the fail.
- Fail verdicts are now actionable: confirmed-failing URLs (`unreachableUrls`) and per-URL
  title/meta findings (`titleMetaProblems`, incl. which routes share a duplicate title) ride in
  the audit note + details. Verdict semantics and Airtable fields are unchanged.
