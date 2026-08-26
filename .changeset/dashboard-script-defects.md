---
"@reddoorla/maintenance": patch
---

Fix four defects in the dashboard's browser script (2026-08-26 review).

All four live in code no test had ever executed — the page's interactivity ships
as one inline `<script>` built from a template literal, and the suite runs
`environment: "node"`. That is the same blind spot that shipped #595 (a checkbox
and a multi-select that rendered perfectly and could not save).

**A saved field re-POSTed on every later blur, forever.** The blur listener fires
on `value !== defaultValue`, and `saveDetail` never touched `defaultValue` — so
after one successful edit the two stayed different until the page was reloaded,
and every subsequent focus+blur wrote to Airtable again. The commentary handler 40
lines below always did resync, which is what marks this as an oversight. The worst
case was the `secret` kind: it deliberately emits no `value` attribute so a
credential is never echoed into the HTML, pinning `defaultValue` at `""` — so
every blur after typing re-sent the credential. One Airtable quota exhaustion has
already reddened six workflows fleet-wide, so tabbing through this form was a
cheap way to burn the write budget. `saveDetail` is now exported as source and
executed against stubs, including a control proving a FAILED save stays dirty so
the next blur retries.

**Approve state reached only one of two buttons.** The same pending report renders
twice — pending list and reports history — so one report id owns two Approve
buttons. The click handler updated the clicked one; the override handler used
`document.querySelector`, singular. After Approve or Override the twin still read
"Approve" and, with the gate clear, was still enabled. All four state paths
(initial disable, success, `!res.ok`, network rejection) now map over every twin —
including the failure paths, since leaving a twin disabled strands it unusable.

**A datetime in a date cell could silently clear the schedule with no user edit.**
`<input type="date">` accepts only `YYYY-MM-DD`; handed an ISO datetime the
browser sanitizes `.value` to `""` while `.defaultValue` keeps the raw string, so
the blur guard fires on an untouched tab-through and the server accepts `""` as a
deliberate clear. `maintenanceDay` / `testingDay` drive the code-owned next-due
schedule. Dormant while those Airtable columns stay date-only — it goes live the
instant anyone ticks "include time". Closed at both ends: the renderer truncates
to the date part, and a save now requires a real `input` gesture as well as a
changed value, which kills the whole class rather than this one instance.

**`rfPhase` was dead on both ends.** It mapped a GitHub step name onto a human
phase line, carefully ordered and commented, and `summarizeFleetRunStatus`
returned `step: null` unconditionally — so the line never rendered once. Removed
rather than wired: the step name only comes from the per-run _jobs_ endpoint, so
filling it would add a GitHub call per workflow per 10-second poll on a request
path, for one line the elapsed/ETA line already covers. Its test asserted the dead
string was _present_, and another claimed "endpoint fills it for in-progress runs";
both now pin the absence.

Also: the cockpit's one `innerHTML` sink escapes its interpolations and gates the
run link on an `https://github.com/` prefix. The values are server enums and
GitHub `html_url`s, but it builds markup from a remote response, and everywhere
else on these pages the rule is that no server string becomes HTML.

And the prospect-audits page joins the inline-script parse gate. Its 50-line
`RUN_SCRIPT` cites the exact build-time-`\n` incident the gate exists to catch,
and it was the one dashboard page the gate never covered.

Four smaller items in the same area:

- The **parse gate had two blind spots**. It matched only `<script>` with no
  attributes, so a future `<script type="module">` or a nonce would be skipped in
  silence — a gate that stops looking still reports green. And it could not see
  inline handler attributes (`onsubmit=`), which are JavaScript too and fail more
  quietly, for one control rather than the page. Both are covered now, with
  self-tests that fail a broken attributed tag and a broken handler, and a positive
  control so the gate is not merely throwing on everything.
- **`scriptLiteral`** joins `escapeHtml` in `src/util/html.ts`. A `<script>`
  element's content is raw text — the HTML parser does not decode entities inside
  it — so `escapeHtml` reaching a script body corrupts the JavaScript instead of
  escaping it, while looking like the house style. There was no correct tool to
  reach for; now there is, and its test compiles the emitted literal to prove
  `</script>` and `<!--` round-trip as data.
- **The multi-select comma invariant is asserted.** The value is comma-joined
  client-side and split on `/[,\n]/` server-side, which round-trips only while no
  option contains a comma. An option like "Deploy failed, retried" would have
  silently arrived as two conditions.
- **The override toggle no longer depends on `nextElementSibling`.** Adjacency is a
  markup accident; anything inserted between the toggle and its form would kill
  "Send anyway…" silently. It uses the `.override` wrapper the markup already
  provides — the same `closest()` contract the submit handler six lines below uses.
