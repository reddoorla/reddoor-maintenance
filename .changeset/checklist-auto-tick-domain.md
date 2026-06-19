---
"@reddoorla/maintenance": minor
---

Checklist auto-tick gains its second signal: **Domain, DNS & SSL**. A new checkout-free `domain`
audit probes each site's deployed URL (DNS resolve + TLS cert expiry via Node `dns`/`tls`, no
repo clone) and persists `Cert days remaining` + `Domain checked at` to the Websites row; it
joins the nightly `fleet-lighthouse` sweep (`--only lighthouse,domain` — both run against the
deployed URL, so no extra clone). The `Maint: Domain, DNS & SSL` box then auto-ticks at draft
time when the check is fresh, the domain is custom (not `*.netlify.app`), it resolves, and the
cert has >14 days left. Fail-safe as always: stale → unknown, near-expiry / unresolved → fail
(amber with the reason), no custom domain or never-probed → left manual. Honest scope: resolve +
valid cert only — not registrar expiry, www↔apex redirect, or MX.
