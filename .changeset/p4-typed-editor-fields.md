---
"@reddoorla/maintenance": patch
---

Dashboard site editor: the two non-text fields (#539 Phase 4).

`Require Turnstile` (a checkbox) and `Accepted Watch Conditions` (a
multipleSelects) cannot be written as strings, so `updateSiteField` and
`mirrorSiteField` now take `AirtableCellValue` (`string | boolean | string[]`)
and the values travel as themselves.

The coercion to Turso's `1/0` and JSON-array storage is NOT repeated in the
mirror — it is delegated to the importer's own `siteValueFor`, newly extracted
and now used by both. Parity compares raw-to-raw, so a mirror storing `"true"`
where the importer stores `1` would red every hourly run; a test asserts the two
paths agree byte-for-byte.

An unknown watch condition is refused rather than sent. The records API would
create a missing select option as a `typecast` side effect — the
silent-option-creation hazard this codebase refuses everywhere.

Known gap, operator-owned: the cockpit supports a `turnstile-unverified` accept
key and the Airtable field has no option for it, so that one condition still
cannot be accepted from the console. Adding the option is a UI action; the API
cannot create select choices.
