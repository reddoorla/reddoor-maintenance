---
"@reddoorla/maintenance": minor
---

Add `svelte-codemods` recipe + `state_referenced_locally` codemod.

Discovered during the caltex 0.5.0 pilot: Svelte 5's `state_referenced_locally` warning flags real reactivity bugs where `let X = $state(prop.expr)` captures a prop only at init time. The same shape appeared in 6+ caltex route files (and likely across the fleet) — a copy-pasted manual-sync pattern:

```js
let { data } = $props();
let content = $state(data.page.data);
$effect(() => {
  data;
  content = data.page.data;
});
```

### `stateEffectSyncToDerived` codemod

New gotcha codemod that collapses the pattern above into the idiomatic Svelte 5 form:

```js
let content = $derived(data.page.data);
```

Joins the existing `onEventToHandler`, `exportLetToProps`, and `removeDollarRestProps` codemods in the gotchas pipeline. Conservative match: only transforms when the `$state(...)` initializer expression and the `$effect`'s assignment expression are textually identical (after trim). Intervening statements between the two block the match. Idempotent.

### `svelte-codemods` standalone recipe

The full `svelte-4-to-5` recipe short-circuits sites already on `svelte ^5.x`. The new `svelte-codemods` recipe runs the same codemod pass on its own — useful when post-migration Svelte 5 strictness warnings emerge and the fleet needs a clean re-application.

```sh
reddoor-maint svelte-codemods /path/to/site
```

Creates a `maint/svelte-codemods-<ts>` branch with one commit: `refactor(svelte5): apply codemods (N files)`. Plans in memory first — no branch is created if the codemods would be a noop, so re-runs are cheap.

### Internal refactor

`applyGotchaCodemods` now delegates to a new `planGotchaCodemods` that returns the change set without writing. `svelte-4-to-5`'s pipeline keeps the existing write-on-apply behavior; `svelte-codemods` uses the plan/apply split to short-circuit cleanly on noop.
