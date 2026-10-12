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
    - every commit is authored by the bot, committed by `web-flow` and
      verified by GitHub. Renovate commits through the API, so its commits
      are exactly that, and a pushed commit cannot be: a commit's author is
      only an email, and the bot's is published in each repo's
      `renovate.yml`;
    - the PR changes only `package.json`, `pnpm-lock.yaml`,
      `pnpm-workspace.yaml`, `.nvmrc` or workflow files; and
    - the `fast-track` label is present, last added by the bot.

The label is how the gate tells a patch or minor from anything else. The
`renovate-staging-flow` preset adds it only to patch and minor updates on `main`.

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

- **Bring `main` into `staging` first.** Fast-tracked patches and minors land on
  `main` and never pass through `staging`, so `staging` falls behind. Open a
  PR with head `main` and base `staging`, and merge it on green. Its head is
  `main`, which `main`'s own ruleset protects from auto-delete. Without this
  step the promotion PR conflicts on `package.json` and `pnpm-lock.yaml` as
  soon as both branches have moved.
- Open the promotion PR (head `staging`, base `main`). Say what it carries since
  the last promotion and what was checked on the staging URL.

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
