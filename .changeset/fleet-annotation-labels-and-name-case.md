---
"@reddoorla/maintenance": patch
---

The fleet workflows escape site labels (`%` → `%25`, CR → `%0D`) in every annotation that names a site: smoke's never-measured error, form-e2e's coverage, budget and probed-nothing lines, config-drift's skipped and not-closing warnings, and prismic-sync's held, failed and refusal lines. A JSON or module inventory with two names that differ only in case (`Baz` and `baz`) is refused at load, exit 2, since both would share one checkout on a case-insensitive filesystem (#2006). An explicit name against a name derived from a nameless site's repo (`Foo` and a derived `foo`) is still not checked.
