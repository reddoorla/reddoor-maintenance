# 2026-10-21 — t4's changedFiles test raced git's detached maintenance

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `fix/t4-scope-maintenance-race`), one test file.

**The failure.** `tests/model-bakeoff/t4-plan-task.test.ts` › `changedFiles` › "finds every change against the scorer's own repo, whatever the agent's .git says" failed once on CI, in run 39533992157 attempt 1 for #1587. That PR does not touch the test, and attempt 2 passed. The error was `ENOENT, No such file or directory '/tmp/t4-scope-Bsg64M/tree/.git/objects'`, thrown at `cpSync(base, tree, { recursive: true })`, line 191. The runner's git was 2.55.0, and this container's is 2.43.0.

**The cause, measured rather than assumed.** The brief guessed that `git gc --auto` repacked loose objects during the copy. That is not what happens. A commit of five files writes about seven objects, far below `gc.auto`'s threshold of 6700, so gc never runs. What does run is `git maintenance run --auto`. The commit starts it on every call (GIT_TRACE2 shows `child_start[1] git maintenance run --auto --quiet`). That process creates `.git/objects/maintenance.lock` and unlinks it again, even when there is nothing to do (strace shows `openat(…/.git/objects/maintenance.lock, O_CREAT|O_EXCL)`, then `unlink`). On 2.43 this finishes before `commit` returns, which is why the test never fails locally. Git 2.47 and later detach that run by default (`maintenance.autoDetach`), so on the runner the lock comes and goes while `cpSync` walks `.git/objects`.

**Reproduced.** A script commits a repo, churns `objects/maintenance.lock` in a shell loop, and calls `cpSync` 2000 times. 209 of those calls failed. The first failure gave CI's message exactly: `ENOENT, No such file or directory '/tmp/t4-scope-Svspfd/tree2/.git/objects'`. Node names the destination directory, not the file that vanished, which is why the CI message pointed nowhere useful.

**The fix.** Right after `git init`, the test sets `gc.auto=0` and `maintenance.auto=false` in the temp repo's own config, and asserts that both read back. With them set, the commit's trace shows no maintenance child. No other bakeoff test copies a freshly committed `.git`:

- `pnpm-update.test.ts`'s fixture is read through `git archive`;
- the other two t4 tests that commit never copy `.git`.

**Evidence.** The changedFiles test passed 50 of 50 runs in a loop. The bakeoff suite passed (450 tests), and eslint, prettier and typecheck are clean. The mutation was to delete the two `config` lines, and it turned the test red ("Command failed: git … config gc.auto"). The loop cannot prove that the race is gone, because 2.43 here never detaches. The trace and the reproduction above are what tie the fix to the failure.

**Not changed.** `commitAll` in `scripts/model-bakeoff/tasks/t4-plan-task.mjs` also commits without disabling maintenance, but nothing copies that repo's `.git` afterwards, so it has no race to fix.
