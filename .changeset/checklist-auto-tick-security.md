---
"@reddoorla/maintenance": minor
---

Checklist auto-tick gains the **Security Updates** signal (the last of the six automatable
checks). The security audit now stamps a `Last security audit at` freshness timestamp alongside
its vuln counts, and a new nightly **`fleet-security`** workflow runs `pnpm/npm audit` across the
fleet (checkout-ful — it reads each repo's committed lockfile; kept a separate job so the
lighthouse/domain/browser sweep stays checkout-free). The `Maint: Security Updates` box
auto-ticks when fresh with **0 critical and 0 high** advisories; any critical/high → fail (amber,
with the count), stale → unknown, never-run → manual. Honest scope: "no known critical/high
advisories in the declared dependencies as of the last audit" (moderate/low advisory-only; does
not prove the fix is deployed).

Also relaxes `writeAuditsToAirtable`: a Lighthouse result is no longer _required_ — a standalone
`--only security` (or any non-lighthouse) sweep now persists its audits instead of erroring. The
Lighthouse-miss flag still fires when Lighthouse was actually run but produced no scores.
