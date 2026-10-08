## 2026-10-08 — "Refresh preview" is drawn for an approved, unsent report (P1-36 follow-up)

This corrects the previous entry,
`2026-10-08-1612-rerender-lookup-writeback`. That entry said "the operator
presses refresh preview on Data Dynamiq's and LAHI's October reports", and
P1-36's merge (#1268) gave the same instruction. The operator could not do
it: "can't click refresh preview on an already approved draft". The
backend path was right. The report-rerender endpoint refuses only a sent
report, and the workflow now runs the lookup for an approved one. But
`src/dashboard/render.ts` draws `rerenderButton` only in `pendingRow`. An
approved, unsent report renders in the history table, where its single
action was Unapprove (#1270, which landed an hour before).

How it was missed: I read `rerenderButton`'s own guard (`sentAt !== null`
→ no button) and took "unsent" to mean "shown". I never looked at its one
call site. That is the CLAUDE.md "read the implementation" corollary, applied
to a function instead of to where it is used. A verification that would have
caught it: render an approved report's page in a test and look for the
button. The new tests do exactly that.

The fix puts `rerenderButton` beside `unapproveButton` in the same branch,
so it shows only while `sendStartedAt` is null. A claimed, sent or withdrawn
report gets none. Two mutations: removing it (the old code) and drawing it on
a claimed row each turn a test red.

Until this deploys there is a workaround that needs no code: Unapprove, then
refresh preview in the pending list, then Approve. Today's 16:07Z send
had already run, so neither report sends before tomorrow's.
