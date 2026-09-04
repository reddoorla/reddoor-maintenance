---
"@reddoorla/maintenance": patch
---

Correct the Turnstile runbook's browser check — as written it would condemn a working widget.

Two claims in `docs/runbooks/turnstile-widgets.md` step 5 were wrong, and measurement on 2026-09-04 contradicts both:

- **"`.cf-turnstile` has an `iframe` child"** — the fleet's widgets are `invisible` mode and solve without leaving one. A healthy VLF widget was measured with **zero** iframes and a valid 773-character token in the same instant. An operator following the old text would have declared a working widget broken.
- **"the nightly `form-e2e` probe is the automated version of this"** — it is not. `form-e2e` swaps in Cloudflare's always-pass test sitekey (`form-e2e.ts:11,187`), so it never exercises the real widget; and no driven browser can, because Cloudflare answers automation with error **600010** regardless of configuration (the known-good `reddoorla.com` canary and Playwright's Chromium, headed and headless, all reported it while an ordinary Chrome window minted an accepted token).

Step 5 is now a single check — a non-empty `cf-turnstile-response` — done in an ordinary browser, with the automation limits stated. The division of labour is made explicit: **110200** does not depend on the browser being human, so the smoke suite rules out the wrong-hostname state; only the manual check establishes that the widget solves.
