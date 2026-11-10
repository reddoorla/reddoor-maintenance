---
"@reddoorla/maintenance": patch
---

dashboard: the cockpit snapshot no longer sends an acked site's Prismic drift report a second time (up to 50,000 characters). The server answers whether the ack names tonight's report (`prismicAckNamesReport`) and nulls `prismicAckDrift`; `prismicAckCovers` reads that answer in the browser and still checks the ack's expiry there (#1679).
