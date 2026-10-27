---
"@reddoorla/maintenance": patch
---

`sync-configs` and `self-updating` report a site's `.github/workflows/renovate.yml` as drift when its Renovate job can never run: an `if:` that GitHub always evaluates false on the job, on every `renovatebot/github-action` step, or on every step that mints the token the Renovate step uses. It used to read clean with cron, pins and App auth intact. As with any drift there, `sync-configs` and `self-updating` rewrite the file from the template, carrying the site's digest pins forward. The file is now parsed with `js-yaml`, which moves from `devDependencies` to `dependencies`.
