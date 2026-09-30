---
"@reddoorla/maintenance": patch
---

`prismic-ci` reads the project's `@reddoorla/maintenance` version from a pnpm 12 lockfile. pnpm 12 writes two YAML documents, the first pinning pnpm itself with its own `importers:` section, and the version reader stopped at that first section, so every pnpm 12 site was refused with "not a dependency in this repo's lockfile".
