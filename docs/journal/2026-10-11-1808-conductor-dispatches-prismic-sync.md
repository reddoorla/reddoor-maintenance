## 2026-10-11 — The conductor dispatches `fleet-prismic-sync` right after drift (P1-39, #1287, `732b446`)

P1-38 moved the fleet nightlies off GitHub's late cron and onto a conductor, `fleet-nightly`, which dispatches each one with `github.token`. One workflow was not on its list: `fleet-prismic-sync`, the D1 pull-sync that brings a Type Builder edit back to a site repo as a PR. Its only automatic trigger was `workflow_run: [fleet-prismic-drift]`.

**Measured before any edit (REST, 17:2xZ).** The trigger did not fire for any conducted night:

- The three sync runs that exist (37458218540, 37614417685, 37772101212) all followed scheduled drift runs, on 10-06 to 10-08.
- The three drift runs the conductor dispatched (37891979106, 38029895400, 38117077820, on 10-09 to 10-11) were `workflow_dispatch` by `github-actions[bot]`, and none of them was followed by a sync.

GitHub's documented rule fits: an event the `GITHUB_TOKEN` caused starts no new run, apart from `workflow_dispatch` and `repository_dispatch`. Nothing went red, because a run that never starts cannot fail.

**The fix.**

- `NIGHTLIES` now holds eight. The sync is third, right after drift, on a 20-minute wait. The guard, the summary (`total=8`) and the per-nightly `NIGHTLY` line treat it like the others.
- The conductor's step and job timeouts went from 260/270 to 290/300 minutes. With the sync, the waits sum to 255 minutes, and at 2 minutes of overhead per nightly the total is 271, which 260 no longer covered.
- The order is a convention, not a data dependency. `prismic-sync` clones each site and compares it with Prismic itself; it reads nothing drift writes. So when drift's 20-minute wait runs out and the sync starts beside a still-running drift, nothing breaks.

**Why the `workflow_run` trigger went rather than stayed.** The brief left the choice open. Keeping it buys one thing: a drift dispatched by hand also starts a sync. That happened 4 times in the last 63 drift runs. It costs two things:

- **A second trigger path whose silence rests on an inferred GitHub rule.** If the conductor ever moved to an App token, which is the obvious next step if `github.token` dispatch ever stopped working, every night would sync twice.
- **An `if:` to suppress that.** Tests could check that `if:` only as a string.

With the trigger removed, the conductor's 12 h guard is the only dedupe, as it is for every other conducted nightly. A test refuses `workflow_run` on any workflow in `NIGHTLIES`.

**Beliefs corrected on contact.**

- **The brief's mutation 4 ("count a failed sync as success in the summary") assumed `NIGHTLY_CONDUCTOR_SUMMARY` counts conclusions.** It does not, for any nightly. It counts dispatched, completed, wait-exceeded, skipped and dispatch-failed. Only the per-nightly `NIGHTLY` line carries a conclusion, and that is what `docs/pm-pass.md` step 1 reads, so the mutation was made there. A `failed=` count in the summary would be a change for all eight nightlies and was left out.
- **The sync has never run from a `workflow_dispatch` on `main`.** All three runs came from `workflow_run`. The Actions-semantics review traced the dispatch path through every job and `if:` and found nothing that depends on `workflow_run`, but tracing is not proof. The first real proof is the 2026-10-12 06:07Z conductor run. The brief forbids dispatching anything but `fleet-smoke` to test, so it is left to the next PM pass.
- **The 20-minute wait is sized from runs with no change.** The three measured runs took 1m55s, 2m34s and 2m01s, and every one skipped `build` because all sites were in sync. A night with a changed site adds a Docker `pnpm install` per changed site, and that case has not been measured.

**Two docs were already wrong, and one of my edits made one of them worse.**

- `docs/runbooks/continuity.md` counted thirteen unattended workflows. It had no row for the sync, and none for `pm-pass-watch` (added in #1235).
- My first edit added the sync and said "Fourteen". Round 2 of the review counted fifteen. Both rows are in now.
- The runbook's §6 still said drift "runs at 05:00 UTC", a schedule it has not had since P1-38.

**An instrument failure of my own.** The first mutation loop restored each mutated file with `git checkout`, but the implementation was not yet committed. So the first restore wiped the implementation, and mutations 3 and 4 then ran against `origin/main`. Their results looked plausible, with 5 tests red each, and were void. The tell was that M2's patch "did not apply", which happened because the sync line was gone. Re-run after a local commit, all eight mutations turned at least one test red. The rule this repo already states held: the harness is the suspect until it has passed on a known-good input.

**A second misread, of authorship.** While landing, #1287 showed a merge commit `274a038`, "Merge branch 'main' into claude/gallant-hopper-sb7mrk", authored by Tucker Lemos through web-flow. I first read it as the operator updating my branch by hand. The land script's own log says otherwise: `BEHIND — update-branch from 451f073`, then `head moved 451f073 -> 274a038`. Its `PUT pulls/{n}/update-branch` is attributed to the account behind the proxy. The release PR #1214 had landed at 17:50Z, which made the branch BEHIND.

Then `main` moved again (#1288, P1-41 to Done), and the branch went DIRTY on `docs/BACKLOG.md`. Each side had removed a different P1 row, and Prettier had re-padded the table to a different width on each side, so no line matched. The fix compared the two sides cell by cell with the padding stripped, took one side, and re-padded with Prettier.

**Review.**

- **Round 1** had three lenses. None found a behaviour defect. It closed two test gaps: a floor on the sync's wait, and the sync dispatched on the conductor's ref. One test name overclaimed and was fixed. It also caught three stale docs.
- **Round 2** found no behaviour defect. It found the miscount above, and an unpinned `publish: if: always()` that predates this PR. I treated that as a clean round for the two-dirty-rounds rule and said so in the PR body.
- **Not covered:** a workflow that dispatched the sync from one of its own steps would make a second sync. Nothing does that today.

**For the next PM pass.** The 10-12 conductor log should show `NIGHTLY fleet-prismic-sync.yml run=<id> conclusion=success` and `total=8`, and the sync run a `PRISMIC_SYNC_SUMMARY` line.

- If it shows `skipped: run …` instead, someone ran the conductor with `only=fleet-prismic-sync` after 18:07Z tonight, and the guard did its job.
- A direct dispatch of `fleet-prismic-sync.yml` is not counted by the guard.
