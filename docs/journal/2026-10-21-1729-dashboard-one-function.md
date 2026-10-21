# 2026-10-21 — The dashboard as one function, and rate limits that throttle

**Where it landed:** reddoorla/reddoor-maintenance#1645 (branch `claude/dashboard-one-fn`), after the measurement draft #1642. This is PRs 1 and 2 of the workspace brief `briefs/2026-10-21-dashboard-one-function.md`. PR 3 (the bundle diet and latency) is separate.

**Why.** From one IP, 260 requests to four rate-limited paths got no 429 (`2026-10-21-1320-rate-limit-one-ip-probe.md`, #1592). The leading suspect was Netlify's cap on code-based rules: 5 per project on Pro, against the 18 this site declared. The cockpit was also slow, and part of that was each page being its own 16 MB function with its own cold start.

**PR 1: the cap is the cause.** Draft #1642 removed `rateLimit` from all 17 functions, leaving the edge rule (60 a minute) as the site's only one. The probe ([run 39632774690](https://github.com/reddoorla/reddoor-maintenance/actions/runs/39632774690)) sent 90 requests from one IP (20.98.142.228) to its deploy preview's `/fleet/__data.json`, between 9:13:47 and 9:14:56am PT.

- Requests 1 to 65 got 200.
- Requests 66 to 90 got 429. The first 429 came 53.9 s after the first request.

The preview's deploy record carried 0 function `rate_limit_config` entries, against production's 17. This was also the probe's first PASS on a known-good input, which the 1320 entry said it still lacked. #1642 is closed.

**PR 2: one function and four rules.**

- **The endpoints moved into the cockpit app.** The dashboard's own endpoints are now SvelteKit `+server.ts` routes on the same paths: approve, unapprove, withdraw, rerender, preview, commentary, submission status, site details, trigger-renovate, refresh-fleet with its status poll, prospect-audit run, and the four `/auth/*`.
  - Each handler is the old function file, changed only in its imports, in `cockpit/src/lib/server/endpoints/`.
  - Each route exports only `fallback`, so the handler still answers every method, its own 405s included.
- **`split: false`.** The build now writes one function, `sveltekit-render` on `/*`. The preview's deploy listed 8 functions where production lists 25.
- **The four rules.**
  - An edge rule on `/*` at 120 a minute. It covers the pages, `/api/*`, `/r/*` and `/api/audit-report/*`, and excludes `/api/forms/*`, `/auth/*`, `/.netlify/*` and `/_app/*`.
  - An edge rule on `/auth/*` at 30 a minute.
  - `form-ingest`'s own rule, at 120.
  - `resend-webhook`'s own rule, at 60.
  - A test refuses a fifth rule beyond these four, and any count over 5.
- **The brief's arithmetic did not fit.** It asked for one rule on `/*`, one on `/auth/*` and "the external endpoints' own rules". There are four external endpoints, which makes 6. `prospect-report` and the two audit-report functions therefore joined the shared budget. Their paths, methods, CORS headers and bodies are unchanged, and only the budget number moved: `audit-report-overrides` goes from 30 to 120 and `/r/*` from 60 to 120. Neither declared limit had applied.
- **Why 120.** The busiest real minute could not be measured. Netlify's observability query returned only the last hour, which held no operator traffic, and the connector then needed signing in again. The budget comes from the cockpit's own request pattern instead: one request per navigation or action click, plus the fleet refresh's poll every 10 s. A frantic operator minute is about 50 requests. 120 is over twice that, and it is the most generous of the per-function limits it replaces (`audit-report-json` and `report-preview`).

**Measured on the deploy preview, from one IP (130.131.239.211, probe run 4):**

| Burst                                                          | Limit       | Result                   |
| -------------------------------------------------------------- | ----------- | ------------------------ |
| `/fleet/__data.json`                                           | 120/min     | 128 × 200, then 7 × 429  |
| `/api/sites/probe/details`                                     | 120/min     | 125 × 200, then 10 × 429 |
| `/auth/login`                                                  | 30/min      | 32 × 200, then 13 × 429  |
| `/_app/%2e%2e/fleet`                                           | not limited | 135 × 404                |
| `/api/forms/%2e%2e/%2e%2e/fleet` with a wrong password (run 5) | not limited | 135 × 404                |

The last two are the dot-segment paths the security review asked about. Their prefixes sit outside the limit, but they never reach the password check.

**Parity.** 41 signed-out requests went to production and to the preview, once each and in sequence: every page, every endpoint's GET, three POSTs and a PUT, the external endpoints with a CORS preflight, and the oracle paths from the cutover. Status, content type, `Location`, `cache-control`, CORS, `Allow` and the body hash were identical on all 41. The only exception was the `<div>` Netlify injects into previews, and with that removed the login page hashed the same too.

**Review: three lenses, two rounds.**

- **Round 1** found three majors. All are fixed:
  - **SvelteKit's own origin check** sat in front of the moved POST routes. It refused a form-typed POST with no `Origin`, which the old functions took. It is now off (`csrf.trustedOrigins: ["*"]`).
  - **The comments overstated sign-in's limit.** They claimed its 30 a minute bounded password guessing, but the pages and `/api/*` take the shared password as Basic auth, under the 120. The real bound is 150 a minute per IP. The old configs declared 60 for pages and 20 to 120 for endpoints, none of which applied.
  - **A signed-out test sent POST to the status poll**, so it never reached that route's own gate.
- **Round 2 was clean**, minors and nits only. Folded in:
  - **`isCsrfAllowed` refuses `Origin: null`.** With SvelteKit's check off, it is the pages' only gate. It had treated an opaque origin as absent.
  - **The hook needs the raw path and the matched route under the same prefix.**
  - **Comments and `docs/SETUP.md`** no longer call the moved endpoints Netlify functions.

**Mutations, each run alone (13, all red).** The brief's seven:

- the hook loses `/r/`;
- a route exports `GET`;
- the edge rule excludes `/api/*` again;
- `site-details` skips `requireOperator`;
- `form-ingest`'s path changes;
- a sixth rule is declared;
- approve takes the approver from the request body.

The rounds added six more: the status poll skips its gate, the origin check comes back on (two forms of that test), commentary accepts GET, `Origin: null` is allowed, and the hook ignores the raw prefix.

The first run of the approve mutation was invalid. It referenced a variable out of scope, so 27 tests failed for the wrong reason. Rewritten as a valid body read, it fails exactly one test: the #1582 guard, "ignores any approver the request body names".

**Defects of my own, caught before merge.**

- **The squash reverted five files.** I squashed onto a newer `origin/main` than the base I had rebased on. The pushed commit `1ef72dde` (branch `claude/dashboard-one-function`) reverted match-harness, digest-collect, pm-cockpit, a changeset and a journal entry. It got no PR. The work moved to a fresh branch, because force-push is denied and the proxy refuses branch deletes, so the stale branch stays.
- **The parity script's status column was wrong.** Its first run read every status as 200, taken from the egress proxy's `HTTP/1.1 200 Connection established`. Statuses now come from curl's `%{http_code}`.
- **CI went red once on `svelte-check`.** After round 1 I ran the tests but not `pnpm typecheck`, and a test's import of the untyped `svelte.config.js` failed. The setting is now pinned by reading the file as text.

**Beliefs corrected.**

- **The brief named the shared budget the dashboard's.** In fact it is also the password-guessing bound for Basic auth on every page and endpoint, which the sign-in rule does not cover.
- **The probe was blocked once.** A burst against production was refused by this session's tool policy as workload interference. Every burst here went to deploy previews, and today's production burst was not re-run. The production evidence is still #1592's two runs.
- **#1642 got no deploy preview while it was a draft** until it was marked ready, even though draft #1633 got one. Netlify had missed the open event, not skipped drafts.

**Not done here.**

- PR 3: the 16 MB, which is `preflight.ts` and the site view importing the send pipeline and MJML, and the before/after latency.
- The functions region and the Turso region, which are the operator's.
- The operator's busiest real minute, measured from the request log.
