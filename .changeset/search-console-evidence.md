---
"@reddoorla/maintenance": minor
---

The "Search Console set up" launch check now passes only on evidence (#943). A recorded property no longer passes it on its own.

- **What is stored.** Every report draft and announcement whose Search Console lookup runs writes the result to `site_health`, in three new columns (migrations `0035`–`0037`):
  - `search_console_outcome`: `resolved`, `no-property` or `soft-fail`;
  - `search_console_resolved`: the property the query ran against, or NULL unless the outcome is `resolved`;
  - `search_console_checked_at`: when the lookup ran.
- **When nothing is written.** A lookup that did not run writes nothing, so an environment without credentials never erases the evidence. That covers a site that is not enrolled, one that opted out, and a run with no GA credentials.
- **When the check passes.** It passes on a `resolved` lookup inside the site's own report cadence plus 14 days: 45 days for a monthly site, 106 for quarterly, 380 for yearly, using the shorter of the maintenance and testing cadences. A "no search console" opt-out still passes, and it wins over any stored outcome.
- **When it does not pass.** A soft-fail reads as unknown, never as pass, and so does a missing or unparseable timestamp. The setup line names which case applies: no lookup on record, no property matched `<host>`, the last lookup errored, or the last resolved lookup is older than the window.
- **The cockpit watch.** The watch `search-console-unrecorded` ("Search Console property not recorded") is replaced by `search-console-no-property`. It is raised only when a maintained site's last lookup matched no property, and it names the host and the lookup date. The "no search console" keys still mute it.
- **API change.** `SearchPresence` gains `property`, the property the query ran against.
