# 2026-11-09 — decisions.mjs keeps path and link refs

Landed in this PR (`scripts/decisions.mjs`, its `.d.mts`, `tests/scripts/decisions.test.ts`).

The 11-09 morning report's decisions check on the operator's personal repo, `tucksravin/workspace`, parsed 0 files (`errors=1`). The brief blamed the YAML block list in one file's `refs`, and predicted that one inline list would fix it. That held for the first error only. After the rewrite (`tucksravin/workspace` `e97140d`), the check still said `parsed=0 errors=1`, because both refs are file paths (`briefs/reports/…md`, `briefs/research_notes/…/`) and the parser took only `owner/repo#N`. The personal repo's `decisions/README.md` defines `refs` as "related files, repos or links", so each new personal decision would have failed the same way. The operator chose to change the parser rather than the personal files (reddoor-workspace `decisions/2026-11-09-2131-personal-decisions-refs-format.md`, answered 1:33pm PT).

The rule now (`isLink`): a ref is kept as a path or link only when it plainly is one. That means a URL that is not a GitHub issue or PR, or a path that ends in `/` or a file extension and has no `#<digit>` in it. It goes, deduplicated, into a new `links` field and is never looked up on GitHub, so `unchecked` does not count it. Everything else is meant as an issue or PR and must still be `owner/repo#N`. On the personal repo, `check` went from `parsed=0 errors=1` to `parsed=1 errors=0`, and the home base still reads `parsed=229 errors=0`.

Belief corrected in review: the first cut treated every ref not ending in `#<digits>` as a link. The Opus review round showed that this silently waved through malformed issue refs that used to fail. `o/r#12)`, `maint#1234 (merged)`, a bare `owner/repo` and a GitHub PR URL all came back with no error and were never looked up. The shape test above replaced that rule, and a test now pins those inputs as errors.

All seven mutations turned a test red. Every non-empty ref a link: 11 red. Links pushed into `refs`: 3. The old behaviour: 3. No dedupe: 1. A path allowed a `#<digit>`: 1, which survived until `o/r#12/` was added to the test. A GitHub issue URL taken as a link: 1. No path shape required: 2.

Not done: YAML block lists are still refused, because inline lists are the format. A path containing a comma would split, as before.

Usage: n/a cost and tokens (get_session returned none), rate limit allowed (seven_day).
