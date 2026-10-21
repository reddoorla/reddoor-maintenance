---
"@reddoorla/maintenance": patch
---

`FLEET_SMOKE_UNMEASURED` counts any smoke result without a verdict, not only the timeout's `smoke: NOT MEASURED` prefix (#1611). A spawn that throws (`EACCES`), which `runOneAudit` turns into `smoke: unexpected error`, and a skip whose deps would not install now count, and the nightly reds with "never measured" and the site named. A site with no `test:smoke` script is marked not applicable and does not count.
