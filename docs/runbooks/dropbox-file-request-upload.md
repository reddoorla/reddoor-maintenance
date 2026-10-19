# Runbook — Putting a binary file in Dropbox from a cloud session

**Try the API first: `node scripts/dropbox.mjs check`.** When it names the
account and prints `granted` for `files.content.write`, upload with
`node scripts/dropbox.mjs upload <folder> <file…>` and stop reading here.
That route (#1388, Operator decisions 127) overwrites in place, keeps the
file's own name and checks every `content_hash` itself.

**Use `scripts/dropbox-file-request-upload.mjs` only when the API cannot
upload**: `check` stops before naming the account (`DROPBOX_APP_KEY`,
`DROPBOX_APP_SECRET` or `DROPBOX_REFRESH_TOKEN` missing or refused), or it
prints `MISSING` for `files.content.write`. If only `file_requests.write` is
missing, `dropbox.mjs upload` still works; use it. The variables can be
missing from a container that started before they were saved. A running
container keeps the environment it started with, while a new session, or
this one after its container restarts, reads the saved value (2026-10-16: a
container booted at 18:46Z saw values saved at about 18:20Z). This is the
fallback (Operator decisions 128). The Dropbox connector creates only UTF-8
text files (`create_file`), but a Dropbox **file request** needs no secret at
all. The connector creates one on the destination folder, the script fills
its public upload page in headless Chromium, and the connector then verifies
and renames what arrived.

## Steps

1. **Look at the destination first** with the connector's `list_folder`
   (`recursive: false`). Dropbox stores each upload as
   `<uploader-name> - <file>`, and it never overwrites. If that name is taken
   and the bytes differ, the new file lands as
   `<uploader-name> - YYYY-MM-DD HH.MM.SS - <file>`. If the bytes are
   identical, nothing new appears, though the request still counts the
   upload. Prefer a folder where none of the expected names exist yet.

2. **Create the request with a deadline** using `create_file_request`:

   ```json
   {
     "title": "<what> (temporary, Claude upload)",
     "destination": "/Clients/<client>/<folder>",
     "deadline": "<about an hour from now, RFC3339 UTC>",
     "description": "Temporary request for one Claude session's upload. It stops accepting uploads at its deadline."
   }
   ```

   Leave `deadline_allow_late_uploads` out. The connector can create a
   request but cannot close one, and
   `node scripts/dropbox.mjs close-request <id>` works only when `check`
   printed `granted` for `file_requests.write`.
   A request with no deadline stays open until someone closes it by hand
   under Dropbox → File requests. Four were open until 10-13, three of them
   since 2026-09-29 and one since 10-08 (`docs/BACKLOG.md` item 81), and the
   10-13 sign-off upload left a fifth (`0nohnhi2368naltaor5k`). Dropbox accepts a
   deadline only on eligible plans; the Reddoor Creative team account is one
   (10-16: `rwq45cqgv3weniwpv46n` and `jdgy7hgrr2hx22f3thh5`). The destination
   cannot be the team root or a personal root such as `/Tucker Lemos`; a
   missing child folder is created.

   At the deadline the request's page stops taking uploads. It reads "This
   file request has been closed, deleted, or never existed", and the script
   fails with "no drop zone". The connector's `is_open` can lag behind the
   page: `jdgy7hgrr2hx22f3thh5` (deadline 17:30Z) still read `is_open: true`
   at 17:31Z and read `false` at 17:51Z, while `rwq45cqgv3weniwpv46n`
   (deadline 17:50Z) already read `false` at 17:51Z. An audit for open
   requests should therefore count a request whose `deadline` has passed as
   closed.

3. **Run the script** from a checkout with dependencies installed (a
   worktree needs its own `pnpm install --frozen-lockfile`). It loads
   Chromium through this repo's `@playwright/test`, so no scratch install of
   `playwright-core` is needed:

   ```sh
   UPLOADER_EMAIL=<the connector's who_am_i email> \
     node scripts/dropbox-file-request-upload.mjs <request url> "Reddoor (Claude)" out/*.pdf
   ```

   It prints one row per file (bytes, `content_hash`, expected name, rename
   target). It uploads in batches of at most five files and 128 MiB, one page
   per batch, and prints `committed` or `FAILED` for each file as its batch
   ends. It exits 0 when every file committed, 1 when any failed, and 2 on
   bad arguments: among them a file over 128 MiB (use `dropbox.mjs`), two
   names Dropbox would treat as one, and an uploader name that is itself a
   file, which usually means the name was left out. `--dry-run` prints the
   table and uploads nothing. Dropbox emails the request's owner about each
   upload.

4. **Verify with the connector**, because the script cannot see the folder.
   `list_folder` (`recursive: false`) gives each file's size.
   `download_link` (up to 25 entries per call) gives its `content_hash`;
   `get_file_metadata` and `list_folder` do not. Call it on each new file and
   on each file already named as a row's expected name. Never fetch the URL
   it returns, and do not paste it anywhere: it is single-use, and anyone
   holding it can read the file. Each row's size and `content_hash` must
   equal a file's. Match by hash, not by name, because of step 1. A row that
   no file in the folder matches did not arrive; a row whose bytes were
   already there under its expected name matches that older file.

5. **Rename** each file to the table's rename target with `move` in the same
   folder. A move can answer `in_progress`; poll `check_job_status` until it
   completes. This route cannot replace a file: if the rename target already
   exists, the move fails that entry with a destination conflict. Do not set
   `autorename`, which gives the file a different name. Move the old file
   aside first, or ask before deleting it.

## How the upload page behaves (measured 2026-10-16)

- Setting the hidden file input (`#uploader-file-field`) does nothing (found
  2026-09-29). A synthetic `dragenter`, `dragover` and `drop` carrying a
  `DataTransfer`, dispatched on the drop zone's container, works.
- The name (`input[name="name"]`) and email (`input[name="email"]`) fields
  appear only after a drop.
- Uploading sends 4 MiB blocks to `dl-web.dropbox.com/put_block_returning_token`,
  then one `POST /drops/commit_file_request_by_token?name=<file>` per file,
  which answers 200 `{"status": "complete"}`. The page then shows "Finished
  uploading". The script waits for every file's commit, up to max(120 s,
  10 s per MB) per batch, and counts a file as committed only when its own
  commit answered that way; a commit already seen still counts if the batch
  fails later. It does not rely on the page text, which a file named
  "Finished uploading…" would match. The commit does not name the stored
  file, which is why step 4 matches by hash.
- The 09-29 version (roalson-interests
  `tools/listing-packages/build/upload.sh` and `frbatch.mjs` at `90c6d9e`,
  removed in roalson-interests#302) found no completion state and slept
  max(45 s, 5 s per MB) per batch. On 10-16, six files in two batches took
  40 s in all, and 39 s with the commit-based wait.
- `content_hash` is the SHA-256 of the concatenated SHA-256 digests of each
  4 MiB block. The unit tests pin six values that Dropbox reported for
  files sent through a file request, from 1 byte to 8,388,610 bytes (one to
  three blocks).

## Not yet tried

- The laptop. It should work there when Playwright's Chromium is installed;
  the script uses the proxy only when `HTTPS_PROXY` is set. Per `CLAUDE.md`
  ("No local browser while agents run"), run it there only in a session with
  no agents live.
- Large files. Each batch passes its files into the page as base64 in one
  message, so memory is several times the batch's size, and Node cannot make
  a string past about 512 M characters (a 384 MiB file). The 128 MiB cap
  stays well under that. The largest file tried is 8.4 MB; the 09-29 script
  moved 46 PDFs of about 6 MB each.
