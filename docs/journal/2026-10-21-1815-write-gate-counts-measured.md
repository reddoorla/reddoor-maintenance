# 2026-10-21 — The fleet write gate counts what was measured

**Where it landed:** reddoorla/reddoor-maintenance#1653 (branch `claude/1605-write-gate`), closing #1605. Brief: the workspace's `briefs/2026-10-21-write-gate-blind-spots.md`. #1609, #1610 and #1611 from the same brief build on it and have not started. The PR is held at the five-round review stop (workspace decision `2026-10-21-1805-write-gate-1605-round-5.md`).

**Why.** That morning's P1-33 sweep found three ways `FLEET_WRITE_SUMMARY` went green with nothing measured. A site whose audits produced nothing was pushed to `written` with an empty FieldSet. `total` was `wrote + failed`, the run counting itself. The 25% tolerance, plus `|| true` on the CLI, kept a permanent one-site miss green forever. The `|| true` cannot simply go: on every real night lighthouse reports `fail` on at least one site (sonder's SEO assertions), so the CLI exits 1 by design. That is why the verdict moved into TypeScript (`fleetWriteGate`) and is printed as a line all five workflows read, absent meaning red.

**Known-good first.** Before anything was called a fix, last night's real per-site results were rebuilt from each job's log and run through the new gate. Lighthouse 17 sites × 5 audits, smoke 17, security 17 × 2 audits, form-e2e 17, prismic-drift 17: all green. A round-3 reviewer then replayed 42 job logs from 10-14 to 10-21 independently: all 34 replayable night-logs came out green. The only non-green line was one true warning, msot's `/health` on 10-19. That reviewer's replay was shown red on known-bad inputs first.

**Beliefs corrected on contact.**

- My first security replay went red: "deps measured nothing on 17 of 17". The gate was not at fault. My synthetic deps details lacked `entries`, which is what `hasDepsCounts` reads. The instrument was the suspect, and it was guilty.
- Form-e2e's self-skips (7 of 17 on 10-19) looked like they would red any coverage threshold. They carry `checkedAt` and write a Turnstile null, so they are measured.
- I expected "a site with nothing written" to be the hard part. The hard part was the denominators. With 13 sites that have no smoke suite, four blind adopters out of five read green until n/a sites came out of both quarters.

**Defects review found, by round.**

- Round 1: n/a dilution. The gate also ran after the old bare counts, so "deps would not install" read as "check the Turso creds". Fleet-security's Renovate dispatch and protection audit skipped on every gate red.
- Round 2: the protection-gap open and close steps carried Actions' implicit `success()`, so the issue still froze on red nights.
- Round 3: five broken skips could be marked n/a with every test green. A source census now pins the seven by-design marks.
- Round 4: after `!cancelled()`, a failed install or build ran the protection audit against a missing `dist/` and would have filed a false coverage gap. The follow-up steps now key on `steps.sweep.outcome`.
- Round 5: nothing pinned that `steps.sweep` names a real step. A generic test now checks every `steps.<id>` an `if:` reads, in every workflow.
- #1633's drought steps landed mid-session with the same implicit `success()`, so this PR fixed them too.

**Measured.** Five review rounds, about 200 mutations tried across them. Every survivor of real behaviour was killed before the next round. The full suite ran 10,551 tests, 1 failed: the container-only dropbox proxy test, which fails on main too.

**Left open, filed.** #1649 covers rules a single run cannot judge, such as one site permanently blind on one audit, or the function-health 404 that is not marked n/a. #1650 covers github-signals' unread verdict and nameless-inventory label drift. #1651 covers annotation duplication and escaping and the `/tmp/audit.out` race. #1652 covers the drought warning's wording.
