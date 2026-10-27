---
"@reddoorla/maintenance": patch
---

`sync-configs` and `self-updating` report a site's `.github/workflows/renovate.yml` as drift when its Renovate job can never run: an `if:` that GitHub always evaluates false on the job, on every `renovatebot/github-action` step, or on every `create-github-app-token` step. It used to read clean with cron, pins and App auth intact. The file is now parsed with `js-yaml`, which moves from `devDependencies` to `dependencies`.
