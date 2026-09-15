---
"@reddoorla/maintenance": patch
---

smoke-dist derives its recipe-export expectations from the barrel; `healthEndpoint`, `smokeSuite` and `matchHarness` reach the entry point (#731)

`src/recipes/index.ts` exported twelve recipe functions; `src/index.ts`
re-exported nine of them by name, and `scripts/smoke-dist.mjs` checked a
third hand-written copy of the same list. A recipe missing from both of the
downstream lists — `healthEndpoint`, `smokeSuite`, `matchHarness` — was
invisible to every gate: build, typecheck, lint, the full suite, `test:dist`,
`--help` and `list-recipes` all stayed green with the exports gone, because
the check was a truthful pass about the names it had been told to look at.

The recipe block of `requiredExports` is now derived at gate time from the
source barrel's runtime exports, loaded under `node --import tsx` (tsup emits
no `dist/recipes/index.js`, so there is no dist copy to ask), with a self-check
that the derivation saw `syncConfigs` so an empty list cannot pass vacuously.
The three recipe commands join `expectedSubcommands`, giving the gate a hold on
their registration. Proven against the unfixed source first: `test:dist`
failed naming exactly the three exports; adding them to `src/index.ts` — the
additive option — turns it green. Whether they should be library API at all,
or CLI-only with the barrel exports dropped, remains open on the issue.
