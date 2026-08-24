---
"@reddoorla/maintenance": minor
---

Header images no longer bake "Your website maintenance is complete." into every
report type. The generator now composes on a CLEAN plate (no headline), and the
send path stamps the report type's headline onto the stored image: Maintenance
gets its headline overlay; Announcement, Launch, and (for now) Testing go out
clean. Testing's overlay is absent because its 2026-08-20 Figma export shipped
flattened onto an opaque red rectangle — re-export it transparent and register
it in HEADLINE_FILES to enable it. Stored pre-switch headers keep their baked
headline until the site's next draft regenerates them; drafting refreshes the
header, so this self-heals within one report cycle (or run
`header-image --all --force`).
