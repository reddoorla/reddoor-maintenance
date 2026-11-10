# 2026-11-10 — A composed, Turnstile-passed copy on a launching site never retro-buckets

Landed in this PR (`test(forms)`), closing reddoorla/reddoor-maintenance#2008, a minor from the review of reddoorla/reddoor-maintenance#2009. Test only; no production code changed.

**Why.** #2009 made `mayRetroBucket = !launching && (!composedFlag || (gatedComposed && passedOnSiteHost))`. Its launching tests drove only an `exact` duplicate of a plain message, the `!composedFlag` branch. The other branch that could retro-bucket before #2009, a site-composed copy on a Turnstile-gated site whose token passed on the site's own host, had no launching test. Moving `!launching` so it guarded only the `!composedFlag` branch left every test green while letting that copy retro-bucket other sites' rows.

**What.** Two tests in the launching block of `tests/forms/ingest.test.ts`, on the file's own stand-ins: a `launching` site with `requireTurnstile`, a payload with `extra.composedMessage: true` and an `extra.visitorText`, a Turnstile `pass` on `hedloc.com`, and `findRecentDuplicates` returning one `new` row under `similar`. The launching copy is stored `spam_auto` / `similar-body`, the lookup is called with the visitorText (so the composed path is the one taken), and `retroBucket` is never called. The `maintained` control, same input, calls `retroBucket(["recNEAR"], "retro:duplicate-body")` exactly once, which shows the stand-ins can see a retro-bucket at all.

**Mutations of the `mayRetroBucket` line** (forms suite, 500 tests): moving `!launching` onto the `!composedFlag` branch alone turned the new launching test red (1 failure); dropping `!launching` turned it and #2009's exact-copy test red (2); `mayRetroBucket` always false turned the new control and 9 others red (10); dropping `passedOnSiteHost` added no red to the new tests but turned 6 existing tests in `ingest-composed-message.test.ts` red (absent, fail, two unverifiable, foreign-host, unverifiable spray). On a launching site `!launching` already zeroes the line, so a launching case cannot see that mutant; the composed-message file is where it belongs.

**Belief corrected.** I expected a test-only change to need a changeset; CI runs no changeset check, and #1461 (test-only) shipped without one, so this has none.

**Review.** One adversarial round on Opus, clean. It reproduced all four mutations, and ran a fifth: moving `!launching` onto the composed branch alone leaves the new test green, which is correct, while #2009's plain-copy test goes red. Its one nit: the `findRecentDuplicates` assertion compares the raw visitorText, whereas ingest passes the trimmed string. That can only fail falsely, never pass falsely, so nothing changed.

Usage: not readable (get_session carries no usage field this session; rate limit allowed).
