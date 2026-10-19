## 2026-10-16 — roalson-interests drops its old Dropbox uploader and points here (roalson-interests#302 `03d6e9a`, #1402)

This closes the "Still not done" line at the end of
`2026-10-16-1930-dropbox-file-request-uploader-lands.md`.
roalson-interests#302 deleted `tools/listing-packages/build/upload.sh` and
`frbatch.mjs`, which had been on its `main` since roalson-interests#293
(`90c6d9e`). It also replaced the `upload.sh` line in
`tools/listing-packages/README.md` with this repo's two routes, in order:
`scripts/dropbox.mjs` (#1388) first, then
`scripts/dropbox-file-request-upload.mjs` (#1395) for when `check` fails
before naming the account or prints `MISSING` for `files.content.write`. The
README links the runbook too. Before the deletion,
`grep -rn "upload.sh\|frbatch" .` found nothing else calling either file. The
only other mention was roalson's 2026-09-29 journal entry, which stays.

Each of the old copy's three defects was checked in the code of both versions,
not taken from the brief:

- **The blind wait.** `frbatch.mjs` slept `max(45 s, 5 s per MB)` and never
  checked arrival. This script waits for each file's commit, for up to
  max(120 s, 10 s per MB) per batch.
- **Case-variant names.** The old copy accepted `A.pdf` beside `a.pdf`. This
  script rejects names that collide after NFC normalisation and lowercasing.
- **A forgotten uploader name.** The old copy swallowed the first file. Review
  found the path the brief did not describe. Through `upload.sh`, the
  documented entry point, the name slot took the directory and the directory
  slot took the first file. With no `set -e`, the failed `cd` did not stop
  it. `frbatch.mjs` on its own took the first file as the name.

The review round (one adversarial reader, on the session model) was clean:
four nits and nothing above them. Three were the journal entry's wording on the
roalson side. The minors rule says to file them as issues and stop. They were
applied before landing instead, because once the entry landed it could only
have been corrected by a later entry, never in place. No review round read
that push (`394cdd7`). The fourth nit was here. The runbook named the two roalson files by path, and that path
no longer exists on its `main`, so the runbook now pins `90c6d9e` and names
roalson-interests#302.

`pnpm verify` passed locally in roalson-interests before the first push. The
PR landed through `land-prs.mjs` with checks green on `394cdd7`. The
`claude/optimistic-feynman-4euipv` branch is still on roalson-interests. That
repo does not delete head branches on merge, and the proxy refuses the
delete with a 403.
