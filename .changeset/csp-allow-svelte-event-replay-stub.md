---
"@reddoorla/maintenance": patch
---

The baseline CSP now allows Svelte's SSR event-replay stub, by pinned hash.

Svelte's server renderer emits `onload`/`onerror="this.__e=event"` on any
load/error element carrying a spread attribute or a `use:` directive — which is
every `<img {...getImageProps(field)} />` the Prismic helpers produce. The stub
stashes an event that fires before hydration so the component can replay it once
it is alive.

Hashes do not apply to inline event handlers unless `'unsafe-hashes'` is
present, so the baseline refused to run it. Two consequences, both permanent:
the pre-hydration `load`/`error` was silently dropped, so anything keyed on it
(a fade-in, a fallback swap) could strand; and a `script-src-attr` violation was
reported per image on every page view, which buried real violations, hammered
the report endpoint, and kept Playwright's `networkidle` from settling. Measured
on beachfront-dentistry: 12 violations on `/` alone, ~40 across nine routes.

`script-src` now carries `'unsafe-hashes'` plus the SHA-256 of that exact
one-liner, exported as `SVELTE_EVENT_REPLAY_HASH`.

On the security tradeoff: `'unsafe-hashes'` widens hash matching to event
handlers, it does not permit arbitrary inline handlers — only this exact text is
allowed, and the stub does nothing but assign the event to a property. The test
asserts `'unsafe-inline'` is never present alongside it, since that would let
any handler run and make the hash meaningless. The hash is recomputed from the
handler text inside the test rather than copy-pasted, so a wrong literal in the
source cannot be confirmed by an equally wrong literal in the test.

Verified in Chrome against a page served with this policy: the handler runs and
`img.__e.type === "error"`. Under the previous baseline, on the same page, it
did not run at all.

A site that overrides `script-src` replaces the baseline entry wholesale, so it
must carry both tokens itself or it reintroduces the violation.
