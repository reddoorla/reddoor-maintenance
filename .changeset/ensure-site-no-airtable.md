---
"@reddoorla/maintenance": minor
---

`ensure-site` no longer consults Airtable

`ensureSite` drops its legacy Airtable dependency:
- The #645 heal lookup is gone. It looked up a slug in Airtable when Turso had none.
- So is its adopt step.
- So is the shadow copy of a `rec` site's filled fields.

A new slug is created straight in Turso. Before, the lookup ran whenever Airtable
credentials existed and refused the create when Airtable failed, so onboarding
was blocked while the Airtable API quota was exhausted.

Airtable has received no writes since 2026-08-31's freeze plus the shadow switch.
Every Airtable site was imported then (`FLEET_PARITY sites=44`), so no site can
exist only in Airtable. `EnsureSiteDeps.airtable`, `LegacyAirtableSites`,
`EnsureSiteResult.healedDbRow` and `EnsureSiteResult.airtableShadow` are removed.
The CLI's stale "invisible to Airtable-enumerated batch jobs" note goes too:
every batch job has enumerated from Turso since 09-17.
