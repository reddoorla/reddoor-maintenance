## 2026-10-16 — The Dropbox file-request uploader lands as the API route's fallback (#1395)

This continues 2026-10-16 — The Dropbox file-request uploader is ported here
and proven by `content_hash`, then held behind the app route. The operator
asked this session to resume once #1388 (`scripts/dropbox.mjs`) had landed,
and it did, at 18:32Z.

**Two routes, one bullet.** The merge from `main` brought #1388's
`CLAUDE.md` bullet, which already called a file request the fallback and
cited item 128. A second bullet for this script would have made a reader
choose between two Dropbox entries, so this one was folded into it: the API
first, "Run `check` first", and only then the file request, named with its
runbook. The bullet's clause "which leaves an open request behind" went,
because a request created with a deadline closed itself (the earlier entry
measured it). The script now imports `dropbox.mjs`'s `contentHash` instead of
keeping its own copy. The six hash values Dropbox reported for this script's
uploads are still pinned in its tests, so they now check the shared function
against a second authority.

**A belief corrected, twice over.** The runbook said a saved environment
value "reaches only later sessions". #1388's e2e entry had already found that
stricter than the truth, and this session showed it again. Its container
booted at 18:46:24Z, after the operator saved new Dropbox credentials at
about 18:20Z. `DROPBOX_ACCESS_TOKEN` was gone and `node scripts/dropbox.mjs
check` printed `granted` for both scopes. A running container keeps the
environment it started with. A new one, including a resumed session's, reads
what was saved. Round 1's docs reviewer flagged the sentence as a major, and
it was fixed.

**What the review changed.**

- **Completion.** A file now counts only when its own commit, from
  `www.dropbox.com`, answered complete. The batch waits for those answers
  rather than the "Finished uploading" text, which a file of that name would
  have matched. A failure after some commits keeps them.
- **Duplicate names** are compared the way Dropbox compares them: NFC, any
  case. Before, `Plan.pdf` and `plan.pdf` both passed, and `dropbox.mjs` had
  the same bug in its round 2.
- **A forgotten uploader name** made the first file the name. `<url> *.pdf`
  then uploaded every file but one and exited 0, and the lost file was in no
  row, so the hash check could not catch it. A name that is a path, or
  contains a slash, is now refused.
- **Files over 128 MiB** are refused, and batches split by bytes as well as
  count. Node cannot build a base64 string past about 384 MiB of input. Round
  2 suspects Chromium's DevTools pipe has a lower limit, near 100 MB a
  message; that is #1396, unmeasured, and it would fail safe.
- **The tests** had a size assertion that passed on the file's name, and an
  untested URL anchor. Both are pinned now, and 30 mutations each turn the
  suite red.

**Proof after the fixes [M].** A new request
(`eyz6ynoxsn251ruu77dl`, deadline 19:38Z) took six files in two batches,
one named with a double space, in 39 s. All six matched Dropbox's size and
`content_hash` through `download_link`. The folder was deleted.

**Honest accounting.** Round 1's correctness reviewer ran the script once
without `--dry-run`, by accident, against a made-up request ID. It reached
Dropbox's page, found no drop zone and exited, sending nothing. Round 2's
seven minors went to issues (#1396–#1401) rather than more pushes, as the
review rule says. The browser half and `main`'s wiring still have no unit
test; the two live runs are their evidence (#1398).

**Still not done.** roalson-interests still carries its own `upload.sh` and
`frbatch.mjs`, and its README documents them. It should point at
`dropbox.mjs` first and this script second.
