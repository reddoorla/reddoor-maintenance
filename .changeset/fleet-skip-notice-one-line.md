---
"@reddoorla/maintenance": patch
---

The fleet prep skip notice ("⚠ N site(s) skipped (could not prepare): …") folds the line breaks in a skip reason (git clone's stderr has several) to `/`, so it stays one line and every skipped site after a multi-line reason is still named in the nightly workflows' warning.
