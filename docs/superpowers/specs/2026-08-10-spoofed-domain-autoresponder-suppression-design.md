# Suppress autoresponder for same-domain spoofed submissions

**Date:** 2026-08-10
**Status:** Approved
**Origin:** MSOT incident 2026-08-08 — a spam bot submitted the MSOT contact
form with `info@medicalsolutionsoftx.com` as its email; the "We got your
message" autoresponder backscattered into the client's own inbox and confused
their staff (spamScore 55, below the 60 auto-spam threshold, so the row landed
as `new` and both emails went out).

## Problem

`buildAutoresponder` (src/forms/notify.ts) emails whatever address the
submitter typed. When a bot spoofs the *site's own domain*, that confirmation
lands in the client's inbox as unexplained backscatter. Auto-spam rows already
skip both emails; this gap is borderline rows that score below `SPAM_THRESHOLD`.

## Decision

Narrow spoof guard only (chosen over score-based suppression): skip the
autoresponder when the submitter's email domain belongs to the site itself.
Borderline spam from outside domains keeps receiving autoresponses — that
trade-off was considered and accepted.

## Behavior

In `buildAutoresponder`, after the existing spam-status and missing-email
guards, return `null` when the submission email's domain matches the site's own
hostname:

- Derive the site host from the Airtable row's `url` (`new URL(...).hostname`),
  strip a leading `www.`, lowercase.
- Take the email's domain (text after the last `@`), lowercase.
- Suppress when the email domain **equals** the site host **or is a subdomain
  of it** (`orders@mail.medicalsolutionsoftx.com` matches
  `medicalsolutionsoftx.com`).
- **Fail open:** site `url` missing/unparseable, or email with no usable
  domain → send as usual. Mirrors the fail-open philosophy of the Turnstile
  hostname check in ingest.

## Unchanged

- POC/client notification still sent for these rows — a human should still see
  and judge the submission.
- `spam_auto` handling, spam thresholds, notify routing: untouched.
- Central change in reddoor-maintenance; one deploy covers the fleet. No
  per-site config.

## Testing

Unit tests on `buildAutoresponder`:

1. Spoofed exact domain → suppressed.
2. Spoofed subdomain of site host → suppressed.
3. Site url with `www.` prefix, email at apex → suppressed.
4. Genuine outside lead (gmail.com) → sent.
5. Site row with missing/unparseable url → sent (fail open).
6. Case-insensitive match (`Info@MedicalSolutionsOfTX.com`) → suppressed.
7. Suffix non-match guard: `notmedicalsolutionsoftx.com` → sent (must match at
   a label boundary, not a bare `endsWith`).
