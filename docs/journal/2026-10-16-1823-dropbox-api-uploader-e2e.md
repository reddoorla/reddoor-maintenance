## 2026-10-16 — Dropbox API uploader passes end to end and lands (#1388)

This continues 2026-10-16 — Dropbox API uploader built, held on a refresh
token that predates its scopes. That entry's session finished the job itself
once the operator replaced the token. Item 127 had sent the work to "later,
from the backlog", but the operator did the re-authorization within the hour.

**Re-authorizing first failed on a team scope [M].** The authorization URL
answered "You must be a team administrator to authorize this app". Dropbox
treats an app with any team scope ticked as a team app, which only an admin
can authorize. The operator unticked the team scopes, kept the six
individual ones (`account_info.read`, `files.metadata.read`,
`files.content.read`, `files.content.write`, `file_requests.read`,
`file_requests.write`) and authorized again. Team folders need no team
scope: the user-level token had already listed `/Design Resources` through
the path-root header. A team-app token would also act for the team rather
than as Tucker, and every call would need a member-selection header the
script does not send.

**The instrument passed before anything was trusted [M].** `check` had only
ever printed `MISSING`. At 18:20:56Z it printed `granted` for
`files.content.write` and `file_requests.write` with no detail, so the
`file_requests/update` probe got the 409 `not_found` the code assumes.

**The end-to-end test, 18:21–18:22Z [M].** All uploads went into
`/Tucker Lemos/Claude dropbox.mjs e2e 20261016-1821`:

| Step                                        | Result                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| 37,748,741 random bytes                     | `ok`, `content_hash` 4519…66fa matches local                                           |
| `Résumé — e2e.txt` (37 bytes)               | `ok`: the escaped `Dropbox-API-Arg` works live                                         |
| empty file                                  | `ok`, e3b0…b855, the zero-block hash                                                   |
| changed file, `--no-overwrite`              | `exists, not overwritten`, exit 1                                                      |
| identical file, `--no-overwrite`            | `ok`: Dropbox sees no conflict                                                         |
| traced upload of the 36 MiB file            | start 16,777,216 B, append at offset 16,777,216, finish at 33,554,432 with 4,194,309 B |
| `close-request` on a throwaway open request | `closed … is_open: false`; the connector agrees                                        |

The connector listed the same five entries with matching sizes, a read from a
second authority. The folder was then deleted, and both the API and the
connector answered not found. The throwaway request was also deleted.

**Corrections to the earlier entry.**

- **That entry said a container restart does not bring a changed environment
  variable. That is wrong, and the evidence never supported it.** At 17:29Z
  the variable had not been changed yet, because the operator re-authorized
  only after 17:51Z. This session's container started at 18:20:34Z, after the
  change, and saw the new value 22 s later. So a fresh container for the same
  session reads the environment as it is now. "Only a new session sees it" is
  stricter than what happened.
- **The two open requests closed themselves.**
  - `rwq45cqgv3weniwpv46n` and `jdgy7hgrr2hx22f3thh5` read `is_open: false`
    once their deadlines passed (17:50Z and 17:30Z), before any token could
    close them. Item 127's note from the file-request session saw the same.
  - `file_requests/list_v2`, readable at last, lists seven requests and none
    open.
  - So a request with a deadline needs no manual close. The open requests
    the operator used to close by hand were the ones without one.

**The `CLAUDE.md` bullet changed before landing.** Item 128 was answered while
this was held: the file-request uploader stays as the fallback for a session
whose API credentials are missing or fail. So the bullet says "not through a
file request", not "never", and names item 128 as the fallback. Item 128 is
unblocked, and its resume steps apply as written.
