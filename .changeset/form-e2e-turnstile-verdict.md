---
"@reddoorla/maintenance": minor
---

`Turnstile widget` is now earned by a browser. The column moves from the `function-health` audit to `form-e2e`.

`function-health` could only ever see whether `PUBLIC_TURNSTILE_SITE_KEY` was a non-empty string — `/health` never contacts Cloudflare — so it could not tell a working widget from one whose hostname is not on the widget's allowlist. That state throws `110200`, mints no token, and on a `Require Turnstile` site buckets 100% of real leads (#689).

`form-e2e` can: it already drives Chromium against each site's live contact form, and — contrary to what the docs claimed until today — it does **not** swap the sitekey, so the site's real widget renders with its real key on every nightly run. It now watches for the rejection and writes the verdict:

| observation                                       | verdict                 |
| ------------------------------------------------- | ----------------------- |
| `/health` reports no sitekey                      | `fail`                  |
| uncaught `110200` on the live page                | `fail`                  |
| mount point **and** a 2xx for Cloudflare's api.js | `pass`                  |
| key set, no widget on the page                    | `null` (clears)         |
| any other `110xxx` (invalid/deleted sitekey)      | `null` (clears)         |
| the probe never opened a browser                  | `null` (clears)         |
| the audit had no opinion at all                   | key omitted (preserves) |

`pass` means "deployed and not mis-hostnamed", not "a human can solve it" — no driven browser can establish that, since Cloudflare answers automation with `600010` regardless of configuration. The matchers are anchored on Cloudflare's own `[Cloudflare Turnstile]` prefix so a page that merely prints those six digits cannot raise a red alarm.

It is deliberately **positive evidence** on both halves. The mount point alone proves only that the env var is set — the starter server-renders that div from `{#if turnstileSiteKey}` — so `pass` also requires Cloudflare's script to have answered 2xx; and "no `110200`" alone is not enough, because a sitekey deleted or rotated at Cloudflare still serves api.js and still SSRs its mount point while minting nothing. Any other `110xxx` therefore denies the green. It does not raise a red: only `110200` has been measured verbatim in this fleet, and an alarm on the fleet's one gated site should not rest on an unmeasured string.

Two properties worth stating because both are load-bearing:

- **The cron order forced the move.** `function-health` runs 08:00, the digest reads 09:23, `form-e2e` writes 10:15 — with both writing, `function-health`'s null would clear every browser verdict each morning before the red alarm ever saw one. Ownership is pinned from both sides by tests.
- **Absent ≠ null.** A run with no opinion omits the key and preserves the prior verdict; only a run that looked and could not tell writes null and clears the cell. Collapsing them would let a probe that cannot see Turnstile erase a real verdict.

The `testMode`-undeclared skip refreshes **no stamp** — `Form E2E OK` and `Form E2E checked at` are both left alone, because carrying a Turnstile verdict on a refreshed form stamp would make a stale form verdict look fresh to the report health gate (`auto-tick.ts` `formsEvidence`). It does write `Turnstile widget: null`, clearing the value `function-health` left in that column: the column has moved, so no other writer could ever correct it, and a legacy verdict nothing is measuring is exactly what this change exists to stop. Those sites are then honestly unverified, and `docs/runbooks/require-turnstile-rollout.md` gains the matching precondition — roll out testMode forwarding before checking `Require Turnstile`.
