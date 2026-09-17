---
"@reddoorla/maintenance": minor
---

The batch jobs read the fleet roster from Turso (#539 Phase 6 step 4, #646). `readFleetRoster` (`src/fleet/roster.ts`) replaces `listWebsites` in the audit write-back (fleet and single-site), `github-signals`, `renovate-dispatch`, `header-image` and the `prismic-models` verdict sink. Until now those jobs matched their results against the Airtable Websites table, so a site created by the Turso-native `ensure-site` — a `site_<ULID>` id with no Airtable record — was either never swept or failed its write-back with "No Websites row matched". Airtable shadow writes are unchanged: every writer skips a non-`rec` id itself and logs the skip. `runFleetWriteBack`, `runGitHubSignalsCommand` and `runRenovateDispatchCommand` take the roster as an injectable dependency. `header-image --all` now decides "has no header image yet" from `sites.header_image*` (the bytes reports render from) instead of the Airtable attachment.
