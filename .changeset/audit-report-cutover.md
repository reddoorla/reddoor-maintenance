---
"@reddoorla/maintenance": minor
---

Point the prospect audit's link at reddoorla.com, and redirect the old one.

The report now lives at `reddoorla.com/audit/{token}` — a real, branded page on
our own domain rather than generated HTML on the ops app's. The audit email
links there.

`/r/:token` stays as a permanent redirect and is deliberately not deleted.
Links already sent are sitting in prospects' inboxes and will be opened months
from now; keeping them working is the entire point of a 301. The redirect is
built from the same token, so the destination is the same document and nobody
following an old link can tell anything moved.

It validates the token shape before redirecting. Without that check the route
would happily bounce an arbitrary path segment onto reddoorla.com — an open
redirect wearing our own domain.

The redirect no longer opens the database, and no longer resolves whether the
report exists. That is deliberate: the destination is the source of truth for
that, and checking in both places would let the two disagree. A dead token now
redirects and 404s at the website.

The report origin is its own `REPORT_BASE_URL` rather than reusing
`DASHBOARD_BASE_URL`. The dashboard addresses operators on the ops app; this
addresses a prospect on the marketing site. They are different audiences on
different domains, and sharing one variable would mean either silently moving
the day the other is repointed. Unset, it defaults to `https://reddoorla.com`.
