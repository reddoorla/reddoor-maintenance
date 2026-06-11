---
"@reddoorla/maintenance": patch
---

fix(a11y): the audit's transient `.reddoor-a11y-spec-*` dir is now removed on every catchable exit (try/finally), and `.reddoor-a11y-spec-*/` is in the canonical gitignore — so a timeout-killed run never leaves untracked files in a fleet repo's tree.
