# 2026-10-22 — The cockpit says when its snapshot is out of date

**Where it landed:** reddoorla/reddoor-maintenance#1695, branch `claude/cockpit-snapshot-freshness`, PR 2 of 2 of the workspace's `briefs/2026-10-21-cockpit-one-snapshot.md`. Three operator decisions shaped it, all in the workspace's `decisions/`:

- `2026-10-21-2339-cockpit-snapshot-version-stamp.md`: a trigger-kept counter, about 4:55pm PT on 10-21;
- `2026-10-22-0417-cockpit-freshness-round-5.md`: a sixth review round, about 7:50am PT on 10-22;
- `2026-10-22-1541-cockpit-freshness-round-6.md`: cut down to a notice, about 9:00am PT on 10-22.

**What landed.** PR 1 (#1681) reads one snapshot per full load. Afterwards, an open, visible cockpit asks one question on focus, on returning to the tab, and every 60 s: has the store changed since that read? The question is one row, a counter kept by `AFTER INSERT/UPDATE/DELETE` triggers on the ten tables the snapshot reads. The brief assumed `updated_at` columns, but only `digest_state` has one, and a submission's status change touches no timestamp. When the counter has moved:

- a notice offers a reload;
- the next navigation becomes a full load;
- the page itself never changes.

A post still behaves as in PR 1: the next navigation is a full load.

**Measured** (production Turso, read-only, about 7:45pm PT on 10-21):

- A snapshot reads about 1,210 rows.
- At that point in the cycle: 708,606 rows read (0.14% of the starter plan's 500M) and 5,296 rows written.
- The notice design reads one row per check and never re-reads the snapshot by itself. An always-open tab costs about 43,000 rows a month (one a minute), against the 10–20M the self-refreshing design would have cost.

**What was tried and abandoned: the page refreshing itself in place.** The brief asked for every action to invalidate the snapshot, and for the page to refresh on focus and every 60 s. I built that. Six review rounds, each with a behaviour reviewer and a security reviewer, found majors in every one. Each round's majors came from the previous round's fix of the same problem: keeping a page the operator is working in up to date without losing what they did.

1. **Remount on every read.** Fixed stale buttons, but threw away a failed save's text.
2. **Remount only when the counter moved, carrying the operator's place across** (`view-keep`). The counter moves on every live store, so the loss came back.
3. **Hold every refresh and remount while a field is focused or a save is in flight.** Then the page's own post remounted it and took its result with it.
4. **Take the page's own read in place.** Then controls that set themselves up at mount went stale (the Approve gate).
5. **Make those controls follow fresh data.** Round 6 found that the follow code could post a value nobody chose (a date the browser cannot show becomes a clear), and could revert a multi-select mid-save.

The notice keeps the part that held from round 2 on: the counter, the endpoint and the checks. It drops everything that has to change a page under the operator. Reviving the self-refresh would mean solving "fresh data into a page with live controls" as a design, likely per-control ownership of state, not as a patch. Round 6's three unfixed findings are in its decision file.

**Beliefs corrected on contact:**

- **Svelte writes a hydrated input's value on the first update of its template effect, even when the value has not changed.** The cache `set_value` checks starts empty after hydration. This is why a refresh in place put the stored value back over the operator's edit.
- **A parity guard decides where state may live.** The first `view-keep` added an attribute, and 37 parity tests against the old renderers failed.
- **Netlify's synchronous function limit is 60 s, not 26 s.** My first post deadline, 30 s, would have shown ✗ for a change the server went on to apply. That code went with the cut.
- **SvelteKit applies only the newest `invalidate`'s data.** An older read that answers later is dropped (`_invalidate`'s token check).

**Kept from the longer PR:**

- the fleet-audit panel stops polling when it unmounts (a latent PR 1 bug);
- the snapshot batch's fallback reads run in order, version first;
- `db dump` writes triggers after the rows.

**Filed:** #1691, #1692, #1693 and #1694. #1691, #1693 and #1694 describe the self-refresh design, so they can be closed with this PR.

**Not yet measured:** Netlify's request log before and after. The baseline is the first `/` at 5.44 s, the second `/` at 1.34 s, and the first `/s/:slug` at 3.01 s. It needs the operator's browse within the hour after the deploy.
