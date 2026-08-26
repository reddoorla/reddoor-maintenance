---
"@reddoorla/maintenance": patch
---

The freeze switch, and the inverted mirror semantics behind it (#612).

Ships **off**: no behaviour changes today. `TURSO_IS_AUTHORITATIVE` in
`src/db/freeze.ts` is `false`, and flipping it to `true` is the freeze.

Through Phase 5 the mirrors are best-effort by design — Airtable is
authoritative, so a Turso write that fails is caught, logged and swallowed, and
the hourly import converges whatever it missed. That is correct right up until
the freeze stops the import. After that nothing converges anything, and the same
swallowed failure is permanent data loss announced only by a log line nobody
greps. Three outcomes change meaning at the flip:

| outcome           | before                          | after                       |
| ----------------- | ------------------------------- | --------------------------- |
| `mirrored=0`      | the sync will fix it            | that write is gone          |
| `mirrored=missed` | the site isn't imported yet     | impossible, therefore a bug |
| `mirrored=absent` | no creds; Airtable still has it | every write was discarded   |

So the freeze is not a config change: it inverts which store is allowed to fail.
`makeSiteMirror`, `makeReportMirror`, `makeHealthMirrorBestEffort` and
`makeScheduleMirrorBestEffort` all gain a `strict` mode that throws where they
used to swallow, and refuses to build at all without credentials rather than
handing back a working-looking mirror that discards every write.

A code constant rather than an env var, deliberately: the same artifact runs in
Netlify functions and Actions runners, and an env var set in one but missed in
the other would give a _partial_ freeze — worse than either end.

Consumers take it as a default parameter rather than reading it inline, so tests
exercise both sides as fixtures with exactly one assertion on the shipped value.
Several older tests that read the shipped constant now pin `false` explicitly,
and the composition roots' suites mock the mirror factories.

Verified by flipping the constant and running the whole suite: **exactly one test
fails, the one that asserts its value.** The freeze is a one-line change.
