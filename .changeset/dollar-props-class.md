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

### Re-running

Sites that already had 0.6.0 codemods applied can safely re-run `reddoor-maint svelte-codemods` — the new codemods are additive and the existing ones are idempotent.
