---
"@reddoorla/maintenance": patch
---

Baseline versions follow the starter off Slice Machine: `slice-machine-ui` and `@slicemachine/adapter-sveltekit` are no longer tracked, and the `prismic` CLI (^1.21.0) is. The deps audit compares only packages a site has installed, so an unmigrated site is unaffected and a migrated one gets its CLI version checked.
