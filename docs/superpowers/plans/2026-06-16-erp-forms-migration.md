# ERP Forms Migration — Implementation Plan

> **For agentic workers:** Implement with TDD (PR1 has full vitest infra). Design spec: `docs/superpowers/specs/2026-06-16-erp-forms-migration-design.md`. Steps use checkbox (`- [ ]`).

**Goal:** Add generic field-based notification routing (multi-recipient + CC) to the central pipeline, then port `erp-industrial` onto it (dropping reCAPTCHA/Resend/bespoke routing).

**Order:** PR1 (pipeline) → Airtable config → PR2 (ERP port) → cutover/verify.

---

## PR1 — reddoor-maintenance: field-based notify routing

Branch: `feat/forms-notify-routing`. Repo has vitest — write failing tests first.

### Task 1: `NotifyRouting` type + defensive parse + WebsiteRow field

**Files:** `src/reports/airtable/websites.ts`, `tests/reports/airtable/websites.test.ts` (or the existing websites test file)

- [ ] Add `NotifyRouting` type (`field: string; routes: Record<string, string|string[]>; default?: string|string[]; cc?: string[]`) and `notifyRouting: NotifyRouting | null` to `WebsiteRow`.
- [ ] Add `parseNotifyRouting(raw: unknown): NotifyRouting | null`: non-string/blank → null; `JSON.parse` in try/catch → null on error; require object with string `field` + object `routes`, else null.
- [ ] `mapRow`: `notifyRouting: parseNotifyRouting(f["Notify Routing"])`.
- [ ] Tests: valid JSON parses; bad JSON → null; missing `field`/`routes` → null; blank/non-string → null. Update any existing `makeWebsiteRow`/fixtures factory to include `notifyRouting: null`.
- [ ] Run: `pnpm test -- websites` → green.

### Task 2: `resolveRecipients`

**Files:** `src/forms/notify.ts`, `tests/forms/notify.test.ts`

- [ ] Replace `notifyRecipient(site): string|null` with `resolveRecipients(site, submission): { to: string[]; cc: string[] } | null` per the spec semantics (pre-launch→operator; maintenance+routing→routed+cc with default fallback; else POC; else null). Add a `normalizeRecipients(v: string|string[]): string[]` (trim, drop empty, dedupe) and a small extraFields-value reader (reuse the JSON parse used by `extraFieldRows`).
- [ ] Tests (matrix): pre-launch→`{to:[operator],cc:[]}`; maintenance+routing match→routed+cc; unknown value→default+cc; no match+no default→POC; no routing→POC; none→null; array route→multi `to`; routing present but status pre-launch→operator (routing ignored).
- [ ] Run: `pnpm test -- notify` → green.

### Task 3: wire builders to `resolveRecipients`

**Files:** `src/forms/notify.ts`, `tests/forms/notify.test.ts`

- [ ] `buildPocNotification`: use `resolveRecipients`; null/empty `to` → return null; set `to` array + `cc` (only when non-empty); `replyTo = submission.email`.
- [ ] `buildAutoresponder`: `replyTo = resolveRecipients(...)?.to[0] ?? FALLBACK_REPLY_TO`.
- [ ] Tests: cc emitted only when non-empty; routed `to` reflected; replyTo = lead; autoresponder replyTo = first recipient.
- [ ] Run: `pnpm test -- notify` → green.

### Task 4: full gate + changeset + PR

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist` — ALL green. (typecheck covers the `.mts` handlers; test:dist catches public-export breaks.)
- [ ] `pnpm changeset` — minor bump, summary: "feat(forms): field-based notification routing (multi-recipient + CC) via Websites `Notify Routing` JSON".
- [ ] Commit explicit paths; push `feat/forms-notify-routing`; open PR (base main). Body notes: generic, inert until a site sets `Notify Routing`; deploys dashboard-side on merge.
- [ ] Gate on HEAD-SHA `ci / ci` = success → merge (squash). The changeset's Version Packages release PR stays human-gated.

---

## Airtable (between PR1 merge and PR2)

- [ ] Add a `Notify Routing` long-text column to the Websites table.
- [ ] Set the **ERP Industrials** row's `Notify Routing` to:
  ```json
  {
    "field": "interest",
    "routes": {
      "Leasing": "BBerry@erpfunds.com",
      "Investor Relations": "pespinoza@erpfunds.com",
      "Property Sales and Acquistions": "MBerry@erpfunds.com"
    },
    "default": "tucker@reddoorla.com",
    "cc": ["tucker@reddoorla.com"]
  }
  ```

---

## PR2 — erp-industrial: the port

Branch: `feat/forms-ingest-migration`. Same shape as the Phase 2c easy-three plan, plus deletions.

- [ ] Bump `@reddoorla/maintenance` → the version PR1 released (≥ the new minor); `pnpm install`.
- [ ] `src/routes/contact/+page.server.ts`: delete reCAPTCHA verify + Resend + interest routing; add `prerender = false`, `load → { formTs }`, `actions.default = createIngestAction({ formType:"contact", getConfig→FORMS_INGEST_URL/TOKEN, buildPayload: email/message/interest/sourceUrl })`. (Preserve any Prismic load on the route — GOTCHA A.)
- [ ] `src/routes/contact/+page.svelte`: remove the `grecaptcha` `<svelte:head>` script + custom `handleSubmit`/`fetch`; `use:enhance` POST with hidden `ts` + `bot-field` honeypot; success/error via `form` prop; disabled-while-submitting (add a `disabled` prop to the shared button if it lacks one — GOTCHA C). Keep `<select name="interest">` with values matching the Airtable `routes` keys EXACTLY (incl. "Property Sales and Acquistions").
- [ ] Delete `src/lib/recaptcha.ts`; remove the `resend` dependency from package.json.
- [ ] `.env.example`: `FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/erp-industrials` + `FORMS_INGEST_TOKEN`; remove `RECAPTCHA_*`/`RESEND_API_KEY`/`CONTACT_TEST_EMAIL` docs.
- [ ] `pnpm lint && pnpm check && pnpm build` green (Prismic CDN DNS may be sandbox-blocked — note it).
- [ ] Commit explicit paths; push; open PR. Gate CI → merge.

⚠️ **Slug = `erp-industrials`** (plural — `siteSlug("ERP Industrials")`), NOT the repo name `erp-industrial`.

---

## Cutover & verification (operator + me)

- [ ] Operator: set ERP Netlify env (`FORMS_INGEST_URL` slug `erp-industrials` + shared `FORMS_INGEST_TOKEN`), redeploy.
- [ ] Verify capture/notify/persistence in `launch period` status → operator-only.
- [ ] Verify routing safely: temporarily set all `routes` → `tucker@reddoorla.com`, flip to `maintenance`, submit one per interest, confirm each slot + CC resolves → then swap in the real `@erpfunds.com` addresses.
- [ ] Restore status → `maintenance`; remove old `RECAPTCHA_*`/`RESEND_API_KEY` Netlify vars.
