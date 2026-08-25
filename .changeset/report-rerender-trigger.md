---
"@reddoorla/maintenance": patch
---

"Refresh preview" for a report, from the console.

Adds `report-rerender.yml` (dispatch-only) and a button beside the preview link
on any unsent report. Clicking it dispatches the workflow, which runs
`report --rerender` where sharp already works and stores the fresh body where the
preview route reads it.

`dispatchWorkflow` gains optional `workflow_dispatch` inputs, omitted from the
request body entirely when absent — a workflow that declares none rejects an
`inputs` key it did not ask for.

The sent-report guard is duplicated in the handler rather than left to the
workflow, so an operator gets an immediate refusal instead of a red run two
minutes later saying the same thing.
