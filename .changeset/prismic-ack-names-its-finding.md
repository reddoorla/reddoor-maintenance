---
"@reddoorla/maintenance": patch
---

A Prismic drift ack mutes only the finding it accepts (#1608). The new `sites.prismic_ack_drift` column (migration `0047_sites_prismic_ack_drift`) holds the drift report the operator reviewed, copied from `site_health.prismic_models_drift` when the ack is set (`PRISMIC_ACK_UPDATE_SQL`). While the ack is unexpired, `collectPrismicDriftAlerts` mutes a `fail` only if tonight's report is that same text (line endings and surrounding blank space aside). A field dropped from another model on an acked site now reaches the digest. An ack with no recorded finding, which is every ack set before this change, mutes nothing until it is set again. A drift report cut at the 50,000-character cap now carries a SHA-256 of the whole report in its truncation notice, so two reports that differ only past the cut no longer store identical text.
