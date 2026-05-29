---
"@reddoorla/maintenance": minor
---

`reddoor-maint audit` now shows live progress while audits run, using `listr2` for spinners. Single-site runs show one spinner per audit type (e.g. `lighthouse: P=87 A=95 BP=78 SEO=100 (32s)`); fleet runs (`--fleet`) show one spinner per site with an `N/4 audits` counter. Audits still run fully in parallel — the spinner layer is presentation-only. `--write-airtable` gets its own progress step (`Wrote to Websites[Acme] (4 audit types)`).

Behavior preserved: `--json` mode is silent (no spinner output, clean JSON on stdout), non-TTY contexts fall back to one-line-per-task transitions (CI logs, file redirects), and the final result table / JSON still prints to stdout exactly as before.
