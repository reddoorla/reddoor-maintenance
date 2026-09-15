---
"@reddoorla/maintenance": patch
---

ensure-site honours `--name` on an existing row, and the create message points at a fix the command can do (#664)

`--name` was read on the create path only, so a row created before the
display name was settled — Name left as the bare slug, the value client-facing
copy uses verbatim — could not be retitled by the command that created it:
re-running with `--name` printed `exists`, wrote nothing, and exited 0. The
create message meanwhile said "re-create with --name", which the command
cannot do either.

On the exists path a differing `displayName` now updates Name, through the
same Airtable update + Turso site mirror the fill-blanks path already uses,
and lands in `updatedFields`. It is the one deliberate exception to
fill-blanks-only: `--name` targets Name and nothing else, and the slugify
guard already proves the new value resolves to the same row. The CLI reports
it as `Name set to "…"` rather than a filled blank, and the create note says
"re-run with --name".
