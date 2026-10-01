---
"@reddoorla/maintenance": patch
---

`prismic-ci` installs from a cloud session. Its caller workflow now also triggers on its own path for `pull_request` (never `push`), so the PR that installs or changes it runs the dry job against Prismic with the site's token: no token exits 1 and a dead token goes red. When the secrets list is refused by the cloud proxy, and only then, the recipe opens the PR anyway, notes in it that the token was not checked, and makes that PR's `prismic-models` check the gate. A confirmed-absent secret, or any other lookup failure, still refuses. Sites already carrying the workflow pick up the new trigger the next time `prismic-ci` runs on them.
