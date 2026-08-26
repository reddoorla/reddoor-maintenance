---
"@reddoorla/maintenance": patch
---

Fix `db restore` against a hosted Turso database — it could only ever restore
into a target that required no authentication.

The command built its libSQL client from a url alone, with no auth token. That
works against `:memory:` and a local `turso dev`, which is exactly what the
nightly rehearsal and the 2026-08-26 manual rehearsal used — and 401s against
every target an actual recovery would have.

Found by pointing the shipped command at a real hosted database for the first
time. It returned a bare `SERVER_ERROR: Server returned HTTP status 401`.

The target token now comes from `TURSO_RESTORE_AUTH_TOKEN`, and a hosted target
with no token is refused as `RESTORE refused=auth-token-absent` **before** the
network and before the dump is even read — so the failure names the missing
token rather than surfacing an opaque 401 or an ENOENT that sends you hunting
for the dump file.

It deliberately does not fall back to the ambient `TURSO_AUTH_TOKEN`: that one
belongs to production, and inheriting it would undo the reason `--url` is
required in the first place.

Now proven end-to-end against a real hosted Turso database: `RESTORE
loaded=true tables=11 rows=766 blob_bytes=7777769 mismatches=0` in 10.4s, with
both refusals (`auth-token-absent`, `target-not-empty`) also confirmed against
that same hosted target.
