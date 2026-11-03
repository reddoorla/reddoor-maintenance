# 2026-11-03 — `report --test-send`, a Turso log of [TEST] sends, and the streak in code

P1-33(c), recommendation 5 of the workspace's `reviews/2026-10-06-two-touch-review/recommendations.md`, queued by the operator on 11-03.

**Why.** Every [TEST] email before this came from a scratchpad script that was never committed, and the clean-send streak lived in a hand-kept BACKLOG table that two passes counted as 1 and 0. The operator's auto-approve condition depends on that count. Now the sender is a command, every send is a row, and the count is one function over the rows.

**What.** `report --test-send <reportId|slug>` renders through `renderReportFromRow`, the function `sendOne` uses, and sends to `operatorEmail()` alone, with `[TEST] ` on the subject, no CC and no reply-to. It refuses `--to`, `--cc` and `--bcc` by name (the CLI parser passes unknown flags through, so without the check a `--to` would have been silently dropped, not refused). It has no way to write to `reports`: its dependencies carry no writer. Each send is a row in `report_test_sends` (migration 0054, beside `deadletter.ts` as `src/db/test-sends.ts`), keyed by an id minted before the send so the Resend idempotency key is per send. `--test-verdict` records `clean` or the problem; `--test-streak` prints the count and every row. The streak rule is #974's, verbatim: "The streak is the number of `clean` rows counted up from the bottom, stopping at the first row that is not `clean`. An `awaiting` row stops it too." The operator cut the BACKLOG table on 10-12 (item 107(e)); this is the computed replacement he queued on 11-03.

**Instruments that caught the new table.** Four existing tests went red before any fix, each correctly: the cockpit counter requires triggers on every table (0054 adds them rather than taking an exception), the backup verifier now hashes 14 tables, the query-plan gate needs every `src/db` module classified (`test-sends.ts` is exempt: CLI-only, a few rows read whole), and the migration-id lists.

**Mutations.** 11 of 11 red (`tests/reports/send/test-send.mutations.json`), including the two the brief named: let `--to` through, and send to the row's recipients.

**Not done here.** The recommendation's (d), the backfill of the BACKLOG table's rows (29 Navy clean, five 10-05 rows awaiting), was not in this brief and is not inferred: no verdict is written for the operator. Nor is a pm-pass step that prints the streak.
