---
"@reddoorla/maintenance": patch
---

fix(form-e2e): survive client re-renders, and make a failure name its cause

The probe filled the form right after `domcontentloaded` and never looked
again. Anything that re-rendered the form during the settle — seen live on
2026-08-31, when a hydration mismatch on reddoor's /contact made Svelte
recreate the subtree — silently discarded the filled values AND the injected
`testMode`/`cf-turnstile-response` fields, so the click hit empty `required`
fields, native validation blocked the submit, and the night's warn said only
"no success banner — POST 200" (a Turnstile telemetry POST; beachfront's
"POST 204" the same night was Google Analytics' beacon).

Three changes, one per lesson:

- Verify the fills just before the click and refill once if they were wiped;
  a pass that needed the refill says so in its summary, so production keeps
  proving (or retiring) the race.
- Scope the observed POST to the site's own host (`isSameSitePost`), so the
  reported status is the action's — and BUDGET_THIN can no longer time a
  third-party beacon.
- On failure, report why nothing happened (`noBannerDetail`): same-site POST
  or "the submission never left the page", empty required fields, validity,
  alert text, and whether a hydration-mismatch warning was seen.
