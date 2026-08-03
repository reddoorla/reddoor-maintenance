# Renovate GitHub App identity — migration runbook

Renovate currently authenticates as the operator's PAT (`RENOVATE_TOKEN`,
identity **tucksravin**). That is the root problem behind the 2026-07-26
incident's forensics cost: the audit trail cannot distinguish bot from human,
so proving _who_ armed auto-merge took timeline archaeology. It is also a
fleet-write credential sitting in every workflow run, and every Renovate cron
across 20+ repos drains the operator's own 5,000/hr API quota.

The fix: Renovate authenticates as a dedicated **GitHub App**
(`reddoor-renovate`), installed org-wide. Identity separation, per-repo-scoped
short-lived tokens, central revocation (delete one key), and an API quota pool
that scales with repo count and is separate from the operator's.

This also **unlocks a review requirement later** if ever wanted: GitHub's
self-approval ban is per-identity, so once automation AUTHORS PRs as the App,
the operator becomes a valid approver for them. (Not part of this migration —
the merge-authority policy is unchanged.)

## Phase 1 — operator, ~20 minutes (cannot be done headless)

1. **Create the App** at
   <https://github.com/organizations/reddoorla/settings/apps/new>:
   - Name: exactly **`reddoor-renovate`** (the slug is baked into the workflow
     template's `RENOVATE_USERNAME`/`RENOVATE_GIT_AUTHOR`).
   - Homepage URL: `https://github.com/reddoorla/reddoor-maintenance` (required
     field, content irrelevant).
   - **Uncheck “Active” under Webhook** (no webhook).
   - **Repository permissions** (Renovate's documented set for app-based
     self-hosting, plus what THIS fleet needs):
     | Permission        | Access         | Load-bearing for                                           |
     | ----------------- | -------------- | ---------------------------------------------------------- |
     | Checks            | Read and write | seeing `ci / ci` green before self-merge                   |
     | Commit statuses   | Read and write | same, for status-API checks                                |
     | Contents          | Read and write | pushing `renovate/*` branches + performing merges          |
     | Issues            | Read and write | Dependency Dashboard + config-error issues                 |
     | Pull requests     | Read and write | opening/updating/merging PRs                               |
     | Workflows         | Read and write | the preset pins action digests in `.github/workflows/`     |
     | Administration    | Read-only      | reading branch protection (`strict` → rebase-before-merge) |
     | Dependabot alerts | Read-only      | `vulnerabilityAlerts` / `osvVulnerabilityAlerts`           |
     | Metadata          | Read-only      | mandatory                                                  |
   - **Organization permissions**: Members → Read-only.
   - “Where can this GitHub App be installed?” → **Only on this account**.
2. On the new App's page: note the **App ID**, then **Generate a private key**
   (downloads a `.pem`).
3. **Install** the App on reddoorla → **All repositories** (this is what makes
   future repos auto-covered — “Only select repositories” would re-create the
   per-repo onboarding gap this migration removes).
4. **Publish the credentials org-wide** (all-repos visibility, so no repo ever
   needs per-repo setup):

   ```sh
   gh variable set RENOVATE_APP_ID --org reddoorla --visibility all --body '<APP_ID>'
   gh secret   set RENOVATE_APP_PRIVATE_KEY --org reddoorla --visibility all < reddoor-renovate.*.pem
   ```

5. Delete the downloaded `.pem` (the org secret is now the only copy that
   matters; a re-generate on the App page rotates it).

## Phase 2 — agent finalize (blocked on Phase 1)

1. Fill the one placeholder in `src/recipes/sync-configs/templates.ts` and the
   `tests/fixtures/sync-clean` copy: replace `312185038` with
   `gh api 'users/reddoor-renovate[bot]' --jq .id`.
2. Land this branch (PR is draft until then; CI + tests green).
3. Roll the fleet: per-repo PRs updating `.github/workflows/renovate.yml` to
   the new template (same mechanics as the 2026-08-01 cron sweep — enumerate
   consumers from the API, never a hand list). Update **reddoor-starter**'s
   copy too (template repo: clones inherit it; `self-updating` would otherwise
   PR the correction on every new site at launch).
4. **Real-run check** on one repo: `gh workflow run renovate.yml`, confirm the
   run is green, the Dependency Dashboard edit and any PR are authored by
   **reddoor-renovate[bot]**, and a patch-level PR self-merges on the next run.
5. Update the `new-site` skill's line “RENOVATE_TOKEN needs nothing — org
   secret, all-repos visibility” to reference the App variables instead.

## Rollback

`RENOVATE_TOKEN` (org secret) is deliberately **left in place** for ≥2 weeks:
reverting a repo is just restoring the previous `renovate.yml` (git revert of
the sweep PR). Remove the PAT from org secrets only after a full clean cycle,
and rotate it at that point (it has been the long-lived fleet-write credential
for months).

## Known limits / non-goals

- **Changelog fetching does not regress**: an installation token has read
  access to all public github.com repos, and Renovate feeds the platform token
  to its changelog fetcher automatically. `GITHUB_COM_TOKEN` is a
  non-github.com-platform concern — not needed here.
- The existing per-repo `RENOVATE_TOKEN` secrets (planted by older
  `self-updating` runs) become inert; cleanup is optional cosmetics.
- The maintenance repo's own workflows (`fleet-security`, `daily-reports`, …)
  keep using the PAT for API reads — that's a separate, narrower migration if
  ever desired.
- Merge policy is UNCHANGED: majors still require a human; patch/minor still
  self-merge from inside Renovate's run under the org preset's `packageRules`.
