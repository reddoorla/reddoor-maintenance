---
"@reddoorla/maintenance": patch
---

Report emails now attach only the inline images they actually render. The blurred-tests image
(`cid:rd-blurred-tests-jpg`) is referenced solely by the Maintenance template, yet `sendOne`
previously attached it — plus the green check — to every report type, leaving a dangling inline
part that some mail clients surface as a stray downloadable attachment on Testing, Announcement,
and Launch emails. The send path now gates each bundled image on its `cid` appearing in the
rendered HTML: the header attaches always, the check on every type except Launch, and the
blurred-tests image only on Maintenance. Self-correcting if a template's image usage changes.
