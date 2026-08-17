---
"@reddoorla/maintenance": patch
---

Internal fleet mail falls back to the operator inbox, not the client inbox.

When `OPERATOR_EMAIL` is unset, the daily digest, the fleet analytics-failure
alert, and `selftest-email` all addressed `info@reddoorla.com` — the shared
client-facing inbox other staff read and reply to clients from. They now fall
back to the operator's own monitored address, which is what the pre-launch lead
guard in `forms/notify` had been doing correctly all along.

The split was not a decision anyone would defend written down; it was four call
sites each spelling out their own default, and one of them disagreeing. They now
share a single definition in `src/util/operator.ts`, so there is one place to be
right and no way for the next caller to pick the wrong inbox by copying its
neighbour.

This surfaced on 2026-08-17. The scheduled `daily-reports` run failed before it
reached its digest step, so the digest was re-run by hand from a laptop — where
`OPERATOR_EMAIL` was unset, because it had only ever been set as a GitHub
Actions repo variable. CI was correct and every local run silently was not. The
fleet digest arrived in the client inbox, and a colleague forwarded it back
asking what it was.

The failure mode worth naming is that nothing broke. A fallback that resolves to
a real, deliverable address cannot fail loudly — it just quietly picks the wrong
audience, and the only reason this was caught is that a human happened to read
it and ask. Degrading toward the inbox the operator actually watches is the
difference between a missed email and a misdirected one.

Client-facing `Reply-To` and the forced ops CC on client report sends still use
`info@reddoorla.com`, which is correct — a client replying to a report should
reach the shared inbox. Only the operator-recipient fallbacks moved.
