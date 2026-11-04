# 2026-11-04 — A site-composed message is duplicate-scanned on what the visitor typed (#1919)

Where it landed: reddoorla/reddoor-maintenance#1919, with the site side in reddoorla/reddoor-website#320. The operator's decisions are in the workspace's `decisions/`: `2026-11-03-2043-…` (fix it in ingest), `-2108-` (scan what the visitor typed) and `-2317-` (only a pass gets that scan).

**Why.** reddoor's landing-page modal writes its own message for every lead. Step one is one fixed sentence, and the application repeats the survey's headings and options. So the fleet duplicate scan stored every lead after the first in 30 days as `duplicate-body`, silently. Even a headed staging submission whose Turnstile token passed landed `spam_auto` (`sub_4bc17c8e…`).

**What it does now.**
- The site marks its message `extra.composedMessage` and sends what the visitor typed as `extra.visitorText`.
- On a gated site, with a token that passed on the site's own host, ingest scans only `visitorText`, and skips the scan when there is none.
- A stored composed row is matched only by its `visitorText`. Only ingest decides what is stored as composed.
- Only a pass on the site's own host may retro-bucket.
- The classifier skips `visitorText` on a composed row, so a pasted URL scores once at ingest and on `submissions rescore`.

**Five review rounds, every one dirty.** Each round ran 3 lenses on Opus.
- **Round 1:** the application carries visitor-typed answers, so skipping the whole scan let a pitch through. Also, a tokenless copy could retro-bucket real leads, and a top-level flag counted.
- **Round 2:** incoming visitorText was compared with stored *messages*, so a crafted step equal to the template retro-bucketed every real step one.
- **Round 3:** the stored half trusted a caller-set flag. Three copies of a pitch on an ungated site all landed `new`. Rescore also double-counted visitorText, 35 at ingest and 60 on rescore.
- **Round 4:** a flagged copy that failed the gate kept its visitorText and scored 60 instead of 35. And "unverifiable" includes a *replayed* token.
- **Round 5:** a token from another Cloudflare account's widget also comes back "unverifiable", as `invalid-input-secret`. Fixing that went to the operator.

**Belief corrected.** In round 2 I widened the visitorText scan from "pass" to "pass or unverifiable". I had read "unverifiable" as an outage: a siteverify timeout or a missing secret, something a bot cannot choose. A bot can choose it two ways: by replaying one solved token, or by bringing a token from its own free widget. Either way, one token delivered unlimited step ones, each with an autoresponder to an address the sender picks. I patched the replay case in round 4, and round 5 found the second cause. The operator's original "only when the token passed" was right. Option 1 of `-2317-` restored it and deleted the round-4 `replayed` marker. The cost: during a real siteverify outage, the second and later genuine step ones are binned on the template, recoverable from the cockpit, exactly as before this PR.

**Also wrong, and recorded.** The round-4 comment said an expired token is "fail". Cloudflare's own page says both: its error table says `invalid-input-response`, its expiry section says `timeout-or-duplicate`. Under the narrow gate it no longer matters, but the comment is gone.

**Process.** Mutations ran in this worktree with a `try`/`finally` restore, and `git diff --quiet HEAD` was checked after each set. A symlinked-`node_modules` copy cannot run vitest here, because the config's global setup shells out to pnpm. That cost one round of "error rc=1" on every mutation, read correctly as a broken instrument, not as 19 reds. The final 22 named mutations each turn a test red; the table is in the PR body.

**Filed, not fixed here.** #1922 (the notify and cockpit rows), #1930 (allow the flag per site rather than on every gated site), and reddoorla/reddoor-website#321, #322 and #323. #323 is a possibly pre-existing loss of every `/api/book` booking to `turnstile-required-absent`. It is unverified, because the production read was refused in this session.
