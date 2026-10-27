# 2026-10-26 — P1-78b: the severity ladder

Landed in reddoorla/reddoor-maintenance (this PR). Brief: workspace `briefs/2026-10-26-p1-78b-severity-ladder.md`; plan: `plans/2026-10-26-cockpit-for-the-team/plan.md`, PR 2 of 8.

**Why.** Any open alarm item made a live site "broken". On 10-26 that put 4 of 19 sites in red: Reddoor (stuck vulns and a Renovate PR), 29 Navy (one transitive vuln), and Beachfront and Sonder (one red Renovate PR each). No visitor could see any of it. The operator's answer was three levels:

- **Broken:** someone outside Reddoor is affected now.
- **Attention:** fix this week.
- **Watch:** housekeeping.

Every existing signal was placed on that table.

**What changed.**

- **The rename.** The step-one commit renamed the old `"attention"` tier to `"broken"` on its own, so the compiler found every consumer before the word came back with its new meaning.
- **`levelOf`.** One pure function (`src/alerts/ladder.ts`) places every item: by kind, by key prefix (the three Prismic flavours, `url-unresolved` against `url-probe-stale`), and, for Renovate, by days red (Attention from day 7).
- **The surfaces.** The cockpit, the triage feed, the site page and `pm-cockpit` all read it: a site's tier is its worst item.
- **A failed production deploy** is now a dated `deploy:` item, maintained sites only. That includes the digest, the one digest change in this PR. It gets a Broken row with an age, and `pm-cockpit` no longer adds a second, undated reason.
- **The roster URL probe** joins the cockpit. A dead URL is Broken on its card, and breaks a launching site's mute. The probe's own staleness is an Attention item on no card, counted over the whole roster as the digest counts it.
- **The verdict** reads "1 site broken · 2 need attention · 3 to watch · 1 waiting on your yes". The Attention pill is an interim outline, not red, until P1-78e.
- **`fleet_daily`** now writes `ladder_version` 1.

**Measured.** The Mon 10-26 fleet, replayed from a fixture, reads:

- Attention for Reddoor and 29 Navy (transitive, past the lockfile window);
- Watch for Beachfront and Sonder;
- no Broken.

The sidecar holds 31 mutants: the brief's 16 (4, 7 and 15 split) plus each review round's. All went red.

**Five review rounds.** Rounds 1 to 4 were dirty and round 5 was clean. Every defect was one the operator would have seen:

- **Round 1:**
  - A day-one Renovate PR showed twice, the second copy with an accept hint that mutes nothing.
  - The accepted "url not deployed" chip vanished with the Watch candidate it replaced.
  - The verdict read "All clear" over a cardless Attention item.
  - Rows carried no age.
  - The stale-probe count disagreed with the digest's.
- **Round 2:** a Broken row took the age of an older Attention item beside it, and no test pinned "oldest" (two mutants survived).
- **Round 3:** a Renovate PR rising on day 7 was never `NEW` in `pm-cockpit`, so it would miss the top of the stack.
- **Round 4:** a day-one Watch item made an Attention row `NEW`. Reddoor would have topped the stack for housekeeping.

**Beliefs corrected on contact.**

- **The shared row fixture's `urlCheckedAt: null`** made the fleet-wide `url-probe-stale` fire in every cockpit test once the probe joined the cockpit (57 hits). The default is now a far-future stamp, which reads fresh. Every test of the probe sets its own.
- **`vitest run -u <file>` without `--project`** updated snapshots across the whole suite. Each one it touched was then read by hand.

**Accepted or filed.**

- The Prismic ack (#1608) still mutes a `prismic-drift:` item, which is now Attention. It is an expiring per-finding ack, not an accept key.
- Critical-first sorts inside Broken only (#1773).
- The cockpit pages show no NEW chip on a Renovate rise, and date a risen row differently from `pm-cockpit` (#1774).

**Home base.** `pm-pass.md`'s top-of-stack rule moves to Broken and Attention in a home-base commit the same day.
