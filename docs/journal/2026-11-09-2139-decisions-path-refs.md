# 2026-11-09 — decisions.mjs keeps path and link refs

Landed in this PR (`scripts/decisions.mjs`, its `.d.mts`, `tests/scripts/decisions.test.ts`).

The 11-09 morning report's decisions check on the operator's personal repo, `tucksravin/workspace`, parsed 0 files (`errors=1`). The brief blamed the YAML block list in one file's `refs`, and predicted that one inline list would fix it. That held for the first error only. After the rewrite (`tucksravin/workspace` `e97140d`), the check still said `parsed=0 errors=1`, because both refs are file paths (`briefs/reports/…md`, `briefs/research_notes/…/`) and the parser took only `owner/repo#N`. The personal repo's `decisions/README.md` defines `refs` as "related files, repos or links", so each new personal decision would have failed the same way. The operator chose to change the parser rather than the personal files (reddoor-workspace `decisions/2026-11-09-2131-personal-decisions-refs-format.md`, answered 1:33pm PT).

The rule now: a ref ending in `#<digits>` names an issue or PR, and must still match `owner/repo#N` (so `hedloc#5`, `#12` and `../..#1` stay errors). An empty item is still an error. Any other ref is kept, deduplicated, in a new `links` field and is never looked up on GitHub, so `unchecked` does not count it. On the personal repo, `check` went from `parsed=0 errors=1` to `parsed=1 errors=0`.

All five mutations turned a test red: every non-empty ref a link (10 red), links pushed into `refs` (2), the old behaviour (2), no dedupe (1), and an empty item as a link (1).

Not done: YAML block lists are still refused, because inline lists are the format. A path containing a comma would split, as before.

Usage: n/a cost and tokens (get_session returned none), rate limit allowed (seven_day).
