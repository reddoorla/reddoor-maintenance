---
"@reddoorla/maintenance": patch
---

Add a blocked-sender-domain tier to the spam classifier.

`jmailservice.com` sent 17 submissions across four unrelated client sites between
2026-06-17 and 2026-08-25. Every one was spam. **Ten of them were emailed to the
operator**, including the two most recent, which scored 30 and 0.

They dodged all three existing defences at once. The content scorer sees varying
bodies that mostly sum under 60. The cross-site `repeat-sender` signal is keyed on
the exact email address, and the sender rotates a plausible `firstname.lastname@`
local part — 11 distinct addresses over those 17 sends — so it almost never saw a
repeat. And the existing disposable-domain list scores +45, which needs
corroboration: even with the domain listed there it would have bucketed only the
five sends that already carried another signal, and **none of the ten that reached
the inbox**. The identity changes every time; the domain does not.

`BLOCKED_EMAIL_DOMAINS` is a second, stricter tier for domains where every
submission the fleet has ever received was spam, so it buckets alone. It is scored
as `SPAM_THRESHOLD` rather than a literal, because the signal is defined as "enough
on its own" rather than as a number that a later threshold change could strand.
Matching covers subdomains (`mail.<domain>`) but stops at a label boundary, so a
look-alike registration like `notjmailservice.com` is unaffected. Nothing is
dropped: a blocked submission is still stored, still visible in the cockpit, and
still recoverable — it just lands `spam_auto`, which suppresses the notification.

**Auditing the rest of the live traffic added seven more.** The MAVIS
virtual-assistant flood — whose body invariants are already in `SPAM_KEYWORDS` —
turns out to run from seven sender domains sharing the same rotate-the-first-name
pattern: 35 submissions, all pitches, 12 of them emailed to the operator.

The tier ships with a deliberately high entry bar, because it is the only signal
with no corroboration requirement, and two entries were **rejected** while applying
it — both of which a naive "100% of its submissions are spam" query would have
added:

- `lemos.com`, 10 for 10 "spam", is the operator's own landing-page test traffic
  from `tucker@lemos.com`. Listing it would have bucketed his own testing.
- `melottogroup.com`, 3 for 3 genuine cold outreach, uses one fixed address with no
  rotation, which `repeat-sender` already catches.

Hence rule 1 of the entry bar: read every row, not the ratio. A regression test
pins the rule that matters most — no shared mailbox provider (gmail, outlook,
icloud, the ISP domains) may ever appear on this list, since a single such entry
would silently bucket every real lead using it and no other signal would be needed
to do it.
