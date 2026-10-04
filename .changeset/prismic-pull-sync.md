---
"@reddoorla/maintenance": minor
---

`prismic-sync` brings Prismic's copy of each changed and each remote-only model into a site's repo, so a Type Builder edit reaches the repo as a reviewed pull request. `prismic-sync <site>` writes into one working tree. `prismic-sync --fleet <inventory> --open-prs` clones each site, commits the result to the fixed branch `prismic-sync` and opens or updates one PR (fast-forward only, never forced; closed when the site is back in sync). The changed-model write is a new, separate capability, `refreshChangedModel`: it replaces only the file the repo already holds for that id, refuses an id or kind mismatch, an identical model and a file edited since it was read, and never creates or deletes a file. `--pull` is unchanged.
