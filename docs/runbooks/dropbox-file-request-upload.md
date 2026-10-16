# Runbook — Putting a binary file in Dropbox from a cloud session

**Use `scripts/dropbox-file-request-upload.mjs` when the session has no
working Dropbox API credentials.** It is the fallback route. The operator is
setting up a Dropbox app with a refresh token (Operator decisions 127), and
once that lands, the API is the first choice wherever its credentials work.

The Dropbox connector creates only UTF-8 text files (`create_file`). Until
now the environment's `DROPBOX_ACCESS_TOKEN` was a short-lived `sl.` token,
which Dropbox expires four hours after issue, so the value a session started
with was usually dead: it answered 401 `invalid_access_token` on 2026-09-29,
10-13 and 10-16. A new value saved in the environment's settings reaches only
sessions started after the save. What needs no secret at all is a Dropbox
**file request**. The connector creates one on the destination folder, the
script fills its public upload page in headless Chromium, and the connector
then verifies and renames what arrived.

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
   request but cannot close one, and a request with no deadline stays open
   until someone closes it by hand under Dropbox → File requests. Four stayed
   open from 2026-09-29 to 10-13 (`docs/BACKLOG.md` item 81), and the 10-13
   sign-off upload left a fifth (`0nohnhi2368naltaor5k`). Dropbox accepts a
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
   target), uploads in batches of five, one page per batch, and then prints
   `committed` or `FAILED` for each file. It exits 0 when every file
   committed, 1 when any failed, and 2 on bad arguments. `--dry-run` prints
   the table and uploads nothing. Dropbox emails the request's owner about
   each upload.

4. **Verify with the connector**, because the script cannot see the folder.
   `list_folder` gives each new file's size. `download_link` (up to 25
   entries per call) gives its `content_hash`; `get_file_metadata` and
   `list_folder` do not. Never fetch the URL that `download_link` returns: it
   is single-use, and anyone holding it can read the file. Each file's size
   and `content_hash` must equal a row of the table. Match by hash, not by
   name, because of step 1. A row that no file matches did not arrive.

5. **Rename** each file to the table's rename target with `move` in the same
   folder. A move can answer `in_progress`; poll `check_job_status` until it
   completes.

## How the upload page behaves (measured 2026-10-16)

- Setting the hidden file input (`#uploader-file-field`) does nothing (found
  2026-09-29). A synthetic `dragenter`, `dragover` and `drop` carrying a
  `DataTransfer`, dispatched on the drop zone's container, works.
- The name (`input[name="name"]`) and email (`input[name="email"]`) fields
  appear only after a drop.
- Uploading sends 4 MiB blocks to `dl-web.dropbox.com/put_block_returning_token`,
  then one `POST /drops/commit_file_request_by_token?name=<file>` per file,
  which answers 200 `{"status": "complete"}`. The page then shows "Finished
  uploading". The script waits for that text, up to max(120 s, 10 s per MB),
  and counts a file as committed only when its commit answered that way. The
  commit does not name the stored file, which is why step 4 matches by hash.
- The 09-29 version (roalson-interests
  `tools/listing-packages/build/upload.sh` and `frbatch.mjs`) found no
  completion state and slept max(45 s, 5 s per MB) per batch. On 10-16, six
  files in two batches took 40 s in all.
- `content_hash` is the SHA-256 of the concatenated SHA-256 digests of each
  4 MiB block. The unit tests pin six values that Dropbox reported for
  files this script uploaded, from 1 byte to 8,388,610 bytes (one to three
  blocks).

## Not yet tried

- The laptop. It should work there when Playwright's Chromium is installed;
  the script uses the proxy only when `HTTPS_PROXY` is set.
- Large files. Each batch passes its files into the page as base64, so memory
  is a few times the batch's size. The largest file tried is 8.4 MB; the
  09-29 script moved 46 PDFs of about 6 MB each.
