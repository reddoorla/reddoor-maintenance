---
"@reddoorla/maintenance": patch
---

fix(dashboard): Trigger Renovate now dispatches via the GitHub REST API instead of the `gh` CLI

The Trigger Renovate button (the dashboard's first request-path GitHub write) shelled out to the `gh` CLI through `makeGitHub`. That works in CI/dev but the Netlify Functions (AWS Lambda) runtime has no `gh` binary, so every live dispatch threw `ENOENT` and the endpoint returned 502. The handler now uses a new `fetch`-based `makeGitHubRest` client (default-branch lookup + `workflow_dispatch`), which is all the Lambda runtime needs.
