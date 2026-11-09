---
"@reddoorla/maintenance": patch
---

A nameless fleet site no longer takes a name from its repo that differs only in case from another site's (`Baz` beside `baz`), because `cloneIfNeeded` would put both in one directory on a case-insensitive filesystem such as macOS's. It keeps its path label, as for an exact collision.
