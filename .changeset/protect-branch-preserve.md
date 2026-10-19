---
"@reddoorla/maintenance": patch
---

`protectBranch` now reads the branch's existing classic protection and carries its reviews, restrictions, `enforce_admins`, flags and existing status checks into the PUT, adding only the requested checks, instead of replacing them with nulls and `enforce_admins: true` (#998).
