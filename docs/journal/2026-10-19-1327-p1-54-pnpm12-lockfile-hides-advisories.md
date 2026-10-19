## 2026-10-19 — Dependabot could not read a pnpm 12 lockfile, so 20 repos audited clean (P1-54, #1412)

The brief asked why a held, green `sharp` security PR never reaches the
cockpit. It guessed the held-PR path in `markWaiting` (`src/alerts/waiting.ts`)
was the cause. That guess was wrong. There were two causes, and neither was the
wait.

**The sweep never recorded the advisory.** caltex-landing, espada and revogen
store `vulns_critical 0, vulns_high 0, security_advisories []` (SELECT through
`pm-cockpit.mts`'s read-only plugin, 2026-10-19 13:12Z, sweep of 06:12Z). Every
`fleet-security` log from 10-04 to 10-19 says `Dependabot: 0 alerts` for
CalTex. Its `pnpm-lock.yaml` has `sharp@0.35.4`, which is inside the
advisory's range (`introduced 0, fixed 0.35.5`, OSV). pnpm 12 writes the
lockfile as two YAML documents. The first holds only `packageManagerDependencies`
(pnpm itself). The second, at line 158, holds the project. GitHub's dependency
graph reads the first one only: the SBOM for caltex-landing lists 22 packages,
the pnpm binaries and the Actions, and no npm dependency at all. Dependabot
therefore had nothing to alert on, and the audit took "0 alerts" as a clean
pass. Renovate still opened the PR, because the preset sets
`osvVulnerabilityAlerts: true` and OSV reads the lockfile itself.

The blind spot covers the fleet. Of the 23 active repo-backed sites, 20 have a
two-document lockfile, and every one of them stores 0/0. The three
single-document ones are on pnpm 11: 29-navy (0C/5H), erp-industrial (0C/3H)
and roalson-interests (`building`, no counts). 29 Navy and ERP are the only
two sites that store any vuln today. The fleet moved to pnpm 12 with `renovate/pnpm-12.x` around
09-22, so this has been dark for about four weeks, not 13 days.

The fix is in `src/audits/security.ts`. When the clone's lockfile has more than
one `lockfileVersion:` line, the audit runs `pnpm audit` (the fallback that
was already there) and adds it to Dependabot's answer. An advisory both
sources report is counted once. The first version skipped Dependabot
entirely. Review round 1 called that a major: the graph still sees Actions and
the pnpm binary, so a real alert on either would have been dropped for a
`pnpm audit` pass. If `pnpm audit` cannot run, the site is skipped and no
counts are written, rather than reporting Dependabot's empty answer. Each
advisory's `relationship` comes from whether `package.json` names the module,
including through an `npm:` alias. In a workspace it is left unknown, because a
member's own `package.json` would make a direct dependency read as transitive,
and that mutes the counter. Without a relationship at all, every transitive
`devalue` advisory would count as a direct one, the auto-fix counter would
climb, and about twenty sites would read "auto-fix failed" within three nights.
The fallback was proven before anything was built on it. On the real clone,
`pnpm audit --json --prod` finds sharp GHSA-wq5f-xc86-pv6w and five more highs
(0C/6H/2M/1L). As a negative control, on the PR's own branch
(`renovate/npm-sharp-vulnerability`, sharp 0.35.5) sharp drops out and high
falls to 5. It also works on the runner's pnpm: 11.11.0 switches itself to
12.5.1 inside the clone (`--version` prints 12.5.1 there and 11.11.0 in `/tmp`),
and the audit still finds sharp. The production `securityAudit`, run on the
clone with Dependabot stubbed to its real answer (`[]`), returns
`fail | pnpm audit + Dependabot: 9 vulnerabilities (0C/6H/2M/1L)`, with sharp `direct` and
the rest `transitive`. That matches what Dependabot records for 29 Navy.

**A recorded advisory was hidden by the feed.** 29 Navy's sharp advisory was
first recorded on 10-13, and `DIRECT_VULN_WAIT_DAYS` (4) escalated it on 10-17.
A held PR does escalate. The auto-fix counter staying at null (the dispatch
answers `skipped (open Renovate PR)`) does not stop it. Today's PM pass still
showed no vuln line, because `buildNeedsYouFeed` drops a non-exhausted vuln from
any site that is broken for another reason. Today that reason was
`2 Renovate PRs failing CI`, first flagged on 10-19. That rule dates from
2026-06-29 (#325), before `markWaiting` existed. Back then, every
non-exhausted vuln reached the card, so leaving it off a broken row cut noise.
Now a vuln reaches a card only after its wait has failed, so dropping it hid an
ask. The broken row now names it. `pm-cockpit.mts` on this branch prints
`5 critical/high vulns — Renovate has not fixed it since 2026-10-13 (escalated
2026-10-17)` under 29 Navy.

**What a reader should not over-credit.** CalTex, Espada and Revogen will not
reach Needs-you tomorrow. Tomorrow's 06:11Z sweep records them, which starts
their `firstFlaggedAt`. The direct wait then runs four more days, to about
10-24. The 36 PRs are already in front of the operator as Operator decisions
129, so the delay hides nothing new. A clock that started at the Renovate PR's
own open date would close it, but that needs a new input and is not built
here. From about 10-24, expect a wave: roughly twenty sites pick up real High
advisories at once. The direct ones (`sharp`) will escalate on the direct wait.
The transitive ones will escalate after a lock-file window, and lock-file
maintenance is stopped fleet-wide (P1-52).

The brief's third mutation ("the held PR is marked automerge-eligible, so it
must go back to waiting") has nothing to act on. No code path tells a held
security PR apart from an automerge-eligible one, and none is needed, because
the direct wait applies to both. The mutation table is in the PR body. Eight
mutations each turned at least one test red.
