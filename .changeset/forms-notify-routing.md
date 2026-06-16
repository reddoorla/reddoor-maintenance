---
"@reddoorla/maintenance": minor
---

Field-based notification routing for form submissions. A site can now set a
`Notify Routing` JSON column on its Airtable Websites row
(`{field, routes, default?, cc?}`) to address the submission notification by the
value of a submission field (e.g. route a contact form's `interest` to a
different recipient per option), with support for multiple recipients and CC.
Recipients resolve server-side from Airtable only — the submitting site never
supplies an address. The config is parsed defensively (bad/blank JSON → the
site keeps its existing single-POC behavior) and is inert until set, so the
change is a no-op for every current site. The verify guard is preserved:
pre-launch sites still route to the operator with no routing or CC.
