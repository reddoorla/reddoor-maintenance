---
"@reddoorla/maintenance": patch
---

Register `db restore --url`, which was never wired — and rehearse the rollback.

**`db restore` shipped unrunnable.** `DbCommandOptions` declared `url?`,
`runDbCommand` read `opts.url` to pick the restore target, and `bin.ts` registered
only `--file`. So `--url` was a cac hard-error at parse time and the command's only
reachable outcome was its own usage message. Every unit test passed, because they
call `runDbCommand` directly and never go through the CLI.

It was found the only way it could be: by trying to use it. A restore path that
cannot be invoked is the worst thing to discover during a recovery, and after the
freeze that dump is the entire rollback story.

**The rollback has now been rehearsed end to end**, against a real libSQL server
rather than the nightly `:memory:` load:

```
dump    17 MB, 11 tables, manifest on line 1
target  turso dev (sqld, Hrana over HTTP) — a real server, empty
RESTORE loaded=true tables=11 rows=755 blob_bytes=7777769 mismatches=0
```

Row counts and total blob bytes were compared against the dump's **origin
manifest**, not against the dump text. Then content was compared directly between
production and the restored copy — the newest submission, the largest header image
(808,289 bytes, JPEG magic intact), the largest rendered report body, the
`digest_state` row and the full migration list all matched exactly.

All three refusals were exercised and each exits non-zero: `target-not-empty`,
`manifest-absent`, and a missing `--url` (which must never default, or a restore is
one keystroke from overwriting production).

**What this does NOT prove:** the target was a local sqld, not a hosted Turso
database, because creating one needs a browser-OAuth platform login. The dump path,
the statement set, the client, the manifest verification and the guards are all
proven; Turso's hosted control plane is not.

A registration test now derives the required flags **from the source** — every
`opts.foo` read in `db.ts` must have a `--foo` on the db command — plus a
behavioural check that spawns the CLI and asserts cac accepts both flags. The
lookup is scoped to the db command's own block, so a `--url` belonging to another
command cannot satisfy it.
