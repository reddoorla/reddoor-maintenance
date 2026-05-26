---
"@reddoorla/maintenance": patch
---

Two codemod / recipe safety fixes from the deep-review backlog.

### Fixed: `convert-to-pnpm` removes `node_modules` before `pnpm install`

Sharing a flat npm `node_modules` across package managers produces phantom-dep resolution issues — pnpm's nested layout disagrees with what's already on disk, and consumers downstream see unexpected resolution paths until the next clean install. The recipe now `rm -rf node_modules` between rewriting the lockfile/package.json and running `pnpm install`, so the new tree is a clean pnpm layout from the first install. node_modules is gitignored on every reddoor site so this doesn't dirty the working tree.

### New: `legacyReactiveToRunes` codemod emits `@migration-task` markers on block conversions

`$: { … }` blocks are converted to `$effect(() => { … })` — which always compiles, but only stays reactive if the locals the block mutates were declared as `$state(…)` rather than plain `let`. Detecting that automatically would require scope analysis on the declaration sites (out of scope for this codemod), so the codemod now leaves a breadcrumb next to each converted block:

```js
// @migration-task: $effect won't trigger UI updates on plain `let` bindings — refine mutated locals to $state or split into per-variable $derived.
$effect(() => {
  justify = float;
  if (float === "left") justify = "start";
});
```

The marker only appears on `$: { … }` block conversions. Simple `$: var = expr` → `let var = $derived(expr)` conversions are reactive-safe (Svelte 5 `$derived` is reactive by construction) and don't get a marker. The codemod remains idempotent: re-running on output doesn't find any new `$:` blocks to convert, so no new markers get added.
