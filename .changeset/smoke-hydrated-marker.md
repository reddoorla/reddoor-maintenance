---
"@reddoorla/maintenance": patch
---

The `smoke-suite` recipe now uses `hydrationMarker: "html[data-hydrated]"` as the marker it scaffolds. Only a mounted root layout writes that attribute, so the marker proves hydration; the old `footer` marker was server-rendered and also matched with the bundle missing (#947). The recipe uses the new marker only when the site's Svelte source writes it. reddoor-starter#184 adds the write to the template. Other sites fall back to `footer`, then `main`, then `body`, and get a note saying this proves paint, not hydration. The scaffolded spec waits up to 20 s for the marker, because a cold dev server takes 5–7 s to compile the client bundle.
