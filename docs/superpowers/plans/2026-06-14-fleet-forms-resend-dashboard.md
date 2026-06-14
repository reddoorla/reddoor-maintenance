# Fleet Forms → Resend + Dashboard — Implementation Plan (Phase 1: Dashboard side)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the central submission pipeline in `reddoor-maintenance` — a token-gated public ingest endpoint that writes an Airtable `Submissions` table, notifies the site's point-of-contact + autoresponds to the submitter via Resend, and surfaces every submission in the operator cockpit and per-site dashboard.

**Architecture (data flow):**

```text
[site form action] --POST /api/forms/:slug (x-forms-token)--> [form-ingest.mts]
   normalize → resolve site → createSubmission (Airtable) → notifySubmission (Resend)
                                                         → stampNotified
[cockpit /] reads listNewSubmissions → 📥 strip + per-card badge
[/s/:slug] reads listSubmissionsForSite → list + status buttons → POST /api/submissions/:id/status
```

Thin Netlify `.mts` handlers over pure, dependency-injected logic modules (the established `approve.ts` + `approve-report.mts` pattern). A new `src/forms/` domain holds the ingest logic, payload normalizer, token check, and Resend notification builders. A new `src/reports/airtable/submissions.ts` mirrors the existing table-module pattern. Dashboard rendering is extended additively (all new model fields optional) so no existing test churns.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `airtable@^0.12`, `resend@^4.8`, Netlify Functions (`@netlify/functions`), Vitest, tsup. Spec: [docs/superpowers/specs/2026-06-14-fleet-forms-resend-dashboard-design.md](../specs/2026-06-14-fleet-forms-resend-dashboard-design.md).

**Scope note:** This plan covers the dashboard subsystem only. The shared `@reddoorla/maintenance/forms` helper and per-site form migration (reddoor-website first, then the 4 Netlify-Forms sites) are **separate plans** in their own repos, written once this phase is proven. After this phase, a site can be wired by POSTing JSON to `POST /api/forms/:slug` with header `x-forms-token: <FORMS_INGEST_TOKEN>` — curl-testable without any site changes.

**Deviation from spec (recorded):** The spec's security model calls for a per-slug ingest rate limit. Netlify's built-in `rateLimit.aggregateBy` cannot key on a path param, so Phase 1 ships a coarse per-IP backstop (120/min) plus the token gate; true per-slug limiting (via Netlify Blobs) is deferred to future enhancements. The spec's future-enhancements section is updated to match.

---

## File Structure

**New files (this repo):**

- `src/reports/airtable/submissions.ts` — `Submissions` table module: types, `mapRow`, `createSubmission`, list/get/update helpers.
- `src/forms/payload.ts` — wire-payload type + `normalizeSubmission()` (field normalizer + validation).
- `src/forms/token.ts` — `verifyFormsToken()` (constant-time) + `bearerToken()`.
- `src/forms/notify.ts` — `buildPocNotification`, `buildAutoresponder`, `notifySubmission()`.
- `src/forms/ingest.ts` — `ingestSubmission()` pure orchestration with injected deps.
- `src/dashboard/submission-status.ts` — `setSubmissionStatus()` state machine.
- `netlify/functions/form-ingest.mts` — public token-gated ingest handler.
- `netlify/functions/submission-status.mts` — operator status-change handler.
- `tests/_helpers/submission-row.ts` — `makeSubmissionRow` factory.
- `tests/reports/airtable/submissions.test.ts`
- `tests/forms/payload.test.ts`
- `tests/forms/token.test.ts`
- `tests/forms/notify.test.ts`
- `tests/forms/ingest.test.ts`
- `tests/dashboard/submission-status.test.ts`
- `tests/dashboard/cockpit-submissions.test.ts`
- `tests/dashboard/fleet-render-submissions.test.ts`
- `tests/dashboard/render-submissions.test.ts`

**Modified files:**

- `src/dashboard/index.ts` — barrel: export `setSubmissionStatus` + types.
- `src/dashboard/fleet-cockpit.ts` — `SubmissionEntry` type; optional `submissions`/`newSubmissions` model fields; `buildCockpitModel` gains a trailing `newSubmissions` param.
- `src/dashboard/fleet-render.ts` — submissions strip, summary chip/head, filter hook, per-card badge.
- `src/dashboard/render.ts` — per-site submissions section + status buttons + inline POST script; trailing `submissions` param.
- `netlify/functions/fleet-homepage.mts` — fetch `listNewSubmissions`, pass to `buildCockpitModel`.
- `netlify/functions/site-dashboard.mts` — fetch `listSubmissionsForSite`, pass to `renderSiteDashboardHtml`.

**External (no code):**

- Airtable: create the `Submissions` table (Task 12).
- Netlify (dashboard site): set `FORMS_INGEST_TOKEN` env var (Task 13).

---

## Task 1: Airtable `Submissions` table module

**Files:**

- Create: `src/reports/airtable/submissions.ts`
- Create: `tests/_helpers/submission-row.ts`
- Test: `tests/reports/airtable/submissions.test.ts`

- [ ] **Step 1: Write `src/reports/airtable/submissions.ts`**

Mirrors `reports.ts` exactly (enum coercion with warn, `FieldSet` create, `eachPage` reads, JS-confirm after `filterByFormula`). Every `f["..."]` string is a load-bearing Airtable column name — they MUST match the table created in Task 12.

```typescript
import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";

export const SUBMISSIONS_TABLE = "Submissions";

export const SUBMISSION_FORM_TYPES = [
  "contact",
  "inquiry",
  "newsletter",
  "rsvp",
  "reserve",
] as const;
export type FormType = (typeof SUBMISSION_FORM_TYPES)[number];

export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const NOTIFY_STATUSES = ["sent", "failed", "skipped"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

function toFormType(raw: string | undefined): FormType {
  if (raw && (SUBMISSION_FORM_TYPES as readonly string[]).includes(raw)) return raw as FormType;
  if (raw)
    console.warn(`[submissions] unknown Form type ${JSON.stringify(raw)} — treating as contact`);
  return "contact";
}

function toStatus(raw: string | undefined): SubmissionStatus {
  if (raw && (SUBMISSION_STATUSES as readonly string[]).includes(raw))
    return raw as SubmissionStatus;
  return "new";
}

function toNotifyStatus(raw: string | undefined): NotifyStatus {
  if (raw && (NOTIFY_STATUSES as readonly string[]).includes(raw)) return raw as NotifyStatus;
  return "skipped";
}

export type SubmissionRow = {
  id: string;
  submissionId: number | null;
  siteId: string;
  formType: FormType;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  /** Raw JSON string of any site-specific fields the typed columns didn't claim. */
  extraFields: string | null;
  sourceUrl: string | null;
  utm: string | null;
  submittedAt: string | null;
  status: SubmissionStatus;
  notifyStatus: NotifyStatus;
  resendMessageId: string | null;
};

export function mapRow(rec: { id: string; fields: Record<string, unknown> }): SubmissionRow {
  const f = rec.fields;
  const linkSites = (f["Site"] as string[] | undefined) ?? [];
  return {
    id: rec.id,
    submissionId: typeof f["Submission ID"] === "number" ? (f["Submission ID"] as number) : null,
    siteId: linkSites[0] ?? "",
    formType: toFormType(f["Form type"] as string | undefined),
    name: String(f["Name"] ?? ""),
    email: String(f["Email"] ?? ""),
    phone: (f["Phone"] as string | undefined) ?? null,
    message: (f["Message"] as string | undefined) ?? null,
    extraFields: (f["Extra fields"] as string | undefined) ?? null,
    sourceUrl: (f["Source URL"] as string | undefined) ?? null,
    utm: (f["UTM"] as string | undefined) ?? null,
    submittedAt: (f["Submitted at"] as string | undefined) ?? null,
    status: toStatus(f["Status"] as string | undefined),
    notifyStatus: toNotifyStatus(f["Notify status"] as string | undefined),
    resendMessageId: (f["Resend message ID"] as string | undefined) ?? null,
  };
}

export type SubmissionInput = {
  siteId: string;
  formType: FormType;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  extraFields?: Record<string, unknown>;
  sourceUrl?: string;
  utm?: string;
  submittedAt: Date;
};

export async function createSubmission(
  base: AirtableBase,
  input: SubmissionInput,
): Promise<SubmissionRow> {
  const fields: FieldSet = {
    Site: [input.siteId],
    "Form type": input.formType,
    Name: input.name,
    Email: input.email,
    "Submitted at": input.submittedAt.toISOString(),
    Status: "new",
  };
  if (input.phone !== undefined) fields["Phone"] = input.phone;
  if (input.message !== undefined) fields["Message"] = input.message;
  if (input.extraFields !== undefined && Object.keys(input.extraFields).length > 0)
    fields["Extra fields"] = JSON.stringify(input.extraFields);
  if (input.sourceUrl !== undefined) fields["Source URL"] = input.sourceUrl;
  if (input.utm !== undefined) fields["UTM"] = input.utm;
  const created = (await base(SUBMISSIONS_TABLE).create([{ fields }])) as Records<FieldSet>;
  const rec = created[0];
  if (!rec) throw new Error("Airtable create returned no records");
  return mapRow({ id: rec.id, fields: rec.fields });
}

export async function listRecentSubmissions(
  base: AirtableBase,
  max = 200,
): Promise<SubmissionRow[]> {
  const out: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return out.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")).slice(0, max);
}

export async function listNewSubmissions(base: AirtableBase): Promise<SubmissionRow[]> {
  const out: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({ filterByFormula: "{Status} = 'new'", pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) out.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  // Confirm in JS — the fake base ignores filterByFormula, and a stray status
  // must never slip into the "new" queue.
  return out
    .filter((s) => s.status === "new")
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
}

export async function listSubmissionsForSite(
  base: AirtableBase,
  siteId: string,
): Promise<SubmissionRow[]> {
  const all = await listRecentSubmissions(base);
  return all.filter((s) => s.siteId === siteId);
}

export async function getSubmissionById(
  base: AirtableBase,
  id: string,
): Promise<SubmissionRow | null> {
  const rows: SubmissionRow[] = [];
  await base(SUBMISSIONS_TABLE)
    .select({ filterByFormula: `RECORD_ID() = ${JSON.stringify(id)}`, maxRecords: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push(mapRow({ id: rec.id, fields: rec.fields }));
      fetchNextPage();
    });
  return rows.find((r) => r.id === id) ?? null;
}

export async function setSubmissionStatusRow(
  base: AirtableBase,
  id: string,
  status: SubmissionStatus,
): Promise<void> {
  await base(SUBMISSIONS_TABLE).update([{ id, fields: { Status: status } }]);
}

export async function stampNotified(
  base: AirtableBase,
  id: string,
  status: NotifyStatus,
  messageId: string | null,
): Promise<void> {
  const fields: Record<string, string> = { "Notify status": status };
  if (messageId !== null) fields["Resend message ID"] = messageId;
  await base(SUBMISSIONS_TABLE).update([{ id, fields }]);
}
```

- [ ] **Step 2: Write the `makeSubmissionRow` factory** — `tests/_helpers/submission-row.ts`

Mirrors `tests/_helpers/website-row.ts`: every `SubmissionRow` field defaulted, `...over` last.

```typescript
import type { SubmissionRow } from "../../src/reports/airtable/submissions.js";

/** Shared SubmissionRow test factory: every field defaulted, override via `over`. */
export function makeSubmissionRow(over: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: "recSUB",
    submissionId: 1,
    siteId: "recSITE",
    formType: "contact",
    name: "Jane Doe",
    email: "jane@example.com",
    phone: null,
    message: "Hello there",
    extraFields: null,
    sourceUrl: null,
    utm: null,
    submittedAt: "2026-06-14T12:00:00.000Z",
    status: "new",
    notifyStatus: "skipped",
    resendMessageId: null,
    ...over,
  };
}
```

- [ ] **Step 3: Write the failing tests** — `tests/reports/airtable/submissions.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  SUBMISSIONS_TABLE,
  createSubmission,
  listNewSubmissions,
  getSubmissionById,
  setSubmissionStatusRow,
  stampNotified,
  mapRow,
} from "../../../src/reports/airtable/submissions.js";
import { makeFakeBase, type CapturedCall } from "../_helpers/fake-airtable-base.js";

const firstCreate = (calls: CapturedCall[]) =>
  calls.find((c): c is Extract<CapturedCall, { kind: "create" }> => c.kind === "create");
const firstUpdate = (calls: CapturedCall[]) =>
  calls.find((c): c is Extract<CapturedCall, { kind: "update" }> => c.kind === "update");

describe("submissions table", () => {
  it("uses the exact Airtable table name", () => {
    expect(SUBMISSIONS_TABLE).toBe("Submissions");
  });

  it("createSubmission writes the linked Site, Status=new, and ISO Submitted at", async () => {
    const base = makeFakeBase();
    const row = await createSubmission(base, {
      siteId: "recSITE",
      formType: "contact",
      name: "Jane",
      email: "jane@example.com",
      message: "hi",
      extraFields: { company: "Acme" },
      submittedAt: new Date("2026-06-14T12:00:00Z"),
    });
    const created = firstCreate(base.__calls);
    const f = created!.records[0]!.fields;
    expect(f["Site"]).toEqual(["recSITE"]);
    expect(f["Status"]).toBe("new");
    expect(f["Submitted at"]).toBe("2026-06-14T12:00:00.000Z");
    expect(f["Extra fields"]).toBe('{"company":"Acme"}');
    expect(row.status).toBe("new");
    expect(row.siteId).toBe("recSITE");
  });

  it("createSubmission omits Extra fields when empty", async () => {
    const base = makeFakeBase();
    await createSubmission(base, {
      siteId: "recSITE",
      formType: "contact",
      name: "Jane",
      email: "jane@example.com",
      extraFields: {},
      submittedAt: new Date("2026-06-14T12:00:00Z"),
    });
    const f = firstCreate(base.__calls)!.records[0]!.fields;
    expect("Extra fields" in f).toBe(false);
  });

  it("mapRow coerces an unknown Form type to contact and missing Status to new", () => {
    const row = mapRow({ id: "rec1", fields: { "Form type": "weird", Site: ["recX"] } });
    expect(row.formType).toBe("contact");
    expect(row.status).toBe("new");
    expect(row.siteId).toBe("recX");
  });

  it("listNewSubmissions returns only Status=new rows", async () => {
    const base = makeFakeBase({
      Submissions: [
        { id: "rec1", fields: { Status: "new", "Submitted at": "2026-06-14T10:00:00Z" } },
        { id: "rec2", fields: { Status: "read", "Submitted at": "2026-06-14T11:00:00Z" } },
      ],
    });
    const rows = await listNewSubmissions(base);
    expect(rows.map((r) => r.id)).toEqual(["rec1"]);
  });

  it("getSubmissionById returns the matching row, null otherwise", async () => {
    const base = makeFakeBase({
      Submissions: [{ id: "rec1", fields: { Status: "new" } }],
    });
    expect((await getSubmissionById(base, "rec1"))?.id).toBe("rec1");
    expect(await getSubmissionById(base, "nope")).toBeNull();
  });

  it("setSubmissionStatusRow writes Status; stampNotified writes Notify status + message id", async () => {
    const base = makeFakeBase({ Submissions: [{ id: "rec1", fields: { Status: "new" } }] });
    await setSubmissionStatusRow(base, "rec1", "archived");
    await stampNotified(base, "rec1", "sent", "msg_123");
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect((updates[0] as Extract<CapturedCall, { kind: "update" }>).records[0]!.fields).toEqual({
      Status: "archived",
    });
    expect((updates[1] as Extract<CapturedCall, { kind: "update" }>).records[0]!.fields).toEqual({
      "Notify status": "sent",
      "Resend message ID": "msg_123",
    });
    void firstUpdate; // helper available if needed
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/reports/airtable/submissions.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/submissions.ts tests/_helpers/submission-row.ts tests/reports/airtable/submissions.test.ts
git commit -m "feat(forms): Submissions Airtable table module + row factory"
```

---

## Task 2: Payload normalizer

**Files:**

- Create: `src/forms/payload.ts`
- Test: `tests/forms/payload.test.ts`

- [ ] **Step 1: Write `src/forms/payload.ts`**

```typescript
import { SUBMISSION_FORM_TYPES, type FormType } from "../reports/airtable/submissions.js";

/** The JSON wire format a fleet site forwards to the ingest endpoint. */
export type SubmissionPayload = {
  formType?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  message?: string;
  sourceUrl?: string;
  utm?: string;
  /** Any additional, site-specific fields. */
  extra?: Record<string, unknown>;
};

export type NormalizedSubmission = {
  formType: FormType;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  sourceUrl?: string;
  utm?: string;
  extraFields: Record<string, unknown>;
};

export type NormalizeResult =
  | { ok: true; value: NormalizedSubmission }
  | { ok: false; errors: string[] };

const KNOWN_KEYS = new Set([
  "formType",
  "name",
  "firstName",
  "lastName",
  "email",
  "phone",
  "message",
  "sourceUrl",
  "utm",
  "extra",
]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function coerceFormType(raw: unknown): FormType {
  const s = str(raw);
  return (SUBMISSION_FORM_TYPES as readonly string[]).includes(s) ? (s as FormType) : "contact";
}

/**
 * Defensively normalize an untrusted ingest payload into typed fields. Folds
 * name/first+last, lowercases email, and dumps every unclaimed key into
 * extraFields so no site-specific data is lost. Rejects only when there's
 * nothing to act on (no email AND no message) or a present email is malformed.
 */
export function normalizeSubmission(payload: unknown): NormalizeResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, errors: ["payload must be a JSON object"] };
  }
  const p = payload as Record<string, unknown>;
  const name = str(p.name) || [str(p.firstName), str(p.lastName)].filter(Boolean).join(" ");
  const email = str(p.email).toLowerCase();
  const message = str(p.message);

  const errors: string[] = [];
  if (!email && !message) errors.push("at least one of email or message is required");
  if (email && !EMAIL_RE.test(email)) errors.push("email is not a valid address");
  if (errors.length > 0) return { ok: false, errors };

  const extraFields: Record<string, unknown> = {};
  const extra = p.extra;
  if (typeof extra === "object" && extra !== null) Object.assign(extraFields, extra);
  for (const [k, v] of Object.entries(p)) {
    if (!KNOWN_KEYS.has(k)) extraFields[k] = v;
  }

  const value: NormalizedSubmission = {
    formType: coerceFormType(p.formType),
    name,
    email,
    extraFields,
  };
  const phone = str(p.phone);
  if (phone) value.phone = phone;
  if (message) value.message = message;
  const sourceUrl = str(p.sourceUrl);
  if (sourceUrl) value.sourceUrl = sourceUrl;
  const utm = str(p.utm);
  if (utm) value.utm = utm;
  return { ok: true, value };
}
```

- [ ] **Step 2: Write the failing tests** — `tests/forms/payload.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { normalizeSubmission } from "../../src/forms/payload.js";

describe("normalizeSubmission", () => {
  it("folds firstName+lastName into name and lowercases email", () => {
    const r = normalizeSubmission({
      firstName: "Jane",
      lastName: "Doe",
      email: "JANE@Example.com",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Jane Doe");
      expect(r.value.email).toBe("jane@example.com");
    }
  });

  it("prefers an explicit name over first/last", () => {
    const r = normalizeSubmission({ name: "Ada L.", firstName: "Ada", email: "a@b.co" });
    expect(r.ok && r.value.name).toBe("Ada L.");
  });

  it("captures unknown keys into extraFields and merges explicit extra", () => {
    const r = normalizeSubmission({
      email: "a@b.co",
      company: "Acme",
      guests: 3,
      extra: { event: "gala" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.extraFields).toEqual({ event: "gala", company: "Acme", guests: 3 });
  });

  it("falls back to formType=contact for unknown types", () => {
    expect(normalizeSubmission({ email: "a@b.co", formType: "nope" }).ok).toBe(true);
    const r = normalizeSubmission({ email: "a@b.co", formType: "rsvp" });
    expect(r.ok && r.value.formType).toBe("rsvp");
  });

  it("rejects when neither email nor message is present", () => {
    const r = normalizeSubmission({ name: "Jane" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("at least one of email or message is required");
  });

  it("rejects a malformed email", () => {
    const r = normalizeSubmission({ email: "not-an-email", message: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("email is not a valid address");
  });

  it("rejects a non-object payload", () => {
    expect(normalizeSubmission("nope").ok).toBe(false);
    expect(normalizeSubmission(null).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/forms/payload.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/forms/payload.ts tests/forms/payload.test.ts
git commit -m "feat(forms): defensive submission payload normalizer"
```

---

## Task 3: Ingest token check

**Files:**

- Create: `src/forms/token.ts`
- Test: `tests/forms/token.test.ts`

- [ ] **Step 1: Write `src/forms/token.ts`**

```typescript
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare of a presented ingest token against the configured
 * FORMS_INGEST_TOKEN. Byte lengths are checked first (timingSafeEqual throws on
 * a length mismatch). Returns false on any missing/blank/mismatched input.
 */
export function verifyFormsToken(
  presented: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract the bearer token from an Authorization header, or null. */
export function bearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1]!.trim() : null;
}
```

- [ ] **Step 2: Write the failing tests** — `tests/forms/token.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { verifyFormsToken, bearerToken } from "../../src/forms/token.js";

describe("verifyFormsToken", () => {
  it("accepts an exact match", () => {
    expect(verifyFormsToken("s3cret", "s3cret")).toBe(true);
  });
  it("rejects a mismatch, a length mismatch, and empty inputs", () => {
    expect(verifyFormsToken("s3cret", "other!")).toBe(false);
    expect(verifyFormsToken("short", "longervalue")).toBe(false);
    expect(verifyFormsToken("", "x")).toBe(false);
    expect(verifyFormsToken("x", undefined)).toBe(false);
    expect(verifyFormsToken(null, "x")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("parses a Bearer header case-insensitively", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer   xyz")).toBe("xyz");
  });
  it("returns null for non-bearer or missing headers", () => {
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/forms/token.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/forms/token.ts tests/forms/token.test.ts
git commit -m "feat(forms): constant-time ingest token verification"
```

---

## Task 4: Resend notification builders

**Files:**

- Create: `src/forms/notify.ts`
- Test: `tests/forms/notify.test.ts`

- [ ] **Step 1: Write `src/forms/notify.ts`**

```typescript
import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { SubmissionRow, NotifyStatus } from "../reports/airtable/submissions.js";
import type { ResendSendInput } from "../reports/send/resend.js";
import { escapeHtml } from "../util/html.js";

const FORMS_FROM = "forms@reddoorla.com";
const FALLBACK_REPLY_TO = "info@reddoorla.com";

/** Strip characters that would break an RFC 5322 display name. */
function displayName(raw: string): string {
  return raw.replace(/["\r\n]/g, "").trim() || "Reddoor";
}

function pocAddress(site: WebsiteRow): string | null {
  return site.pointOfContact ?? site.reportRecipientsTo ?? null;
}

function fieldsTable(submission: SubmissionRow): string {
  const rows: Array<[string, string]> = [
    ["Form", submission.formType],
    ["Name", submission.name || "—"],
    ["Email", submission.email || "—"],
  ];
  if (submission.phone) rows.push(["Phone", submission.phone]);
  if (submission.sourceUrl) rows.push(["Page", submission.sourceUrl]);
  if (submission.utm) rows.push(["UTM", submission.utm]);
  const body = rows
    .map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  const message = submission.message
    ? `<p style="white-space:pre-wrap">${escapeHtml(submission.message)}</p>`
    : "";
  return `<table>${body}</table>${message}`;
}

/** POC notification — the primary email; null when the site has no contact address. */
export function buildPocNotification(
  site: WebsiteRow,
  submission: SubmissionRow,
): ResendSendInput | null {
  const to = pocAddress(site);
  if (!to) return null;
  const input: ResendSendInput = {
    from: `${displayName(site.name)} Forms <${FORMS_FROM}>`,
    to: [to],
    subject: `New ${submission.formType} from ${site.name}`,
    html: `<h2>New ${escapeHtml(submission.formType)} submission — ${escapeHtml(
      site.name,
    )}</h2>${fieldsTable(submission)}`,
  };
  // Reply straight to the lead.
  if (submission.email) input.replyTo = submission.email;
  return input;
}

/** Autoresponder to the submitter — null when there's no submitter email. */
export function buildAutoresponder(
  site: WebsiteRow,
  submission: SubmissionRow,
): ResendSendInput | null {
  if (!submission.email) return null;
  const intro = site.copyIntro ?? `Thanks for reaching out to ${site.name}.`;
  const contact = site.copyContact ?? "We've received your message and will be in touch soon.";
  const footer = site.copyFooter ?? site.name;
  return {
    from: `${displayName(site.name)} <${FORMS_FROM}>`,
    to: [submission.email],
    replyTo: pocAddress(site) ?? FALLBACK_REPLY_TO,
    subject: "We got your message",
    html: `<p>${escapeHtml(intro)}</p><p>${escapeHtml(contact)}</p><p>${escapeHtml(footer)}</p>`,
  };
}

export type NotifyDeps = {
  send: (input: ResendSendInput) => Promise<{ messageId: string }>;
};

export type NotifyOutcome = { status: NotifyStatus; messageId: string | null };

/**
 * Send the POC notification (primary — drives notifyStatus) then the submitter
 * autoresponder (best-effort — logged, never changes the outcome). The submission
 * is already persisted before this runs, so a Resend outage degrades to
 * notifyStatus="failed", never a lost lead.
 */
export async function notifySubmission(
  deps: NotifyDeps,
  site: WebsiteRow,
  submission: SubmissionRow,
): Promise<NotifyOutcome> {
  const poc = buildPocNotification(site, submission);
  let outcome: NotifyOutcome;
  if (!poc) {
    outcome = { status: "skipped", messageId: null };
  } else {
    try {
      const { messageId } = await deps.send(poc);
      outcome = { status: "sent", messageId };
    } catch (err) {
      console.error(`[submissions] POC notification failed: ${String(err)}`);
      outcome = { status: "failed", messageId: null };
    }
  }
  const auto = buildAutoresponder(site, submission);
  if (auto) {
    try {
      await deps.send(auto);
    } catch (err) {
      console.error(`[submissions] autoresponder failed: ${String(err)}`);
    }
  }
  return outcome;
}
```

- [ ] **Step 2: Write the failing tests** — `tests/forms/notify.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  buildPocNotification,
  buildAutoresponder,
  notifySubmission,
} from "../../src/forms/notify.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

describe("buildPocNotification", () => {
  it("addresses the POC, sets Reply-To to the submitter, names the site in From", () => {
    const site = makeWebsiteRow({ name: "Acme Co", pointOfContact: "owner@acme.com" });
    const sub = makeSubmissionRow({ email: "lead@x.com", formType: "inquiry" });
    const input = buildPocNotification(site, sub)!;
    expect(input.to).toEqual(["owner@acme.com"]);
    expect(input.replyTo).toBe("lead@x.com");
    expect(input.from).toContain("Acme Co Forms <forms@reddoorla.com>");
    expect(input.subject).toBe("New inquiry from Acme Co");
  });

  it("falls back to reportRecipientsTo, and returns null with no contact", () => {
    const withCc = makeWebsiteRow({ pointOfContact: null, reportRecipientsTo: "to@acme.com" });
    expect(buildPocNotification(withCc, makeSubmissionRow())!.to).toEqual(["to@acme.com"]);
    const none = makeWebsiteRow({ pointOfContact: null, reportRecipientsTo: null });
    expect(buildPocNotification(none, makeSubmissionRow())).toBeNull();
  });
});

describe("buildAutoresponder", () => {
  it("uses per-site copy when present and replies to the POC", () => {
    const site = makeWebsiteRow({
      name: "Acme",
      pointOfContact: "owner@acme.com",
      copyIntro: "Hi from Acme!",
    });
    const input = buildAutoresponder(site, makeSubmissionRow({ email: "lead@x.com" }))!;
    expect(input.to).toEqual(["lead@x.com"]);
    expect(input.replyTo).toBe("owner@acme.com");
    expect(input.html).toContain("Hi from Acme!");
  });

  it("returns null when the submitter has no email", () => {
    expect(buildAutoresponder(makeWebsiteRow(), makeSubmissionRow({ email: "" }))).toBeNull();
  });
});

describe("notifySubmission", () => {
  it("returns sent + message id and also fires the autoresponder", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const out = await notifySubmission({ send }, site, makeSubmissionRow({ email: "l@x.com" }));
    expect(out).toEqual({ status: "sent", messageId: "msg_1" });
    expect(send).toHaveBeenCalledTimes(2); // POC + autoresponder
  });

  it("returns failed when the POC send throws, without throwing", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const out = await notifySubmission({ send }, site, makeSubmissionRow({ email: "l@x.com" }));
    expect(out.status).toBe("failed");
  });

  it("returns skipped when there is no POC", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "x" });
    const site = makeWebsiteRow({ pointOfContact: null, reportRecipientsTo: null });
    const out = await notifySubmission({ send }, site, makeSubmissionRow({ email: "l@x.com" }));
    expect(out.status).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1); // autoresponder only
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/forms/notify.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/forms/notify.ts tests/forms/notify.test.ts
git commit -m "feat(forms): Resend POC notification + submitter autoresponder builders"
```

---

## Task 5: Ingest orchestration

**Files:**

- Create: `src/forms/ingest.ts`
- Test: `tests/forms/ingest.test.ts`

- [ ] **Step 1: Write `src/forms/ingest.ts`**

```typescript
import type { WebsiteRow } from "../reports/airtable/websites.js";
import type {
  SubmissionRow,
  SubmissionInput,
  NotifyStatus,
} from "../reports/airtable/submissions.js";
import { normalizeSubmission } from "./payload.js";

export type IngestDeps = {
  getWebsiteBySlug: (slug: string) => Promise<WebsiteRow | null>;
  createSubmission: (input: SubmissionInput) => Promise<SubmissionRow>;
  notify: (
    site: WebsiteRow,
    submission: SubmissionRow,
  ) => Promise<{ status: NotifyStatus; messageId: string | null }>;
  stampNotified: (id: string, status: NotifyStatus, messageId: string | null) => Promise<void>;
  now: () => Date;
};

export type IngestResult =
  | { status: "accepted"; submissionId: string; notifyStatus: NotifyStatus }
  | { status: "rejected"; reason: "invalid-payload"; errors: string[] }
  | { status: "unknown-site"; slug: string };

/**
 * Normalize → resolve site → persist → notify → stamp. The order is load-bearing:
 * the row is written BEFORE notify, and notify/stamp failures are swallowed (logged)
 * so a Resend or Airtable-write-back hiccup can never turn an accepted lead into a 502.
 */
export async function ingestSubmission(
  deps: IngestDeps,
  slug: string,
  rawPayload: unknown,
): Promise<IngestResult> {
  const normalized = normalizeSubmission(rawPayload);
  if (!normalized.ok) {
    return { status: "rejected", reason: "invalid-payload", errors: normalized.errors };
  }
  const site = await deps.getWebsiteBySlug(slug);
  if (!site) return { status: "unknown-site", slug };

  const n = normalized.value;
  const row = await deps.createSubmission({
    siteId: site.id,
    formType: n.formType,
    name: n.name,
    email: n.email,
    phone: n.phone,
    message: n.message,
    extraFields: n.extraFields,
    sourceUrl: n.sourceUrl,
    utm: n.utm,
    submittedAt: deps.now(),
  });

  let notify: { status: NotifyStatus; messageId: string | null };
  try {
    notify = await deps.notify(site, row);
  } catch (err) {
    console.error(`[ingest] notify threw: ${String(err)}`);
    notify = { status: "failed", messageId: null };
  }
  try {
    await deps.stampNotified(row.id, notify.status, notify.messageId);
  } catch (err) {
    console.error(`[ingest] stampNotified failed: ${String(err)}`);
  }
  return { status: "accepted", submissionId: row.id, notifyStatus: notify.status };
}
```

- [ ] **Step 2: Write the failing tests** — `tests/forms/ingest.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { ingestSubmission, type IngestDeps } from "../../src/forms/ingest.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

function deps(over: Partial<IngestDeps> = {}): IngestDeps {
  return {
    getWebsiteBySlug: vi.fn().mockResolvedValue(makeWebsiteRow({ id: "recSITE" })),
    createSubmission: vi.fn().mockResolvedValue(makeSubmissionRow({ id: "recSUB" })),
    notify: vi.fn().mockResolvedValue({ status: "sent", messageId: "msg_1" }),
    stampNotified: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-06-14T12:00:00Z"),
    ...over,
  };
}

describe("ingestSubmission", () => {
  it("rejects an invalid payload before touching Airtable", async () => {
    const d = deps();
    const r = await ingestSubmission(d, "acme", { name: "no contact info" });
    expect(r.status).toBe("rejected");
    expect(d.createSubmission).not.toHaveBeenCalled();
  });

  it("returns unknown-site when the slug doesn't resolve", async () => {
    const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(null) });
    const r = await ingestSubmission(d, "nope", { email: "a@b.co" });
    expect(r).toEqual({ status: "unknown-site", slug: "nope" });
    expect(d.createSubmission).not.toHaveBeenCalled();
  });

  it("persists, notifies, stamps, and accepts on the happy path", async () => {
    const d = deps();
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r).toEqual({ status: "accepted", submissionId: "recSUB", notifyStatus: "sent" });
    expect(d.createSubmission).toHaveBeenCalledTimes(1);
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "sent", "msg_1");
  });

  it("still accepts (notifyStatus=failed) when notify throws — the lead is already saved", async () => {
    const d = deps({ notify: vi.fn().mockRejectedValue(new Error("boom")) });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co" });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("failed");
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "failed", null);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/forms/ingest.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/forms/ingest.ts tests/forms/ingest.test.ts
git commit -m "feat(forms): ingest orchestration (normalize → persist → notify → stamp)"
```

---

## Task 6: Submission-status state machine + barrel export

**Files:**

- Create: `src/dashboard/submission-status.ts`
- Modify: `src/dashboard/index.ts`
- Test: `tests/dashboard/submission-status.test.ts`

- [ ] **Step 1: Write `src/dashboard/submission-status.ts`**

```typescript
import type { SubmissionRow, SubmissionStatus } from "../reports/airtable/submissions.js";
import { SUBMISSION_STATUSES } from "../reports/airtable/submissions.js";

export type SubmissionStatusDeps = {
  getSubmissionById: (id: string) => Promise<SubmissionRow | null>;
  setSubmissionStatusRow: (id: string, status: SubmissionStatus) => Promise<void>;
};

export type SubmissionStatusResult =
  | { status: "updated"; submissionId: string; newStatus: SubmissionStatus }
  | { status: "noop"; submissionId: string; reason: "already-set" }
  | { status: "invalid"; requested: string }
  | { status: "not-found"; submissionId: string };

function isStatus(v: unknown): v is SubmissionStatus {
  return typeof v === "string" && (SUBMISSION_STATUSES as readonly string[]).includes(v);
}

/**
 * Operator status transition. Idempotent: a request for the row's current status
 * is a no-op (no write). Rejects an unknown status before any read.
 */
export async function setSubmissionStatus(
  deps: SubmissionStatusDeps,
  submissionId: string,
  requested: unknown,
): Promise<SubmissionStatusResult> {
  if (!isStatus(requested)) return { status: "invalid", requested: String(requested) };
  const row = await deps.getSubmissionById(submissionId);
  if (!row) return { status: "not-found", submissionId };
  if (row.status === requested) return { status: "noop", submissionId, reason: "already-set" };
  await deps.setSubmissionStatusRow(submissionId, requested);
  return { status: "updated", submissionId, newStatus: requested };
}
```

- [ ] **Step 2: Add to the barrel** — `src/dashboard/index.ts`

Append after the existing `approve` exports:

```typescript
export { setSubmissionStatus } from "./submission-status.js";
export type { SubmissionStatusDeps, SubmissionStatusResult } from "./submission-status.js";
```

- [ ] **Step 3: Write the failing tests** — `tests/dashboard/submission-status.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  setSubmissionStatus,
  type SubmissionStatusDeps,
} from "../../src/dashboard/submission-status.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

function deps(over: Partial<SubmissionStatusDeps> = {}): SubmissionStatusDeps {
  return {
    getSubmissionById: vi
      .fn()
      .mockResolvedValue(makeSubmissionRow({ id: "recSUB", status: "new" })),
    setSubmissionStatusRow: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("setSubmissionStatus", () => {
  it("rejects an unknown status without reading", async () => {
    const d = deps();
    const r = await setSubmissionStatus(d, "recSUB", "bogus");
    expect(r.status).toBe("invalid");
    expect(d.getSubmissionById).not.toHaveBeenCalled();
  });

  it("returns not-found for a missing row", async () => {
    const d = deps({ getSubmissionById: vi.fn().mockResolvedValue(null) });
    expect((await setSubmissionStatus(d, "nope", "read")).status).toBe("not-found");
  });

  it("is a no-op when already in the requested status", async () => {
    const d = deps({
      getSubmissionById: vi.fn().mockResolvedValue(makeSubmissionRow({ status: "read" })),
    });
    const r = await setSubmissionStatus(d, "recSUB", "read");
    expect(r.status).toBe("noop");
    expect(d.setSubmissionStatusRow).not.toHaveBeenCalled();
  });

  it("updates and writes on a real transition", async () => {
    const d = deps();
    const r = await setSubmissionStatus(d, "recSUB", "archived");
    expect(r).toEqual({ status: "updated", submissionId: "recSUB", newStatus: "archived" });
    expect(d.setSubmissionStatusRow).toHaveBeenCalledWith("recSUB", "archived");
  });
});
```

- [ ] **Step 4: Run the tests + typecheck the barrel**

Run: `pnpm vitest run tests/dashboard/submission-status.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/submission-status.ts src/dashboard/index.ts tests/dashboard/submission-status.test.ts
git commit -m "feat(forms): submission status state machine + barrel export"
```

---

## Task 7: Public ingest Netlify handler

**Files:**

- Create: `netlify/functions/form-ingest.mts`

Handlers are thin glue over the (already-tested) pure modules, so per repo convention they have no unit test; verification is `pnpm typecheck` (which type-checks `.mts` via `tsconfig.netlify.json`) plus the GET health check.

- [ ] **Step 1: Write `netlify/functions/form-ingest.mts`**

```typescript
import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { createSubmission, stampNotified } from "../../src/reports/airtable/submissions.js";
import { ingestSubmission } from "../../src/forms/ingest.js";
import { notifySubmission } from "../../src/forms/notify.js";
import { verifyFormsToken, bearerToken } from "../../src/forms/token.js";
import { defaultResendClient } from "../../src/reports/send/resend.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Public, token-gated ingest. Path-routed on the function (same reason as
// approve-report.mts: a netlify.toml rewrite would hide ctx.params). Server-to-
// server only — the caller is a fleet site's Netlify egress, so per-IP limiting
// is a coarse abuse backstop; real protection is the token + the site-side
// honeypot/timing. (Per-slug limiting is a future enhancement — Netlify's
// rateLimit can't key on a path param.)
export const config: Config = {
  path: ["/api/forms/:slug", "/.netlify/functions/form-ingest"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 120,
    aggregateBy: ["ip"],
  },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-form-ingest",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          RESEND_API_KEY: typeof process.env.RESEND_API_KEY === "string",
          FORMS_INGEST_TOKEN: typeof process.env.FORMS_INGEST_TOKEN === "string",
        },
      },
      { status: 200 },
    );
  }
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  const expected = process.env.FORMS_INGEST_TOKEN;
  if (!expected) {
    console.error("[form-ingest] FORMS_INGEST_TOKEN missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  const presented =
    req.headers.get("x-forms-token") ?? bearerToken(req.headers.get("authorization"));
  if (!verifyFormsToken(presented, expected)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[form-ingest] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  const slug = ctx.params?.slug;
  if (!slug) return json({ ok: false, error: "missing-slug" }, 400);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }

  try {
    const base = openBase({ apiKey, baseId });
    const resend = defaultResendClient();
    const result = await ingestSubmission(
      {
        getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
        createSubmission: (input) => createSubmission(base, input),
        notify: (site, submission) =>
          notifySubmission({ send: (i) => resend.send(i) }, site, submission),
        stampNotified: (id, status, messageId) => stampNotified(base, id, status, messageId),
        now: () => new Date(),
      },
      slug,
      payload,
    );

    if (result.status === "unknown-site") return json({ ok: false, error: "unknown-site" }, 404);
    if (result.status === "rejected")
      return json({ ok: false, error: "invalid-payload", details: result.errors }, 400);
    return json({ ok: true, id: result.submissionId, notify: result.notifyStatus }, 200);
  } catch (err) {
    return handlerError("form-ingest", err);
  }
};
```

- [ ] **Step 2: Typecheck (covers the new `.mts`)**

Run: `pnpm typecheck`
Expected: clean (no errors). This runs `tsc --noEmit -p tsconfig.netlify.json`, which type-checks the handler against `src/`.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/form-ingest.mts
git commit -m "feat(forms): public token-gated form ingest handler (POST /api/forms/:slug)"
```

---

## Task 8: Operator status-change Netlify handler

**Files:**

- Create: `netlify/functions/submission-status.mts`

- [ ] **Step 1: Write `netlify/functions/submission-status.mts`**

```typescript
import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import {
  getSubmissionById,
  setSubmissionStatusRow,
} from "../../src/reports/airtable/submissions.js";
import { setSubmissionStatus, verifyBasicAuth } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Operator-only state change: same posture as approve-report.mts (CSRF + Basic
// auth + tighter 30/min). Path-routed on the function for the same ctx.params
// reason.
export const config: Config = {
  path: ["/api/submissions/:id/status", "/.netlify/functions/submission-status"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 30,
    aggregateBy: ["ip"],
  },
};

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-submission-status",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[submission-status] DASHBOARD_PASSWORD missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[submission-status] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  const id = ctx.params?.id;
  if (!id) return json({ ok: false, error: "missing-id" }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }
  const requested = (body as { status?: unknown } | null)?.status;

  try {
    const base = openBase({ apiKey, baseId });
    const result = await setSubmissionStatus(
      {
        getSubmissionById: (sid) => getSubmissionById(base, sid),
        setSubmissionStatusRow: (sid, status) => setSubmissionStatusRow(base, sid, status),
      },
      id,
      requested,
    );
    if (result.status === "not-found") return json(result, 404);
    if (result.status === "invalid") return json(result, 400);
    return json(result, 200);
  } catch (err) {
    return handlerError("submission-status", err);
  }
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/submission-status.mts
git commit -m "feat(forms): operator submission-status handler (POST /api/submissions/:id/status)"
```

---

## Task 9: Cockpit model — submissions queue + per-site count

**Files:**

- Modify: `src/dashboard/fleet-cockpit.ts`
- Test: `tests/dashboard/cockpit-submissions.test.ts`

All additions are backward-compatible: `buildCockpitModel` gains a **trailing, defaulted** `newSubmissions` param (existing 5-arg callers/tests unaffected), and the new model fields are **optional** (existing `SiteCard`/`CockpitModel` literals unaffected).

- [ ] **Step 1: Add the import** — top of `src/dashboard/fleet-cockpit.ts`

After the existing `import type { ReportType } from "../reports/types.js";` line, add:

```typescript
import type { SubmissionRow, FormType } from "../reports/airtable/submissions.js";
```

- [ ] **Step 2: Add `newSubmissions` to `SiteCard`**

In the `SiteCard` type, after the `watchSignals` field, add:

```typescript
  /** Count of NEW submissions for this site (optional; populated by buildCockpitModel). */
  newSubmissions?: number;
```

- [ ] **Step 3: Add the `SubmissionEntry` type + extend `CockpitSummary`/`CockpitModel`**

After the `PendingEntry` type block, add:

```typescript
export type SubmissionEntry = {
  submissionId: string;
  siteName: string;
  slug: string;
  formType: FormType;
  name: string;
  email: string;
  submittedAt: string | null;
};
```

In `CockpitSummary`, after `pending: number;` add:

```typescript
  /** Count of NEW submissions across the fleet (optional for back-compat). */
  newSubmissions?: number;
```

In `CockpitModel`, after `pending: PendingEntry[];` add:

```typescript
  /** NEW submissions across the fleet, newest-first (optional for back-compat). */
  submissions?: SubmissionEntry[];
```

- [ ] **Step 4: Extend `buildCockpitModel`**

Change the signature — add the trailing defaulted param. Replace:

```typescript
export function buildCockpitModel(
  websites: WebsiteRow[],
  reports: ReportRow[],
  priorSnapshot: DigestSnapshot,
  baseUrl: string,
  now: Date,
): CockpitModel {
```

with:

```typescript
export function buildCockpitModel(
  websites: WebsiteRow[],
  reports: ReportRow[],
  priorSnapshot: DigestSnapshot,
  baseUrl: string,
  now: Date,
  newSubmissions: SubmissionRow[] = [],
): CockpitModel {
```

Right after `const sitesById = new Map<string, WebsiteRow>(visible.map((w) => [w.id, w]));`, add the per-site count map:

```typescript
// Per-site NEW-submission counts, keyed by Websites record id. Used for the
// per-card badge below; the strip resolves entries against ALL sites.
const subCountBySite = new Map<string, number>();
for (const sub of newSubmissions) {
  subCountBySite.set(sub.siteId, (subCountBySite.get(sub.siteId) ?? 0) + 1);
}
```

In the `cards` map, change the returned object literal from:

```typescript
return { site, tier, items, watchReasons, watchSignals };
```

to:

```typescript
return {
  site,
  tier,
  items,
  watchReasons,
  watchSignals,
  newSubmissions: subCountBySite.get(site.id) ?? 0,
};
```

After the `pending` loop (immediately before the `const summary` block), add the entries build (reuses `allById` from the pending block):

```typescript
const submissions: SubmissionEntry[] = [];
for (const sub of newSubmissions) {
  const s = allById.get(sub.siteId);
  if (!s) continue; // orphan submission → skip rather than render a broken link
  submissions.push({
    submissionId: sub.id,
    siteName: s.name,
    slug: siteSlug(s.name),
    formType: sub.formType,
    name: sub.name,
    email: sub.email,
    submittedAt: sub.submittedAt,
  });
}
```

In the `summary` object literal, after `pending: pending.length,` add:

```typescript
    newSubmissions: submissions.length,
```

Change the return from `return { summary, cards, pending };` to:

```typescript
return { summary, cards, pending, submissions };
```

- [ ] **Step 5: Write the failing tests** — `tests/dashboard/cockpit-submissions.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

const baseUrl = "https://dash.example.com";
const now = new Date("2026-06-14T12:00:00Z");

describe("buildCockpitModel — submissions", () => {
  it("defaults to an empty submissions queue when none are passed", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme", dashboardToken: "x" });
    const model = buildCockpitModel([site], [], {}, baseUrl, now);
    expect(model.submissions).toEqual([]);
    expect(model.summary.newSubmissions).toBe(0);
  });

  it("builds entries, per-card counts, and the summary from NEW submissions", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme Co", dashboardToken: "x" });
    const subs = [
      makeSubmissionRow({ id: "s1", siteId: "recSITE", formType: "contact" }),
      makeSubmissionRow({ id: "s2", siteId: "recSITE", formType: "rsvp" }),
    ];
    const model = buildCockpitModel([site], [], {}, baseUrl, now, subs);
    expect(model.summary.newSubmissions).toBe(2);
    expect(model.submissions?.map((s) => s.submissionId)).toEqual(["s1", "s2"]);
    expect(model.submissions?.[0]?.slug).toBe("acme-co");
    expect(model.cards[0]?.newSubmissions).toBe(2);
  });

  it("skips an orphan submission whose site is unknown", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme", dashboardToken: "x" });
    const subs = [makeSubmissionRow({ id: "s1", siteId: "recGONE" })];
    const model = buildCockpitModel([site], [], {}, baseUrl, now, subs);
    expect(model.submissions).toEqual([]);
    expect(model.summary.newSubmissions).toBe(0);
  });

  it("surfaces a submission for a hidden site in the strip (resolves against ALL sites)", () => {
    const hidden = makeWebsiteRow({ id: "recHID", name: "Hidden", dashboardToken: null });
    const subs = [makeSubmissionRow({ id: "s1", siteId: "recHID" })];
    const model = buildCockpitModel([hidden], [], {}, baseUrl, now, subs);
    expect(model.submissions?.length).toBe(1);
  });
});
```

- [ ] **Step 6: Run the tests + the full suite (catch any cockpit-test fallout)**

Run: `pnpm vitest run tests/dashboard/cockpit-submissions.test.ts && pnpm vitest run tests/dashboard`
Expected: PASS. Existing cockpit tests still pass (additions are back-compatible).

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts tests/dashboard/cockpit-submissions.test.ts
git commit -m "feat(forms): cockpit model — new-submissions queue + per-site counts"
```

---

## Task 10: Cockpit render — strip, chip, badge + wire fleet-homepage

**Files:**

- Modify: `src/dashboard/fleet-render.ts`
- Modify: `netlify/functions/fleet-homepage.mts`
- Test: `tests/dashboard/fleet-render-submissions.test.ts`

- [ ] **Step 1: Import the new type** — `src/dashboard/fleet-render.ts`

Change the cockpit-types import line:

```typescript
import type { CockpitModel, SiteCard, Tier } from "./fleet-cockpit.js";
```

to:

```typescript
import type { CockpitModel, SiteCard, Tier, SubmissionEntry } from "./fleet-cockpit.js";
```

(`SubmissionEntry` is referenced for clarity in the strip; if the linter flags it as unused once the strip is added it will be used — keep it.)

- [ ] **Step 2: Add the submissions strip + per-card badge functions**

After the existing `approveStrip` function (ends at its closing `}`), add:

```typescript
function submissionsStrip(model: CockpitModel): string {
  const subs: SubmissionEntry[] = model.submissions ?? [];
  if (subs.length === 0) return "";
  const rows = subs
    .map((sub) => {
      const href = `/s/${escapeHtml(sub.slug)}`;
      const when = sub.submittedAt ? escapeHtml(relativeTimeFromNow(sub.submittedAt)) : "";
      const who = escapeHtml(sub.name || sub.email);
      return `<div class="approve-row" data-signal="submissions">
        <strong>${escapeHtml(sub.siteName)}</strong>
        <span class="muted">${escapeHtml(sub.formType)} — ${who}</span>
        <span class="muted">${when}</span>
        <a href="${href}">open ▸</a>
      </div>`;
    })
    .join("");
  return `<section class="approve-strip subm-strip" data-tier="submissions">
    <h2>📥 New submissions (${subs.length})</h2>
    ${rows}
  </section>`;
}

function submBadge(c: SiteCard): string {
  const n = c.newSubmissions ?? 0;
  return n > 0 ? `<span class="chip">📥 ${n} new</span>` : "";
}
```

- [ ] **Step 3: Render the badge on each card**

In `cockpitCard`, change:

```typescript
const extra = `${pill}${chips(c)}`;
```

to:

```typescript
const extra = `${pill}${chips(c)}${submBadge(c)}`;
```

- [ ] **Step 4: Add the "submissions" filter + summary head**

In the `FILTERS` array, add `"submissions"` after `"pending"`:

```typescript
const FILTERS = [
  "all",
  "vulns",
  "lighthouse",
  "delivery",
  "prs",
  "ci",
  "stale",
  "pending",
  "submissions",
] as const;
```

In `summaryBar`, add a head entry. Change the `heads` array's last line from:

```typescript
    `${s.pending} pending`,
```

to:

```typescript
    `${s.pending} pending`,
    `${s.newSubmissions ?? 0} new`,
```

- [ ] **Step 5: Place the strip in the document + add the filter jump**

In `renderCockpitHtml`, change:

```typescript
  ${approveStrip(model)}
  ${sections}
```

to:

```typescript
  ${approveStrip(model)}
  ${submissionsStrip(model)}
  ${sections}
```

In `FILTER_SCRIPT`, after the `if (f === 'pending') {...}` line, add a sibling for submissions:

```javascript
if (f === "submissions") {
  var ss = document.querySelector(".subm-strip");
  if (ss) ss.scrollIntoView({ behavior: "smooth" });
  return;
}
```

- [ ] **Step 6: Wire `fleet-homepage.mts`**

Add the import after the existing `listAllReports` import:

```typescript
import { listNewSubmissions } from "../../src/reports/airtable/submissions.js";
```

Inside the `try` block, after the `prior` defensive read block (`let prior ... }`), add:

```typescript
let newSubmissions: Awaited<ReturnType<typeof listNewSubmissions>> = [];
try {
  newSubmissions = await listNewSubmissions(base);
} catch {
  // submissions strip simply absent — triage still renders
}
```

Change the model build from:

```typescript
const model = buildCockpitModel(websites, reports, prior, baseUrl, new Date());
```

to:

```typescript
const model = buildCockpitModel(websites, reports, prior, baseUrl, new Date(), newSubmissions);
```

- [ ] **Step 7: Write the failing tests** — `tests/dashboard/fleet-render-submissions.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import type { CockpitModel } from "../../src/dashboard/fleet-cockpit.js";

function model(over: Partial<CockpitModel> = {}): CockpitModel {
  return {
    summary: {
      attention: 0,
      watch: 0,
      healthy: 0,
      criticalHighVulns: 0,
      lighthouseBelowFloor: 0,
      deliveryFailures: 0,
      renovateFailing: 0,
      ciRed: 0,
      pending: 0,
      newSubmissions: 0,
    },
    cards: [],
    pending: [],
    submissions: [],
    ...over,
  };
}

describe("renderCockpitHtml — submissions", () => {
  it("omits the strip when there are no submissions", () => {
    expect(renderCockpitHtml(model())).not.toContain("subm-strip");
  });

  it("renders the strip with an escaped entry and a count", () => {
    const html = renderCockpitHtml(
      model({
        summary: { ...model().summary, newSubmissions: 1 },
        submissions: [
          {
            submissionId: "s1",
            siteName: "Acme <b>",
            slug: "acme",
            formType: "contact",
            name: "Jane",
            email: "jane@x.com",
            submittedAt: "2026-06-14T12:00:00Z",
          },
        ],
      }),
    );
    expect(html).toContain("subm-strip");
    expect(html).toContain("New submissions (1)");
    expect(html).toContain("Acme &lt;b&gt;");
    expect(html).toContain('href="/s/acme"');
    expect(html).toContain("1 new"); // summary head
  });
});
```

- [ ] **Step 8: Run the tests + typecheck**

Run: `pnpm vitest run tests/dashboard/fleet-render-submissions.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean (fleet-homepage `.mts` compiles).

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/fleet-render.ts netlify/functions/fleet-homepage.mts tests/dashboard/fleet-render-submissions.test.ts
git commit -m "feat(forms): cockpit submissions strip + chip + per-card badge, wired to homepage"
```

---

## Task 11: Per-site dashboard — submissions list + status actions

**Files:**

- Modify: `src/dashboard/render.ts`
- Modify: `netlify/functions/site-dashboard.mts`
- Test: `tests/dashboard/render-submissions.test.ts`

- [ ] **Step 1: Add the import** — `src/dashboard/render.ts`

After the existing `import { isPendingApproval } from "../reports/airtable/reports.js";` line, add:

```typescript
import type { SubmissionRow } from "../reports/airtable/submissions.js";
```

- [ ] **Step 2: Add the submissions section functions**

After the existing `reportRow` function (before `const STYLES = `), add:

```typescript
function submissionRow(s: SubmissionRow): string {
  const when = s.submittedAt ? escapeHtml(relativeTimeFromNow(s.submittedAt)) : "—";
  const type = escapeHtml(s.formType);
  const who = escapeHtml(s.name || "(no name)");
  const email = escapeHtml(s.email || "");
  const message = escapeHtml(s.message ?? "");
  const status = escapeHtml(s.status);
  const id = escapeHtml(s.id);
  const url = `/api/submissions/${encodeURIComponent(s.id)}/status`;
  const btn = (label: string, status: string) =>
    `<button class="subm-status" data-id="${id}" data-status="${status}" data-url="${url}">${label}</button>`;
  return `<li class="subm-item">
    <div class="subm-head"><strong>${type}</strong> · ${who} <span class="muted">${email}</span> <span class="pill subm-${status}">${status}</span> <span class="muted">${when}</span></div>
    ${message ? `<div class="subm-msg">${message}</div>` : ""}
    <div class="subm-actions">${btn("Read", "read")}${btn("Archive", "archived")}${btn("Spam", "spam")}</div>
  </li>`;
}

function submissionsSection(submissions: SubmissionRow[]): string {
  if (submissions.length === 0) return "";
  const recent = [...submissions]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, 25);
  return `<div class="section submissions">
    <h2>Form submissions (${submissions.length})</h2>
    <ul class="subm-list">${recent.map(submissionRow).join("")}</ul>
  </div>`;
}
```

- [ ] **Step 3: Add styles**

In the `STYLES` template string, just before the closing backtick, add:

```css
.pill {
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-weight: 700;
}
.subm-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.subm-item {
  padding: 0.6rem 0;
  border-bottom: 1px solid #eee;
}
@media (prefers-color-scheme: dark) {
  .subm-item {
    border-color: #2a2a2a;
  }
}
.subm-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.subm-msg {
  margin: 0.35rem 0;
  white-space: pre-wrap;
}
.subm-actions {
  display: flex;
  gap: 0.4rem;
}
button.subm-status {
  font: inherit;
  padding: 0.25rem 0.7rem;
  border: 1px solid #888;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
button.subm-status:disabled {
  opacity: 0.6;
  cursor: default;
}
.pill.subm-new {
  background: #e8f0fe;
  color: #1a56db;
}
.pill.subm-read {
  background: #f0f0f0;
  color: #555;
}
.pill.subm-archived {
  background: #eee;
  color: #888;
}
.pill.subm-spam {
  background: #fdecea;
  color: #b00;
}
```

- [ ] **Step 4: Add the trailing param + render the section + extend the script**

Change the signature:

```typescript
export function renderSiteDashboardHtml(site: WebsiteRow, reports: ReportRow[]): string {
```

to:

```typescript
export function renderSiteDashboardHtml(
  site: WebsiteRow,
  reports: ReportRow[],
  submissions: SubmissionRow[] = [],
): string {
```

In the document body, change:

```typescript
  ${pendingSection(reports)}
```

to:

```typescript
  ${pendingSection(reports)}
  ${submissionsSection(submissions)}
```

In the inline `<script>`, after the existing `document.querySelectorAll("button.approve").forEach(...)` block (right before `</script>`), add:

```javascript
document.querySelectorAll("button.subm-status").forEach((b) => {
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      const res = await fetch(b.dataset.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: b.dataset.status }),
      });
      b.textContent = res.ok ? "✓" : "Failed";
      if (!res.ok) b.disabled = false;
    } catch {
      b.textContent = "Failed";
      b.disabled = false;
    }
  });
});
```

- [ ] **Step 5: Wire `site-dashboard.mts`**

Add the import after the existing `listReportsForSite` import:

```typescript
import { listSubmissionsForSite } from "../../src/reports/airtable/submissions.js";
```

In the `try` block, after `const reports = await listReportsForSite(base, site.id);`, add a defensive submissions read and pass it to the renderer. Change:

```typescript
const reports = await listReportsForSite(base, site.id);

return html(renderSiteDashboardHtml(site, reports), 200);
```

to:

```typescript
const reports = await listReportsForSite(base, site.id);

let submissions: Awaited<ReturnType<typeof listSubmissionsForSite>> = [];
try {
  submissions = await listSubmissionsForSite(base, site.id);
} catch {
  // submissions section simply absent — the rest of the page still renders
}

return html(renderSiteDashboardHtml(site, reports, submissions), 200);
```

- [ ] **Step 6: Write the failing tests** — `tests/dashboard/render-submissions.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

describe("renderSiteDashboardHtml — submissions", () => {
  it("omits the section when there are no submissions", () => {
    const html = renderSiteDashboardHtml(makeWebsiteRow(), []);
    expect(html).not.toContain("Form submissions");
  });

  it("lists submissions with escaped content and status buttons", () => {
    const html = renderSiteDashboardHtml(
      makeWebsiteRow(),
      [],
      [
        makeSubmissionRow({
          id: "recSUB",
          formType: "contact",
          name: "Jane <x>",
          email: "jane@x.com",
          message: "Hi & bye",
          status: "new",
        }),
      ],
    );
    expect(html).toContain("Form submissions (1)");
    expect(html).toContain("Jane &lt;x&gt;");
    expect(html).toContain("Hi &amp; bye");
    expect(html).toContain('data-url="/api/submissions/recSUB/status"');
    expect(html).toContain('data-status="archived"');
    expect(html).toContain("pill subm-new");
  });
});
```

- [ ] **Step 7: Run the tests + typecheck + full suite**

Run: `pnpm vitest run tests/dashboard/render-submissions.test.ts && pnpm typecheck && pnpm test`
Expected: PASS across the board (existing render tests unaffected — `submissions` defaults to `[]`).

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/render.ts netlify/functions/site-dashboard.mts tests/dashboard/render-submissions.test.ts
git commit -m "feat(forms): per-site submissions list + status actions, wired to site dashboard"
```

---

## Task 12: Create the Airtable `Submissions` table

**Files:** none (external Airtable change).

This is a real mutation to the production Airtable base. Do it via the Airtable MCP (`mcp__airtable__create_table` / `create_field`) or by hand in the Airtable UI. The column names below MUST match the `f["..."]` strings in `submissions.ts` exactly (Task 1).

- [ ] **Step 1: Create the table `Submissions`** in the same base as `Websites`/`Reports` (`AIRTABLE_BASE_ID`), with fields:

| Column name (exact) | Type                                | Options                                               |
| ------------------- | ----------------------------------- | ----------------------------------------------------- |
| `Submission ID`     | Autonumber                          | primary field                                         |
| `Site`              | Link to another record → `Websites` | single linked record                                  |
| `Form type`         | Single select                       | `contact`, `inquiry`, `newsletter`, `rsvp`, `reserve` |
| `Name`              | Single line text                    |                                                       |
| `Email`             | Email                               |                                                       |
| `Phone`             | Single line text                    |                                                       |
| `Message`           | Long text                           |                                                       |
| `Extra fields`      | Long text                           | (JSON string)                                         |
| `Source URL`        | URL                                 |                                                       |
| `UTM`               | Single line text                    |                                                       |
| `Submitted at`      | Date                                | include time, GMT/ISO                                 |
| `Status`            | Single select                       | `new`, `read`, `archived`, `spam`                     |
| `Notify status`     | Single select                       | `sent`, `failed`, `skipped`                           |
| `Resend message ID` | Single line text                    |                                                       |

- [ ] **Step 2: Smoke-test the round-trip against the live base.** With `AIRTABLE_PAT` + `AIRTABLE_BASE_ID` in the env (loaded from `~/.config/reddoor-maint/credentials.env`), confirm a write+read works. Either run the form-ingest GET health check after deploy (Task 13) or, from a node REPL, call `createSubmission(openBase(readAirtableConfig()), {...})` against a real `Websites` record id and verify the row appears with `Status=new`. Delete the test row afterward.

- [ ] **Step 3:** No commit (no repo change). Note completion in the PR description.

---

## Task 13: Final verification, env wiring, and PR

**Files:** none (verification + ops).

- [ ] **Step 1: Run the full pre-merge gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all green. (`test:dist` is required per project policy — `build` passing doesn't catch a renamed/removed public export.)

- [ ] **Step 2: Set the dashboard env var.** In the `reddoor-maintenance` Netlify site env, add `FORMS_INGEST_TOKEN` = a freshly generated random secret (e.g. `openssl rand -hex 32`). This same value will go into each fleet site in the Phase-2 plan. Record it in the operator credentials store.

- [ ] **Step 3: Post-deploy health checks (after the PR merges and deploys).** Curl each new handler's GET endpoint and confirm every env flag is `true`:

```bash
curl -s https://reddoor-maintenance.netlify.app/.netlify/functions/form-ingest | python3 -m json.tool
curl -s https://reddoor-maintenance.netlify.app/.netlify/functions/submission-status | python3 -m json.tool
```

Expected: `form-ingest` shows `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY`, `FORMS_INGEST_TOKEN` all `true`; `submission-status` shows its three flags `true`.

- [ ] **Step 4: Live end-to-end ingest test** (against a real `Websites` slug, e.g. `caltex`):

```bash
curl -s -X POST https://reddoor-maintenance.netlify.app/api/forms/<slug> \
  -H "x-forms-token: $FORMS_INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Test Lead","email":"you@example.com","message":"ingest smoke test","formType":"contact"}'
```

Expected: `{"ok":true,"id":"rec...","notify":"sent"}` (or `"skipped"` if that site has no POC). Confirm the row appears in the cockpit `📥 New submissions` strip and on `/s/<slug>`, the POC notification + autoresponder arrive, then archive the test row from `/s/<slug>` (exercises `submission-status`). Delete the test Airtable row when done.

- [ ] **Step 5: Open the PR.** Title `feat(forms): central submission pipeline (ingest + Resend + dashboard)`. In the body, link the spec + this plan, note the per-slug-rate-limit deviation, list the operator follow-up (`FORMS_INGEST_TOKEN`), and confirm the full gate output. Per merge-authority policy this non-release feat auto-merges once CI-green + review-clean.

---

## Self-Review

**1. Spec coverage:**

| Spec section                                                                                     | Task(s)                                                                                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Data model — `Submissions` table                                                                 | Task 1 (module) + Task 12 (table)                                                                   |
| Pipeline (normalize → site → persist → notify → stamp)                                           | Task 5 (+2, +1, +4)                                                                                 |
| Security: token (constant-time)                                                                  | Task 3, Task 7                                                                                      |
| Security: CSRF + Basic-auth on status endpoint                                                   | Task 8                                                                                              |
| Security: honeypot/timing                                                                        | Deferred to Phase-2 site plan (operates on the raw browser form, not the dashboard) — noted in spec |
| Security: per-slug rate limit                                                                    | Deviation recorded; coarse IP backstop in Task 7, per-slug deferred                                 |
| Email: POC notify + autoresponder, smart Reply-To, per-site copy                                 | Task 4                                                                                              |
| Failure isolation (Airtable before Resend; notifyStatus)                                         | Task 5 (logic) + Task 1 (`stampNotified`)                                                           |
| Dashboard: cockpit strip + per-site count                                                        | Task 9 (model) + Task 10 (render)                                                                   |
| Dashboard: per-site list + status actions                                                        | Task 11                                                                                             |
| Status endpoint                                                                                  | Task 6 (logic) + Task 8 (handler)                                                                   |
| Code org: `src/forms/` domain                                                                    | Tasks 2–5                                                                                           |
| Env: `FORMS_INGEST_TOKEN`                                                                        | Task 13                                                                                             |
| Testing list (normalizer, validator, token, status machine, cockpit model, ingest happy/failure) | Tasks 1–11 tests                                                                                    |

The shared-package `@reddoorla/maintenance/forms` subpath and per-site migration are explicitly out of this phase's scope (separate plans) — by design, not a gap.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every step has complete code or an exact command. ✓

**3. Type consistency:** `SubmissionRow`/`FormType`/`SubmissionStatus`/`NotifyStatus` defined in Task 1 and imported unchanged everywhere. `buildCockpitModel`'s trailing `newSubmissions` param and the optional model fields are consistent across Task 9 (producer) and Task 10 (consumer). `renderSiteDashboardHtml`'s trailing `submissions` param matches Task 11's call site in `site-dashboard.mts`. `ingestSubmission`/`setSubmissionStatus` deps shapes match their handler call sites (Tasks 7/8). Airtable column strings in `mapRow`/`createSubmission` (Task 1) match the table schema (Task 12). ✓
