---
"@reddoorla/maintenance": patch
---

One owner/repo validator: `isOwnerRepo` in util/git, everywhere (#724)

Three copies of the same two-segment regex validated a GitHub `owner/repo`
identity independently — `src/dashboard/site-details.ts` (`REPO_RE`, also
consumed by `trigger-renovate`), `src/cli/fleet/clone-if-needed.ts`
(`GIT_REPO_RE`) and `src/util/git.ts` (`OWNER_REPO_RE` behind `isOwnerRepo`).
A reader finding three could not tell which was authoritative, and only the
util one carried the explicit `..` reject: `.` is a legal repo character, so
the bare regex admitted `owner/..`, which the dashboard then wrote to Airtable,
`trigger-renovate` interpolated into a dispatch path, and `clone-if-needed`
turned into `https://github.com/owner/...git` — despite its own comment
promising to block traversal.

The dashboard and the fleet clone now import `isOwnerRepo`; the two local
regexes are gone. The only behavioural change is that a `..` segment is now
rejected on all three paths, each pinned by a test that was red against the
old regex.
