# 2026-10-22 — The cockpit's snapshot stays fresh

**Where it landed:** reddoorla/reddoor-maintenance#1695, branch `claude/cockpit-snapshot-freshness`, PR 2 of 2 of the workspace's `briefs/2026-10-21-cockpit-one-snapshot.md`. The operator chose the trigger-kept counter at about 4:55pm PT on 2026-10-21; the decision is the workspace's `decisions/2026-10-21-2339-cockpit-snapshot-version-stamp.md`.

**Why.** PR 1 (#1681) loads one snapshot per full load. From then on, a page shows that snapshot until something reads it again. This PR does three things to keep it current:

- every action reads the snapshot again;
- the open cockpit asks, on focus, on returning to the tab and every 60 s while it is visible, whether the store changed;
- it reads the snapshot again only if the store did change.

"Changed" is one row: a counter kept by `AFTER INSERT/UPDATE/DELETE` triggers on the ten tables the snapshot reads. The brief assumed `updated_at` columns. Only `digest_state` has one, and a submission's status change or a site edit touches no timestamp. A trigger cannot miss a write, whoever makes it.

**Measured** (production Turso, read-only, about 7:45pm PT on 2026-10-21):

- A snapshot reads about 1,210 rows.
- The cycle stood at 708,606 rows read (0.14% of the starter plan's 500M) and 5,296 written, about 265 a day.
- An always-open tab therefore costs about 2–4% of the read quota a month.
- A snapshot whose reads keep failing re-reads every minute, which costs about 10–20%. That is #1691.

**What review taught, round by round.** Five rounds, each with a behaviour reviewer and a security reviewer, and every round found something real. The design moved under the findings.

1. **Round 1.** Status buttons keyed by position posted the wrong action once a row's buttons changed under them, and the Approve gate went stale. I remounted the page on every read.
2. **Round 2.** That remount threw away a failed save's text and ✗, and closed the lead the operator had open. I keyed the remount on the counter instead, and added `lib/view-keep.ts` to carry open `<details>`, the fleet chip and the scroll across a remount.
3. **Round 3.** The same loss came back whenever the counter had moved since mount, which is always on a live store. A check already in flight when the operator clicked into a field also remounted the page under the cursor. I added `busy`: a focused field or a post still in flight holds every check, refresh and remount. Failed edits also travel through view-keep.
4. **Round 4.** The read after the page's own post remounted it too, because that post had moved the counter. An `/audits` run that failed to start lost its error and the whole filled-in form. The fix was the one that should have come first: the read after the page's own post is taken in place. Only a change a check found elsewhere remounts. The same round found two more:
   - a post answered 401 followed the auth gate's redirect at once, taking the typed text with it;
   - a post that never answers froze freshness for good.

   Now a 401 or 403 marks the next navigation as a full load, and every post has a deadline. Round 5 caught that my first deadline, 30 s, was shorter than Netlify's 60 s limit on a synchronous function: a ✗ for a change the server went on to apply, and a retry would have dispatched a second fleet sweep or paid audit. It is 65 s.

5. **Round 5:** see the PR.

**Beliefs corrected on contact:**

- **"Remount on a fresh snapshot" is not a safe default for a page people type into.** Every round's major defect was the same one, the operator's state thrown away, found from a new angle. The question that settled it: who caused this read? The page's own post knows what it did. Only a change from elsewhere needs a fresh mount.
- **Svelte writes a hydrated input's value on the first update of its template effect, even when the value is the same.** The cache `set_value` checks starts empty after hydration. A DetailField that read `$$props.url` re-ran its effect on every refresh and put the stored value back over the operator's edit. The fields now show the props they mounted with.
- **A parity guard decides where state lives.** The first view-keep added a `data-keep` attribute, and 37 parity tests against the old renderers failed. `<details>` are now named by what already names them: their class, or their row's `data-id`.
- **`afterNavigate` does not fire on a remount from `invalidate`**, only on a navigation. So the fleet chip's reset on navigation is left as it was.

**Mutations:** 42 named, 41 red. The survivor removes a `tick()` that SvelteKit's `invalidate` does not await. Svelte has flushed by then anyway, so the `tick()` makes the order explicit rather than incidental.

**Minors filed:** #1691, #1692, #1693 and #1694.

**Not yet measured:** Netlify's request log before and after. The baseline is the first `/` at 5.44 s, the second `/` at 1.34 s, and the first `/s/:slug` at 3.01 s. The comparison needs the operator's browse within the hour after the deploy.
