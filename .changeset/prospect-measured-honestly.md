---
"@reddoorla/maintenance": patch
---

Prospect audits no longer report two numbers they never measured: `mixedContent.measured` is now true only when the crawl actually recorded image sources (an older stored report replayed used to read as "we checked and found none"), and `AnswerSpace.queriesAsked` counts the category probes dispatched rather than only the ones that came back.
