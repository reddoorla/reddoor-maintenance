---
"@reddoorla/maintenance": patch
---

`createIngestAction`'s `buildPayload` may now be async, matching
`createIngestEndpoint`.

Without this, CMS-authored auto-replies were reachable only from sites using the
JSON endpoint. Every site on a SvelteKit form action — which is what
`reddoor-starter` generates, so most of the fleet — had no way to await a CMS
read and could not adopt the feature at all.

Also closes the same gap the endpoint had: a promise-returning `buildPayload`
previously escaped the try/catch as an unhandled rejection instead of the
documented failure result.
