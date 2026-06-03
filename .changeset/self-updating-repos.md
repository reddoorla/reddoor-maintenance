---
"@reddoorla/maintenance": minor
---

M1: self-updating repos. New `reddoor-maint self-updating [site]` recipe bootstraps a repo to keep itself current — writes a unified CI workflow (format+lint, typecheck, build, a11y via `audit --only a11y --fail-on-violations`; no lighthouse), a nightly self-hosted Renovate workflow, and `renovate.json` (patch/minor auto-merge on green, majors → PR); pushes, opens a PR, enables branch protection + auto-merge, and sets the `RENOVATE_TOKEN` secret. The three files join the `sync-configs` canonical set so the CI standard stays unified fleet-wide.

- New `src/github/` (gh CLI wrappers + config); `GITHUB_TOKEN` + `RENOVATE_TOKEN` in credentials.env.
- New Airtable Websites "Git repo" field → `WebsiteRow.gitRepo` → `Site.gitRepo` (falls back to the checkout's origin remote for local runs).
- `audit --fail-on-violations` (a11y CI gate; exits non-zero on any a11y violation).
