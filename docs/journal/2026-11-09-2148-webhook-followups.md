# 2026-11-09 — Webhook URLs checked at save, and the form webhook's test gaps (#1971, #1972, #1973)

Landed in the PR that closes reddoorla/reddoor-maintenance#1971, #1972 and #1973,
the remaining minors from the review of #1974. #1970 went separately and first
(the redirect refusal), because Sonder's form webhook goes live as soon as Carlo
sends a URL.

**#1971.** Both webhook fields used the editor's `url` kind, which accepts any
http(s) URL, while the forwarders send only to a public https one. So
`http://hooks.zapier.com/…` saved with no complaint and every forward after it
was stamped `webhook:0` (or `form-webhook:0`), which nobody looks at until a client asks where their
leads went. A new kind, `webhookUrl`, validates with `isPublicHttpsUrl`, the
same function `postJson` checks before every POST. The cockpit's `DetailField`
shows "failed" on any 400, so the operator sees the refusal when they leave
the field. It does not say why, and it looks the same as a network failure.
Values already stored are not re-checked: an `http://` hook saved before this
still fails every forward until someone re-saves or clears it. I did not read
Turso for any (a read-only query was refused in this session). The
test checks that the editor and the forwarder agree. Eleven candidate URLs go
through both: public https, an Apps Script `/exec`, http, loopback, 10.x,
169.254, localhost, `[::1]`, ftp, `javascript:` and junk. For each one,
"saves" must equal "the forwarder called fetch". The rule cannot drift between
the two without this test going red.

One existing assertion changed. The `url` kind's test had asserted that
`http://` saves, using `newsletterWebhook` as its example. It now uses the
site's own `url` field, which still accepts http. The old assertion was pinning
exactly the behaviour #1971 asked to remove.

**#1972.** `RICH` lacked three of the 29 `SITE_FIELDS` columns, not two:
`Form Webhook`, `Form Webhook Types` and `Prismic Ack Drift`. With RICH as it
was on main, I blanked either form-webhook column in `fleet-state.ts`'s reader
(`formWebhook: null`, then `formWebhookTypes: []`), and the equivalence test
still passed 42 of 42. With all three columns in RICH, each mutation fails
"rich record: every populated field round-trips identically". A completeness
test over `SITE_FIELDS`, beside the health-field one, now fails if a later site
column is left out of RICH. Deleting `Form Webhook` from RICH turns it red.

**#1973.** Three tests: a `requireTurnstile` site with an absent or failed
token is `spam_auto` and is not forwarded, with a passing-token control that is;
a `building` site forwards even at score 100 with no token; a deferred tail
still forwards and stamps after the response. Review round 1 showed the first
version of that last test passed even with the tail run inline. It now holds
`notify` open and requires `ingestSubmission` to return first. Each was proved by removing the
code it covers. Without the Turnstile escalation, without the building gate, or
with the deferred tail never run, each new test goes red, and main's
`form-webhook.test.ts` stays 21 of 21 green under all three. The issue was right
that these were coverage gaps.

Belief corrected: the issue said only the two form-webhook columns were missing
from the fixture. The completeness check found the third (`Prismic Ack Drift`)
on its first run.
