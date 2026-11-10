# The staging flow: feature → staging → main, per repo

The per-repo template for #545, as the operator set it on 2026-10-12 (Operator
decisions 113). Repeat it for each repo; do not reinvent it. vida-legacy-foundation
is the pilot, and every step below was first done there.

## The shape

- `main` is production: the Netlify production deploy.
- `staging` is a persistent branch with a Netlify branch deploy at
  `staging--<netlify-site-name>.netlify.app`. Feature work opens PRs into
  `staging`, and a worker merges them on green CI plus `@smoke` against that
  URL.
- **Only the operator promotes `staging` → `main`.** A worker opens the
  promotion PR and never merges it.
- **Renovate:** patches and minors target `main` and fast-track. Renovate merges
  them on green, with no operator PR per update. Majors and every other update
  type target `staging`, and reach `main` only through the operator's
  promotion.
- **The gate on `main`:** `main-gate` is a required check on `main`. It passes
  only two kinds of PR:
  - a PR from this repo's `staging`, or
  - a PR by `reddoor-renovate[bot]` on a `renovate/` branch where:
    - every push to the branch since its latest creation was the bot's, by
      the repository activity log. Commit metadata cannot prove who pushed:
      a writer can have GitHub create and sign a commit whose author is the
      bot (`PUT contents` with an author override). The log is read only
      back to the latest `branch_creation`, because Renovate reuses branch
      names. The log lags: on 2026-10-21 it still listed nothing for a
      branch 22 to 24 seconds after Renovate created it, and a log that
      lags can also be partly filled. So the log is trusted only once its
      newest entry is the PR's head commit and it lists a
      `branch_creation`; it is read again for about a minute until it
      does, and this check fails if it never does;
    - every commit is authored by the bot, committed by `web-flow` and
      verified by GitHub, which is how Renovate's API commits look;
    - the PR changes only `package.json`, `pnpm-lock.yaml`,
      `pnpm-workspace.yaml`, `.nvmrc` or workflow files; and
    - the `fast-track` label is present, last added by the bot.

The label is how the gate tells a patch or minor from anything else. The
`renovate-staging-flow` preset adds it only to patch and minor updates on `main`.

Each of the gate's five GitHub reads (commits, activity, files, labels, label
events) goes through one helper. A 5xx, a 429, a rate-limit 403 or a failure
with no HTTP status is read again after 2, 8 and 30 seconds. Any other failure,
or a fourth, fails the check with an `::error::` naming the read, its HTTP
status and what `gh` said (reddoorla/reddoor-maintenance#1624). Before that, a
failed read ended the step through `set -e` with `gh`'s message in the log but
no annotation, and a failed labels read was reported as a missing label. A read
that keeps failing costs 40 seconds, so in the worst case, an activity feed
that fails on every read, the gate can run about five minutes before it fails.

## The pieces, and where each lives

| Piece                                                                      | Where                                                                                                                       | Who applies it                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `staging` branch                                                           | `git push origin <main sha>:refs/heads/staging`                                                                             | a worker (the cloud proxy refuses `POST git/refs`, but a git push works) |
| Netlify branch deploy                                                      | `PATCH /api/v1/sites/<netlify_id>` with `{"build_settings":{"allowed_branches":["main","staging"]}}`                        | a worker, with `NETLIFY_PAT`; `netlify_id` is on the site's Turso row    |
| `staging` ruleset: deletion, no force-push, PR, `ci / ci`, no bypass actor | [`staging-flow/staging-ruleset.json`](staging-flow/staging-ruleset.json)                                                    | the operator (red tier; the cloud proxy refuses ruleset writes)          |
| `main-gate` workflow                                                       | [`staging-flow/main-gate.yml`](staging-flow/main-gate.yml), copied to `.github/workflows/main-gate.yml`                     | a worker, by PR into `staging`                                           |
| `main-gate` as a required check on `main`                                  | the `jq` edit below                                                                                                         | the operator, **after** the first promotion                              |
| Renovate preset                                                            | `renovate-staging-flow.json` in `reddoorla/.github` ([the patch](../patches/2026-10-12-github-renovate-staging-flow.patch)) | the operator, once, for the whole fleet                                  |
| `extends` in the repo's `renovate.json`                                    | `"extends": ["github>reddoorla/.github:renovate-config", "github>reddoorla/.github:renovate-staging-flow"]`                 | a worker, by PR into `staging`, **after** the preset exists              |

`sync-configs` can carry the workflow file but not the rulesets, the Netlify
setting or the order below, so this is a runbook rather than a template there.

## The order, and why it is the order

1. **`staging` from `main`, then the Netlify branch deploy.** Diff the site's
   `build_settings` before and after; on vida only `allowed_branches` changed.
2. **The `staging` ruleset (operator):**

   ```sh
   gh api -X POST repos/reddoorla/<repo>/rulesets --input docs/runbooks/staging-flow/staging-ruleset.json
   gh api repos/reddoorla/<repo>/rules/branches/staging   # expect deletion, non_fast_forward, pull_request, required_status_checks
   ```

   It has to exist **before** any Renovate config targets `staging`. The fleet
   preset's invariant (3) says every branch Renovate merges into needs a
   required check with no bypass actor. With `internalChecksAsSuccess`,
   Renovate otherwise merges lock-file maintenance into `staging` before CI has
   run. It also has to exist before the first promotion: a promotion PR's head
   _is_ `staging`, and `delete_branch_on_merge` deletes an unprotected head on
   merge (#545, the 09-11 comment).

   **Check `main` too.** `gh api repos/reddoorla/<repo>/branches/main --jq .protected`
   must be `true`. mantis-landscaping's was `false` on 2026-10-12, with no
   ruleset at all, against `true` on vida as the control. The fleet preset's
   09-21 sweep found a required check on every default branch, and a repo
   bootstrapped after it can lack one. If it is `false`, create `main`'s
   ruleset (vida's, minus its id) before anything else:

   ```sh
   gh api -X POST repos/reddoorla/<repo>/rulesets --input docs/runbooks/staging-flow/main-ruleset.json
   ```

3. **`main-gate.yml` into `staging`**, by PR, merged on green.
4. **Work lands on `staging`** (on vida, the kit 3 migration).
5. **The promotion PR**, `staging` → `main`, opened by the worker, merged by the
   operator.
6. **`main-gate` becomes required on `main` (operator), after step 5 has
   merged.** `main-gate` runs on `pull_request_target`, which runs `main`'s copy
   of the workflow, so a PR cannot edit the gate that judges it. Until the file
   is on `main` the check never reports, so requiring it earlier would block
   the promotion that delivers it. It is pinned to the GitHub Actions app
   (15368), so a commit status named `main-gate` cannot satisfy it:

   ```sh
   id=$(gh api repos/reddoorla/<repo>/rulesets --jq '.[] | select(.name=="main: reviewed changes only") | .id')
   gh api repos/reddoorla/<repo>/rulesets/$id \
     | jq '{name,target,enforcement,conditions,bypass_actors,rules: [.rules[] | if .type=="required_status_checks" then .parameters.required_status_checks |= (map(select(.context != "main-gate")) + [{"context":"main-gate","integration_id":15368}]) else . end]}' \
     | gh api -X PUT repos/reddoorla/<repo>/rulesets/$id --input -
   gh api repos/reddoorla/<repo>/rules/branches/main --jq '.[] | select(.type=="required_status_checks") | .parameters.required_status_checks'
   ```

   The `jq` was run against vida's real ruleset (`22045535`). It keeps every
   other rule, and running it twice adds the check once.

7. **The Renovate `extends`, by PR into `staging`, once the preset is on
   `.github`'s `main`.** Renovate reads its config from the default branch, so
   it takes effect at the next promotion. If the preset does not exist when the
   repo's `renovate.json` names it, Renovate stops on that repo with a config
   error.

## Promotion, each time

- **Why `main` has to come into `staging` first.** Fast-tracked patches and
  minors land on `main` and never pass through `staging`, so `staging` falls
  behind. Both branches are also scheduled to rewrite `pnpm-lock.yaml` every
  week: Renovate's non-major group on `main`, and lock-file maintenance and
  majors on `staging`. Git merges a lockfile as text, so once both have moved,
  a bring-main PR and the promotion PR conflict on it. On 2026-11-03,
  caltex-landing (#104 on `main`, #105 on `staging`) conflicted in 51 hunks of
  the lockfile and nowhere else, and medical-solutions-of-texas (#111; #113 and
  #117) in 31. GitHub can only resolve that by hand-editing the text.
- **Bring it with the script, never with a PR whose head is `main`.** From a
  maintenance checkout, against a full (not shallow) clone of the site:
  `node scripts/staging-bring-main.mjs --dir <site checkout>`. It cuts a
  branch from `staging`, merges `main` into it, and has the site's pinned
  pnpm merge the lockfile (`pnpm install --lockfile-only`, which resolves its
  own conflict markers), so a lockfile-only conflict needs no hand resolution.
  A conflict in any other file stops it with exit 2 and makes nothing: that
  is a real fork, such as a major on `staging` and a minor of the same package
  on `main`, and a human's.
- **It checks what pnpm chose, not only that pnpm finished.** A clean pnpm
  merge can still go backwards: on 2026-11-10 pnpm 12.5.1 merged
  alamo-anatomy's and mantis-landscaping's lockfiles and put `staging`'s
  `rolldown` 1.3.0, `cookie` 2.0.2 and `@netlify/types` 3.3.1 back to `main`'s
  older versions on both (alamo-anatomy#108, mantis-landscaping#87). So it
  checks each dependency in both sides' lockfiles (both of pnpm 12's YAML
  documents): wherever the merged lockfile keeps the importer or the exact
  package version that depended on a version, it must resolve it at least as
  new now. It lets through a dependent the merged lockfile no longer has
  (nothing depends on that copy now), a downgrade on purpose (the merged
  `package.json` range rejects the old version, or an `overrides` pin that is
  not scoped under a parent), peers (they follow the site's own choice, which
  is checked), and versions that are not semver (`file:`, `link:`, a tarball).
  A lockfile with no snapshots is compared by line instead: a major, or
  `0.minor`, must keep its newest version.
- **On a regression it retries from a side's own lockfile**, as both incidents
  were fixed by hand: `staging`'s first, then `main`'s, and only a side whose
  `package.json` files, `patches/`, `pnpm-workspace.yaml`, `.npmrc` and
  `.pnpmfile.cjs`/`.mjs` the merged tree still has, so its lockfile already
  answers them. The seeded result is checked against both sides the same way,
  so a seed that would drop the other side's lockfile-only change is refused
  too. Its output and commit message say when it seeded. If no seed passes, it
  stops with exit 2, names every package put back and why each side could not
  seed, and makes nothing: rebuild that lockfile by hand from the newer side's
  and record why in the site's journal.
- **Merge its PR as a merge commit, while `staging` is still where the script
  started.** A worker lands it, under AUTONOMY.md's merge authority. Push the branch it names and open its PR into `staging`. Just
  before merging on green, read `staging`'s live tip
  (`gh api repos/reddoorla/<repo>/branches/staging --jq .commit.sha`, not the
  PR's `base.sha`, which is a snapshot from when the PR was opened or last
  pushed) and merge only if it is still the `staging` sha the script printed.
  If `staging` has moved, close the PR, delete the local branch
  (`git branch -D <branch>`, or give the re-run its own `--branch`), and run
  the script again: `staging`
  does not require an up-to-date branch, so GitHub would merge the lockfile as
  text. The merge call cannot pin the base, so a window of seconds remains.
  Merge it as a **merge commit**, never a squash: a squash keeps the resolved
  tree but drops `main` as a parent, so the promotion PR still conflicts
  (caltex-landing#88 squashed and had to be redone as #89, 2026-10-19).
  `land-prs.mjs` squashes wherever the base allows it, so merge this one with
  `PUT pulls/{n}/merge` and `merge_method=merge`, pinned to the green head's
  `sha`.
- **Open the promotion PR at once** (head `staging`, base `main`); the
  operator merges it. Say what it carries since the last promotion and what
  was checked on the staging URL. `main` requires an up-to-date branch, so if
  a fast-track PR lands on `main` before the operator merges, the promotion PR
  reads behind (or dirty). Do not press "Update branch": it would push to
  `staging`, which only takes PRs. Whenever `main` is no longer an ancestor of
  `staging`, run the script again and land its new bring-main PR the same way,
  closing any earlier bring-main PR it supersedes.

## What the first live Renovate run does

Measured by Renovate's own `dryRun: full` on vida (vida-legacy-foundation#99,
closed):

- **Branch names change.** Two base branches put the base into every branch
  name (`renovate/main-all-minor-patch`, `renovate/staging-sveltejs-kit-3.x`).
  The first run autocloses the repo's open Renovate PRs and reopens them under
  the new names. On vida that was #80 and #94–#97.
- **Security fixes open on both bases.** Each vulnerability alert is a
  packageRule with `force: { enabled: true }`, which overrides the preset's
  `enabled: false`. A patch or minor fix into `main` carries `fast-track`. A
  **major** security fix into `main` is held by `main-gate` for the operator.
- **Packages in renovate-config's never-automerge list** (`@reddoorla/maintenance`,
  `sharp` and the image packages) still wait for a human, on `main` as before.
  Under `group:allNonMajor`, one of them in the group holds the whole grouped
  PR. This preset does not change that.

## Known gaps

- **CI depth.** #545's 09-28 comment asks for a fast lane into `staging` and a
  full lane into `main`. The reusable `ci.yml` has no `mode` input yet, so both
  run the full CI. That is stricter, not looser, and it is a `.github` change
  for its own PR.
- **Turnstile on the staging host.** A Turnstile widget is bound to a hostname
  list, and `staging--<site>.netlify.app` is a new hostname. The contact form
  there mints no token until the host is added to the widget
  ([turnstile-widgets.md](turnstile-widgets.md)).
- **reddoor-website**, the reference implementation, predates this template:
  its `renovate.json` sends everything to `staging`, and its `staging` has a
  deletion rule only. Moving it onto this template is its own change.
