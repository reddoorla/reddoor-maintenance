# 2026-11-09 — decisions.mjs keeps path and link refs

Landed in this PR (`scripts/decisions.mjs`, its `.d.mts`, `tests/scripts/decisions.test.ts`).

The 11-09 morning report's decisions check on the operator's personal repo, `tucksravin/workspace`, parsed 0 files (`errors=1`). The brief blamed the YAML block list in one file's `refs`, and predicted that one inline list would fix it. That held for the first error only. After the rewrite (`tucksravin/workspace` `e97140d`), the check still said `parsed=0 errors=1`, because both refs are file paths (`briefs/reports/…md`, `briefs/research_notes/…/`) and the parser took only `owner/repo#N`. The personal repo's `decisions/README.md` defines `refs` as "related files, repos or links", so each new personal decision would have failed the same way. The operator chose to change the parser rather than the personal files (reddoor-workspace `decisions/2026-11-09-2131-personal-decisions-refs-format.md`, answered 1:33pm PT).

The rule now (`isLink`). A ref that looks like an issue or PR must still be `owner/repo#N`: one with a `#` followed by a digit or ending it, or one with a `pull/N` or `issues/N` path. So `o/r#12)`, `maint#1234 (merged)`, `o/r#` and a GitHub PR URL all stay errors. Every other ref is a path, repo or link: `briefs/x.md`, `README`, `tucksravin/workspace`, `plan.md#the-model`, or any URL that is not a GitHub issue or PR (such a URL may carry a numeric fragment). It goes, deduplicated, into a new `links` field and is never looked up on GitHub, so `unchecked` does not count it. On the personal repo, `check` went from `parsed=0 errors=1` to `parsed=1 errors=0`; the home base still reads `parsed=229 errors=0`.

Beliefs corrected in review, which took two rounds of Opus. Round 1: the first cut took every ref not ending in `#<digits>` as a link. That silently waved through malformed issue refs that used to fail (`o/r#12)`, a GitHub PR URL), so they were never looked up. I narrowed it to "a URL, or a path ending in `/` or an extension". Round 2: that was stricter than the operator's answer, "keep what is not `owner/repo#N`, validate what looks like it". It refused `README`, a bare repo and a heading anchor, which the personal README allows. The final rule tests what looks like an issue ref, not what looks like a path.

Ten mutations; nine turned a test red. Every non-empty ref a link: 11 red. Links pushed into `refs`: 3. The old behaviour: 3. No dedupe: 1. No `#N` check on non-URLs: 11. A trailing `#` taken as a link: 1. A GitHub PR URL taken as a link: 1. URLs held to the `#N` check: 1. An empty item taken as a link: 1. The tenth made the `pull|issues` match case-insensitive and stayed green: GitHub writes those paths in lowercase, so the flag was dropped instead of pinned.

Not done: YAML block lists are still refused, because inline lists are the format. A path containing a comma would split, as before.

Usage: n/a cost and tokens (get_session returned none), rate limit allowed (seven_day).
