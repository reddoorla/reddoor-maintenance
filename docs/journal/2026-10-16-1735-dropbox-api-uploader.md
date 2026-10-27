## 2026-10-16 — Dropbox API uploader built, held on a refresh token that predates its scopes (#1388 held, #1389)

> Superseded in part by 2026-10-16 — Dropbox API uploader passes end to end and lands.

The goal was a reliable way for a cloud session to put a binary (PDF, image)
into the Reddoor Dropbox, replacing the file-request workaround. The Dropbox
connector writes only text. The workaround drives Dropbox's upload page with
Playwright and leaves each request open until the operator closes it by hand.
The operator had made a Dropbox app and set `DROPBOX_APP_KEY`,
`DROPBOX_APP_SECRET` and `DROPBOX_REFRESH_TOKEN`. `scripts/dropbox.mjs` is
built and tested, but it cannot upload yet: the refresh token was authorized
before the app had its write scopes. #1388 is held as a draft. The operator
chose to finish it later from the backlog line #1389 adds.

**The credentials pass, and the controls fail as they must [M].**

- A random refresh token is refused (400 `invalid_grant`, "malformed").
- The real token with one character changed is refused (400 `invalid_grant`,
  "invalid or revoked").
- The real token with one character of the app secret changed is refused
  (400 `invalid_client`).
- The real pair answers 200 with `expires_in` 14400 and names Tucker Lemos on
  Reddoor Creative: root namespace 3244718323, home 2263648307.

The refresh response carries no `scope` field, so it cannot show what the
token may do. Only calling the endpoints can.

**The path root is required, not decorative [M].** `files/list_folder` on
`/Design Resources/Reddoor Style Guide` answers 409 `path/not_found` without
`Dropbox-API-Path-Root`. With it, the call lists the style guide `.md`
(69,272 bytes) and `.pdf` (1,587,301 bytes). The script takes the root from
`get_current_account` rather than hard-coding it.

**`content_hash` was proven on real files before the tests used it [M].**

- The local hash (SHA-256 of the raw SHA-256 digests of each 4 MiB block)
  matched Dropbox's on four team files, of 1, 1, 3 and 10 blocks. The
  largest was a 39,939,603-byte `.fig`, found by scanning 19,579 entries
  under `/Design Resources`.
- It matched both computed in memory and streamed from disk.
- With one byte flipped, every file's hash differed.
- The unit-test vectors were generated after that, and a reviewer matched
  them against a separate Python version of Dropbox's documented algorithm.

**Beliefs corrected on contact.**

- **The brief said the app had four scopes. It had none of the write ones.**
  At 16:49Z `files.content.write`, `file_requests.write` and
  `file_requests.read` all failed. The brief's list also left out
  `file_requests.read`, which `file_requests/get` and `list_v2` need.
- **Ticking a scope on the app does not reach an existing token.** At 16:53Z
  the operator updated the permissions. The same calls changed from 400 "Your
  app … is not permitted … required scope" to 401
  `{".tag": "missing_scope"}`. That change is the readable signal: 400 means
  the app lacks the scope, and 401 means the app has it but the token
  predates it. The script's error now names whichever fix applies.
- **A container restart does not bring a changed environment variable.**
  At 17:29Z, after this container restarted, the token still lacked both
  scopes.

**Review.**

- Round 1's major: two files with the same name, such as `a/deck.pdf` and
  `b/deck.pdf`, went to the same Dropbox path. The second overwrote the first,
  and both printed `ok` with exit 0. Both reviewers found it.
- Round 2's major: the same bug through case. `Logo.png` and `logo.png` are
  one path to Dropbox. The guard now folds case and Unicode form.
- Round 1 also changed four things:
  - `check` probes both write scopes without side effects. Before, it passed
    while every upload failed.
  - No single request carries more than 16 MiB, not the brief's 150 MB. A
    reviewer measured Node's 300 s headers timeout running while the body was
    still being sent.
  - The hash is computed over the bytes actually sent.
  - Network failures name their cause.
- Round 3 found only minors, so it counted as clean, and they are filed as
  #1390 to #1394. The one most likely to bite is #1390: `files/upload`
  silently creates a mistyped folder. The rest: an overwrite is not
  announced (#1391), `check` exits 0 on a `file_requests` 409 other than
  `not_found` (#1392), 409 `too_many_write_operations` is not retried
  (#1393), and a file growing during a session upload reports `ok` (#1394).
  Its last nit stands as the open instrument question: `check` has never
  printed `granted` against the real API. That is step one of #1388's
  end-to-end test.
- The tests started at 39 with 21 mutations. They ended at 56 tests and 42
  mutations, each red. Four mutations survived along the way, and each
  survivor got a test.

**What is open.** Two temporary file requests are still open:
`rwq45cqgv3weniwpv46n` (the style guide upload) and `jdgy7hgrr2hx22f3thh5`
(the test request of the session on `claude/tender-bohr-eh2rwb`). Both have
passed or are near their deadlines, so neither accepts uploads, but both read
`is_open: true`. The connector cannot close them, and the API's close needs
the new token. #1387 asks separately whether that session's file-request
uploader should stay as a fallback. If it does, its `CLAUDE.md` bullet must
stop calling file requests the route. The roalson-interests Playwright
uploader (`tools/listing-packages/build/upload.sh`, `frbatch.mjs`, on unmerged
branches) is superseded and should not be landed.

`DROPBOX_ACCESS_TOKEN` is still set and is the dead short-lived token. Nothing
reads it.
