---
"@reddoorla/maintenance": patch
---

Close the query-plan gate's blind spot, and stop shipping report bodies to
compute booleans (2026-08-26 review).

**The gate tested function names, not predicate shapes.** It reported
`raw_scans=0` while three request-path raw scans of `submissions` shipped, because
`countSubmissionsFiltered` had exactly two hand-written scenarios — `{}` and
`{siteId}` — and both happen to land on an index. Its `formType`, `search` and
`reason` shapes were never planned at all. The `listSubmissionsFiltered` sibling —
same filter, same request — did get an "every WHERE shape" scenario; the count
running beside it never did, and the export-completeness check was satisfied
because it matches names.

Both functions are now driven off one `FILTER_CASES` record, `satisfies
Record<keyof SubmissionFilter, …>`, so a new filter key fails to compile until it
is added and then gets planned against every filtered function automatically. That
took the gate from 52 scenarios to 64 and immediately turned it red on exactly the
three predicted scans — which is the point of adding the scenarios before the fix.

**`form_type` had no index at all** (migration `0012`), so
`countSubmissionsFiltered({formType})` scanned the whole table twice per load of
the submissions page. `submissions` is the one unbounded-growth table in the schema
and Turso meters row scans, so that cost rises forever. Adding the index took the
count 3 → 2, measured as a delta rather than asserted.

**`search` and `reason` are genuinely unindexable** — leading-wildcard `LIKE`, one
of them over a concatenation expression — so they are now named allowlist entries
with the reason they are accepted (operator-only page, bounded by one person's
typing) and the condition to revisit (~10k rows, or the page becoming client-facing).

**Allowlist entries can no longer go stale.** An entry that no longer matches a
real scan is dead permission: it keeps a name exempted after a rename or a new
index, and silently re-permits a regression that reuses the name. Every entry must
still describe an observed scan. This caught one immediately — an entry added in
this very change that turned out not to be needed.

**The cockpit shipped 1.17 MB of report HTML per page load to compute 16
booleans.** `listAllReports` used `.selectAll()`, and `fleet-homepage.mts` owns
`path: ["/"]`. The column was read only to be tested for null. The identical
hazard was already solved for `sites` 320 lines up in the same file —
`SITE_COLUMNS` omits the header-image BLOB with a comment about Turso billing the
bytes, and a lockstep test keeps it honest — so `reports.rendered_html` now has
`REPORT_LIST_COLUMNS` and the same test. `listReportsForSite` had it too.

`reportRowFromDb` takes the body's presence as an argument now rather than reading
the column, so a list row and a full row are both honest inputs and nothing can
start depending on body _content_ without the type saying so.

**Hourly parity pulled the same 1.17 MB, 24×/day, to discard it** —
`rendered_html` was already a parity `SKIP_COLUMN`, but the read was still
`selectAll()`. It shares the projection now.

**The detector's "`USING` ⇒ fine" rule was wrong for a row-scan-metered store.**
It skipped any plan line containing `USING`, justified as "an index-ordered
traversal under a LIMIT stops early". True — but only when there IS a limit. An
aggregate has none and reads every row through the index, which costs exactly what
a raw scan does when the store bills rows rather than pages. `SCAN t USING
[COVERING] INDEX` now counts unless the statement carries a LIMIT.

That made **four** full traversals visible that the gate had never reported (the
review predicted three): `countSubmissionsFiltered({})`, `countNotifyBouncedBySite`
and `listScreenOutsSince`'s group-by on the cockpit request path, plus the digest
cron's `countSubmissionsSinceBySite`. Each is now a named allowlist entry with its
justification, not an invisible pass.

Three of them are **accepted, not fixed**. The real answer is to fold those
slow-moving "since a window" numbers into the nightly `digest_state` singleton the
homepage already reads by primary key — but that makes the figures up to 24 hours
stale, which is an operator's call rather than mine, so it is flagged rather than
taken.

One known gap is left explicit rather than guessed at: a LIMITed statement whose
filter carries a residual predicate the index cannot serve still scans the whole
table when few rows match, and EXPLAIN's output does not distinguish that from a
clean early stop.
