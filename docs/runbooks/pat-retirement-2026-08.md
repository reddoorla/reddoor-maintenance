# PAT retirement — rotation runbook (2026-08)

The org-wide classic PAT stored as the `RENOVATE_TOKEN` org secret is due for
removal + rotation (~2026-08-16, per the 2026-08-02 architecture review).
Renovate itself moved to the `reddoor-renovate` GitHub App on 08-02; this
runbook covers the six remaining workflow consumers plus the dashboard, and
the safe ordering. **Rotating the PAT before step 1 silently kills
`github-signals` and `protection-audit` — the workflows stay green while the
cockpit's GitHub columns go stale and gap alarms mute.**

## Consumer map (before migration)

| Consumer                                                  | Needs                                                          | App covers today?                                     |
| --------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| fleet-security → Dependabot-alerts read                   | Dependabot alerts: read                                        | ✅                                                    |
| fleet-security → `renovate-dispatch --fleet`              | Actions: write (workflow dispatch)                             | ❌                                                    |
| fleet-security → `protection-audit --org`                 | Actions: read + Administration: read (`security_and_analysis`) | ❌                                                    |
| fleet-lighthouse → `github-signals --fleet`               | Actions: read (runs/jobs)                                      | ❌                                                    |
| release.yml → checkout token + changesets `GITHUB_TOKEN`  | contents + pull-requests write                                 | ✅                                                    |
| Dashboard Netlify env (`RENOVATE_TOKEN`, also `GH_TOKEN`) | Actions: write + fleet reads (request-path)                    | n/a — long-lived server env, App tokens expire hourly |

## Order of operations

1. **[operator, ~2 clicks] Expand the `reddoor-renovate` App's repository
   permissions**: add **Actions: Read and write** and **Administration:
   Read-only** (App settings → Permissions & events), then approve the
   permission request on the reddoorla installation (Org settings → GitHub
   Apps). Everything else the consumers need is already granted
   (contents/PR write, Dependabot alerts read, issues write).
2. **[agent/operator] Verify from the migration branch** _after_ step 1:
   `gh workflow run fleet-security.yml -r <branch>` and
   `gh workflow run fleet-lighthouse.yml -r <branch>`; confirm in the run
   logs that the Dependabot-alerts path reads (not the `pnpm audit`
   fallback), `renovate-dispatch` dispatches without warnings,
   `protection-audit` prints its `PROTECTION_AUDIT gaps=` line, and
   `github-signals` prints a write summary — then check an Airtable Websites
   row's GitHub columns actually refreshed.
3. **[operator or merge-authority] Merge the migration PR.** Do NOT merge
   before step 1 — `protection-audit` under an under-permissioned token files
   false "coverage gap" issues, and `github-signals` goes silently stale.
4. **[operator] Replace the dashboard's Netlify env tokens**: create a NEW
   fine-grained PAT scoped to reddoorla repos with **Actions: write** (the
   Trigger-Renovate + fleet-refresh buttons) and metadata/contents read (the
   `GH_TOKEN` request-path reads), and set it as `RENOVATE_TOKEN` + `GH_TOKEN`
   in the dashboard site's Netlify env. (Cleaner long-term: teach the two
   Netlify functions to mint App tokens per-request — follow-up, not
   required for rotation.)
5. **[operator] Delete the `RENOVATE_TOKEN` org secret and revoke/rotate the
   old PAT.** The workflows no longer read it after step 3; the
   protection-audit and github-signals steps carry empty-token guards that
   fail LOUDLY (never silently) if a mint ever breaks.
6. **Watch the next nightly**: fleet-security (06:00 UTC) and
   fleet-lighthouse (08:00 UTC) both green, no new tracking issues, cockpit
   GitHub columns fresh. Also confirm the next release cycle: the "Version
   Packages" PR now opens as `reddoor-renovate[bot]` and its `build` check
   still goes green on its own (the App push fires ci.yml exactly as the PAT
   push did).

## Also-check list on rotation day

- `~/.config/reddoor-maint/credentials.env` — if its `RENOVATE_TOKEN` /
  `GITHUB_TOKEN` values are the old PAT, replace with the new fine-grained
  PAT (local CLI runs fall back `RENOVATE_TOKEN` → `GITHUB_TOKEN`).
- Any site-repo secrets named `RENOVATE_TOKEN` are legacy — `self-updating`
  stopped planting them when Renovate moved to the App; deleting them is
  cleanup, not migration.
