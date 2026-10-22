# 2026-10-21 — The cockpit loads one snapshot and navigates without the server

**Where it landed:** reddoorla/reddoor-maintenance#1681, branch `claude/cockpit-one-snapshot`, PR 1 of 2 of the workspace's `briefs/2026-10-21-cockpit-one-snapshot.md`. Decisions: the workspace's `decisions/2026-10-21-2339-cockpit-snapshot-flood-search.md` and `…-version-stamp.md`, both answered by the operator at about 4:55pm PT.

**Why.** The operator asked for "one full pull to the client" so the cockpit stops reloading on every page. Each page used to read Turso on its own, and every link was a full page load (`data-sveltekit-reload`), so each click paid a function run plus the reads. Now the root layout reads one snapshot per full load, in one `client.batch(…, "read")`. Every page derives its view in the browser. A scripted walk through all five pages in Chromium against the built app makes zero `__data.json` requests.

**Measured** (production Turso, SELECT-only, 2:41pm PT, from a cloud container):

- A snapshot takes 407 ms on the first round, then 123–207 ms, against 193 ms for today's `/` and 141 ms for `/s/williamson-construction-co` with #1663's parallel reads.
- It is 686,869 bytes as SvelteKit serialises it, 156,065 gzipped, against the brief's 1 MB stop.
- One earlier first batch took 1,945 ms and did not reproduce; that is the egress proxy opening a connection, as #1663 found.

**Built on #1663, not around it.** `openDb({ batchReads: true })` queues every query issued in one turn and sends them as one batch. It needs #1663's `concurrentReads`: with Kysely's lock each query would reach the client alone, and be a batch of one. A failed batch is retried statement by statement, so a defensive read still fails alone and is named in `gaps`.

**Where it departs from the brief, and why:**

1. **No 140-character preview.** Pages show the whole message, and `/submissions` searches it, so a preview changes what a page shows.
2. **"Invalidate after an action" moved from PR 2 into this PR**, as a full reload on the next navigation. Without it, PR 1 alone made an approval or status change vanish on the next click.
3. **The Mailchimp key is redacted**, because the editor promises it never reaches the page.

**Defects the three review rounds found** (all fixed; 34 mutations, all red):

- **Round 1.**
  - Changes vanished on the next client navigation (critical).
  - The filters compared `rowFromDb`'s narrowed status (`"unread"` read as `"new"`). `?status=new` went from 1 row to 3, while the bulk mark-read flipped 1.
  - A root-layout failure dropped the Shell.
  - The blob-column test was blind to `selectAll("sites")`.
- **Round 2.**
  - Back and Forward ignored `data-sveltekit-reload` (SvelteKit reads it only for links and GET forms).
  - The clock offset, re-measured on every navigation, froze every page's "now" at `takenAt`.
  - A per-field cap was not a bound: devalue writes `<` as six bytes, so 8 crafted posts broke every page.
- **Round 3.** Spending the new total text budget dropped older leads out of `q=`, `reason=` and the facets. Narrowed to message-word search only, which the operator accepted.

**Beliefs corrected on contact:**

- **"Snapshot one batch" is not "client navigation"** while `data-sveltekit-reload` sits on `<body>`. That attribute existed because the pages' stylesheets share class names, so each page's CSS now mounts and unmounts with the page (`?inline` in `<svelte:head>`). A browser test checks for a rule of `site.css` after leaving the page.
- **The brief's "not modified" stamp assumed `updated_at` columns.** Only `digest_state` has one, and a submission status change or a site edit touches no timestamp. The operator chose a trigger-kept counter for PR 2.
- **A local `client.batch(…, "read")` does run writes**; only Turso refuses them. The regex in `execute` is what holds in tests.
- **`cp -a` of a worktree copies its `.git` file, so the copy shares HEAD and index.** A reviewer's copy moved when I committed. Review copies now use `git worktree add`.

**Not yet measured:** Netlify's request log before and after. It needs the operator's browse within the hour after the deploy.
