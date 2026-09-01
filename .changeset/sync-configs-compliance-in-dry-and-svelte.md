---
"@reddoorla/maintenance": patch
---

sync-configs: stop treating hand-authored `svelte.config.js` as drift, and make `--dry` tell the truth

`isSvelteConfigCompliant` required the literal string `createSvelteConfig`, so any
site that hand-authors its config read as off-pattern and would be replaced by the
8-line canonical template. That was four live sites — the-pointe-burbank (151
lines), beachfront-dentistry (241), 1836dig, data-dynamiq — plus reddoor-starter,
whose placeholder-repo prerender tolerance is the only reason a freshly cloned
site builds green. A config on the canonical adapter with its own `kit` block is
now compliant; a missing file, the wrong adapter, or a stub with no `kit` config
still gets the template.

`--dry` re-implemented drift detection as a raw byte comparison and never applied
the compliance predicates, so it reported files the real run leaves alone. It now
calls the recipe's own `planTemplateDiffs`, so preview and apply cannot disagree.
