# Cockpit Google Sign-In — Design

Replace the cockpit's single shared Basic-auth password with Google sign-in and
a signed session cookie, so that every operator action is attributable to a
named person and can be revoked individually.

## What and why

Twelve Netlify functions currently gate on one shared secret:

```ts
const password = process.env.DASHBOARD_PASSWORD;
if (!password) return plainText("… unconfigured …", 503);
if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
  return plainText("Authentication required.", 401, {
    "www-authenticate": 'Basic realm="Reddoor fleet"',
  });
}
```

`fleet-homepage`, `fleet-table`, `refresh-fleet`, `approve-report`,
`site-details`, `site-dashboard`, `report-preview`, `trigger-renovate`,
`prospect-audits-page`, `prospect-audit-run`, `submissions-page`,
`submission-status`. Nothing else calls them: no workflow, script or webhook
authenticates against the dashboard, so every caller is a human in a browser.
That is what makes this replaceable in one pass.

Two concrete problems, beyond the general case against shared passwords:

**The audit trail is fiction.** `resolveRequestedBy` reads the Basic _username_,
which `verifyBasicAuth` documents itself as deliberately ignoring — only the
password gates entry. Any operator can type any name, so `requested_by` on a
prospect audit is unverified free text defaulting to `"cockpit"`. The
`/audits` page lists who ran each audit and the list cannot be trusted.

**`csrf.ts` exists only to compensate for Basic auth.** Its docstring says so:
"a state-changing POST reachable with the ambient Basic-auth creds the browser
replays cross-site". Browsers attach Basic credentials to cross-site requests
automatically, so every state-changing endpoint needed a hand-rolled
`Sec-Fetch-Site`/Origin check. A `SameSite=Lax` cookie is not sent on cross-site
POSTs at all, which removes the cause rather than checking for the symptom.

There is no state-changing GET on the dashboard — the "Send anyway…" override
that reads like a link (`/api/reports/:id/approve?override=1`) is submitted by
`fetch` with `method: "POST"` — so `Lax` covers the entire surface.

## The shape

Authorization Code + PKCE against Google, then a signed cookie. No new runtime
dependency: the exchange is two `fetch` calls, and the signing is
`node:crypto`.

**Revocation without a session table.** The allowlist is re-read from the
environment on _every request_, not just at sign-in. Removing an address logs
that person out on their next click. Rotating the signing secret logs out
everyone. This is what buys us a stateless cookie: no Turso round-trip on the
authentication path, and a 30-day session is still safe because it can be
withdrawn at any moment.

The limit that follows, stated plainly: a live cookie on a stolen laptop cannot
be revoked on its own without rotating the secret and signing out all three
operators. For a three-person tool that is the right trade against operating a
session table; it is not the right trade for a larger team, and this is the
decision to revisit if the operator list grows.

## Endpoints

One function, `netlify/functions/auth.mts`, serving four paths — the same
convention `refresh-fleet.mts` uses for `/api/fleet/refresh` and its `/status`
poll. Rate-limited to 30/min per IP.

### `GET /auth/login`

Public. Renders a small page rather than bouncing straight to Google: a stale
bookmark should not fling the operator at an account chooser with no
explanation, and "that account is not authorised" needs somewhere to be said.

Three states, chosen by query parameter:

- default — "Sign in with Google"
- `?denied=1` — the account authenticated but is not on the allowlist. Offers
  "try a different account", which restarts the flow with
  `prompt=select_account` so a wrongly-cached Google account can be swapped.
- `?error=<code>` — the flow failed.

`error` codes map to fixed strings through a lookup table, exactly as
`STAGE_FAILED_MESSAGE` does in `src/prospect/render.ts`. Query text is never
echoed into the page.

Starting the flow: generate a PKCE verifier and `state`, set the `rd_auth_state`
cookie, redirect to Google's authorization endpoint.

### `GET /auth/callback`

The registered redirect URI. Verifies `state` against the cookie, exchanges the
code (with the verifier and the client secret) for tokens, calls Google's
userinfo endpoint, and requires `email_verified === true`. Checks the allowlist.
On success: clear `rd_auth_state`, set `rd_session`, redirect to the stored
`returnTo`. On rejection: redirect to `/auth/login?denied=1`. On any other
failure: `/auth/login?error=…`.

Google's endpoints, confirmed against
`https://accounts.google.com/.well-known/openid-configuration` on 2026-08-25:

| Purpose       | URL                                                |
| ------------- | -------------------------------------------------- |
| Authorization | `https://accounts.google.com/o/oauth2/v2/auth`     |
| Token         | `https://oauth2.googleapis.com/token`              |
| UserInfo      | `https://openidconnect.googleapis.com/v1/userinfo` |

`S256` is supported, and `email` / `email_verified` are supported claims.
These are hardcoded with a comment pointing at the discovery document rather
than fetched at runtime — one fewer network call and one fewer failure mode on
a URL set that has been stable for years.

**Why userinfo rather than decoding the `id_token`.** The token response carries
an ID token whose signature OIDC Core §3.1.3.7 permits skipping when it arrives
directly from the token endpoint over TLS, which would save a round trip. It
would also put a "decode this JWT without verifying it" helper in the codebase,
which is a genuinely dangerous thing for someone to later reuse against a token
from an untrusted source. Sign-in happens rarely; the extra request costs
nothing that matters and leaves no footgun behind.

Scopes are `openid email` — not `profile`. The cockpit needs an identity, not a
name and a photograph.

### `GET /auth/logout`

Clears `rd_session` and redirects to `/auth/login`.

GET, not POST. Logout CSRF is real but nuisance-only — the worst outcome is
ending your own session — and the alternative means threading a POST form
through five independently-built page shells. Recorded here so the choice reads
as deliberate rather than overlooked.

### `GET /auth/basic`

Present only when `DASHBOARD_PASSWORD` is set. Returns `401` with
`WWW-Authenticate: Basic` when unauthenticated, and redirects to `returnTo` once
the header validates.

This exists because of an ordering problem that is easy to miss. Browsers only
volunteer Basic credentials to an origin after being challenged once, and the
new gate never sends `WWW-Authenticate` — a challenge on a JSON endpoint would
pop a native password dialog in the middle of a `fetch`. Without a deliberate
way to trigger the challenge, the shared-password fallback would be unreachable
in a browser, which would lock everyone out of deploy previews. The login page
renders a secondary "use the shared password" link to this path when the
variable is set, and renders nothing when it is not.

## Modules

All under `src/dashboard/auth/`, pure and separately testable, following the
same decomposition as `src/prospect/`.

| File             | Responsibility                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cookies.ts`     | Parse a `Cookie` header; serialize a `Set-Cookie` value. No crypto.                                                                                                                                                    |
| `signing.ts`     | Versioned HMAC-SHA256 sign/verify over a string payload.                                                                                                                                                               |
| `session.ts`     | Session payload semantics — mint, verify, TTL.                                                                                                                                                                         |
| `oauth-state.ts` | The `{state, verifier, returnTo}` blob, and `safeReturnTo`.                                                                                                                                                            |
| `google.ts`      | PKCE pair, authorize URL, code exchange, verified-email lookup.                                                                                                                                                        |
| `allowlist.ts`   | Parse and test `DASHBOARD_ALLOWED_EMAILS`.                                                                                                                                                                             |
| `require.ts`     | `requireOperator`, the gate the endpoints call, plus `readAuthConfig` — the single reading of the auth environment that the gate and the sign-in handler share, so they cannot disagree about what "configured" means. |
| `render.ts`      | The login page, and the signed-in chrome fragment.                                                                                                                                                                     |

`signing.ts` is separated from `session.ts` because it is the security-critical
primitive and deserves its own focused test file — and because `oauth-state.ts`
needs it too.

### The session token

`v1.<base64url(payload)>.<base64url(hmac)>`, where the payload is
`{ email, iat, exp }` and the MAC covers the encoded payload segment.

Verification splits on `.`, checks the version prefix, recomputes the MAC, and
compares constant-time. **Byte lengths are compared before `timingSafeEqual`**,
which throws `RangeError` on a length mismatch — the same lesson already
learned and documented in `basic-auth.ts`, where a JS-length guard would have
turned a wrong password into an uncaught 500. A malformed signature segment is
an ordinary rejection, not a stack trace.

`exp` is checked against an injected clock so expiry is testable without waiting.

### Cookies

| Cookie          | Lifetime   | Attributes                                   |
| --------------- | ---------- | -------------------------------------------- |
| `rd_session`    | 30 days    | `HttpOnly; Secure; SameSite=Lax; Path=/`     |
| `rd_auth_state` | 10 minutes | `HttpOnly; Secure; SameSite=Lax; Path=/auth` |

**`SameSite=Lax` is required, not merely chosen.** `Strict` would break sign-in
outright: the callback is a top-level navigation _from_ `accounts.google.com`,
and a `Strict` cookie is withheld on cross-site navigations, so `rd_auth_state`
would never arrive and every sign-in would fail state validation. `Lax` sends
cookies on top-level GET navigation and withholds them on cross-site POST,
which is exactly the property this design wants. Any future change to `Strict`
breaks the login flow.

`rd_auth_state` is signed even though it is `HttpOnly`, because `HttpOnly` only
stops scripts reading it — the operator can still edit it in devtools, and
`returnTo` rides inside it.

### `requireOperator`

```ts
type OperatorAuth = { ok: true; email: string | null } | { ok: false; response: Response };

function requireOperator(
  req: Request,
  opts: { wants: "redirect" | "json"; env?: NodeJS.ProcessEnv },
): OperatorAuth;
```

`email` is `null` when entry came through the shared-password fallback, which
has no identity to report. Callers that record who acted must treat `null`
honestly rather than inventing a name.

Order of decisions:

1. `DASHBOARD_SESSION_SECRET` and `DASHBOARD_ALLOWED_EMAILS` both present, and
   `rd_session` verifies → check the allowlist. Still listed → `{ ok: true }`.
   No longer listed → clear the cookie and reject, sending a navigation to
   `/auth/login?denied=1` so the person is told why rather than looping through
   a sign-in that will fail again.
2. No usable session, `DASHBOARD_PASSWORD` set, Basic header valid →
   `{ ok: true, email: null }`.
3. Neither Google sign-in nor the shared password is configured → `503`. Fail
   closed: a deploy that can authenticate nobody says so instead of admitting
   everybody.
4. Otherwise → `302` to `/auth/login?returnTo=…`, or `401 {"error":
"unauthenticated"}`.

The Google configuration and the Basic fallback are checked **independently**,
and this ordering matters. Treating a missing `DASHBOARD_ALLOWED_EMAILS` as an
immediate `503` — the obvious way to write "fail closed" — would return `503`
on every deploy preview, where Google sign-in cannot work and the shared
password is the only way in. Each mechanism is unconfigured on its own terms;
only the absence of both is a misconfiguration.

`/auth/*` is never gated by `requireOperator`. The login page has to be
reachable by someone who is not yet signed in.

**`wants` is chosen by how the browser reaches the route, not by its path.** A
`302` to Google inside the approve button's `fetch` is useless — the page needs
a status it can act on. Navigations redirect; `fetch` targets get JSON:

- redirect: `fleet-homepage`, `fleet-table`, `site-dashboard`,
  `prospect-audits-page`, `submissions-page`, `report-preview`
- json: `refresh-fleet`, `approve-report`, `site-details`, `trigger-renovate`,
  `prospect-audit-run`, `submission-status`

`report-preview` sits under `/api/` but is opened as a link in a new tab, so it
redirects. Sorting these by URL prefix would get it wrong.

**The existing ordering is preserved**: authentication still runs _before_ the
Turso and Airtable environment guards, so an unauthenticated probe still cannot
learn which services a deploy has configured. That was deliberate in the current
handlers and several carry a comment saying so.

### `safeReturnTo`

Accepts only a same-origin path: must begin with `/`, must not begin with `//`
or `/\`, and falls back to `/`. Without this the login endpoint is an open
redirect, and an attacker-supplied `returnTo` would send an operator to another
origin immediately after a successful sign-in.

### Signed-in chrome

There is no shared page shell — `fleet-render.ts`, `fleet-table-render.ts`,
`prospect-audits-render.ts`, `submissions-page-render.ts` and `render.ts` each
emit their own `<!doctype html>`. Rather than refactor five renderers into one
layout, which is unrelated work, `render.ts` exports a small
`renderAuthChrome(email)` fragment — "signed in as … · sign out" — that each
page drops into its header. Five one-line insertions.

## Changes to existing code

- Twelve handlers: the password block becomes two lines.
- `resolveRequestedBy` takes the verified email instead of the `Authorization`
  header, returning `"cockpit"` only for the identity-less Basic fallback.
- `basicAuthUsername` is **deleted** along with its tests. It existed solely to
  present unverified input as an identity; with a real one available it is not
  merely unused but actively misleading.
- `verifyBasicAuth` and `basic-auth.ts` stay — the fallback depends on them.
- `csrf.ts` stays. `SameSite=Lax` makes it redundant for cookie sessions, but it
  still covers the Basic fallback path, and removing a working CSRF check as a
  side effect of an auth change is not a trade worth making.

## Testing

Every test runs offline. `google.ts` takes an injected `fetch`; anything
time-dependent takes an injected clock.

- **signing**: round-trip; tampered payload; tampered signature; wrong secret;
  malformed segment counts; a signature of the wrong byte length rejects rather
  than throwing.
- **session**: mint/verify round-trip; expired (including `exp` exactly at now);
  a token signed with a rotated secret fails; a validly-signed token whose
  payload is the wrong shape is rejected.

  Only `exp` is enforced. An earlier draft of this spec called for rejecting a
  future `iat` as clock skew; that was dropped during implementation, and the
  test now asserts the opposite. Rejecting a future `iat` turns ordinary skew
  between deploys into a mysterious sign-out and buys nothing — the token is
  signed by us either way.

- **allowlist**: comma and whitespace handling; case-insensitive matching;
  empty and unset both admit nobody; an entry that is not an address never
  matches.
- **oauth-state**: round-trip; `safeReturnTo` accepts `/audits`, rejects
  `//evil.com`, `/\evil.com`, `https://evil.com`, and the empty string.
- **google**: authorize URL carries `client_id`, `redirect_uri`, `scope`,
  `state`, `code_challenge`, `code_challenge_method=S256`; the challenge is the
  base64url SHA-256 of the verifier; code exchange posts the verifier and
  secret; userinfo rejects `email_verified: false`; a non-200 from either
  endpoint surfaces as a typed failure, not a throw.
- **requireOperator**: the full matrix — session valid/expired/tampered/absent ×
  Basic present/absent/wrong × `wants` redirect/json. Plus the three cases the
  ordering exists for: an operator removed from the allowlist mid-session is
  rejected to `?denied=1`; a deploy with **only** `DASHBOARD_PASSWORD` set (the
  preview case) authenticates by Basic rather than returning 503; a deploy with
  neither mechanism configured returns 503 rather than admitting anyone.
- **auth handler**: state mismatch rejects; the state cookie is cleared on both
  success and failure; `returnTo` survives the round trip; the login page renders
  the shared-password link only when `DASHBOARD_PASSWORD` is set; error codes
  render fixed strings and never echo the query.
- The twelve existing adapter tests are updated to the new gate.

## What this deliberately does not do

- **No session table, no per-device revocation.** Covered above.
- **No roles.** Everyone on the allowlist is a full operator. Three people, one
  privilege level; permissions can be added when there is a second one.
- **No Workspace domain rule.** An explicit address list works whether or not
  the operators share a domain, and "anyone at the domain" is a weaker gate than
  three named addresses.
- **No sliding refresh.** Re-authenticating is one click when already signed in
  to Google. A refresh path is state to get wrong for a benefit measured in
  clicks per month.
- **No change to public routes.** `/r/:token` prospect reports, form ingest and
  the Resend webhook stay public; they are public by design.

## Deploy-time

**1. Google Cloud OAuth client.** Create a Web application client. Authorized
redirect URI: `https://reddoor-maintenance.netlify.app/auth/callback`, derived
in code from `resolveDashboardBaseUrl` so it cannot drift from the registered
value. Google permits no wildcards, which is why deploy previews cannot use
Google sign-in and keep the shared password instead.

**2. Netlify environment variables.**

```bash
netlify env:set GOOGLE_OAUTH_CLIENT_ID     "…" --context production
netlify env:set GOOGLE_OAUTH_CLIENT_SECRET "…" --context production --secret
netlify env:set DASHBOARD_SESSION_SECRET   "$(openssl rand -base64 32)" --context production --secret
netlify env:set DASHBOARD_ALLOWED_EMAILS   "…,…,…" --context production
```

`netlify env:clone` writes masked garbage for secret variables, so anything
marked `--secret` must be set explicitly per context. That has bitten this fleet
before.

**3. Rollout, in this order.** Deploy with `DASHBOARD_PASSWORD` still set in
production. Sign in with Google **in a private window** — a browser that already
holds cached Basic credentials will keep replaying them and sail past Google
without ever exercising the new path. Once all three operators have signed in
successfully, unset `DASHBOARD_PASSWORD` in the production context only, leaving
it on `branch-deploy` and `deploy-preview`, and redeploy.

**Rollback** is restoring `DASHBOARD_PASSWORD` in production and redeploying —
Netlify functions read environment variables from the deploy, so a variable
change needs a new deploy to take effect. No code revert required.

## Sequencing

This touches all twelve endpoints, including the two added by #580 and #581.
Both are green and mergeable; they land first, and this is built against `main`
afterwards, so the diff has one parent instead of a three-deep stack to rebase.

**Implementation note.** The work was built against `main` while #580 and #581
were still open, so it converts the **ten** endpoints that exist there.
`prospect-audits-page` and `prospect-audit-run` arrive with those PRs and get
the same two-line gate on rebase — `prospect-audits-page` as a navigation
(`redirect`), `prospect-audit-run` as a `fetch` target (`json`). Until that is
done those two routes still carry the old Basic-auth block, which keeps working
because `verifyBasicAuth` and `DASHBOARD_PASSWORD` are retained for the
fallback; they are simply not yet identity-aware, so their `requested_by` stays
`"cockpit"`.
