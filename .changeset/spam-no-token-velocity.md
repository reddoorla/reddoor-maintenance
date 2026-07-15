---
"@reddoorla/maintenance": patch
---

fix(forms): hard-block missing-token submissions on gated sites + duplicate-body velocity signal

Two ingest-time spam defenses aimed at the current direct-POST outreach flood, which
the content classifier can't reliably catch (grammatically clean, single-signal pitches).
Both bucket to the recoverable `spam_auto` status, never to a hard reject.

- **Absent Turnstile token → auto-spam on `Require Turnstile` sites.** `verifyTurnstile`
  now distinguishes a _configured-secret-but-no-token-forwarded_ case as a new `"absent"`
  outcome. A real browser that renders the widget always sends a token, so a completely
  missing one is the direct-POST-bot signature. On a site that has opted into
  `Require Turnstile`, both a forged token (`"fail"`) and an absent one now escalate
  (reasons `turnstile-required-failed` / `turnstile-required-absent`). A _present-but-
  expired/duplicate_ token stays `"unverifiable"` and fail-open — a real browser did
  render the widget — and sites that haven't opted in are entirely unaffected.

- **Duplicate-body velocity signal.** The same pitch blasted across the fleet (or re-run)
  shows up as identical message bodies. Ingest now does a fleet-wide lookup
  (`countRecentDuplicateMessages`, case/whitespace-normalized, 30-day window) and buckets a
  repeat as `spam_auto` + `duplicate-body`. Guarded: skipped for newsletter forms, for
  bodies shorter than 40 chars (short lines legitimately repeat across real people), and
  when the row is already spam. Best-effort — a lookup failure never blocks a lead.

Reddoor is the `Require Turnstile` canary; the absent-token block only takes effect on
opted-in sites, so this ships safe for the rest of the fleet.
