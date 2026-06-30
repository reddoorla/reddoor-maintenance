---
"@reddoorla/maintenance": patch
---

fix(svelte5): the `dollarPropsClass` codemod no longer emits an invalid rest element

When the `$props()` destructuring it extends already ended in a rest element (`...rest`, as produced by `exportLetToProps` or the official `svelte-migrate` pass), the codemod appended `class: className = ""` AFTER it, emitting `let { …, ...rest, class: className = "" } = $props()`. A rest element must be last in a destructuring pattern, so this was invalid JS — every site with a `$$props.class` pass-through plus a rest element failed to compile with "A rest element must be last in a destructuring pattern" / "Comma is not permitted after the rest element" (~12 files on hedloc's Svelte 5 migration alone).

The codemod now inserts `class: className = ""` BEFORE a trailing rest element, producing the valid `let { …, class: className = "", ...rest } = $props()`. Bodies with no rest element are unchanged (class still appended), and a rest-only body becomes `{ class: className = "", ...rest }`.
