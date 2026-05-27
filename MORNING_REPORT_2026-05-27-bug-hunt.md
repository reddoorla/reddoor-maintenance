# Morning Report — Bug-hunt Addendum (2026-05-27)

Driven by Tucker's request "do another deep review looking for bugs and check each test also." Three parallel adversarial agents covered: source code logic, test quality, Airtable contract realism. This addendum supersedes the earlier MORNING_REPORT_2026-05-27.md severity bucketing for the bugs it surfaces — everything below is **new** information.

**Headline:** the 0.7.0 reports code as it stands today will fail to send a working email. The Resend SDK contract is wrong, and even before that, every Websites row in production is missing the prerequisite data. Multiple silent date-math bugs and a real duplicate-send race round out the BLOCKER tier.

**Verification:** `pnpm typecheck && pnpm test && pnpm build` still all pass — none of these are caught by the existing harness. The first three findings each ship a broken email or worse on the first real `--send-ready`.

---

## BLOCKER

### B1 — Resend SDK silently drops `content_type` / `content_id`; every email's header image is broken

**File:** [src/reports/send/orchestrate.ts:96-104](../reddoor-maintenance-reports/src/reports/send/orchestrate.ts#L96-L104), [src/reports/send/resend.ts:10-15](../reddoor-maintenance-reports/src/reports/send/resend.ts#L10-L15)

The orchestrator builds attachments with `content_type` and `content_id` (snake_case). The Resend Node SDK's `Attachment` interface is **camelCase**: `contentType` and `inlineContentId`. The SDK does not validate unknown keys — it silently drops them.

Consequence: every Maintenance/Testing email ships with the header image attached as a regular downloadable file (no `Content-ID` MIME header). The HTML `<img src="cid:acme-header">` resolves to nothing. Clients see a broken image PLUS an unexpected attachment they didn't ask for.

**Reproduction:** trigger any real send. Inspect the raw MIME of the delivered message — no `Content-ID: <X>` header on the attachment part. The fake-client contract test at [tests/reports/send/orchestrate.test.ts:23](../reddoor-maintenance-reports/tests/reports/send/orchestrate.test.ts#L23) passes because it captures the misnamed keys on a fake; the SDK is the only thing that knows the names are wrong.

**Fix:** rename in `ResendSendInput` (`resend.ts:10-15`) and the call site (`orchestrate.ts:97-103`):

- `content_type` → `contentType`
- `content_id` → `inlineContentId`

Tighten by typing `attachments` with the actual SDK type: `Parameters<Resend["emails"]["send"]>[0]["attachments"]`. Then a future name drift is a typecheck failure.

### B2 — Send/stamp race: Resend 200 then Airtable failure → next run re-sends to client

**File:** [src/reports/send/orchestrate.ts:107-109](../reddoor-maintenance-reports/src/reports/send/orchestrate.ts#L107-L109)

```ts
const result = await client.send(payload);
await stampSent(base, report.id, new Date(), result.messageId);
```

If Resend returns 200 (email is in flight) and the `stampSent` Airtable call throws (network blip, rate limit — Airtable's SDK has no built-in retry), `Sent at` stays `BLANK()`. Next `--send-ready` sees the row in `listSendableReports` and re-sends. Client gets the same report twice.

**Reproduction:** simulate by stubbing `stampSent` to throw after the fake client returns success; run `sendApprovedReports` twice. The second invocation reships.

**Fix:** two complementary moves:

1. **Idempotency key on Resend** — Resend's SDK `CreateEmailRequestOptions extends IdempotentRequest`. Pass a stable key like `report:${recordId}:${reportId}` so a re-send is a no-op on Resend's side regardless of Airtable state.
2. **Stamp-before-send** — write a `Send in progress` flag (or set `Sent at` to a sentinel ISO) before the Resend call; finalize after. Rollback on Resend rejection.

### B3 — Airtable formula `FIND("recX", ARRAYJOIN({Site}))` does substring matching

**File:** [src/reports/airtable/reports.ts:149](../reddoor-maintenance-reports/src/reports/airtable/reports.ts#L149), [src/reports/airtable/reports.ts:192](../reddoor-maintenance-reports/src/reports/airtable/reports.ts#L192), [netlify/functions/resend-webhook.mts:52](../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts#L52)

Two distinct subproblems:

**(a) `listReportsForSite`'s `FIND(siteId, ARRAYJOIN({Site}))` matches substrings.** Airtable record IDs are `rec` + 14 alphanumerics. A site whose id is `recABCDEF000001` matches `recABCDEF000001X` too. Realistic? Rare. But because the orchestrator iterates `listReportsForSite` once per site (the N+1 from the morning report), one prefix-collision site silently pulls in another's reports.

**(b) `messageId` from the Resend webhook is interpolated raw into a formula.** The webhook is internet-exposed (Netlify Function URL). A signed but malformed `messageId` containing `"` corrupts the formula. Practical exploit is low — Resend signs everything — but the pattern is now codified and will be copied.

**Fix:**

- Add an `escapeFormulaString(s)` helper (escape `\` and `"`); use it at both call sites.
- For the site-id lookup, drop `FIND/ARRAYJOIN` and use a proper equality check. Since `Site` is `multipleRecordLinks`, Airtable's `ARRAYJOIN({Site}, ",")` produces a single comma-separated string; wrap with sentinels: `FIND(",${escape(siteId)},", "," & ARRAYJOIN({Site}, ",") & ",") > 0`. Or simpler: change the `Site` field to `prefersSingleRecordLink: true` in Airtable and use `{Site} = "${escape(siteId)}"`.

### B4 — `addMonths` overflow: Jan 31 + 1 month = March 3 (skips a month)

**File:** [src/reports/due.ts:20-24](../reddoor-maintenance-reports/src/reports/due.ts#L20-L24)

```ts
function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}
```

Verified empirically (Node REPL):

- `addMonths(2026-01-31, 1)` → **2026-03-03** (should be Feb 28)
- `addMonths(2026-08-31, 1)` → **2026-10-01** (should be Sep 30)
- `addMonths(2026-03-31, 3)` → **2026-07-01** (should be Jun 30)
- `addMonths(2026-11-30, 3)` → **2027-03-02** (should be Feb 28)

For Monthly maintenance, a site whose last send was Jan 31 is "due" March 3 instead of Feb 28 — the Feb report effectively disappears. For Yearly testing on a Feb 29 site (leap-day setup), similar weirdness. None of the existing tests in `tests/reports/due.test.ts` exercise overflow; all use mid-month fixtures.

**Fix:** clamp to the last day of the target month:

```ts
function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}
```

Note the switch to UTC accessors — fixes B5 simultaneously.

### B5 — `findDueReports` mixes UTC-parsed Airtable dates with local-time math

**File:** [src/reports/due.ts:20-30](../reddoor-maintenance-reports/src/reports/due.ts#L20-L30), [src/reports/due.ts:72-73](../reddoor-maintenance-reports/src/reports/due.ts#L72-L73)

`new Date("2026-04-26")` parses as UTC midnight. `addMonths` uses `setMonth/getMonth` (local TZ). `startOfDay` uses `setHours(0, 0, 0, 0)` (local TZ). Operator running `--due` from US Pacific at 9pm May 25:

- `startOfDay(today)` = `May 25 00:00 PST` = `May 25 07:00 UTC`
- `dueDate = addMonths(new Date("2026-04-26"), 1)` = `May 26 00:00 local interpretation of UTC midnight` = `May 26 00:00 PDT` = `May 26 07:00 UTC`
- Comparison: `May 25 07:00 < May 26 07:00` → **NOT due** on the day the operator expected.

Same algorithm in Asia/Tokyo (UTC+9) flips the other direction.

**Fix:** switch `startOfDay` and `addMonths` to UTC accessors (`setUTCHours`, `setUTCMonth`). The B4 fix above already does this. Document that "due date" means UTC calendar date.

---

## HIGH

### H1 — `ymd()` near midnight Pacific produces tomorrow's date in UTC

**File:** [src/reports/airtable/reports.ts:86-88](../reddoor-maintenance-reports/src/reports/airtable/reports.ts#L86-L88), [src/reports/draft.ts:86](../reddoor-maintenance-reports/src/reports/draft.ts#L86)

`ymd(d)` = `d.toISOString().slice(0, 10)`. On Dec 31 11pm Pacific, `new Date()` ISO is `2026-01-01T07:00:00Z` → `ymd` returns `"2026-01-01"`. The report row's `Period end`, `Completed on`, and `Report ID` all carry Jan 1. The operator running `--due` again the next day produces a second row with the same `Report ID` — silent collision (no unique constraint on the field).

**Fix:** compute "today" in the operator's locale, e.g.,

```ts
new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
// → "2026-01-01" while still in Pacific Dec 31
```

### H2 — `parseAddresses` doesn't handle `Display Name <email>`, doesn't dedupe, doesn't validate

**File:** [src/reports/send/orchestrate.ts:112-119](../reddoor-maintenance-reports/src/reports/send/orchestrate.ts#L112-L119)

- `"Smith, John" <a@b.com>` → split on `,` into `['"Smith', ' John" <a@b.com>']`. Both pieces fail validation. Whole send fails.
- `"a@x.com, a@x.com"` → `["a@x.com", "a@x.com"]`. Double-sent.
- `"not an email"` → passes the length filter, reaches Resend, which 422s. The error message bubbles into the orchestrator output. May contain other recipients' addresses (PII leak in shared logs).
- The `pointOfContact` fallback is wrapped in `[site.pointOfContact]` — single entry, never parsed. If the operator wrote `"john, jane"` in that field, it ships as one invalid address.

**Fix:** lowercase + dedupe via `Array.from(new Set(list.map(s => s.toLowerCase())))`. Run `pointOfContact` through `parseAddresses` too. Add an `isProbablyEmail(s)` cheap regex check; throw clearly on malformed.

### H3 — Webhook silently returns 200 on every failure path; production debugging impossible

**File:** [netlify/functions/resend-webhook.mts:42](../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts#L42), [:46](../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts#L46), [:59](../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts#L59)

Three "OK" early returns with no logging:

- `(event ignored)` — event type wasn't in `STATUS_MAP`. If Resend adds `email.opened` and we want to capture it, we won't notice we missed it.
- `event missing data.email_id` — silently swallows.
- `OK (no matching report)` — this is the **most dangerous one**. If `Resend message ID` was never stamped (B2 race) OR if formula injection mangled the lookup (B3), the webhook gives up and returns 200. Resend shows "delivered". Airtable never updates. Operator believes everything works.

**Fix:** `console.log` each branch with event type + messageId + matched record id. The unmatched-report branch should arguably return 500 (so Resend retries via svix's backoff) — not 200.

### H4 — `stampSent` overwrites `Delivery status` to `"pending"`, can clobber a delivered webhook

**File:** [src/reports/airtable/reports.ts:159-175](../reddoor-maintenance-reports/src/reports/airtable/reports.ts#L159-L175)

Order of operations under bad luck:

1. `client.send(payload)` — Resend accepts, fires `email.sent` and possibly `email.delivered` immediately.
2. Webhook hits the Netlify Function but `stampSent` hasn't written `Resend message ID` yet → "no matching report" branch returns 200; status lost.
3. `stampSent` finally runs, writes `Delivery status: "pending"`.

If `email.delivered` arrives BETWEEN the Resend response and `stampSent` (cold-start Netlify can be slow), the `pending` overwrite clobbers a `delivered`.

**Fix:** in `stampSent`, only write `"Delivery status": "pending"` if the existing value is null/blank (read-then-write, or use a conditional formula). Or: stamp the message id BEFORE sending (with `Sent at` = sentinel like `1970-01-01T00:00:00Z` flagging "in-flight"), finalize after.

### H5 — Frequency cast swallows malformed data → site silently never due

**File:** [src/reports/airtable/websites.ts:46-47](../reddoor-maintenance-reports/src/reports/airtable/websites.ts#L46-L47)

```ts
maintenanceFreq: ((f["maintenence freq"] as string | undefined) ?? "None") as Frequency,
```

Two failure modes:

- If a single-select option is renamed to `"Weekly"` (or anything not in `Frequency`), cast succeeds; `MONTHS["Weekly" as keyof typeof MONTHS]` is `undefined`; `addMonths(date, undefined)` produces `Invalid Date`; comparison is `NaN >= NaN` → false → site **silently never due**.
- The field name `"maintenence freq"` has the typo locked in. If Airtable fixes the typo to `"maintenance freq"`, every site falls back to `"None"` — **same silent failure**, fleet-wide.

**Fix:** validate at the boundary; throw with the raw value if it's not one of the four known. For the field-name typo, defensive read: `f["maintenence freq"] ?? f["maintenance freq"]`.

### H6 — `derivePeriodStart` falls back to "30 days ago" — wrong for Quarterly/Yearly

**File:** [src/reports/draft.ts:104-117](../reddoor-maintenance-reports/src/reports/draft.ts#L104-L117)

The first Quarterly report for a new site has `periodStart = today - 30 days`. If the report shows analytics summed over the period, the client sees three months of work but a one-month analytics window. (Maintenance reports don't currently show period stats, but the field is in Airtable and is wrong as recorded.)

**Fix:** the fallback should depend on `freq`. Pass it through to `derivePeriodStart` and use `addMonths(today, -MONTHS[freq])`.

### H7 — `Site` link `linkSites[0]` silently truncates; unhelpful error if 0 or 2+ links

**File:** [src/reports/airtable/reports.ts:34, 40](../reddoor-maintenance-reports/src/reports/airtable/reports.ts#L34-L40)

The Airtable schema has `Site: multipleRecordLinks` with `prefersSingleRecordLink: false`. If a Reports row has zero linked Sites (operator forgot), `mapRow` returns `siteId: ""`. The orchestrator then logs `✗ ... Site row not found for id=` (empty string) — confusing message that hides the underlying schema-vs-intent mismatch.

**Fix:** throw early at `mapRow` if `linkSites.length !== 1` for a draft-ready Report. Include the reportId in the message.

### H8 — Test `tests/reports/send/orchestrate.test.ts` provides false confidence

**File:** [tests/reports/send/orchestrate.test.ts:1-25](../reddoor-maintenance-reports/tests/reports/send/orchestrate.test.ts#L1-L25)

The single test does NOT import `sendApprovedReports`. It defines a fake `ResendClient`, calls `fake.send(...)`, asserts the fake captured what it was passed. If `sendApprovedReports` were deleted entirely, this test still passes.

Worse: it captures `content_id` on the fake — which is the misnamed key that B1 is about. The test passes because the fake's contract uses the misnamed key, not because the SDK does. **This test actively prevented B1 from being caught.**

**Fix:** delete this test. Replace with a real orchestrator test using a typed `Pick<AirtableBase, ...>` fake (the 0.8.0 plan Phase 2 covers this).

### H9 — Test `tests/webhook/resend-webhook.test.ts` provides false confidence

**File:** [tests/webhook/resend-webhook.test.ts:1-22](../reddoor-maintenance-reports/tests/webhook/resend-webhook.test.ts#L1-L22)

Re-declares `STATUS_MAP` locally; asserts on the local copy. The webhook handler is never imported. The test will pass forever — even if the handler is deleted or its STATUS_MAP is changed. The comment "Pinning it here so a typo'd event type in the function gets caught" is wishful thinking; the test does not import from the function.

**Fix:** at minimum, export `STATUS_MAP` from `netlify/functions/resend-webhook.mts` and import it. Better: behavioral test (construct a fake `Request`, mock `Airtable`, invoke the handler, assert the `Response`).

### H10 — Lighthouse score interpolation test doesn't verify position

**File:** [tests/reports/render.test.ts:27-37](../reddoor-maintenance-reports/tests/reports/render.test.ts#L27-L37)

Asserts that scores `12`, `34`, `56`, `78` all appear in the HTML. Doesn't verify that Performance got 12, Accessibility got 34, etc. If the template ever swapped `data.lighthouse.performance` and `data.lighthouse.accessibility`, every score would render under the wrong label — and this test would still pass.

**Fix:** assert positional structure. Either split the HTML on label boundaries (`html.split("Performance")[1].split("Acceptable")[0].includes(">12<")`) or check `html.indexOf(">12<") < html.indexOf(">34<") < html.indexOf(">56<") < html.indexOf(">78<")`.

### H11 — Production data: every Websites row is missing required score and header-image fields

Confirmed via `mcp__airtable__list_records`. Across the entire base:

- **Zero rows** have any of `pScore`, `rScore`, `bpScore`, `seoScore` populated.
- **Zero rows** have `Header image` set.
- **Zero rows** have `Report recipients (To)` set (so every send falls back to `point of contact`).
- Several active sites (e.g., `Worthe`, `Reddoor`) have **no `point of contact`** AND a frequency set → `--send-ready` will throw "no recipients" for them.

**Implication:** the very first `reddoor-maint report --due` invocation against the live base will throw at `draft.ts:30-34` ("missing Lighthouse scores") for every single site. The pipeline is end-to-end functional in code (modulo B1) but cannot be exercised in production until operator backfill happens.

**Fix:** the 0.8.0 plan's `audit lighthouse --write-airtable` is the right move. Pre-flight: backfill `Header image` for active clients first. The smoke-test plan in `MORNING_REPORT_2026-05-27.md` should be updated to start with a paragraph on Airtable preparation.

---

## MEDIUM

### M1 — `check.png` and `blurredTests.jpg` are NOT CID-attached (only the header is — and even that is broken per B1)

**File:** [src/reports/maintenance-email/template.ts:3-4](../reddoor-maintenance-reports/src/reports/maintenance-email/template.ts#L3-L4)

The morning report flagged the CloudFront dependency on these two assets. The bug-hunt agent verified: only the per-site header image is meant to be CID-inline; `check.png` and `blurredTests.jpg` are external `<img src="https://d3eq0h5l8sxf6t.cloudfront.net/...">`. Mail clients with image-blocking show broken icons until the user clicks "show images" — and external image fetches are also tracked by some clients (privacy concern for the client).

**Already covered in the 0.8.0 plan (Phase 1.5).** Mention is a duplicate; flagging here so the priority of vendoring these is clear: it's not just link-rot risk, it's also click-to-show-images friction.

### M2 — `commentary` is interpolated raw into the MJML template (XSS)

**File:** [src/reports/maintenance-email/template.ts:101](../reddoor-maintenance-reports/src/reports/maintenance-email/template.ts#L101)

```ts
${text.replace(/\n/g, "<br/>")}
```

Operator writes `<script>alert(1)</script>` in Airtable → MJML compiles it through → email client renders. Most clients sandbox `<script>`, but `<img onerror=...>` does fire in some webmail previews. More pedestrian: `AT&T` in commentary breaks rendered HTML.

**Fix:** escape `& < > "` to entities, then replace `\n` with `<br/>`.

### M3 — Subject override fallback has no date/year → Gmail threads collapse all reports

**File:** [src/reports/send/orchestrate.ts:79](../reddoor-maintenance-reports/src/reports/send/orchestrate.ts#L79)

Default subject: `"${site.name} ${report.reportType} Report"`. Two reports a year for the same site arrive with identical subjects. Gmail threads them — reviewers can't distinguish May 2026 from May 2025.

**Fix:** include period-end in the default: `"${site.name} ${report.reportType} Report — ${monthYear(periodEnd)}"`.

### M4 — `setDraftReady` is the last write; failure here strands the row

**File:** [src/reports/draft.ts:98-99](../reddoor-maintenance-reports/src/reports/draft.ts#L98-L99)

If `uploadHtmlAttachment` succeeds and `setDraftReady` fails (transient Airtable error), the Reports row exists with all data but `Draft ready=false`. The next `--due` won't recreate (because `derivePeriodStart` sees the existing row). Operator must manually flip the flag.

**Fix:** include `"Draft ready": true` in the initial `createDraft` payload. The HTML upload then becomes the last write; a partial state has the row but no HTML attachment — still recoverable (operator can re-trigger render in 0.8.0).

### M5 — N+1 query in `runDueDraft`, but worse: it walks every site for every Reports row

**File:** [src/cli/commands/report.ts:43-46](../reddoor-maintenance-reports/src/cli/commands/report.ts#L43-L46)

Morning report noted this; bug-hunt confirms: for a fleet of 30, that's 1 listWebsites + 30 listReportsForSite calls = 31 sequential Airtable round-trips. Airtable's per-base rate limit is 5 req/s — 31 calls in tight sequence will throttle around the 6th call. The SDK should backoff automatically but adds latency.

**Fix:** single query: `base("Reports").select({ filterByFormula: "{Sent at} != BLANK()", fields: ["Site", "Report type", "Sent at"] })`. Bucket by site in memory.

### M6 — No runtime guard on `ReportType`, `DeliveryStatus`, `Frequency`

**File:** [src/reports/types.ts](../reddoor-maintenance-reports/src/reports/types.ts), [src/reports/airtable/reports.ts:41,54](../reddoor-maintenance-reports/src/reports/airtable/reports.ts#L41), [src/reports/airtable/websites.ts:46-47](../reddoor-maintenance-reports/src/reports/airtable/websites.ts#L46-L47)

The 0.6.x repo has the `tests/types.test.ts` registration-drift pattern (runtime arrays vs TS unions) for `AuditName` and `RecipeName`. Reports has nothing equivalent. Three string-union fields are cast directly from Airtable single-selects with no validation. Drift between Airtable and TS will be silent.

**Fix:** for each union, export an `ALL_X = [...] as const` constant and an `isX` predicate. Extend `tests/types.test.ts` to assert union ↔ array consistency. Cast `f["X"]` through the predicate.

### M7 — `due.ts` `startOfDay` uses local-time accessors → latent TZ trap in tests

**File:** [src/reports/due.ts:26-30](../reddoor-maintenance-reports/src/reports/due.ts#L26-L30)

The 9 existing due tests pass in every IANA timezone — but only because the fixture data is carefully chosen (all timestamps anchored at noon UTC, fallback dates land safely either side of TZ boundaries). A future test author adding a fixture near a TZ boundary (e.g., `sentAt: "2026-05-26T00:00:00Z"`) hits the latent bug. **B4 fix** (switch to UTC accessors) removes this trap permanently.

**Fix:** included in B4. Additionally: add `process.env.TZ = "UTC"` to a `tests/setup.ts` referenced from `vitest.config.ts`.

### M8 — `mapRow` (24 field reads, 4 coercions) is untested

**File:** [src/reports/airtable/reports.ts:32-58](../reddoor-maintenance-reports/src/reports/airtable/reports.ts#L32-L58)

The single function in the entire reports module most likely to develop a typo. A wrong em-dash on `Lighthouse — Best Practices` (e.g., switching to a hyphen) makes that field silently null for every Reports row. Caught by no test.

**Fix:** add a `mapRow` round-trip test (pure unit, just stuff a fake `{ id, fields }` in, assert the output matches the expected `ReportRow`). ~30 LOC. Already covered in 0.8.0 plan Phase 2.

### M9 — `dueDate` value isn't asserted in most due tests

**File:** [tests/reports/due.test.ts:67-99](../reddoor-maintenance-reports/tests/reports/due.test.ts#L67-L99)

Most tests check `length === 1` but not whether `dueDate` equals the expected math. If `addMonths` returned `today` instead of `baseDate + freq`, four of the nine tests would still pass.

**Fix:** add `expect(due[0].dueDate.toISOString().slice(0, 10)).toBe("2026-05-26")` to tests 2.3, 2.5, 2.7, 2.9.

### M10 — No Yearly frequency test

**File:** [tests/reports/due.test.ts](../reddoor-maintenance-reports/tests/reports/due.test.ts)

`MONTHS["Yearly"] = 12` has no coverage. Trivial to add (one test).

### M11 — `attachments[0]` for header image: no determinism guarantee, no warning on multiple

**File:** [src/reports/airtable/websites.ts:38-40](../reddoor-maintenance-reports/src/reports/airtable/websites.ts#L38-L40)

If the operator uploads a new logo, the old one may remain at `attachments[0]` (Airtable attachment order is by upload time but isn't guaranteed stable across edits). Silently picks the wrong image.

**Fix:** sort by upload time or by filename (newest-by-name wins, e.g. matching `header-v2.jpg` over `header.jpg`); warn if `attachments.length > 1`.

### M12 — No mutex between `--preview`, `--due`, `--send-ready`

**File:** [src/cli/commands/report.ts:18-29](../reddoor-maintenance-reports/src/cli/commands/report.ts#L18-L29)

If the operator passes `--preview --send-ready` together, `sendReady` wins (sends real emails) and `--preview` is silently ignored. A typo can spam clients.

**Fix:** validate at command entry: at most one of `{--due, --send-ready, <slug>}` may be set. Throw `exitCode: 2` otherwise.

---

## LOW

### L1 — Webhook update has no rate-limit protection

A burst of 20 deliveries from Resend triggers 20 webhook invocations; each does select+update. Airtable's 5 req/s/base will throw 429. svix retries the webhook but each retry hits the same limit.

**File:** [netlify/functions/resend-webhook.mts:48-62](../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts#L48-L62)

**Fix:** tiny jitter (`await new Promise(r => setTimeout(r, Math.random() * 1000))`) or batch via a queue.

### L2 — `--preview` writes to `cwd`, ignores `--cwd` flag

**File:** [src/reports/draft.ts:78](../reddoor-maintenance-reports/src/reports/draft.ts#L78), [src/cli/commands/report.ts:73](../reddoor-maintenance-reports/src/cli/commands/report.ts#L73)

The CLI accepts `--cwd <path>` (from bin.ts global flag) but `runReportCommand` doesn't honor it for the preview-file path. Preview lands in shell's actual cwd regardless.

**Fix:** either resolve `previewPath` against `opts.cwd` if set, or remove `cwd` from `ReportCommandOptions`.

### L3 — No size validation on Resend attachments

Resend caps at 40MB per email. No pre-check. A 50MB header image 422s mid-orchestrate.

**File:** [src/reports/send/resend.ts](../reddoor-maintenance-reports/src/reports/send/resend.ts)

### L4 — `fmtDate(null)` renders empty string; `Last Tested:` shows bare label

**File:** [src/reports/maintenance-email/template.ts:81](../reddoor-maintenance-reports/src/reports/maintenance-email/template.ts#L81)

If `lastTestedDate` is null on a Maintenance email, the template renders `Last Tested: ` with nothing after the colon. Cosmetic.

**Fix:** hide the whole `<mj-text>` if null.

### L5 — `siteSlug("")`, `siteSlug("🚀")` produces empty string with weird downstream

**File:** [src/reports/airtable/websites.ts:29-34](../reddoor-maintenance-reports/src/reports/airtable/websites.ts#L29-L34)

`"🚀"` slugs to `""`. CID becomes `"-header"`. Preview path becomes `reports//draft.html`. `getWebsiteBySlug("")` matches the first emoji-named site (unlikely, but).

**Fix:** if slug is empty, throw or fall back to `recordId`.

### L6 — `account owner` field never CCs the report

Per the original design memo intent ("e.g. account owner"), CC could default to `account owner` when `Report recipients (CC)` is blank. Currently it only reads `Report recipients (CC)`.

**Fix:** in `parseAddresses` fallback chain, prepend `site.accountOwner` if set. (Requires extending `WebsiteRow` to read this field — currently unread.)

### L7 — `--json` flag missing from `report` command

Other CLI commands support `--json` for machine-readable output. `report` doesn't. CI consumers can't reliably parse success/failure per row.

### L8 — Production debugging issues already noted in H3 — `Webhook.verify` returns `unknown`, cast to `ResendEvent` is unsound

**File:** [netlify/functions/resend-webhook.mts:36](../reddoor-maintenance-reports/netlify/functions/resend-webhook.mts#L36)

A signed-but-malformed payload (`event.type` not a string) would throw on access. Minor since svix-signed events are trusted, but a runtime guard is cheap.

### L9 — Two existing tests are TRIVIAL (assert table-name constants against themselves)

**File:** [tests/reports/airtable/reports.test.ts:5-11](../reddoor-maintenance-reports/tests/reports/airtable/reports.test.ts#L5-L11)

`expect(REPORTS_TABLE).toBe("Reports")` is asserting a constant against the constant's value. Catches nothing. Either delete or convert to a contract test.

---

## NIT

### N1 — `MORNING_REPORT_2026-05-27.md`'s `#18` (fmtDate UTC) is now more important than rated

The fmtDate UTC fix was rated "MEDIUM, belt-and-suspenders." After B4/B5 surface, the whole date-handling story across `due.ts`, `draft.ts`, `reports.ts`, and `template.ts` needs a single UTC-everywhere pass. Promote to HIGH and bundle into the date-math fix.

### N2 — `commentarySection` heading test `>NOTES<` is fragile

**File:** [tests/reports/render.test.ts:71](../reddoor-maintenance-reports/tests/reports/render.test.ts#L71)

A future styling change wrapping `NOTES` in `<strong>` would break this test for no real reason. Use `expect(html).toMatch(/NOTES/)` instead.

### N3 — Memory file `0.7.0-report-design.md` line 46 is stale

The memory claims `emailHeaderId` (field `fld3KbmfzjJt11w4C`) on Websites is unused and needs manual deletion. **The Airtable agent verified: it's already gone.** Someone removed it via the UI. Update memory.

---

## Verification — what these agents confirmed in production data

- **0 rows** in Reports table — pipeline has never run end-to-end against live data.
- **0 Websites rows** with any of `pScore` / `rScore` / `bpScore` / `seoScore` populated.
- **0 Websites rows** with `Header image` set.
- **0 Websites rows** with explicit `Report recipients (To)`.
- 2 active sites (`Worthe`, `Reddoor`) have neither `Report recipients (To)` nor `point of contact`.
- Several Yearly-frequency sites with `maintenance day` 1+ year ago → first `--due` invocation will surface them all at once.
- Every `f["..."]` field-name string in the code character-matches the live schema (no typos, no em-dash mismatches).
- All field IDs cited in memory file `0.7.0-report-design.md` are still valid.
- `Delivery status` schema choices are confirmed **lowercase** (`pending`, `delivered`, `bounced`, `complained`); code is consistent.

---

## Recommended fix order (for tomorrow)

Numbered by impact-per-minute:

1. **B1 (5 min)** — rename two keys. Without this, every email is broken on day 1.
2. **B4 + B5 + N1 (30 min)** — switch `due.ts` and friends to UTC accessors + clamp `addMonths`. Add three tests (Yearly, month-31 overflow, TZ-shifted base date). This is a single PR.
3. **H8 + H9 (15 min)** — delete the two tautological test files; the 0.8.0 plan will replace them with real tests. Don't ship 0.7.0 carrying false confidence.
4. **H3 (15 min)** — add `console.log` to webhook branches, return 500 on unmatched-report so svix retries.
5. **B2 + H4 (1–2 hr)** — idempotency-key Resend sends; conditional `Delivery status: "pending"` write that doesn't clobber. Real engineering decision.
6. **B3 (20 min)** — escape formula interpolation; switch site-id filter to anchored search (or one-line schema change to single-link Site field).
7. **H2 (20 min)** — `parseAddresses` dedupe + validation. Pass `pointOfContact` through it too.
8. **H10 (10 min)** — render test 1.2 assertion strengthening.
9. **H11 (operator task, ~1 hr)** — backfill Airtable scores + header images for at least 1 test site before merging 0.7.0.
10. Everything else can land as 0.8.0 cleanups.

**The combined fix surface for items 1–8 is about 3–4 hours.** All can land on the same `feat/0.7.0-reports` branch before pushing.

---

## What changes for the 0.7.0 → 1.0 arc

The arc in `MORNING_REPORT_2026-05-27.md` is still right. But:

- **Do not merge 0.7.0 as-is.** B1 alone is shippable-but-broken; B2 is a real client-experience bug. The earlier morning report's "ready to merge" framing was wrong — fix the BLOCKER tier first.
- **0.7.0's PR should include items #1–#8 from the fix order above.** That's 3–4 hours of work, all on the same branch.
- **Smoke tests in the morning report's recommended sequence need updates.** Smoke 1 (--preview) and Smoke 2 (--due) both depend on `pScore`/`rScore`/`bpScore`/`seoScore` being populated on at least one site. Add a Smoke 0: "pick a test site (e.g., one of your sites, not a client's), populate the 4 scores, upload a Header image, and set yourself as Report recipients (To) before running any other smoke."
- **The 0.8.0 plan's Phase 2 (orchestrator tests) is now more important.** Without it, B2/H4 fix correctness can't be verified mechanically.

---

## Open items not surfaced by the agents

- **Resend domain verification status.** The bug-hunt assumes `reports@reddoorla.com` is verified in Resend. The Airtable agent couldn't check this. If not verified: first real send 401s with a Resend domain-verification error.
- **Netlify site for the webhook.** Still not provisioned (already in morning report). All H3/H4/L1 webhook fixes only matter once it's deployed.
- **Whether the user wants the H8/H9 test deletions to ship as part of 0.7.0** — they remove failing-to-test surface but technically reduce visible coverage. Recommend deleting; document the gap; backfill in 0.8.

End of bug-hunt addendum.
