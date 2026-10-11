## 2026-10-08 — An approved report can be taken back, and the send claims each report before Resend (#1262, #1270, Operator decisions 100 in #1266)

The operator asked from the cockpit for an "unapprove" on pending reports. The
trigger was Data Dynamiq's October Maintenance report. It was approved at
15:11:12Z, and its refresh preview at 15:11:32Z found the row approved and
locked the scores (`REPORT_RERENDER … scores=locked`). The report therefore
kept best practices 78 against a live 100. Nothing on the dashboard could
undo that: withdraw refuses an approved row, and the next `--send-ready` run
would have mailed it.

The unapprove itself was straightforward to build. It is a decision function
like `withdraw.ts`, an endpoint with withdraw's gates, and an SQL-guarded
write that clears the approval and stamps `unapproved_at` / `unapproved_by`
(migrations 0041–0042). It also clears `send_override`, because a later plain
approve would otherwise inherit a health-gate bypass: `isSendOverridden`
needs the flag and a reason, and the reason stays as the record.

**The brief's assumption that did not hold.** The brief said the guard
`sent_at IS NULL` means "the send wins" if a send is in flight. It does not.
`sendApprovedReports` reads its queue once, renders and calls Resend per
report, and stamps `sent_at` only after Resend answers. So the guard sees a
finished send, not one in progress. This was reproduced before anything was
claimed, through the real send loop and the real handler on one temp libSQL
database. An unapprove fired inside the Resend call answered 200
`unapproved`, the email went out, and the row ended `approved_to_send = 0`
with `sent_at` set. The control, the same unapprove before the queue read,
sent nothing. That is exactly the brief's stop condition, so it went to the
operator as Operator decisions 100. The item was 99 when written; another
session's #1264 took 99 while #1266 was landing. The operator chose
"claim before send".

One more fact made the window matter. Operator decisions 98 (answered the same
morning) moves client sends to a fixed 16:07Z. That is inside the operator's
working day, when the dashboard is open.

**The claim, and what review found in it.** `claimReportForSend` sets
`send_started_at` (migration 0043) right before Resend, guarded like the send
queue's WHERE. The unapprove refuses a claimed row. Three review lenses ran in
round 1. Two of them reproduced the same two defects independently:

- The claim checked only the flags, so an unapprove, refresh and re-approve
  that all landed between the queue read and the claim passed it. The batch
  then sent the body it had rendered from its stale read (92 went out where
  the row read 37). The claim now also requires `approved_at` to equal what
  the queue read. Every approve writes a fresh one, so the stale copy is
  skipped and the next run sends the new one. The test carries a control: the
  original render contains no "37".
- A claim was never released, so a send Resend refused (a 422) left the row
  un-unapprovable and un-withdrawable for as long as the refusal repeated. The
  client now keeps the SDK's error name. Reading the SDK
  (`resend/dist/index.mjs` `fetchRequest`) showed that network failures and
  unparseable 5xx responses all come back as `application_error`, so only
  other names count as a refusal that releases the claim.

Round 2 reproduced no defect through a production entry point. It found that
the two idempotency 409s were classed as releasable once the name was carried.
`isIdempotencyConflict` reads the message, not the new property. This is now
fixed. One gap is left by design, and it is in the PR body: if a claim is kept
after an ambiguous failure and every later run fails before the claim, the row
cannot be taken back from the dashboard. That is the price of "the send wins
once claimed". The page now says "Send started <time>" rather than "Sending".

Seventeen mutations, the brief's four among them, each turn a test red; the
table is in #1270.

A process note. The docs-only decision PR conflicted twice on `BACKLOG.md`
while landing, once on the same item number. The second conflict cost one
re-run of CI, not a wrong merge, because `land-prs.mjs` stops on `DIRTY`.
