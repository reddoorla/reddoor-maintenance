---
"@reddoorla/maintenance": patch
---

Fix two client-facing strings in the announcement email.

The inbox preview line was hard-coded to "Your monthly report from Reddoor" —
wrong twice over: this email is the announcement, not a report, and it asserted
a monthly cadence that the body contradicts for every client on a quarterly or
yearly pace. It is now `Your ongoing site care for <site>`, interpolated like
the launch ("<site> is live") and maintenance ("Checked up on <site>")
templates already were.

The framework improvement callout now reads "our latest framework" rather than
"the latest framework".
