---
"@reddoorla/maintenance": patch
---

fix(forms): map benign Turnstile error-codes to unverifiable; fail weight 70→50

`verifyTurnstile` now parses the siteverify `error-codes` array and returns
`"fail"` only for `invalid-input-response` (an actual bad/forged token). Every
other `success:false` — `timeout-or-duplicate` (expired 300s token from a
human filling a long form, or a double-submit), `internal-error`, secret/config
errors, unknown or absent codes — fails open to `"unverifiable"`, so a
Cloudflare-side or operational condition never punishes a possibly-real
visitor. The classifier's turnstile-fail weight drops from 70 to 50 so a lone
"fail" plus one benign co-signal (a single pasted URL, +30) no longer reaches
the spam_auto threshold of 100, and a new guardrail test pins that
`requireTurnstile` sites keep accepting + notifying on `"unverifiable"`
(Cloudflare outage / JS-off visitors never spam-bucket on gated sites).
