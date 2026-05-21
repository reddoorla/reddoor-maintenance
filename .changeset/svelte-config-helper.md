---
"@reddoorla/maintenance": minor
---

Add `createSvelteConfig` helper and svelte.config.js to sync-configs templates.

Discovered during the caltex pilot: Svelte 5 emits `element_invalid_self_closing_tag` for the `<div ... />` shorthand reddoor codebases use everywhere. Across a fleet this drowns out useful warnings; silencing it once per site was repetitive.

### `createSvelteConfig`

New canonical helper exported from `@reddoorla/maintenance/configs/svelte`. Wraps a site's existing config and layers in the canonical `compilerOptions.warningFilter`, which silences `element_invalid_self_closing_tag`. Composes cleanly with any site-provided filter — both must allow a warning for it to show.

```js
// svelte.config.js
import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
import adapter from "@sveltejs/adapter-auto";

export default createSvelteConfig({
  kit: { adapter: adapter() },
});
```

### sync-configs now includes svelte

The recipe now writes a canonical `svelte.config.js` using `createSvelteConfig` + `adapter-auto`. Sites already on `adapter-auto` (most reddoor sites) get clean syncs. Sites using a different adapter need to edit after sync.

The new template intentionally **drops** `preprocess: vitePreprocess()` since Svelte 5 no longer needs it. Sites carrying that legacy preprocess setting are quietly modernized during sync.

### Re-running sync-configs against onboarded sites

Sites previously synced under ≤ 0.3.0 will see a new commit for `svelte.config.js` on the next run. Idempotent: re-running again is a noop.
