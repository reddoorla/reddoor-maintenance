---
"@reddoorla/maintenance": patch
---

### Fixed: `removeDollarRestProps` no longer emits references to an undeclared `rest`

The codemod previously rewrote `<div {...$$restProps}>` → `<div {...rest}>` unconditionally, but never modified the script's `$props()` destructuring. The result was Svelte 5 source that referenced an undeclared identifier — a silent runtime breakage on any component using `$$restProps`.

The codemod now:

- **Injects `...rest` into an existing `$props()` destructuring** when `$$restProps` is used. For TypeScript components, the inline type annotation is widened with an `[key: string]: unknown` index signature so the rest binding actually captures excess attributes (without the widening, TS would infer `rest` as `{}` and the spread would forward nothing).

  ```ts
  // before
  let { name }: { name: string } = $props();
  // …
  <div {...$$restProps}>{name}</div>

  // after
  let { name, ...rest }: { name: string; [key: string]: unknown } = $props();
  // …
  <div {...rest}>{name}</div>
  ```

- **Is idempotent.** A `$props()` destructuring that already collects `...rest` is left alone — no double-insert.

- **Refuses to rewrite when no `$props()` call exists.** The rare Svelte 4 component that used `$$restProps` without `export let` to convert now passes through unchanged, leaving the user with the original `$$restProps` and a clear Svelte 5 build error to migrate by hand — rather than receiving broken output.

### Fixed: `removeDollarRestProps` no longer corrupts string literals

The previous global `replace(/\$\$restProps/g, "rest")` also rewrote occurrences inside `'…'`, `"…"`, and backtick-delimited strings in the script body (e.g. a comment-style error message like `"$$restProps was removed in Svelte 5"` became `"rest was removed in Svelte 5"`). The codemod now masks script-level string literals before the rewrite and restores them afterwards.
