---
"@reddoorla/maintenance": minor
---

form-e2e now finds the contact form on one-page sites.

The probe hard-coded `/contact`. On a site whose only form lives on the homepage
that route 404s, so the audit recorded `formPresent: false` — "checked, no contact
form" — and moved on. That verdict is n/a rather than a failure, so nothing went
red: the site's only conversion path was unmonitored while the cockpit looked
clean. 1836dig is exactly this shape.

The probe now walks `CONTACT_PATHS` (`/contact`, then `/`) and submits against the
first route that renders a `<form>` carrying an email field. `/contact` stays
first, so sites built from the starter still resolve in a single navigation.

A `<form>` with no email input no longer counts as a contact form — homepages
often carry a search or newsletter form, and submitting one would have reported a
false pass.

The route-discovery loop is exported as `findFormPath`, taking a structural
`FormProbePage` rather than a Playwright `Page`, so it is unit-tested without
launching a browser. Previously this logic sat inside `defaultFormRunner` and no
test could reach it.
