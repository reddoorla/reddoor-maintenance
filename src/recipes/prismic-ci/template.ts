/**
 * The caller workflow every Prismic site gets.
 *
 * Fully generic — no per-site values — because the token is the site's own
 * `PRISMIC_WRITE_TOKEN` secret, the name every site's code already reads.
 * Contrast `ci.yml`, which is deliberately NOT templated anywhere in this
 * package because it carries per-site `netlify-site:` / `node-version:` values
 * a byte template would strip fleet-wide.
 */

/** Where the file lands in a site repo. Also the `gh api .../contents/<path>`
 *  segment, so it must stay traversal-free (`assertUrlSegment` re-checks). */
export const WORKFLOW_PATH = ".github/workflows/prismic-models.yml";

/** The Actions secret the reusable workflow declares as `required: true`, and
 *  the environment variable the CLI reads. Spelled ONCE, here, because the
 *  failure mode of a second spelling is silent: a caller passing a name the
 *  callee never declared supplies nothing, and the callee's required secret
 *  arrives empty at the one step that writes to a live client's Prismic repo. */
export const SECRET = "PRISMIC_WRITE_TOKEN";

/** The reusable workflow, without a ref. */
export const REUSABLE_WORKFLOW = "reddoorla/.github/.github/workflows/prismic-models.yml";

/**
 * The ONE branch this delivery path can run its apply job on.
 *
 * Not a preference — the reusable workflow's apply job hard-codes
 * `github.ref == 'refs/heads/main'`. On a repo whose default branch is anything
 * else, a merged model PR would produce a green check and never reach Prismic,
 * which is why the recipe refuses such a repo instead of installing a workflow
 * that silently cannot fire.
 */
export const APPLY_BRANCH = "main";

/** A commit in `reddoorla/.github`, plus the release tag that commit carries.
 *  Both are written into the workflow: the SHA is what Actions resolves, the tag
 *  is what a human (and Renovate's github-actions manager) reads. */
export type ReusableWorkflowPin = { sha: string; tag: string };

/**
 * What the shipped pin says while the reusable workflow has not been published
 * to `reddoorla/.github` and tagged yet (plan Task 25).
 *
 * DELIBERATELY NOT 40 HEX CHARACTERS. A placeholder shaped like a real SHA is
 * indistinguishable from a real one in review, and would install a workflow
 * referencing a commit that does not exist into 15 client repositories — where
 * it fails at workflow-load time, on every model PR, with an error that names
 * neither this file nor the reason. Unresolved must be unmistakable, and
 * {@link isPinResolved} is what the recipe gates on.
 */
export const UNRESOLVED_PIN_SHA = "UNRESOLVED-publish-and-tag-reddoorla-dot-github-first";

/**
 * The pin the fleet rolls out.
 *
 * RESOLVED 2026-08-14. `reddoorla/.github#30` merged as
 * 558395431ddcb481ecba3dd84b78b38c338cfa03 and that commit was tagged v1.4.0;
 * `gh api repos/reddoorla/.github/commits/v1.4.0 --jq .sha` returns the SHA
 * below. `validate` (the digest-pinning + Renovate-preset check that is the
 * only CI in that repo) passed on the merge commit.
 *
 * TO RE-RESOLVE after a future `reddoorla/.github` release: set `sha` to
 * `gh api repos/reddoorla/.github/commits/<tag> --jq .sha` and `tag` to that
 * tag — then VERIFY PROPAGATION rather than assuming it. Renovate does bump
 * this ref: 17 site repos went v1.2.0 -> v1.3.0 between 2026-07-13 and
 * 2026-08-10. It runs self-hosted here and its author identity has already
 * changed once mid-window (operator PAT, authoring as `tucksravin`, until
 * 2026-08-02; `reddoor-renovate[bot]` since), so no single author filter
 * matches all 17 and `app/renovate` matches none of them. Search the
 * `renovate/*` head branch, not an author; an empty author-filtered search
 * is not evidence. But it proposed neither
 * of the last two tags for `ci.yml`: v1.4.0 (2026-08-14) was never offered,
 * and v1.4.1 (2026-09-01) reached the fleet only because ci.yml was swept BY
 * HAND across 21 repos that day (beachfront-dentistry#36). Treat propagation
 * as three steps to run, not a guarantee: (1) re-resolve this constant,
 * (2) release @reddoorla/maintenance, (3) `reddoor-maint prismic-ci --fleet
 * airtable` — the already-delivered gate content-compares the installed file
 * and opens a corrective PR per stale repo — plus ONE POSITIONAL RUN PER
 * PRE-LAUNCH SITE, which the Airtable inventory excludes
 * (`src/inventory/airtable.ts:50` filters `building`/`launching`).
 */
export const REUSABLE_WORKFLOW_PIN: ReusableWorkflowPin = {
  sha: "558395431ddcb481ecba3dd84b78b38c338cfa03",
  tag: "v1.4.0",
};

/**
 * Is this pin a real commit reference?
 *
 * A full 40-hex SHA and nothing else. Not a tag, not a branch: this repo pins
 * every `uses:` to a commit (see `src/recipes/sync-configs/templates.ts`, whose
 * renovate template spells out why — a retagged `@v3` runs attacker code with
 * whatever token the workflow holds). Do not assume the pin bumps itself:
 * Renovate has proposed this ref in the past but did not for either of the
 * last two tags — see the propagation note on
 * {@link REUSABLE_WORKFLOW_PIN} above.
 */
export function isPinResolved(pin: ReusableWorkflowPin): boolean {
  return /^[0-9a-f]{40}$/.test(pin.sha);
}

/**
 * Render the caller workflow for a pin.
 *
 * Path-filtered on both triggers: this must not run on every commit, only when
 * a model changes.
 */
export function prismicCiWorkflow(pin: ReusableWorkflowPin): string {
  return `# Delivers this site's Prismic model changes. Managed by @reddoorla/maintenance
# (\`reddoor-maint prismic-ci\`) — change it there and re-run, not here.
#
# On a PR touching a model: comment the delta, write nothing.
# On merge to ${APPLY_BRANCH}: push those models to Prismic. Never delete.
#
# THE BRANCH FILTER ON \`push:\` IS LOAD-BEARING, not tidiness. The reusable
# workflow's apply job also guards \`github.ref == 'refs/heads/${APPLY_BRANCH}'\`,
# and its comment calls this the other half of that gate: an unfiltered
# \`on: push:\` fires on every branch AND every tag, so a feature branch's models
# would reach production with no pull request and therefore no review anywhere in
# the sequence. Keep both halves.
name: prismic-models

on:
  # No branch filter here, deliberately: a model PR into any base deserves its
  # delta comment, and the dry job is INCAPABLE of writing — it never passes
  # \`--apply\`, and it holds no job that does.
  pull_request:
    paths:
      - "customtypes/**"
      - "src/lib/slices/**/model.json"
  push:
    branches: [${APPLY_BRANCH}]
    paths:
      - "customtypes/**"
      - "src/lib/slices/**/model.json"

jobs:
  prismic-models:
    # A called workflow's jobs can only NARROW what the caller granted, so the
    # PR-comment permission has to be granted here as well as there. Nothing in
    # either job pushes code, so \`contents\` stays read.
    permissions:
      contents: read
      pull-requests: write
    uses: ${REUSABLE_WORKFLOW}@${pin.sha} # ${pin.tag}
    secrets:
      # Spelled exactly as the reusable workflow declares it. A workflow-local
      # alias would not be a rename — it would be an undeclared secret, and the
      # required one would arrive empty.
      ${SECRET}: \${{ secrets.${SECRET} }}
`;
}

/** The workflow as currently shipped. Unusable — and refused by the recipe —
 *  until {@link REUSABLE_WORKFLOW_PIN} is resolved. */
export const PRISMIC_CI_WORKFLOW = prismicCiWorkflow(REUSABLE_WORKFLOW_PIN);
