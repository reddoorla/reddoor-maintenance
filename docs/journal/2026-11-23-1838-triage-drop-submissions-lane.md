# 2026-11-23 — The submissions lane leaves /triage

Landed in reddoorla/reddoor-maintenance#2248 (issue #2241).

The operator, Monday about 10:00am PT: "remove the submissions bit from triage, it has its own page now". `/triage` had kept a collapsed "Submissions (N new)" lane holding up to 10 rows, a link onward to `/submissions`, the fleet's 30-day spam roll-up and an "N auto-filtered this week — review" line. `/submissions` already shows the rows, with status changes and the spam filter, so the lane repeated it. The lane goes, with `inbox()`, `InboxView`, the `inbox` view field and the two CSS rules only it used. `/submissions` is untouched.

**What else stopped showing.** The fleet-wide "Spam (30d) — caught N · through N" roll-up appeared nowhere but this lane. Per-site spam counts stay on each `/s/<slug>` page, and auto-filtered rows stay one click away at `/submissions?status=spam_auto`. The brief named the roll-up as part of the lane, so it went without asking. It is written down here and in the PR because the cockpit no longer shows it anywhere.

**What stayed, on purpose.** The cockpit model's `submissions`, `spam` and `autoFiltered` fields now feed no page. The new-submissions list has to stay regardless, because it fills each site card's `Inbox: N new` chip on `/fleet`. Removing the other two would reach into the snapshot schema and its parity tests for no visible change, so they stay with a comment saying they are unrendered: fork (iii), defaulted, in the workspace's `decisions/2026-11-23-1821-triage-submissions-model-fields-kept.md`. The price is one small libSQL count per cockpit load.

**The verdict never read submissions, and now a test says so.** The lane's comment had claimed it ("they never raise the verdict"), and the code agreed: only `inbox()` read the three fields. The new test builds one site needing attention, once with 13 submissions, spam and 4 auto-filtered rows and once with none, and asserts that the verdict, the feed and the whole `/triage` HTML are identical.

**A mutation that did not bite, and why that is fine.** The brief's first mutation was "put the lane back in `+page.svelte`". With the markup alone restored, the render tests stay green: the view no longer carries `inbox`, so the block can never render. What catches it is `svelte-check` (CI's typecheck), with four "Property 'inbox' does not exist on type 'CockpitView'" errors. With the markup and `inbox()` both restored, all three new tests fail. Breaking `/submissions`' data load (`rowViews: {}`) failed 35 tests in 3 files. A verdict made to count submissions failed 2 of the 3 new tests.

**Tests removed:** 16 legacy tests that pinned the lane (its rows, the cap of 10, the lead/signup split in its summary, the spam line and its as-of label, the auto-filtered link). Three `/triage` snapshots lost the lane's markup and nothing else. Review round 1 (Opus) was clean, one minor and three nits. The minor, a region-order comment still counting "all four regions", was folded in. The nits are filed as reddoorla/reddoor-maintenance#2249.

**Not from this change:** two tests fail in this container on an untouched `origin/main` too (`t4-plan-task`'s stale-install box and `dropbox.test.ts`'s HTTPS_PROXY re-exec).

Usage: $4.67, 1673/32433 tokens, 11697834/252322 cache, rate limit allowed
