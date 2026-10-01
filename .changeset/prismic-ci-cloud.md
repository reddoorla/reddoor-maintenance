---
"@reddoorla/maintenance": patch
---

`prismic-ci` installs from a cloud session. Its caller workflow now also triggers on its own path for `pull_request` (never `push`), so the PR that installs or changes it runs the dry job, which reads the site's models from Prismic with its token: no token exits 1 and a dead token goes red. When the secrets list is refused by the cloud proxy, and only then, the recipe opens the PR anyway, over REST only (the proxy also refuses GraphQL, so PR creation moved from `gh pr create` to `POST repos/{repo}/pulls`, which `self-updating` shares, and the open-PR check uses a new REST `openPullRequestRefs`), notes in it that the token was not checked, and makes that PR's `prismic-models` check the gate. A confirmed-absent secret, or any other lookup failure, still refuses. Sites already carrying the workflow pick up the new trigger the next time `prismic-ci` runs on them.
