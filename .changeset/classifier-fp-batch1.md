---
"@reddoorla/maintenance": patch
---

fix(forms): stop the classifier silently bucketing genuine leads + three hardening fixes

An adversarial review pass over #410/#412 confirmed two HIGH false-positive classes and
three smaller defects. All verified by executing the classifier and replaying live data.

- **Gibberish rule reworked.** The ≥5-consecutive-consonant rule (y as consonant) fires
  on ordinary English — every `psych*` word ≥10 letters (p-s-y-c-h is itself a 5-run),
  "worthwhile", "nightclubs": 3,138 dictionary words — so gibberish(+35) + one pasted
  link(+25) silently bucketed whole genuine-lead verticals (a psychology practice's
  inquiry scored exactly 60). Now: run ≥7 with y as a VOWEL, **or** ≥3 interior
  lower→upper case flips. Measured: zero dictionary words or common brand names flagged;
  all four live mash samples still caught; live recall unchanged (8/20 marked spam).

- **Keywords split into seller-voice vs buyer-compatible tiers.** Phrases a genuine
  prospect writes in first person ("our google ranking tanked", "seo problem",
  "free consultation", "virtual assistant") stacked to 75 on exactly the SEO-help
  inquiry a web agency wants most. Buyer-compatible phrases alone now score a weak +10
  (capped +20 — even with the lead's own site link the sum stays under 60); a
  seller-voice phrase ("would you be interested", "position your brand") promotes them
  back to full weight, so real pitches still bucket at 75.

- **Duplicate-body velocity was silently inert for non-ASCII bodies**: libSQL `lower()`
  is ASCII-only while JS `toLowerCase()` is Unicode, so a sentence-cased Cyrillic spray
  could never match its own byte-identical copy. Both sides now fold in SQL (with an
  explicit whitespace trim set — SQLite's bare `trim()` strips spaces only).

- **`Accepted Watch Conditions` array elements are validated as strings** — a
  collaborator/attachment-shaped field passes `Array.isArray` with object elements and
  crashed the whole fleet cockpit build on one misconfigured row.

- **`requireTurnstile` doc comment corrected** — it still described pre-#412 semantics
  (claimed absent tokens stay neutral) and now documents the rollout precondition: only
  enable on a site whose deployed package forwards `_meta.turnstileToken` from every
  form, since a non-forwarding site would silently bucket 100% of its real leads.
