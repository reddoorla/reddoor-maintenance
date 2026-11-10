---
"@reddoorla/maintenance": patch
---

`dropbox-file-request-upload` keeps a file's `{"status":"complete"}` commit answer once it has one, so a later answer for the same file (a 403 when the page re-sends a whole commit batch after another file's 5xx) no longer reports a committed file FAILED (#1994).
