---
"@reddoorla/maintenance": minor
---

`Turnstile widget` is now earned by a browser. The column moves from the `function-health` audit to `form-e2e`.

`function-health` could only ever see whether `PUBLIC_TURNSTILE_SITE_KEY` was a non-empty string — `/health` never contacts Cloudflare — so it could not tell a working widget from one whose hostname is not on the widget's allowlist. That state throws `110200`, mints no token, and on a `Require Turnstile` site buckets 100% of real leads (#689).

`form-e2e` can: it already drives Chromium against each site's live contact form, and — contrary to what the docs claimed until today — it does **not** swap the sitekey, so the site's real widget renders with its real key on every nightly run. It now watches for the rejection and writes the verdict:

| observation                        | verdict                 |
| ---------------------------------- | ----------------------- |
| `/health` reports no sitekey       | `fail`                  |
| uncaught `110200` on the live page | `fail`                  |
| real widget rendered, no `110200`  | `pass`                  |
| key set, no widget on the page     | `null` (clears)         |
| nothing observed                   | key omitted (preserves) |

`pass` means "deployed and not mis-hostnamed", not "a human can solve it" — no driven browser can establish that, since Cloudflare answers automation with `600010` regardless of configuration. The matcher is anchored on Cloudflare's own `[Cloudflare Turnstile]` prefix so a page that merely prints those six digits cannot raise a red alarm.

Two properties worth stating because both are load-bearing:

- **The cron order forced the move.** `function-health` runs 08:00, the digest reads 09:23, `form-e2e` writes 10:15 — with both writing, `function-health`'s null would clear every browser verdict each morning before the red alarm ever saw one. Ownership is pinned from both sides by tests.
- **Absent ≠ null.** A run with no opinion omits the key and preserves the prior verdict; only a run that looked and could not tell writes null and clears the cell. Collapsing them would let a probe that cannot see Turnstile erase a real verdict.

The `testMode`-undeclared skip deliberately writes nothing at all: refreshing `Form E2E checked at` to carry a Turnstile verdict would make a stale form verdict look fresh to the report health gate (`auto-tick.ts` `formsEvidence`). Those sites stay unobserved, and `docs/runbooks/require-turnstile-rollout.md` gains the matching precondition — roll out testMode forwarding before checking `Require Turnstile`.
