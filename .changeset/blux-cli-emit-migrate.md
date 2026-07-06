---
"@reddoorla/maintenance": minor
---

`blux` CLI command group. `blux emit <exportDir>` runs the deterministic conversion offline and writes the migration plan, `customtypes/*.json` schemas, theme CSS, review manifest, and assembled IR (plus a diagnostics summary). `blux migrate <outDir>` executes an emitted plan against a live Prismic repo — creds-gated on `PRISMIC_REPOSITORY_NAME` + `PRISMIC_WRITE_TOKEN`, pushing custom types via the Custom Types API and documents + assets via the Migration API (`@prismicio/*` are lazily-imported devDependencies, so consumer installs and CLI startup stay clean).
