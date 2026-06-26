---
"@reddoorla/maintenance": minor
---

New `selftest email [site]` CLI command: preview any report email (announcement/maintenance/testing/launch) for a site — or `--all` maintenance sites — to yourself (`--to` to override; defaults to `OPERATOR_EMAIL`), with `--dry-run` to render to disk. No Airtable side effects. Faithfulness via a shared `renderReportEmail` seam used by both the real send path and the self-test, plus a shared `defaultReportSubject`.
