---
"@reddoorla/maintenance": patch
---

smoke audit runs `svelte-kit sync` before the suite — unbreaking 9 of 11 live sites.

`playwright.config.ts` resolves `tsconfig.json`, which extends the **generated**
`./.svelte-kit/tsconfig.json`. A fresh clone has no such file, and no fleet repo
carries a `prepare` script to write one, so Playwright aborted while loading its
own config, before running a single test:

```
Error: Failed to load tsconfig file at <site>/tsconfig.json:
Failed to resolve "extends" path "./.svelte-kit/tsconfig.json"
```

Nine of eleven live sites were recording `Smoke OK: fail` for this reason —
CalTex, Data Dynamiq, ERP, Espada, LA Homelessness Initiative, MSOT, Revogen,
Sonder and Vineyard. Only Reddoor and LA Homelessness Youth passed.

It stayed invisible because `fleet-smoke.yml` gates on `FLEET_WRITE_SUMMARY`,
which counts rows **written**, not rows **passing**. A failing site is still
written, so the nightly reported success throughout.

The audit now runs `pnpm exec svelte-kit sync` between install and `test:smoke`.
Fixing it centrally covers every site at once, where a `prepare` script would
need a PR per repo. `sync` is idempotent and fast, so it runs unconditionally
rather than probing for the file — a warm checkout can have `node_modules`
without `.svelte-kit`. The step is best-effort: a non-SvelteKit site or a missing
binary can never downgrade a working suite, and the suite remains the verdict.

Verified A/B against a cold clone of data-dynamiq: `smoke fail` (tsconfig error)
before, `smoke pass` (suite green) after.
