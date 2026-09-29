---
"@reddoorla/maintenance": patch
---

The client Maintenance and Testing email no longer shows a checklist row whose evidence is `n/a`. A site with no CMS no longer gets "CMS Checked ✓", a site with no contact form no longer gets "Form Functionality ✓", and a repository with no CI no longer gets "Tested After Updates ✓". The row is left out, not marked "N/A". Rows whose evidence is `pass`, `fail` or `unknown`, and rows with no evidence record, render as before. The pre-send gate is unchanged.

The same rule applies on every path that renders the email: the send, the stored draft body behind the dashboard preview, "refresh preview", `report --preview`, and `selftest email`. If a whole list is `n/a`, its heading and intro are dropped with it.

A draft stored before this release keeps its old body, n/a rows included, until someone clicks "refresh preview" on it. Its send already renders from the row and drops the rows.
