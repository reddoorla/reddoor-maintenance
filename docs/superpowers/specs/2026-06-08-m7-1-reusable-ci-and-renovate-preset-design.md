# Design — M7.1: One CI (reusable workflow) + org Renovate preset

> **Status:** approved 2026-06-08. Implements roadmap milestone **M7.1**
> (`docs/superpowers/specs/2026-06-02-fleet-scale-roadmap.md`) and extends its scope to also collapse
> the per-repo `renovate.json` into one org preset (same repo, same "fix-once" lever).
> **Decision: host both in `reddoorla/.github`; callers SHA-pin the reusable workflow + Renovate
> bumps the SHA (not a moving `@v1`).**

## Context

M7 adopts the shared-PLUMBING model: the starter stays the clone skeleton, `@reddoorla/maintenance`
is the shared brain, and Renovate propagates every fix (fix-once-apply-all). Today the CI definition
is **copy-pasted** into every repo via the `sync-configs` `ci` template — a ~25-line inline job that
must be re-synced on every change. The `renovate.json` is likewise a per-repo copy. "Fix CI once"
isn't real yet.

A 2026-06-08 prior-art research pass (deep-research; 23 verified findings, sources in §References)
confirmed our overall model is the mainstream pattern for separate-repo fleets and surfaced two
refinements now baked into this design:

1. **SHA-pin the reusable-workflow `@ref`, not a moving `@v1`.** GitHub's own docs call a commit SHA
   "the safest option for stability and security"; Renovate's `github-actions` manager (on by
   default) keeps a `@<sha> # vX.Y.Z` ref current automatically.
2. **Collapse per-repo `renovate.json` into one org preset.** Renovate config presets are the
   standard org-wide fix-once mechanism: repos reference a shared preset via a thin `extends` array.

(The research also validated keeping plumbing as a _versioned dependency_ rather than a Copier/cruft
template overlay — a dep bump has no merge-conflict tax, which template-overlay propagation always
incurs. No change needed there; it reinforces the existing M7 model.)

## Decision — host both in `reddoorla/.github`

A new **`reddoorla/.github`** repo becomes the org's fix-once home. Chosen over a dedicated
`reddoorla/workflows` repo because the same repo also hosts the org Renovate preset and (free, later)
the org-default community health files — consolidating all three fix-once mechanisms in one place.

The repo hosts:

| Artifact                       | Path                                             | Purpose                                                |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Reusable CI workflow           | `.github/workflows/ci.yml` (`on: workflow_call`) | the canonical CI steps, defined once                   |
| Org Renovate preset            | `renovate-config.json` (repo root)               | the shared dependency policy, referenced via `extends` |
| (later) community health files | `profile/`, issue templates, etc.                | out of scope for M7.1                                  |

Versioned with **semver git tags** (`v1.0.0`, …). Callers SHA-pin with a version comment
(`@<sha> # v1.0.0`); Renovate's `github-actions` manager bumps the SHA when a newer tag ships.

## Components

### 1. Reusable workflow — `reddoorla/.github/.github/workflows/ci.yml`

`on: workflow_call`, a single `ci` job carrying today's canonical steps verbatim (checkout, pnpm +
node 22, `install --frozen-lockfile`, prettier `--check`, eslint, svelte-kit sync + svelte-check,
build, playwright install chromium, `reddoor-maint audit --only a11y --fail-on-violations`, and the
conditional `pnpm test`). Third-party actions inside it are SHA-pinned with version comments so
Renovate maintains them.

`actions/checkout` in a reusable workflow checks out the **caller's** repo (`github.repository`
resolves to the caller), so the caller's code is what gets linted/built/audited — correct.

### 2. Thin caller — the new `ci` template in `sync-configs`

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  ci:
    uses: reddoorla/.github/.github/workflows/ci.yml@<sha> # v1.0.0
```

`on:` triggers and `permissions:` must stay in the caller (a reusable workflow can't declare its own
triggers). Replaces the ~25-line inline `ci` template in
`src/recipes/sync-configs/templates.ts`.

### 3. Thin Renovate config — the new `renovate-config` template

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>reddoorla/.github:renovate-config"]
}
```

The body that lives in today's per-repo `renovate.json` (config:recommended, Monday schedule,
patch/minor automerge, major no-automerge) moves into `reddoorla/.github/renovate-config.json`.
Changing fleet dependency policy becomes a one-file edit there.

### 4. `self-updating` branch-protection step

`src/recipes/self-updating/index.ts` currently requires the status check **`ci`**. After the swap the
reusable-workflow check reports under a **nested** context name (see Risk below). The branch-protection
step must require the **new** context. The exact string is verified empirically on the starter before
fleet rollout and then hard-coded (expected `ci / ci`).

## ⚠️ Primary risk — the required status-check context changes

A reusable-workflow job reports its check as **`<caller-job> / <reusable-job>`** — i.e. **`ci / ci`**,
not `ci`. Every fleet repo's branch protection currently requires `ci`. The instant the thin caller
lands, the old `ci` context stops reporting and a new `ci / ci` context appears. If branch protection
still requires `ci`, **every open and future PR becomes unmergeable** (waiting on a check that never
arrives).

**Mitigation — lockstep + verify-first:**

- The exact context string is read from the **live checks API on the starter** (first repo migrated)
  before any other repo is touched — never assumed.
- For each repo, the branch-protection update to the new context happens **in the same operation** as
  the workflow swap (the self-updating recipe does both; the swap PR's own run produces the new
  context so the PR can satisfy it).
- Rollout is staged (starter → caltex canary → rest), so a mistake is caught on one repo, not 16.

## Changes in `reddoor-maintenance`

- `src/recipes/sync-configs/templates.ts`: `ci` template → thin caller; `renovate-config` template →
  `extends` preset.
- `src/recipes/self-updating/index.ts`: branch-protection required context `ci` → the new nested
  context.
- Template-shape tests (the M7 package-shape spec, PR #114) updated/extended to assert the thin-caller
  and thin-renovate shapes.
- A changeset; release a new `@reddoorla/maintenance` version carrying the new templates.

## Rollout — staged, verify-first

1. **Create `reddoorla/.github`**: add the reusable workflow + `renovate-config.json`, tag `v1.0.0`,
   capture the tag's commit SHA.
2. **Update `reddoor-maintenance`**: templates + self-updating context + tests; release the new package
   version.
3. **Starter first**: apply the shims, read the real check context from the checks API, fix branch
   protection to match, confirm green end-to-end (CI runs the reusable workflow, PR mergeable,
   Renovate config valid).
4. **caltex canary**: repeat on one live fleet site; confirm a real PR → ci → merge → Netlify deploy.
5. **Remaining 14**: propagate via `self-updating` / `sync-configs`.

## Testing

- **Reusable workflow**: proven by a real caller run (starter PR), not unit tests — workflows aren't
  unit-testable in isolation.
- **Template changes**: extend the existing package-shape tests so the thin-caller `ci` shape and the
  `extends`-only `renovate.json` shape are asserted (guards against a future edit re-inlining them).
- **Check-name handling**: verified against the live starter checks API before fleet rollout; the
  hard-coded context in `self-updating` must match what the API reports.

## Non-goals / out of scope

- The org `.github` community health files (`profile/README.md`, shared issue templates) — free to add
  later, not part of M7.1.
- Folding the heavy audits into a scheduled/deployed-URL profile — that is M7.4/M7.5.
- OpenSSF Scorecard Action / SARIF-to-Security-tab — noted by the research as a cheap security add-on;
  tracked separately, not M7.1.
- Migrating the conformance suite itself — M7.4.

## References

- Roadmap: `docs/superpowers/specs/2026-06-02-fleet-scale-roadmap.md` (M7.1).
- Prior-art research (2026-06-08): GitHub reusable-workflow docs (SHA-pin recommendation), Renovate
  `github-actions` manager + config-presets docs, OpenSSF Scorecard, multi-gitter/all-repos (one-off
  sweeps, relevant to M7.6). Full cited findings in the session research output.
