---
"@reddoorla/maintenance": patch
---

Add `pnpm verify` and make CI run it, so the local gate and the Actions gate are one definition

CI listed its steps inline while contributors ran some ad-hoc subset locally, and
the two drifted in the expensive direction: a local `lint && build && test` could
pass while CI failed on `typecheck` — the only step that typechecks `tests/**` —
and nothing local ran `test:dist` at all. `pnpm test` is also not `test:coverage`,
so the coverage floor in vitest.config.ts was never enforced outside CI.

`pnpm verify` is now typecheck → lint → build → test:coverage → test:dist, and the
workflow runs exactly that one command. A guard test asserts CI delegates rather
than re-inlining any step, and that verify has not quietly downgraded to the fast
`test` script.
