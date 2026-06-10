---
"@reddoorla/maintenance": patch
---

fix(fleet): `cloneIfNeeded` derives a clone URL from `gitRepo` (`https://github.com/<owner/repo>.git`, strict-validated) when no `repoUrl` is set, unbreaking checkout-based `--fleet airtable` recipes. The JSON inventory provider now also carries `gitRepo`/`deployedUrl`.
