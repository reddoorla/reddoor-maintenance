---
"@reddoorla/maintenance": patch
---

Correct two overstatements about what watches Cloudflare Turnstile. Both were written on 2026-09-04 and both claimed more coverage than exists.

- **`form-e2e` does not swap the sitekey.** `CF_TEST_SITEKEY` reaches exactly one expression — `` `testmode-${testSitekey}` `` (`form-e2e.ts:444`) — injected at `:460` as the _value_ of a hidden `cf-turnstile-response` input. Nothing writes `data-sitekey`, calls `page.route`, or uses `addInitScript`. The site's real widget renders with its real key on every nightly run, against 6 sites' live contact forms. The probe is already generating the evidence and discarding it.
- **The smoke suite's 110200 guard is inert in the fleet run.** `fleet-smoke` is clone-based and runs each site's own suite against a local dev server; `PUBLIC_TURNSTILE_SITE_KEY` is a Netlify variable that is not in the clone, so no widget initialises and no `TurnstileError` is thrown. The guard is right and defends a site's own CI where the key is present — it does not defend the fleet.

Net: nothing automated currently observes a production Turnstile widget on its production hostname. `docs/runbooks/turnstile-widgets.md` now says so plainly instead of implying two layers of cover.
