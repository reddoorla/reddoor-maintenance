## 2026-10-20 — P1-64 follow-up: 29-navy and beachfront extend `renovate-staging-flow`, landed on `staging` ahead of their rulesets

Landed in the PR that carries this file. The changes are reddoorla/29-navy#90 and reddoorla/beachfront-dentistry#98, both into `staging`. This follows `2026-10-20-1653-p1-64-types-node.md`, from the same session.

Backlog: P1-64 follow-up · reddoorla/29-navy#90 and reddoorla/beachfront-dentistry#98 into `staging` (merged `29a9940` and `2c154d1`, 17:25Z). They unblock reddoorla/29-navy#88 and reddoorla/beachfront-dentistry#91 at each repo's next promotion, which waits on the operator's `staging` ruleset for that repo.

**Why.** The earlier entry ended with two lock-file PRs that `@types/node` could not turn green. `main-gate` on `main` admits only `staging` or a Renovate patch or minor labelled `fast-track`. Neither repo's Renovate was on the staging flow, so lock-file maintenance kept targeting `main` with no label. The operator asked for the `extends` (the staging-flow runbook's step 7). Each `renovate.json` now matches vida-legacy-foundation's byte for byte.

**The order matters more than the diff.** The preset's own description sets the precondition: a repo extends it "only once it has a `staging` branch with a ruleset requiring `ci / ci`". Neither repo meets it today: 29-navy's `staging` and beachfront's recut `staging` both read `protected=false`. Landing the `extends` on `staging` changes nothing yet, because Renovate reads its config from the default branch. The risk opens at promotion. Without the ruleset, Renovate's automerge (with `internalChecksAsSuccess`) could merge lock-file maintenance into `staging` before CI runs. The runbook also needs the ruleset before any promotion, since `delete_branch_on_merge` deletes an unprotected head. Both PR bodies name the `gh api -X POST …/rulesets` command. The ruleset is red tier: it is the operator's, not a worker's.

**The instrument was proved before its verdict was used.** `renovate-config-validator --strict` (renovate@latest) passed the new file with exit 0. The same validator on a config carrying `nonsenseOption: true` failed with exit 1 ("Invalid configuration option: nonsenseOption"). The validator logs "Validating renovate.json as global config" and does not resolve presets. That `renovate-staging-flow.json` exists was checked separately: HTTP 200 on `.github`'s `main`.

**What the next promotion in each repo will do**, by the runbook's vida measurement:

- Renovate renames its branches with the base (`renovate/main-…`, `renovate/staging-…`).
- It closes the open Renovate PRs and reopens them under the new names: reddoorla/29-navy#88, and reddoorla/beachfront-dentistry#91 and its major reddoorla/beachfront-dentistry#66.
- Lock-file maintenance and majors then target `staging`. That is what retires the `main-gate` red on both lock-file PRs.
- Each promotion also carries P1-64's `@types/node`, which those lock-file PRs need for `ci / ci`.
