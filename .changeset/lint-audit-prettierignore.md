---
"@reddoorla/maintenance": patch
---

The `lint` audit now skips files the site's own `.gitignore` or `.prettierignore` excludes, as the site's `prettier --check .` does. Sites moved to the Prismic CLI (reddoorla/reddoor-maintenance#1090) list the generated `prismicio-types.d.ts` and `src/lib/slices/index.ts` in `.prettierignore`, because their `prismic-codegen` job compares both files byte-for-byte with the generator's output. Before this change the audit counted them as unformatted: espada went from `warn` (0 unformatted) to `fail` (2 unformatted) on its migration commit.
