---
"@reddoorla/maintenance": patch
---

feat: Require-Turnstile guardrail + solved-hostname check + honest no-property search flag

Closes out the remaining confirmed findings from the 2026-07-15 adversarial review.

- **Require-Turnstile guardrail.** The nightly function-health sweep already reads the
  site's `/health` `forms.turnstile` boolean but dropped it before Airtable; it now
  persists as the `Turnstile widget` field (pass/fail, freshness via `Function health
checked at`). A site with `Require Turnstile` ON whose fresh sweep says the widget is
  MISSING raises a **critical attention item** (cockpit + digest) — that combination
  silently buckets 100% of the site's real leads, and the form-e2e probe cannot see it
  (testMode bypasses the gate). The item rides the attention short-circuit ABOVE the
  accepted-watch mute loop, so no accept key can silence it. A gated site whose widget
  state merely can't be verified (null verdict / stale sweep) gets an acceptable amber
  watch (`turnstile-unverified`). Rollout preconditions live in
  `docs/runbooks/require-turnstile-rollout.md`.

- **Solved-hostname check (defense-in-depth).** `verifyTurnstile` now returns
  `{ outcome, hostname }` — siteverify's record of where a passing token was solved.
  On a `Require Turnstile` site, a passing token solved on a host unrelated to the
  site's own URL escalates to `spam_auto` (`turnstile-required-hostname`). Subdomains
  match both ways (www./previews), a null hostname or unparseable site URL skips the
  check entirely (fail-open), and non-gated sites are untouched. Bare-outcome strings
  remain accepted by `ingestSubmission` for compatibility.

- **Search flag split (#408 follow-up).** `defaultQueryMissed` conflated "the site-name
  default found no data" with "NO Search Console property matched at all" — and its
  remedy ("set an explicit Search query") permanently silenced the latter, since an
  explicit query that finds nothing is by design never flagged. `fetchSearchPresence`
  now reports `propertyFound`, and drafting raises a distinct `searchPropertyMissing`
  flag (fires for explicit AND default queries) with the correct remedy: verify the
  domain property exists and the service account has access. The `--due` batch summary
  prints the two cases as separate lines.
