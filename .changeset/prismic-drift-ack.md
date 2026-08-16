---
"@reddoorla/maintenance": minor
---

An expected Prismic divergence can be accepted — until a date, and no longer.

A `fail` is sometimes correct and already known: the operator is modelling in
Prismic on a branch that has not landed, so Prismic is legitimately AHEAD of
`main` and the nightly is faithfully reporting a divergence nobody needs to act
on. Until now the only options were to leave a permanent red item in the
needs-you feed or to stop believing the feed — and the second one happens on its
own, which is how a fleet stops reading its own alarms.

The new `Prismic Ack Until` column (dateTime) accepts one site's `fail` until a
moment the operator picks. While it is in the future the drift item is not
raised, and the cockpit carries a muted `Prismic drift accepted until
2026-08-30` chip instead — an accepted finding is still a finding, and the site
must not read as plainly healthy.

**It expires, and nothing renews it.** A permanent ack would reproduce this
column's own failure mode one step later: once the branch lands, the same acked
cell would silently swallow real drift, and "nobody is looking at this" would
render as "this is fine" — the exact collapse the drift sweep exists to prevent.
An expiry means the worst case is a silence that ends by itself.

It is deliberately narrow, and the placement in `collectPrismicDriftAlerts`
enforces the narrowness rather than documenting it — the check sits after the
`unknown` and staleness branches have already returned, so it is unreachable for
either:

- **never mutes `unknown`** — the check could not run at all, usually a dead
  write token. Accepting "Prismic is ahead of main" says nothing about a broken
  secret, and muting it would send the operator to fix a model when the job is
  to fix a credential.
- **never mutes the staleness escalation** — a verdict nobody has re-established
  is not a verdict. If an ack also suppressed staleness, a site whose nightly
  had quietly died would look accepted-and-fine indefinitely.
- **never mutes `pass`** — there is nothing to accept.

Every uncertain reading resolves to "not acked": blank, whitespace, an
unparseable date, or an expiry exactly equal to now. A mistyped cell costing one
noisy item is recoverable; a mistyped cell silently muting a live finding is not.

Ships dark until the column exists — absent, it reads null and nothing is acked.
