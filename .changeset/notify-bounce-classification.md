---
"@reddoorla/maintenance": patch
---

A client-side spam rejection no longer reads as a dead point-of-contact address (#783)

The resend-webhook mapped both `email.bounced` and `email.complained` onto
`notify_status = 'bounced'` and read only `data.email_id`, so Resend's `bounce`
object — the classification and the receiving server's own message — was
discarded. A Permanent bounce on a dead mailbox and a Transient/ContentRejected
refusal by the _client's_ spam filter became the same stored state, and
`collectNotifyBounceAlerts` told the operator to "check the point-of-contact
address" for both. Espada sat CRITICAL across the 2026-09-11, 09-12 and 09-14
digests over an address that was fine; their inbound filter was refusing lead
notifications whose spam_score (30 and 55) fell under our auto-filter line.

The classification is now kept (migrations 0018–0020: `bounce_type`,
`bounce_subtype`, `bounce_message`), the webhook parses `data.bounce` through a
pure `parseBounceDetail`, and the alarm words itself from it: any Permanent
bounce keeps the address wording, while none — including every unclassified row
written before 0018 — says the client's mail filter is rejecting them. Severity
stays critical either way, because the lead reached nobody in both cases.

Migration 0021 adds `bounce_ack_at`, the operator's exit: acknowledging a bounce
on the site page drops it from the alarm while KEEPING the bounce record. That
replaces the workaround actually used on 2026-09-14 — a hand-written UPDATE
against the production `submissions` table flipping `bounced` back to `sent`,
which cleared the alarm by destroying the evidence. The ack is per row, so it
clears exactly what was reviewed rather than muting a site for a fixed window,
and a genuinely dead address appearing the next day still alarms.
