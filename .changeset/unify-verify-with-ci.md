---
"@reddoorla/maintenance": patch
---

Add `pnpm verify` and bind the CI workflow to it, so the local gate and the Actions gate cannot drift

CI listed its steps inline while contributors ran some ad-hoc subset locally, and
the two drifted in the expensive direction: a local `lint && build && test` could
pass while CI failed on `typecheck` — the only step that typechecks `tests/**` —
and nothing local ran `test:dist` at all. `pnpm test` is also not `test:coverage`,
so the coverage floor in vitest.config.ts was never enforced outside CI.

`pnpm verify` is now typecheck → lint → build → test:coverage → test:dist. CI still
lists those steps individually, so a failure stays attributable at a glance in the
Actions UI — but `tests/ci-gate.test.ts` derives the expected commands from the
`verify` script and asserts the workflow matches it exactly, in order. The
workflow cannot gain, lose, or reorder a gate without the suite failing.
