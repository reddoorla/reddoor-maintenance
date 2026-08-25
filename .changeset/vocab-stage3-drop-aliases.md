---
"@reddoorla/maintenance": patch
---

Site-status vocabulary stage 3: the old Airtable names are gone from the code.

The operator deleted the seven retired options from the Airtable `Status`
single-select, so an old value can no longer be entered — which was always the
gate, rather than merely "none is stored". `AIRTABLE_STATUS_ALIASES`,
`AIRTABLE_OLD_NAMES` and `AIRTABLE_USES_NEW_VOCABULARY` are deleted, and both
`canonicalizeStatus` and `toAirtableStatus` reduce to the identity.

One behaviour changes, and it is intended: an old name is no longer translated.
`canonicalizeStatus("maintenance")` used to yield `maintained`; it now yields
`"maintenance"` verbatim, which `isUnrecognizedStatus` flags and the cockpit
surfaces as a watch row. A stored old value would now mean something went wrong
— a restored backup, a scripted write, a caller with a stale constant — and the
fleet should say so rather than absorb it into a status nobody chose.

Selection is unchanged: no fleet operation gains or loses a site.
