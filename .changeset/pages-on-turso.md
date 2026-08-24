---
"@reddoorla/maintenance": minor
---

feat(dashboard): the cockpit, site page, and approve gate read from Turso
(#539 Phase 2 — the last request-path repoints)

fleet-homepage and site-dashboard now read sites, health, and reports from
Turso as their core data (a Turso failure 502s cleanly rather than rendering a
misleading empty page); Airtable remains only for the digest NEW-badges.
approve-report's gate reads (report by id, site by id) come from Turso — kept
current within the same request by the #563 write mirrors — while its writes
stay on Airtable + mirror. With this, every dashboard and forms request path
reads fleet state from Turso; Airtable requests on the hot paths are down to
the editor's write, the approve/override write, the webhook's delivery-status
write, and the digest state.
