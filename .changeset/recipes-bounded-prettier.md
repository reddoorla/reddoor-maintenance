---
"@reddoorla/maintenance": patch
---

recipes: health-endpoint and smoke-suite format with the site's own prettier, bounded (#737)

Both recipes called `formatWithPrettier` with neither `bin` nor `timeoutMs`,
which the helper turns into `pnpm exec prettier --write …` with no timeout and
no process group to kill. On `--fleet` — the normal input, since
`prepareFleetSites` clones and never installs — every site arrives without
`node_modules`, so `pnpm exec` first ran a full, unbounded `pnpm install` in a
live client repo and then, where that install left no prettier of its own, fell
through to the CALLING repo's binary and exited 0: success reported for a format
the target never did.

Both now take the pattern prismic-ci and match-harness (#733) already use:
resolve the target's own `node_modules/.bin/prettier` positively, invoke it by
absolute path under a 60s timeout, and when there is none, push the flag note
and spawn nothing. smoke-suite resolves after its own `pnpm install` step so a
site that just gained its devDependencies still gets formatted.

Intended consequence: on `--fleet` both recipes now return the prettier flag
note for every fresh clone. That note is the honest answer, not noise.
