---
"@reddoorla/maintenance": patch
---

Two codemod fixes surfaced by the caltex 0.6.0 pilot — sites failed to build with `Cannot use $$props in runes mode`.

### `dollarPropsClass` (new codemod)

Converts the legacy `$$props.class` pattern (extra HTML class passed from a parent) to a Svelte 5 named-prop destructuring:

```svelte
<!-- before -->
<script lang="ts">
  let { foo }: { foo?: string } = $props();
</script>
<div class="other {$$props.class || ''}">x</div>

<!-- after -->
<script lang="ts">
  let { foo, class: className = "" }: { foo?: string; class?: string } = $props();
</script>
<div class="other {className || ''}">x</div>
```

The original `svelte-migrate` tool flagged this with `@migration-task` comments because it can't safely combine `$$props` with named props in general. We can for the `class` case specifically — it's the dominant pattern across the reddoor fleet. The codemod also strips those stale `@migration-task` comments when the file's `$$props` issues are fully resolved.

Conservative match — only transforms files that have BOTH a template `$$props.class` reference AND an existing `$props()` destructuring. Lazy regex backtracking on the destructuring body so default values containing braces (`click = () => {}`, `config = { x: 1 }`) and type annotations containing braces (`items: string[]|{label:string}[]`) don't truncate the match.

### `exportLetToProps` (relaxed)

Previously only matched `<script lang="ts">` blocks. Now matches plain `<script>` too, emitting destructuring without a type annotation. Picks up Svelte 4 → 5 conversions the original migration skipped (caltex's `ArrowButton` was the immediate find).

### `legacyReactiveToRunes` (new codemod)

Converts Svelte 4 reactive statements (illegal in runes mode) to runes:

```js
// before
$: fillHeight = viewport > threshold;
$: {
  justify = float;
  if (float === "left") justify = "start";
}

// after
let fillHeight = $derived(viewport > threshold);
$effect(() => {
  justify = float;
  if (float === "left") justify = "start";
});
```

Surfaced by espada's build failure (`@sveltejs/vite-plugin-svelte@4` rejects `$:` in runes mode where caltex's `@5` silently accepts it). Block patterns become `$effect` rather than per-variable `$derived` — they typically mutate multiple already-declared locals with conditional logic, too contextual for a safe automatic decomposition. Refine into discrete `$derived` calls afterward if desired.

Manual brace matching with string-literal awareness so braces inside string literals or nested object/block bodies don't fool the close-brace counter. Scoped to `<script>` content only.

### Re-running

Sites that already had 0.6.0 codemods applied can safely re-run `reddoor-maint svelte-codemods` — the new codemods are additive and the existing ones are idempotent.
