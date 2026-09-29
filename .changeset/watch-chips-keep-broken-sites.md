---
"@reddoorla/maintenance": patch
---

A broken site no longer drops out of the cockpit's watch filter chips. `assignTier` used to return early, with no watch tags, for any attention item or failed deploy, so a site that was both broken and on `*.netlify.app`, or missing a GA4 or Search Console property, or stale, was missing from the `no-domain`, `no-analytics`, `search-console-unrecorded` and `stale` chips. Every one of those chips undercounted exactly the sites that were also broken (#941). A broken site now carries its un-accepted watch conditions in `watchSignals` and keeps tier `attention`. Its `watchReasons`, `watchAcceptKeys` and `acceptedReasons` stay empty, so the tier counts, the Needs-you feed and the verdict line do not change.
