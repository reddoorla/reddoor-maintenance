---
"@reddoorla/maintenance": patch
---

match-harness: the commit says what the run did — an upgrade is no longer committed as an install (#760)

Every run committed as `feat: install the matching harness (…)`, including a
run that installed nothing. Measured on 29-navy: three scripts upgraded and
three block regions terminated — 6 files, 436 lines — labelled a first install,
directly above a previous install commit saying exactly the same thing. The
notes told the two apart the whole time; the message is what survives into
`git log`, and 0.95.1's whole job is to make upgrade commits the common case
across the fleet.

The message is now derived from the per-file actions the recipe already
computes. Anything written for the first time is an install; only
replace/terminate is an upgrade; both is both:

- `feat: install the matching harness (…)` — unchanged, byte-for-byte, for a
  pristine install.
- `chore: upgrade the matching harness (N files from a previously shipped version)`,
  with the paths in the body, so `git log` answers "when did this site's
  gate.sh change" without a diff.
- `feat: install and upgrade the matching harness (…)` when one run does both,
  again naming each in the body.

The test asserts the thing that had no coverage: a pristine install and a
re-run over the committed 0.95.0 bodies now produce different subjects. Before
the change both read `feat: install the matching harness (/…`.
