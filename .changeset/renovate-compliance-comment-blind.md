---
"@reddoorla/maintenance": patch
---

Close the comment-blind and quoting gaps in the renovate.yml compliance check (#651 follow-up).

The predicate that replaced byte-matching for `.github/workflows/renovate.yml`
took the FIRST regex hit anywhere in the file — comments included. A canonical
pin, cron, or job body sitting in a `#` comment above the real (wrong) line
read as compliant, and `withRenovatePinsFrom` would scrape a sha out of a
comment like `# old: uses: actions/checkout@1111…1111 # v4` and carry it into
the healed file — a pin downgrade delivered by the exact recipe that exists to
prevent pin downgrades. Every check now runs against a comment-stripped copy,
and `uses:` matching is anchored to the start of a line (only leading
indentation and an optional `- ` marker allowed before it).

Also: `RENOVATE_REPOSITORIES` and `contents: read` now tolerate quoting like
the cron check already did; the permissions check no longer requires
`contents: read` to be the first key under `permissions:`; the pin check
widened from three hardcoded actions to every `uses:` line in the file (a
local `uses: ./.github/actions/x` path ref is correctly never flagged); the
`RENOVATE_USERNAME`/`RENOVATE_GIT_AUTHOR` gap now reports which field failed
instead of folding both into one message; `withRenovatePinsFrom`'s doc comment
now says plainly that the heal is pin-neutral (never orders digests, so it can
heal a site onto its own OLDER pin) rather than implying it prevents
downgrades; `self-updating`'s write loop now writes only the paths that
actually drifted, so a stale `renovate.json` no longer drags an
already-compliant `renovate.yml` into the same PR; and `RENOVATE_ACTION_CONFIG`
is now exported once from `renovate-action.ts` instead of being declared
separately in `sync-configs.ts` and `self-updating/index.ts`.

Re-verified against all 22 fleet `renovate.yml` checkouts: verdicts unchanged
(12 compliant, 10 healed, zero false positives/negatives).
