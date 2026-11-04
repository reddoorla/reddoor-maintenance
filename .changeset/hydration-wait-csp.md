---
"@reddoorla/maintenance": patch
---

`waitForHydration`, the wait form-e2e and turnstile-coverage make before they touch a page, now waits on a site whose CSP has no `'unsafe-eval'`, which includes every starter site (#1923). It passed its check to Playwright as a string, which Playwright `eval`s in the page once the check has to poll. The starter's CSP refused that, so whenever the marker was not already written, the wait returned `"settled"` within milliseconds instead of waiting for `html[data-hydrated]`. It now passes a function. On a test page served with the starter's `script-src` that writes the marker 1.5 s after `load`, the old code settled in about 120 ms and the new code returns the marker at about 1.6 s.
