---
"@reddoorla/maintenance": minor
---

`reddoor-maint report --test-send <reportId|slug>` emails the operator, and only the operator (`operatorEmail()`), the exact email a report row would send, rendered through `renderReportFromRow` like the real send, with `[TEST] ` on the subject, no CC and no reply-to. A slug picks the site's newest unsent, unwithdrawn report. It refuses `--to`, `--cc` and `--bcc`, and never writes to the report (no `sent_at`, no approval). Each send is logged in the new `report_test_sends` table (migration 0054) with verdict `awaiting`. `report --test-verdict <sendId> clean|"<what was wrong>"` records the operator's verdict, and `report --test-streak` prints the clean-send streak: clean rows counted back from the newest, stopping at the first that is not clean (`TEST_SEND_STREAK streak=N sends=N awaiting=N`, then every row).
