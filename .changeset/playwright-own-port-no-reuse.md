---
"@reddoorla/maintenance": patch
---

Playwright runs get their own port and never reuse a server they didn't start.

`reuseExistingServer` was `!process.env.CI`, so a local run reused anything that
answered the readiness probe. The probe only asks "does this URL respond?" — it
never asks "is this server serving the code I am about to test?" So a vite left
open from earlier, or one whose working tree changed underneath it after a
checkout, silently became the system under test.

That fails in both directions, and the second one is the expensive one. A false
red gets blamed on the code: on beachfront-dentistry two `qa-expand` tests failed
deterministically while CI was green on the same commit, which read convincingly
as a macOS-vs-Linux platform difference, was investigated as one, and reached a
PR description before anyone noticed the tests were correct. A false green is
worse and quieter — you change code, the suite passes against the old build, and
nothing ever prompts you to look twice. CI was immune because `CI` flipped the
flag to `false`, and that asymmetry is exactly what made the whole thing look
like a platform bug instead of a config one.

Local runs now allocate their own free port instead of falling back to the fixed
5173, so your dev server keeps running untouched and a collision is no longer
possible. `REDDOOR_SMOKE_PORT` still wins when the central smoke audit supplies
one. The cost is a fresh vite boot per run, roughly 10-20s against a ~2 minute
suite.

The port is allocated through a short synchronous subprocess rather than by
making the config an async export, because sites consume this base by
**spreading** it (`{ ...base, use: { ...base.use } }`). Spreading a Promise
yields none of its properties, which would have handed every site a silently
empty config — the same false-green class this change exists to remove.
