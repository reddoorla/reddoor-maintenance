---
"@reddoorla/maintenance": patch
---

`sync-configs --dry` now agrees with the real run on tracked build artifacts: a `.gitignore` that is already complete but has a tracked `build/` (or other canonically ignored directory) file is reported as `.gitignore` drift instead of `no changes needed`. The dry run also prints machine-readable lines after the human text: `DRIFT <repo> <path>` for each file the real run would change, `CLEAN <repo>` when nothing would, `SKIPPED <repo> <reason>` for each site fleet prep dropped or could not plan, and one `SYNC_CONFIGS_DRIFT drifted=N clean=M skipped=K total=T` summary. Fleet lines name the site's `owner/repo`, not its slug.
