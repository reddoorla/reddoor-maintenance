---
"@reddoorla/maintenance": patch
---

form-e2e: the Turnstile script matcher follows Cloudflare's redirect, so a healthy widget can finally earn a `pass`

`TURNSTILE_API_JS` matched `/turnstile/v0/api.js` exactly. Cloudflare answers
that URL with a 302 to a build-hashed sibling, so the only response the matcher
ever saw was the redirect — measured on reddoorla.com's live `/contact`,
2026-09-16:

    302  https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit
    200  https://challenges.cloudflare.com/turnstile/v0/g/330e41bb475c/api.js

`turnstileScriptLoaded` is set from a 2xx, so it could never become true.
`turnstileVerdict` then took its `container but no script → null` arm on every
site, every run, since #695 landed on 2026-09-04: all 45 `site_health` rows
null, zero passes and zero fails fleet-wide. Reddoor is the only site with
`Require Turnstile` on, so it was the only one that could surface the
consequence — a permanent cockpit watch reading "Require Turnstile on; widget
not verified by a browser", which no amount of healthy widget could clear. A
check that can never say "this is right" is a complaint, not a measurement.

The verdict RULE was correct throughout and is unchanged; `window.turnstile`
was an `object` on the live page the whole time. The defect was entirely in the
observation that feeds it — which had **no test at all**, while the rule it
feeds was pinned exhaustively in `turnstile-verdict.test.ts`. That asymmetry is
how this shipped green.

- `TURNSTILE_API_JS` now allows optional path segments between `/turnstile/v0/`
  and `api.js`. Same host, same prefix, same leaf: `/turnstile/v0/siteverify`
  (server-side token verification) still does not match, nor does another API
  version.
- `tests/audits/turnstile-script-url.test.ts` covers the matcher, including the
  build-hashed URL verbatim — the case that decides whether a pass is reachable.

Proven on known-good input before being trusted: driving the live reddoorla.com
form with the REAL constants and the REAL `turnstileVerdict` imported from
source, the unfixed matcher observes `scriptLoaded: false` and returns null;
the fixed one matches the 2xx and returns `pass`.

What `pass` still does NOT mean is unchanged and worth restating: that a human
can solve the challenge. Cloudflare answers every driven browser with 600010
regardless of configuration, so `pass` remains "the widget is deployed and is
not mis-hostnamed". Confirming a real token stays the manual browser check in
docs/runbooks/turnstile-widgets.md.
