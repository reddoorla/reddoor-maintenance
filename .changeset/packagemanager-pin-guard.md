---
"@reddoorla/maintenance": patch
---

The nightly sweep now audits the pnpm `packageManager` pin (#690)

Three repos sat on a pnpm security bump for two months and nothing said so:
nothing in `src/` or `.github/workflows/` ever asked whether the fleet agreed
on a pnpm version. The nightly protection-coverage sweep now asks, per public
repo — a missing `packageManager` field where a `package.json` exists, a pin
that disagrees with the fleet's, and a workflow pinning a pnpm `version:` input
alongside a `packageManager` field, which `pnpm/action-setup` hard-errors on
rather than resolving either way.

The fleet pin is DERIVED (the value a strict majority of pinned repos carry),
not hand-typed here — a constant in this file would be one more copy to drift,
which is exactly what `convert-to-pnpm.ts`'s `DEFAULT_PNPM_VERSION` did. With
no strict majority the sweep reports `fleetPin=SPLIT` and gaps nobody on that
clause rather than firing on 24 repos over one unmade decision.

A repo with no `package.json` reads as out of scope, never as a gap, and the
workflow input is parsed from the `pnpm/action-setup` step's own block: a
grep for `version:` matches `node-version:` from `setup-node` and reported
eleven healthy workflows as broken when this was measured by hand.
