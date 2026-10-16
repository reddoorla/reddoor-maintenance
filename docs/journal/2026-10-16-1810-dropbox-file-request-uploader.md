## 2026-10-16 — The Dropbox file-request uploader is ported here and proven by `content_hash`, then held behind the app route (#1387, branch `claude/tender-bohr-eh2rwb`)

> Superseded in part by 2026-10-16 — The Dropbox file-request uploader lands as the API route's fallback.

The brief: put the Dropbox file-request uploader where sessions look for
tools, in this repo, instead of in a client repo. The Dropbox connector writes
only UTF-8 text, and the environment's `DROPBOX_ACCESS_TOKEN` is a
short-lived `sl.` token that is usually dead by the time a session reads it.
The route that works for a PDF or an image is a file request: the connector
creates one, a headless Chromium fills its public page, and the connector
verifies and renames what arrived. `scripts/dropbox-file-request-upload.mjs`
is that route, with a runbook (`docs/runbooks/dropbox-file-request-upload.md`)
and one `CLAUDE.md` line. All of it sits on `claude/tender-bohr-eh2rwb`
(`3926b85f`), unmerged, for the reason at the end.

**A belief corrected before any code.** The brief said `upload.sh` and
`frbatch.mjs` were absent from roalson-interests `main`. They have been there
since roalson-interests#293 (`90c6d9e`, 10-12), byte-identical to the five
branches the brief named. The reason to move them still held: nothing here
pointed to them.

**The page has a completion state after all.** The 09-29 script slept
max(45 s, 5 s per MB) per batch because "the page shows no completion state a
script can read". On 10-16 it does. Each file gets one
`POST /drops/commit_file_request_by_token?name=<file>`, which answers 200
`{"status": "complete"}`, and about two seconds later the page reads
"Finished uploading". The script now waits for that text, up to max(120 s,
10 s per MB), and counts a file only when its commit answered that way. Six
test files in two batches took 40 s in all. Under the old sleep, the waiting
alone would have taken at least 90 s. The name and email
fields are `input[name="name"]` and `input[name="email"]`, and they appear
only after a drop. The old script's Chrome 141 user-agent override and its
cookie-banner click were not needed this time; the click stays because it
costs five seconds when there is no banner.

**Verification is by hash, and `download_link` is where the hash is.**
`list_folder` and `get_file_metadata` give sizes but no `content_hash`.
`download_link` returns it alongside a single-use URL that nobody needs to
fetch. The script prints each local file's `content_hash` (the SHA-256 of the
concatenated SHA-256s of each 4 MiB block). The test was written before the
script, with its first expected value taken from Dropbox for a 1,000-byte
probe file. Six values Dropbox reported are pinned now, from 1 byte to
8,388,610 bytes: exactly 4 MiB is one block with no empty block after it,
4 MiB + 1 is two, and 8 MiB + 2 is three. Eight live uploads matched Dropbox
on size and hash.

**Names cannot be trusted, which is why the hash matters.** Dropbox never
overwrites through a file request. Different bytes under a taken name landed
as `Reddoor (Claude) - 2026-10-16 16.43.07 - uploader-test-g-2000.bin`.
Identical bytes produced no new file, though the request's `file_count` still
went up by one. The commit's answer does not name the stored file, so the
script cannot report it. The runbook says to look at the destination first and
to match uploads to files by hash.

Mutations run against the tests, each turning at least one red:

| Mutation                                       | Result               |
| ---------------------------------------------- | -------------------- |
| M1 `BLOCK` is 4,000,000 bytes, not 4 MiB       | red (4 of 20 failed) |
| M2 outer hash fed hex strings, not raw digests | red (7 of 20)        |
| M3 trailing partial block dropped              | red (6 of 20)        |
| M4 plain SHA-256 of the whole file             | red (8 of 20)        |
| M5 separator `-` instead of `␠-␠`              | red (2 of 20)        |
| M6 `UPLOADER_EMAIL` not required               | red (2 of 20)        |
| M7 duplicate basenames allowed                 | red (1 of 20)        |
| M8 timeout floor 45 s                          | red (1 of 20)        |
| M9 `--dry-run` falls through to the upload     | red (1 of 20)        |
| M10 a commit counts on any 200 body            | red (1 of 20)        |
| M11 a commit counts whatever its status        | red (1 of 20)        |

The browser half (`uploadBatch`) has no unit test; the live runs are its
evidence.

**The deadline, measured rather than assumed.** The runbook tells every
session to give a request a deadline, because the connector cannot close
one. The test request `jdgy7hgrr2hx22f3thh5` had a 17:30Z deadline. At 17:31Z
its page read "This file request has been closed, deleted, or never
existed". The script, run against it as a negative control, exited 1 with
"no drop zone", and no file arrived. Yet `get_file_request` still said
`is_open: true` at 17:31Z. It said `false` at 17:51Z, and so did the other
session's style-guide request (`rwq45cqgv3weniwpv46n`), one minute after its
own 17:50Z deadline. So the page closes at the deadline, and `is_open`
catches up within minutes. An audit like item 81, which read `is_open`,
should count any request whose `deadline` has passed as closed. The same
17:51Z listing shows `0nohnhi2368naltaor5k`, the 10-13 sign-off request that
P1-46's status line still asks someone to close, already reading
`is_open: false`.

**The token, and the operator's two messages.** At about 16:30Z the operator
said the Dropbox token had been updated. This container still held the old
value: same `sl.` prefix, 401 `invalid_access_token` at 16:31Z. An
environment variable saved mid-session reaches only sessions started after
it. At about 16:45Z the operator said a Dropbox app with a refresh token,
built elsewhere, should supersede this "unless you see a reason to keep both".
I asked (Operator decisions 128): the file request needs no secret, only the
connector, so it still works in any session the new credentials have not
reached. The answer was to land it as the fallback. Then: pause it until the
app work lands, or the two will conflict. So no PR is open for the script.
The app route reached `main` as Operator decisions 127 (#1389) while this
entry was being written: `scripts/dropbox.mjs` in #1388, held as a draft until
the refresh token is authorized again with the write scopes. Its `CLAUDE.md`
bullet says never to use file requests, so the two bullets must be made to
agree when this one lands. Line 128 has the steps to resume: merge `main` in, put the `CLAUDE.md` line
after the API route's as its fallback, point the runbook at the API route,
re-run tests and lint, open the PR with the table above, review, land.

**Not done here.** roalson-interests still carries its own `upload.sh` and
`frbatch.mjs`, and its README documents them. Once the script here lands, that
README should point here instead. The uploader email of earlier runs was never
recorded. This session used the account's own address, the one `who_am_i`
returns, and the runbook says to do the same. The laptop and files beyond
8.4 MB are untried. The eleven test files and their folder,
`/Tucker Lemos/Claude uploader test 2026-10-16`, were deleted at the end;
Dropbox keeps them under Deleted files.
