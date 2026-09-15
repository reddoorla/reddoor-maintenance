---
"@reddoorla/maintenance": patch
---

prismic-ci: refuse when Airtable's 'Git repo' and the checkout's origin name different repositories (#713)

`gitPush` pushes to the checkout's `origin`; `openPullRequest` files at `repo`,
which `resolveOwnerRepo` takes from Airtable's 'Git repo' whenever the cell is
set. When the two disagreed — a stale cell after a rename or transfer, a fork or
personal mirror as origin, a row copy-pasted from another client — the branch
landed in one repository and the PR was requested in another with a head that
did not exist there. GitHub answered 422, but only after a real branch, a real
commit and a real push had reached a client repo, and the `finally` restore
cleans the local checkout without deleting the pushed branch.

The recipe now compares the two with `sameOwnerRepo` right after the identity
resolves, and returns `failed` naming both sides before any write. A checkout
with no origin at all is left to the push, which fails there before anything
reaches GitHub. No existing test had `gitRepo` and an origin together, which
is why nothing pinned the divergence; the new one does, alongside a control
proving agreement across case and the `.git` suffix still applies.
