# 2026-11-04 — waitForHydration waits under the starter's CSP (#1923)

https://github.com/reddoorla/reddoor-maintenance/issues/1923: `src/audits/util/hydration-wait.ts` passed `HYDRATED_EXPR` to `page.waitForFunction` as a string. The starter's enforced CSP (`csp.mode: "auto"`) has no `'unsafe-eval'` in `script-src`, so the predicate was refused and the wait returned `"settled"`. The callers are form-e2e (#1148's wait before the first fill) and turnstile-coverage (the wait before the trigger click). On starter sites, both have probably not waited since #1148. That has not been measured on a fleet site. https://github.com/reddoorla/reddoor-maintenance/pull/1928 fixed the same string in the a11y spec.

**What changed.** `waitForHydration` now waits on `isHydrated`, a new exported function with the same check. Playwright serializes a function and runs it without `eval`. `HydrationWaitPage.waitForFunction` now takes that function and no longer a string, so passing the string back is a type error. turnstile-coverage's `CoveragePage` slice accepts either a string or a function, because its modal wait still passes a string (see below). `HYDRATED_EXPR` stays exported for the a11y spec, and its comment now says never to pass it to `waitForFunction` as a string.

**A belief corrected on contact: a string predicate is not always refused.** The new test first proves that its CSP is live, by checking that a string predicate is refused on that page. The first draft of that check used `"true"`, and it resolved. A probe on the same page measured the following: `waitForFunction("true")` resolved in 26 ms under the CSP. A string that is false on its first check was rejected with `EvalError … 'unsafe-eval'` in 7 ms. Without the CSP, the same falsy string waited out its 1000 ms timeout. Playwright answers the first check over the protocol and `eval`s only when it has to poll. So the defect bites only when the marker is not yet written at the call, which is the case the wait exists for, and #1928's "already hydrated" shape of test passes either way. `page.evaluate("1+1")` worked under the same CSP, so form-e2e's string `evaluate`s are not affected. The instrument check now uses a predicate that stays false.

**The test.** The page is served through `page.route` on a made-up origin with `content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'`, because a `data:` URL cannot carry a header. It writes the marker 1500 ms after `load`. The test asserts that the policy refuses a polling string, that the marker is absent, and then that `waitForHydration` returns `"marker"` in no less than 1000 ms and under 6000 ms, with a cap of 8000 ms. On today's code it read `"settled"`, with the whole test taking 120 ms. With the fix it reads the marker at 1604 ms. The existing five tests are unchanged.

| Mutation                                            | Red (of 6 in `hydration-wait.test.ts`) |
| --------------------------------------------------- | -------------------------------------- |
| M1 the string predicate (today's code)              | 1: the new CSP test                    |
| M2 wrong attribute in the function (`data-hydrate`) | 3                                      |
| M3 the cap ignored (fixed 100 ms timeout)           | 3                                      |

M1 is caught only by the new test, which is the point: the three real-page tests serve no CSP.

**The callers.** form-e2e's, turnstile-coverage's and a11y's suites pass: 12 files, 450 tests. No fixture of theirs serves a CSP; the one CSP-bearing starter config in `tests/fixtures/kit3-starter` belongs to sync-configs and is never served. So no caller test now waits where it did not.

**Found beside it, filed rather than fixed.** turnstile-coverage's modal wait, `waitForFunction(`${DIALOG_STATE_EXPR} !== null`)`, is a string too. Measured under the same CSP with the real expression: a modal that opens in the click handler is judged (34 ms), and one that opens 300 ms later is rejected with the `EvalError` at 34 ms, so the pass returns the page without judging the modal. The no-CSP control opened at 313 ms. Fixing it needs a different shape (the expression is assembled from `JUDGE_FN`), so it is its own issue: https://github.com/reddoorla/reddoor-maintenance/issues/1943.

**Not done.** Nobody has measured the effect on a live fleet site, before or after this change. That is a follow-up: a form-e2e run on one starter site, comparing `hydration` in its result.
