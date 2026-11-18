# 2026-11-18 — `decisions.mjs check` skips `decisions/images/`

Landed in reddoorla/reddoor-maintenance on branch `claude/decisions-check-skip-images`. This entry ships in that PR.

The PM pass's first screen reads a non-zero `check` as "decision files unreadable". Run over the workspace's `decisions/`, `check` exited 1 with `DECISIONS_SUMMARY parsed=282 errors=1` and a single line, `ERROR images: not a regular file`. That folder holds one PNG, which `2026-11-17-2337-p1-87-pr7-traffic-axis-31-nights.md` links to by path. The operator chose to teach the checker about the folder rather than move the image out (11-18 cockpit, item 1).

`readDecisionDir` now skips one entry: a **directory** named exactly `images`. A regular file named `images`, a symlink named `images` (a `Dirent` does not follow links), `Images`, and every other directory are still reported. I left `IGNORED_ENTRIES` alone because `operator-ledger.mjs` imports it. That script already ignores sub-folders, since it keeps only `blob` entries from `ls-tree`.

Run over the live workspace folder with the fix, `check` gives `DECISIONS_SUMMARY parsed=282 errors=0 open=0 parked=1 unchecked=0` and exits 0.

Mutations, each run against the full `decisions.test.ts`, 81 tests:

- Skip every directory: 1 failure, the existing test "reports every entry it will not read". It went red on its sub-directory named `2026-10-13-1205-sub.md`.
- Remove the skip: 1 failure, the new `images/` test.
- Skip by name without the directory check: 1 failure, the new "regular file named images" test.

Review: one Opus round came back clean, with one nit. No test pins the symlink case. The fix is a new test, so the nit is filed as reddoorla/reddoor-maintenance#2116 rather than folded in.

Usage: not readable (`get_session` carried no `usage` block at writing).
