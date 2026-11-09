# 2026-11-09 — Webhook forwards refuse redirects (#1970)

Landed in the PR that closes reddoorla/reddoor-maintenance#1970.

`postJson` in `src/forms/webhook.ts` is the one POST both webhook forwarders use.
It checked the configured URL with `isPublicHttpsUrl` and then let fetch follow
redirects for the newsletter forward, so a public https hook answering 307 with
`Location: http://169.254.169.254/…` would have had the subscriber's email, name,
page and UTMs re-POSTed to the metadata address. The form forward (from #1974)
already passed `redirect: "manual"`; the newsletter forward was left alone then so
existing sites saw no change. Now `"manual"` is hard-wired inside `postJson`, and
the parameter that let a forwarder leave it out is gone.

Why refuse rather than follow with the guard on every hop, as
`src/prospect/http-probes.ts` does for the crawler's GETs: a forward gains nothing
from a follow. Checked against real local servers on Node's fetch: on a 302 the
default follow re-sent the POST as a GET with a 0-byte body, and on a 307 it
re-POSTed the full 15-byte body to the second server; with `"manual"` neither
server behind the redirect was hit and the 3xx came back with `ok: false`. So the
only redirect that carries the data on is the 307/308 the guard exists for.

The cost, for the Sonder worker: a Google Apps Script web app answers a POST to
`/exec` with a 302 to `script.googleusercontent.com` after `doPost` has already
run. Under this rule the data still arrives, but the row is stamped
`form-webhook:302` and the forward is logged as a failure. That is a reporting
problem, not a delivery one, and it is not fixed here by loosening the guard; it
is written in the PR body. Not probed against a live Apps Script.

The test (`tests/forms/webhook-redirect.test.ts`) uses a fetch stub that follows
unless told `"manual"`, the way the local-server check showed Node does, and runs
every case through both forwarders. On main's code it fails 10 of 20 (the
newsletter cases); with `"follow"` forced into `postJson` it fails 21 of 41 in the
two webhook files.
