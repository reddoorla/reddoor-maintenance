# 2026-10-27 — P1-78c: the production signals the alarms never read

Landed in reddoorla/reddoor-maintenance (this PR). The brief is the workspace's `briefs/2026-10-26-p1-78c-production-signals.md`, and the plan is `plans/2026-10-26-cockpit-for-the-team/plan.md`, PR 4 of 8. Three operator decisions shaped it, all in the workspace's `decisions/`: `2026-10-27-0131-p1-78c-form-and-smoke-wiring.md`, `2026-10-27-1021-p1-78c-after-five-rounds.md` and `2026-10-27-1440-p1-78c-after-round-six.md`.

**Why.** The nightly audits stored a dozen verdicts about the live sites that no alarm read:

- uptime, the certificate, the server function and the CMS;
- render, links, titles and accessibility;
- dependencies, smoke, the form test and the Search Console lookup.

A site could be down while the cockpit showed green. Each verdict now reaches the ladder at the level the operator set on 10-26, and only beside a fresh stamp: 3 days, or 8 for the weekly accessibility run. A null or stale stamp vouches for nothing.

**What changed.**

- **One module.** `src/alerts/production-signals.ts` holds one collector per new row of the plan's ladder table, scoped to maintained sites.
- **Registration.** Broken and Attention collectors are on both the cockpit's list and the digest's. Only the digest writes `digest_state`, so an item the digest lacks would never age. Watch collectors are the cockpit's only, and they are standing and undated.
- **The browser writer** stores null, not a fail, when it sampled no route or checked no link. Both LA Homelessness "link failures" on 10-26 had checked no link.
- **Dependencies** age per package from `fleet_daily`'s latest reading. They are read on both cockpit paths, on the site page, in pm-cockpit, in the `fleet_daily` writer and by the digest. A night whose deps measure failed carries the last reading forward rather than dropping it.
- **Accessibility:**
  - its stamp column, `a11y_checked_at` (migration 0052);
  - a weekly `fleet-a11y.yml`, Sunday night, in its own workflow because a11y clones, installs and builds every site;
  - an opt-in install (`REDDOOR_A11Y_INSTALL`), because a fresh clone has no `node_modules`;
  - a tracking issue on failure.

  A skip the site declared (a fixture its source does not have, or its own routes while it still points at the placeholder Prismic repo) leaves the stored route total. That was the operator's answer (a) on 10-27. Without it, such a site read "partial" every week and its alarm could never fire.

- **`fleet_daily`** writes `ladder_version` 2.
- **Form test and smoke** are built and unwired, by the operator's answer of 10-26. Wired, Sonder and Vida would have read Broken nightly and seven sites Watch, all because of probe bugs (#1736, #1737, #1777). Each is a one-line registration once its probe is fixed.

**The proofs.** The 10-26 night was read with SELECT-only queries.

- **Render:** 16 sites pass. 1836dig's fail was real. It cleared on the 10-26 night.
- **Links:** the only two fails had checked no link, and they now read as not measured.
- **Titles:** 4 sites are Attention, all real:
  - 1836dig and Data Dynamiq have no meta description on `/privacy`;
  - Williamson Homes has none on `/`;
  - Vida's `/` and `/es` share a title.
- **Accessibility**, proved locally because the workflow cannot be dispatched from a session:
  - williamson-homes at `c938c85` passed with 0 violations across 8 of 8 routes;
  - the same build with an `<img>` lacking alt and an empty `<button>` planted on its fixtures failed with `image-alt` and `button-name`, critical, across 8 of 8 routes.
- **Form test:** passes on 11 sites, and its 2 fails are false.
- **Smoke:** passes on 10 sites, and all 7 fails are false. The spec asserts a production build that the nightly never made (#1777).

**Measured.**

- **Before the first `fleet_daily` row** (11:21pm PT on 10-26), this branch read `watch=2` with 9 sites healthy.
- **After it** (the operator's `fleet-nightly` at 11:07pm PT wrote the first row), the branch reads `PM_COCKPIT_SUMMARY broken=0 attention=6 watch=11` with **no site healthy**. Every maintained site with a package a major behind gets a deps Watch line, which the brief intends: every site reads Watch for its first 90 days, because the age counts from the first `fleet_daily` row.
- **Certificates:** none is within 30 days. The soonest, Reddoor, was at 34 days on 10-26.

**Six review rounds**, each with three lenses: correctness, tests and evidence, and what the operator sees.

- **Round 1:**
  - `deps:` and `search-console:` read NEW, flagged today, on every load. They are the first kinds only the cockpit collects, so their keys never reach `digest_state`. They are now standing and undated.
  - The Search Console opt-out was ignored.
  - Certificate days were not aged by their stamp.
  - 19 production lines were unpinned.
- **Round 2:** a night whose deps measure failed dropped every deps item, and the digest re-mailed a far item as NEW with its age reset. The fix carries the last reading.
- **Rounds 3 and 4:** unpinned paths only. These were the newest reading winning, an empty package list, the far item's names and count, and two failed nights in a row.
- **Round 5:**
  - **A Prismic outage raised two Broken items.** The site template's `/health` answers `ok:false` only when Prismic errored and the function ran, so "a server function is erroring" sat beside the true "the CMS is unreachable". A CMS outage is now one item.
  - **The certificate's metric was its days left**, so the nearest expiry sorted last. The metric now rises with urgency.
  - The operator chose a sixth round over the targeted check I proposed.
- **Round 6:**
  - **One dead sitemap page on a site that was up read "site down" at Broken.** Reproduced with `/` 200, `/about` 200 and `/blog/old` 404. The row stores no URL, so the title now says what was seen: "a sampled page did not answer 2xx or 3xx". The operator kept the plan's level (#1816).
  - "Violations" became "findings", because the stored count also holds JS errors and rules axe could not measure.
  - The Search Console window, and critical on three Broken items, were unpinned. They are now pinned, with six minors folded in.

The sidecar grew from the brief's 19 mutants to 81, every one red. It holds the brief's 19, two that pin the unwired decision, and one or more per review finding.

**Beliefs corrected on contact.**

- **"Watch needs no age, so the digest can skip it."** That is true for the mail and false for the badge. Every surface diffs against a snapshot that only the digest writes.
- **"No route sampled" was the browser writer's worry.** It cannot happen, because `discoverRoutes` always samples the root. "No link checked" happens every night.
- **"`uptime_reachable` means the site is up."** It means every page sampled from the sitemap answered. One stale sitemap entry fails it.
- **"`a11y_violations` counts axe violations."** It counts every entry in the artifact's list, including client errors, missing fixture routes and rules axe could not measure.
- **"`pnpm exec` in the cockpit dir is harmless."** `svelte-kit sync` there wrote a stray `cockpit/node_modules/$app` that broke `svelte-check` with a misleading `./$types` error. The repo syncs from the root.
- **"A sixth round would mostly find more missing tests."** It did mostly find those (two majors of that kind), but it also found the one wording defect an operator would have acted on.

**Filed.**

- #1777: smoke's build-only spec.
- #1797: the CLI's "not measured" line is unpinned.
- #1798: pm-cockpit's `--since` compares UTC dates.
- #1799: why some Watch rows are undated.
- #1806: one TLS timeout reads as a dead domain.
- #1807: `fleet_daily`'s deps count lags a night.
- #1814: a run that scanned nothing stores "0 of 0".
- #1815: render stores false on an empty sample.
- #1816: one dead sitemap page reads Broken; the follow-up stores the failing URLs.

**Still to see.** The first Sunday `fleet-a11y` run's results, read on the Monday after.
