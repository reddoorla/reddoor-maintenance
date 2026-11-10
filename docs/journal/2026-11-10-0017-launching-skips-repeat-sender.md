# 2026-11-10 — A launching site skips the cross-site repeat-sender scan

Landed in reddoorla/reddoor-maintenance on branch `claude/launching-skips-repeat-sender` (this PR). The decision is workspace `decisions/2026-11-10-0008-launching-sites-spam-handling.md`.

On 2026-11-09 the operator's own test submission on hedloc, a `launching` site, was stored `spam_auto` with reason `repeat-sender` and notify `skipped` (`sub_5cace6b7-6ff9-4a00-ae5e-161f3235ec56`). The same address, tucker@reddoorla.com, had tested msot that day and roalson-interests on 10-28. `src/forms/ingest.ts` already exempts `building` sites from all spam handling for exactly this reason (the 2026-08-17 comment). The exemption stopped one status short: a `launching` site has the pre-launch notify guard on, so its notifications go only to the operator, but it still ran full spam handling.

The operator chose option 2 of two. Option 1 was to treat `launching` like `building` and turn all spam handling off. The difference that decided it: a `launching` site is deployed and reachable, and `buildAutoresponder` in notify.ts sends to any address a submitter types unless the row is spam. With everything off, a bot typing a stranger's address would get that stranger an email from forms@reddoorla.com, the address every site shares. So on `launching`, only the signal whose signature _is_ the operator's testing pattern is off. That is the cross-site repeat-sender scan, retro-bucketing included. The duplicate and similar-body scans still judge the incoming copy, but `mayRetroBucket` is false, so a launching copy cannot re-bucket other sites' `new` rows. The classifier and the Turnstile escalations are unchanged.

What the tests do not save the operator from: the second hedloc test (4:01pm PT on 11-09) reused the first test's message word for word and was caught by `duplicate-body`, not repeat-sender. That trap remains by design. Write each test with a fresh message.

Mutations, each run against `tests/forms/ingest.test.ts`. Every mutation turned at least one test red:

| Mutation                                                       | Tests red                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| M1: drop `!launching` from the repeat-sender gate              | 1 (the operator test is stored `new` and notified)         |
| M2: drop `!launching` from `mayRetroBucket`                    | 1 (a duplicate copy is bucketed but retro-buckets nothing) |
| M3: `launching` treated like `building` (all off)              | 3 (the duplicate, classifier and Turnstile cases)          |
| M4: skip only the escalation; the scan and its retro still run | 1 (the operator test: retroBucket was called)              |
| M5: repeat-sender off for every status                         | 8 (both `maintained` controls and six repeat-sender tests) |

Under M3 the operator-test case still passes, which is expected: over-exempting still stores the row `new`. The three "still buckets" cases are what catch it.

The review round (Opus, one reviewer) found one minor and one nit. The nit was folded in: the new tests' notify assertions used `if (r.status === "accepted") expect(...)`, which checks nothing on a non-accepted result, and now use `toMatchObject`. The minor needs a new test, so it was filed as an issue rather than folded in. No launching test covers a `similar` match on a composed, Turnstile-passed copy. That is the one path where the old `mayRetroBucket` was true for a reason other than `!composedFlag`, so a refactor that scoped `!launching` to the wrong branch would pass every test.

Belief corrected: I had expected the pre-launch notify guard to be keyed on `isPreLaunch`. It is keyed on `status !== "maintained"`, so `hosted-only`, `external` and `archived` sites also notify the operator only. This change leaves that alone.

Usage: not readable (`get_session` returned no `usage` block, and `context_usage` still read 0 mid-session).
