# 2026-10-21 — two clients migrating at once no longer throws on the marker (#1667)

Landed in this PR, before tonight's nightlies, because the #1654 worker is about to add migration 0046 and the nightly workflows open the database together.

`runMigrations` read `_migrations`, ran each missing migration, then recorded it with a plain `INSERT`. Every migration's DDL is idempotent (`IF NOT EXISTS`, `DROP INDEX IF EXISTS`, and the swallowed duplicate `ADD COLUMN`), so with several clients in one process the only race left was the marker: whoever wrote it second threw `SQLITE_CONSTRAINT_PRIMARYKEY: UNIQUE constraint failed: _migrations.id`. The new test reproduced the issue's count exactly before the fix: three clients on one `file:` database with the newest `ADD COLUMN` pending, one applied it and two threw. With two clients, one threw.

The fix is `INSERT … ON CONFLICT(id) DO NOTHING`, chosen over `INSERT OR IGNORE` and over catching the error. `OR IGNORE` also ignores NOT NULL and CHECK failures, which would be a broader silence than the race needs; a catch has to recognise the conflict by its message. The upsert clause names the one conflict that means "another client recorded it" and lets anything else throw. `ran` now holds only what this client recorded (`rowsAffected > 0`), so the `db migrate` command no longer claims a migration another client applied.

The test uses separate connections to a scratch `file:` database. A shared `:memory:` client serialises the calls and never races, which is why the existing idempotency tests could not see this. It sits in its own file because #1654's branch edits the id lists in `tests/db/migrate.test.ts`.

Mutations: the plain `INSERT` back reds both concurrency cases; swallowing every insert error reds the I/O-error case; pushing to `ran` unconditionally reds both concurrency cases. `INSERT OR IGNORE` passes every test, as it should, since it is the issue's other correct fix, not a mutation.

Belief corrected in review: "the marker is the only race" holds for clients in one process, not across processes. The review drove six OS processes at one `file:` database with 0043 pending, and in 3 of 3 rounds five threw `SQLITE_BUSY: database is locked` at the `ALTER TABLE`, before reaching the marker. That predates this change, and production clients use remote Turso, so it went to #1674 rather than into this PR. The fix there would reuse `retryOnBusy` from `src/db/prospect-audits.ts`.
