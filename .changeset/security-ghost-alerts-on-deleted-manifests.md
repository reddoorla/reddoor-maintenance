---
"@reddoorla/maintenance": patch
---

security: a Dependabot alert on a manifest GitHub no longer tracks is a warn, not a permanent fail (#702)

GitHub's dependency graph retains a manifest after the file is deleted from
the default branch and keeps filing advisories against that frozen snapshot.
`erp-industrial` and `data-dynamiq` each sat red for five days on a high
against a `package-lock.json` deleted months earlier, while their real
`pnpm-lock.yaml` pinned a clean version. No dependency update can close such an
alert, and the cockpit read the red as "Renovate exhausted" — the wrong
diagnosis.

The audit was structurally blind: `mapDependabotAlert` dropped
`dependency.manifest_path` and folded `relationship: "inconclusive"` (GitHub's
own stamp on these) to null.

- `DependabotAlert` now carries `manifestPath` and keeps `"inconclusive"`.
- `GitHubRest.manifestExists(repo, path)` resolves a path against the default
  branch via the contents endpoint: 200 → true, 404 → false, anything else
  throws.
- `dependabotAudit` resolves each distinct manifest once per audit. Alerts whose
  manifest is gone go to `details.ghostAdvisories`, are excluded from the
  severity tallies, and produce one line: `N alert(s) on a manifest GitHub no
  longer tracks (package-lock.json) — dismiss as inaccurate`. Ghosts alone are
  `warn`; live counts keep their own status and the line is appended.
- Fail-loud on every uncertainty: no `manifest_path`, a lookup that throws, or
  injected deps with no lookup all count the alert exactly as before.

A site with no ghosts keeps its summary byte-for-byte.
