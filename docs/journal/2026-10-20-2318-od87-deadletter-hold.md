## 2026-10-20 — Operator decisions 87, answered (a): a dead letter on a known site waits two replay cycles before it alarms (#1546, this PR)

The operator answered (a) on 2026-10-20. Background: `forms-deadletter-replay.yml` (`47 */6 * * *`) drains the dead-letter queue every 6 h, so a fresh dead letter on a site the fleet knows is a "just wait" signal under the 2026-10-05 rule. It now stays off the cockpit's cards, the cardless lane, the Needs-you feed and the digest until 12 h after its oldest unreplayed row's `received_at`. Until then it shows on `/s/<slug>` as the dotted `waiting:` chip #1199 gave a held vuln. After that it is CRITICAL and names the oldest row's age. A slug that resolves to no site still alarms at once, because replay cannot place it.

**Why the clock lives where it does.**

- `markWaiting` clocks vulns by the snapshot's day-granular `firstFlaggedAt`, which cannot express 12 h. So the collector stamps `oldestReceivedAt` on a known slug's item, and a `deadletter` branch in `src/alerts/waiting.ts` owns the policy.
- The collector cannot import that policy itself: `waiting.ts` already imports `digest-collectors.ts`, and the cycle would hit a TDZ at load.
- The age comes from a new grouped `min(received_at)` query (`oldestUnreplayedDeadLetterBySlug`, and a per-slug form for the site page). It is a separate query from the counts, whose `Map<string, number>` type reaches five callers.
- Migration 0044 adds `received_at` to the per-slug index, so the site page's read is covering. 0045 drops 0028's index, a strict prefix of 0044's. Nobody asked for 0045; it deletes no data.

**Beliefs corrected on contact.**

- The fleet-wide grouped dead-letter count is not covering, and never was. Without ANALYZE stats SQLite plans it on `idx_deadletter_unreplayed (replayed_at)` with a rowid lookup per unreplayed row. The new fleet-wide min plans the same way, and the test asserts that equality rather than claiming coverage. Only the per-slug reads are covering.
- A `*/6` cron inside a `/** */` docblock closes the comment, and esbuild fails on the next line.
- My first cockpit handler fixture used status `"Maintained"`. The visible set is lowercase `maintained`, so the site had no card and the test rode the archived path. A mutation in round 1's fix turned the test red for the wrong reason, which is how I noticed.

**Note [I] of the brief: do the alarm and replay resolve slugs the same way?** Live Turso, read with the raw client at 19:39Z (`openDb` would have run this branch's migrations): all 47 sites have `siteSlug(name) === sites.slug`, and `submission_deadletter` holds 0 rows in any state. So they did not disagree on live rows. The round-3 correctness lens noted the latent case: a site renamed with `ensure-site --name` keeps its stored slug, and its dead letters would alarm at once as "NO fleet site". That fails loud, not mute, and predates this branch.

**Review: four rounds, three lenses each (correctness, operator intent, test evidence).**

- **Round 1 (dirty).**
  - The cockpit resolved dead-letter slugs over visible sites only. An archived site's dead letter was held by the digest but CRITICAL on the cockpit as "resolves to NO fleet site", which is false: `getSiteBySlug` ignores status.
  - A row first seen 12 to 24 h old escalated badged WORSE over NEW.
  - Ten of 27 test-lens mutations survived, all in the loaders' failure paths. The worst: a failed age read could have dropped every dead letter from the digest. The production cockpit handler had no loading test at all.
- **Round 2 (dirty).** Round 1's whole-roster fix let an archived namesake take a visible site's slug, and listed an archived site's escalated item as having no page.
- **Round 3 (dirty).** Round 2's pm-cockpit change gave any cardless item with a url a page, so a preflight "(unlinked site)" item linked `/s/unlinked-site`, a 404. It also listed a site twice when it already had a Watch row.
- **Round 4 (clean).** No correctness findings. Two wording nits, folded in. Five test gaps, filed as #1570–#1573.
- Each round's fixes were in code the round before had added. A narrow change kept reaching surfaces the brief did not list (pm-cockpit's cardless loop, the lane's links), and each reach needed its own round.

**Mutations.** The brief's five turn tests red: newest-row clock (2), `>` for `>=` (6), 6 h for 12 h (7), hold on an unknown slug (3), new export off the plan gate (1), held item through the digest filter (1). Over a hundred more were run across the review rounds. Survivors were folded in until round 4, whose survivors are the filed issues.

**Merge with `main`.** While review ran, `main` moved the cockpit handler's store reads into `loadCockpitModel` (`src/dashboard/page-data.ts`), which the new SvelteKit cockpit's `/` route also calls. The age read is ported there, so both cockpits hold alike. The handler test, `tests/dashboard/fleet-homepage-deadletter.test.ts`, still goes red when that loader passes no ages or lets a failed read throw.

**Process.** `git stash` is on the deny list. Red-first was shown in a second worktree at `origin/main` instead: the 16 new tests failed against `main`'s source. `tests/scripts/dropbox.test.ts`'s HTTPS_PROXY case fails in this container on `main` too.
