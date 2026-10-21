---
"@reddoorla/maintenance": patch
---

`runMigrations` no longer throws when several clients migrate at once (#1667). The `_migrations` marker insert is `ON CONFLICT(id) DO NOTHING`, so a client that loses the race to record a pending migration reads the primary-key conflict as "applied by another client" instead of failing with `SQLITE_CONSTRAINT_PRIMARYKEY`; any other insert failure still throws. Only the client that recorded the marker reports the migration as run.
