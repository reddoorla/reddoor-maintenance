---
"@reddoorla/maintenance": patch
---

### Fixed: `state-effect-sync` codemod missed the multi-line `$effect` form with trailing semicolons

The regex only matched `$effect(() => { x; name = expr })` — bare expression, no trailing `;` before the closing `}`. In practice every fleet site authored the effect across multiple lines with a semicolon after the assignment:

```js
$effect(() => {
  data;
  content = data.page.data;
});
```

That form was silently skipped, leaving `$state + $effect` manual-sync pairs untouched on sites the codemod was supposed to clean up. The pattern now also matches an optional `;` after the assignment, so both forms convert to `$derived(...)`.

### New: end-to-end pipeline composition test

Surfaced this bug, plus catches future regressions where individual recipes pass in isolation but break when chained. The fixture (`tests/fixtures/pre-onboarding/`) is a Svelte 5 site still on npm with every legacy pattern reddoor sites accumulated during their original 4→5 migration. The test runs the full onboarding sequence — `convert-to-pnpm → onboard → sync-configs → svelte-codemods` — and verifies both the green path and idempotency on a second pass. This mirrors the actual sequence we ran (manually) against caltex-landing and espada, where bugs like this one only appeared when recipes ran against each other's output.
