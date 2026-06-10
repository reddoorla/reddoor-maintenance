---
"@reddoorla/maintenance": patch
---

fix(audits): kill the whole process group on a spawn timeout (detached when a timeout is set + `process.kill(-pid)` with SIGTERM→SIGKILL escalation), so a timed-out audit no longer orphans vite/Chromium. Timeout-less streaming calls stay attached so Ctrl-C still works. Also caps captured stdout/stderr.
