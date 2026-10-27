# Maintenance/Testing Checklist Gate — Design

**Date:** 2026-06-17
**Status:** design (approved in conversation)

## Goal

Turn the report email's static "all done" checklist into a **real operational gate**: per-item checkboxes the operator works through (in Airtable AND on the dashboard), where a Maintenance/Testing report **cannot be approved or sent until every item for its type is checked**. The client email is unchanged — its checklist is now _guaranteed_ accurate because nothing escapes the gate.

## Decisions (settled in conversation)

- Per-item checkboxes live **on the Reports row in Airtable** and are **interactive on the dashboard per-site page** (tick them there; writes back to Airtable via an endpoint, same pattern as the existing Approve / submission-status buttons).
- The dashboard **Approve** button is disabled until all of that report's items are checked; the **approve action and the send path both hard-enforce** completeness server-side.
- The **email is unchanged.**
- **Maintenance** reports gate on the 6 maintenance items; **Testing** on the 6 testing items; **Launch/Announcement** have no checklist (gate is vacuously satisfied).
- Items default **unchecked** on a new draft → the operator flips them.

## Source of truth: a checklist module

New `src/reports/checklist.ts` is the single source mapping each item's stable identity to its display label and its Airtable column:

```ts
export type ChecklistItem = { key: string; label: string; field: string };
export const MAINTENANCE_CHECKLIST: ChecklistItem[] = [
  { key: "logs", label: "Reviewed Logs", field: "Maint: Reviewed Logs" },
  { key: "cms", label: "CMS Checked", field: "Maint: CMS Checked" },
  { key: "dns", label: "DNS Checked", field: "Maint: DNS Checked" },
  { key: "google", label: "Google Indexed", field: "Maint: Google Indexed" },
  { key: "cert", label: "Reviewed Certificate", field: "Maint: Reviewed Certificate" },
  { key: "security", label: "Security Updates", field: "Maint: Security Updates" },
];
export const TESTING_CHECKLIST: ChecklistItem[] = [
  { key: "desktop", label: "Desktop Browsers", field: "Test: Desktop Browsers" },
  { key: "mobile", label: "Mobile Browsers", field: "Test: Mobile Browsers" },
  { key: "packages", label: "Package Updates", field: "Test: Package Updates" },
  { key: "bottle", label: "Bottlenecks", field: "Test: Bottlenecks" },
  { key: "forms", label: "Form Functionality", field: "Test: Form Functionality" },
  { key: "animation", label: "Animation Functionality", field: "Test: Animation Functionality" },
];
export function checklistFor(type: ReportType): ChecklistItem[]; // Maintenance|Testing → its list; else []
export function isChecklistComplete(report: { reportType; checklist }): boolean; // every item.field === true; [] → true
```

The `label`s mirror `DEFAULT_COPY.maintenanceChecks` / `testingChecklist` (what the email renders). A test asserts they stay in sync so the operator's checklist and the client's checklist never drift.

## Component changes

1. **Airtable (Reports table):** add **12 checkbox fields** named exactly as the `field` values above. Created via the API (`create_field`, type `checkbox`) — done as a setup step, NOT by the build's tests (which use the fake base).
2. **`src/reports/checklist.ts`** — the module above (pure).
3. **`src/reports/airtable/reports.ts`**
   - `ReportRow` += `checklist: Record<string, boolean>` — `mapRow` reads each of the 12 checkbox fields into it (keyed by field name; missing/false → false).
   - Re-export / use `isChecklistComplete` for the gates.
4. **`src/dashboard/approve.ts`** — before flipping `Approved to send`, reject when `!isChecklistComplete(report)` with a clear status (`reason: "checklist-incomplete"`); the dashboard surfaces it.
5. **`src/reports/send/orchestrate.ts`** — `sendOne` (or the selection) hard-skips a Maintenance/Testing report whose checklist is incomplete: throw/skip with a clear message (defensive — covers "Approved to send" ticked directly in Airtable without finishing the checklist). At-least-once semantics unchanged (Sent at stays null → retried).
6. **`netlify/functions/report-checklist.mts`** — new authed JSON `POST` endpoint (mirror `submission-status.mts` / the approve endpoint): body `{ reportId, field, value }`; validate `field` is a known checklist column (reject otherwise — no arbitrary Airtable writes); update the one checkbox; return `{ ok, complete }` (so the client can flip the Approve button without a reload).
7. **`src/dashboard/render.ts`** — in the pending-approval section, for each pending Maintenance/Testing report render its checklist as **interactive checkboxes** (current state from `report.checklist`), and disable the **Approve** button until all are checked. Client JS: on checkbox change → POST to the endpoint → on `{complete}` toggle the Approve button's disabled state. Non-pending reports just show the checklist read-only (or omit). Escape everything; reuse the existing button/endpoint JS pattern.

## Edge cases

- **Launch/Announcement:** `checklistFor` → `[]`, `isChecklistComplete` → true → no gate, no checkboxes rendered.
- **Legacy reports** (created before the fields existed): the 12 cells read false → such a report can't be approved/sent until ticked. Already-sent reports are unaffected (Sent at set). Acceptable.
- **Endpoint safety:** only the 12 known field names are writable; an unknown `field` → 400. Auth required (same gate as the rest of the dashboard).
- **Approve race:** server-side gate in BOTH approve.ts and orchestrate.ts means the disabled button is a convenience, not the enforcement.

## Testing strategy

- `checklist.ts`: `checklistFor` per type; `isChecklistComplete` (all/partial/none, and `[]`→true for Launch/Announcement); labels match `DEFAULT_COPY`.
- `reports.ts`: `mapRow` reads the 12 checkboxes into `checklist`; missing → false.
- `approve.ts`: blocks when incomplete, allows when complete.
- `orchestrate.ts`: an incomplete Maintenance/Testing report is NOT sent; a complete one is; Launch/Announcement send regardless.
- endpoint: rejects unknown field; updates a known one; returns `complete` correctly.
- `render.ts`: pending report shows the right checklist with state; Approve disabled until complete; Launch/Announcement show no checklist.

## Out of scope

- Per-site custom checklists (items are global per type, matching today's copy). Per-site is a future lever.
- Changing the email template or what the client sees.
- Auto-deriving any item (all 12 are manual flips, incl. "Google Indexed").
