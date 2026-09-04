---
"@reddoorla/maintenance": patch
---

Turnstile: stop reporting a widget healthy on the strength of an env var, and add widget 3.

`Turnstile widget` in Websites was written from `/health`'s `forms.turnstile`, which is `!!PUBLIC_TURNSTILE_SITE_KEY?.trim()` — a truthiness check on a string that never contacts Cloudflare. A site deployed with the sitekey of a widget already full at Cloudflare's 10-hostname cap therefore reported `pass` while the live widget threw `110200` and minted no token; under `Require Turnstile` that buckets 100% of real leads, and the false `pass` satisfied **both** halves of the guardrail meant to catch it (the red digest item needs `"fail"`, the amber cockpit watch needs `!== "pass"`).

The mapping is now asymmetric: `false → "fail"` (no key IS proof the widget can't work), `true → null` (a key is NOT proof that it does). `null` is the cockpit's existing accept-able "can't verify" watch, so nothing new had to be built; a real `pass` has to be earned by a browser.

Two more places the same failure hid, plus capacity:

- The generated smoke suite allowlisted `/turnstile|challenges\.cloudflare/i` against `pageerror` as well as console output, so the uncaught `TurnstileError` was discarded by name. The allowlist is split: console telemetry stays allowed, an uncaught throw does not.
- `form-ingest.mts` now reads `TURNSTILE_SECRET_KEY_3` alongside `_KEY`/`_KEY_2`, for the new "Site Forms 3" widget — "Forms 1" is full and "Site Forms 2" had one slot left fleet-wide.
- New runbook `docs/runbooks/turnstile-widgets.md` covers hostname allowlisting, the two-slots-per-site rule, the launch-time custom-domain cutover, and the browser check that is the only real proof. `require-turnstile-rollout.md`'s preconditions and guardrail section are corrected to match.
