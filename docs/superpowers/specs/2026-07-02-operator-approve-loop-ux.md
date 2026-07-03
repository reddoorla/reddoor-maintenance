# Operator UX: the approve loop's blind spots — 2026-07-02

Status: proposal (code-mapped 2026-07-02 against `main` @ `7a52ab4`; every claim
cites the line it came from). Scope: the cockpit, the per-site approve flow, and
the "auto-checker" (checklist auto-tick + daily cron) — from the seat of the
operator who runs them.

## The core observation

**Approve is the highest-stakes click in the system, and it is the most
information-starved.** At the moment of approval the operator cannot see, on the
same screen: who will receive the email, what the email looks like, whether the
send will actually succeed, or when it will go out. Each of those exists
somewhere else:

- Recipients live far down the page in Site-details (render.ts:294-295), never
  echoed on the pending row; the forced global CC (orchestrate.ts:22) is shown
  nowhere at all.
- The rendered-email "view" link exists only in the report-history table
  (render.ts:172), a different section, only for the recent-6 slice — preview
  and Approve are never colocated (render.ts:135-142).
- Recipient/header validity is enforced only at send time inside the cron
  (orchestrate.ts:120-165); an Approved report can fail at 09:23 UTC with the
  error visible only as a red Actions run + GitHub issue.
- Approve returns `{status:"approved"}` and the button says "Approved"
  (approve-report.mts:112) — nothing says it now waits up to ~24h for the
  daily-reports cron (daily-reports.yml:11).

And the gate itself is uneven: the checklist gate covers Maintenance (6 items)
and Testing (13), but **Launch and Announcement have empty checklists and are
vacuously approvable** (checklist.ts:54-58) — i.e. the announcement rollout,
the highest-visibility send type, has no gate at all beyond Draft-ready.

## Proposals, in priority order

### 1. The approve card tells the whole story (S–M) — do this first

One change with most of the value. The pending row (render.ts:135-142) gains:

- **To/CC line** — resolved exactly as orchestrate.ts will (explicit To else
  point of contact, plus the forced `info@reddoorla.com` CC), so what the
  operator approves is what the send does.
- **Preview link** — the `renderedHtmlAttachment` URL already on the row.
- **Preflight chip** — run `preflightSite` (shipped in #350, pure function,
  data already fetched) server-side at render: green `preflight ✓` / red chip
  listing the fails. Approve button disabled on fails, same pattern as the
  checklist gate (render.ts:124-127).
- **Send-time line** — "sends at the next daily run (09:23 UTC, ~Xh from now)".

### 2. Approve from the cockpit + bulk approve (M)

"Waiting on your yes" rows are navigation-only by design (fleet-render.ts:183-
184); with the per-report gate made trustworthy by (1), that design constraint
can relax: an Approve button on each blue-band row (gated identically), plus
"approve all N that pass preflight + checklist" for send days. A 9-site
rollout is currently 9 page-loads on a phone.

### 3. Gate the cron on preflight, not on mid-run throws (S)

daily-reports.yml step 2 discovers bad rows by throwing (orchestrate.ts:135-165)
— one bad site turns the whole run red. Insert `preflight --all --type
maintenance` (and testing) before `--send-ready`: skip-and-report failing sites
in the digest instead of dying, send the clean ones. The command exists; this is
wiring.

### 4. A minimal Announcement/Launch checklist (S)

Close the vacuous-gate hole (checklist.ts:54-58) with 2–3 items that reflect
what actually went wrong in review: "Recipients verified (client address, not
ops)", "Header image reviewed" (Erik's 2026-07-01 timeless-hero note), "Copy
overrides read". Auto-tick "Recipients verified" from the preflight result.

### 5. Real-time bounce/complaint notice (S)

The Resend webhook already flips `Delivery status` (webhook-events.ts:9-11) but
the operator learns about a bounce from the NEXT day's digest
(digest-collectors.ts:125-148). Send a one-line operator email from the webhook
on bounce/complaint — the Resend client and templates are right there.

### 6. Mobile pass on the site page (S)

The operator approves from a phone. Viewport meta exists (render.ts:433) but the
7-column report-history table has no responsive treatment (render.ts:424-427)
and caps at recent-6 with no pager. Wrap tables in overflow scroll containers,
stack the pending card on narrow widths.

### Later / when the team starts approving

- Per-user identity: shared Basic auth + `APPROVED_BY = "dashboard"`
  (approve.ts:5) is fine solo; the moment nicole/tim/erik approve, the audit
  trail needs names (per-user tokens or basic-auth users).
- Cockpit filters for `pending`/`submissions` are deliberately excluded
  (fleet-browse-render.ts:192-193) — revisit once approve moves cockpit-side.
- Stale comment: dashboard/checklist.ts:23 says "12 known checklist columns";
  ALL_CHECKLIST_FIELDS is 13. Comment-only fix.

## What was checked and found healthy

Worst-band-wins verdict + accepted-watch suppression (fleet-cockpit.ts:73-96,
141), the single `isPendingApproval` predicate shared by every surface
(reports.ts:69), idempotent approve (approve-report.mts:113-118), checklist
auto-tick's fail-safe freshness rules (auto-tick.ts:9-42), at-least-once send
with next-day retry (daily-reports.yml:59-70), and the no-noise digest skip
(digest.ts:81-91) are all doing their jobs.
