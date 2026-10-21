# 2026-10-21 — the 10-20 evening's review minors, and #1561 held at five rounds

Landed in: #1623 (pins), #1638 (#1589), #1640 (#1577, #1578, #1581, #1555), #1643 (#1566, this entry). Held: #1641 (#1561), on `reddoorla/reddoor-workspace` `decisions/2026-10-21-1551-1561-partial-security-run.md`. Brief: workspace `briefs/2026-10-21-review-minor-batch.md`.

**#1561 took all five review rounds and is still not done.** On main, a site with a two-document pnpm-12 lockfile whose `pnpm audit` cannot run throws away Dependabot's live alerts: it returns the skip, and a skip writes no counts. The issue's input was a live critical on `actions/checkout` with pnpm and npm both ENOENT, and the output was `skip` where the issue expected `fail` at 1C. The first fix returned Dependabot's result. That fixed the issue's input, and each of the next four review rounds then found a different way a Dependabot-only night corrupts the stored row. Each was reproduced through the real path (`securityAudit` → `planAuditWrite` → Turso → `getSiteById` → auto-tick or Renovate selection):

- **Round 1.** Dependabot's counts overwrote a stored npm high with 0. That drops the site from Renovate targets and resets its auto-fix counter.
- **Round 2.** A fresh `Last security audit at` made a never-audited or stale row auto-tick Security Updates as "pass".
- **Round 3.** Flooring at the stored counts locked in Dependabot alerts that had since been fixed, ending at "auto-fix failed (3×)" for an alert GitHub had closed.
- **Round 4.**
  - More than 25 alerts grew the count every night: 30, 35, 40. The persisted list caps at 25, and the overflow was added back each night.
  - A GHSA-only advisory counted twice after a merged night, because `normalizeSecurityAdvisory` dropped `ghsa`.
- **Round 5.**
  - A stored pnpm high that Dependabot rated moderate went to moderate in one night.
  - A second night without that alert lost it.

**The belief corrected on contact:** I took this for a one-line change to the skip branch. The real defect is that the stored row never recorded which source found each advisory, so no rule for rebuilding a partial row could be right in every case. The design that survived tags each advisory `lockfile: true|false` and persists `ghsa`. A partial run then replaces only Dependabot's side and never stamps the audit time. Round 5's two findings are fixed in an unreviewed top commit, which is the operator's call. The full mutation set is 24, every one red. Three survivors along the way taught something:

- **M21 and M22** (persisting `ghsa`, and not letting pnpm's empty `cves` overwrite Dependabot's) covered for each other in one test. Once `ghsa` is persisted, M22's case cannot arise (Dependabot always carries a GHSA), so that change was reverted rather than shipped untested.
- **M24** showed "subtract only at the cap" had no test until a below-cap one went in.

**Tried and abandoned:** the round-1 rule, "a partial run's counts may rise, never fall". It is simple and it ratchets: round 3 is that rule's failure.

**The pins (#1623) were test-only.** All six of the issues' named mutations now go red. P4 (`||=` → `=`) is equivalent: only dead letters reach that branch, and `collectDeadLetterAlerts` always sets `critical`. #1572 was already pinned by #1574's cockpit test, and L1 turns that test red, so it was closed citing 67a4099b. The review also found that `isNew → sinceDay !== null` survived on both cardless branches; a later `since` now kills it.

**#1566 took three rounds.** Two of them were majors in the same shape: a kit 3 route the recipe itself had shipped, or had told the user to write, read as "hand-edited?" forever. Once on a kit 3 site's earlier bodies, once on an unreadable `catalog:` spec. `template.ts` is generated, so the swap happens at install time in `renderForKit`, and the kit 2 bytes and snapshots are unchanged.

**#1577.** `cockpit:build` now runs in `verify` and CI. It takes about 7 s and leaves the tree clean.

**Defects outside this charter, noticed:**

- `cockpit/tests/site/site.ssr.test.ts > submissions over the cap` went red on clean main this morning: its fixture renders "N mo ago" against the real clock. #1601, #1602 and #1603 are another session's fix.
- `tests/scripts/dropbox.test.ts > re-executes through HTTPS_PROXY` fails in the cloud container on main too.

**Left to the operator, unchanged:** #1583 and #1584 (wording calls), #1585 (Sites sort order). **Filed:** #1636, #1637, #1644.

**Honest accounting:** #1589 and #1566 were written by worktree subagents. The reviews were fresh session-model agents, one per round.
