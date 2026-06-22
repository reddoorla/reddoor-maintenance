# Submission Detail + Spam Catch-Rate Observability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator inspect full submission detail on the dashboard and see spam catch-rate (caught honeypot/too-fast vs marked-through) per site and fleet-wide.

**Architecture:** Component 1 is a pure render change (expandable `<details>` per submission). Component 2 adds a compact daily-bucket Airtable table (`Spam Screenouts`), a best-effort token-authed beacon from the site helpers when the honeypot/timing screen rejects, a handler branch that routes the beacon to a counter, a `recordMarkedSpam` increment when the operator marks "spam", and two read surfaces (per-site panel + cockpit roll-up).

**Tech Stack:** TypeScript ESM (`.js` import specifiers), vitest, Airtable JS SDK (throttled `openBase`), SvelteKit form helpers, Netlify `.mts` handlers. `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on.

**Spec:** `docs/superpowers/specs/2026-06-22-submission-detail-and-spam-observability-design.md`

**Conventions:**

- TDD per task: failing test → run (fail) → implement → run (pass) → commit.
- `git add <explicit paths>` — never `-A`/`.`. Do NOT commit `.env.example` (pre-modified) or `dist/` (gitignored).
- `npx prettier --write <files>` before each commit; CI runs `eslint . && prettier --check .`.
- Run the full gate before the PR: `pnpm lint && npx tsc --noEmit -p tsconfig.json && pnpm test && pnpm build && pnpm test:dist`.
- **Field-first:** the `Spam Screenouts` Airtable table is created by the controller BEFORE Task 2 merges (the controller handles this out-of-band via the Airtable MCP — implementer subagents must NOT attempt Airtable schema changes).

---

## File Structure

- `src/dashboard/render.ts` — MODIFY: `submissionRow` becomes expandable (all fields); add `extraFieldsList` helper, `spamScreenSection`; add CSS. (Component 1 + 2 panel)
- `src/reports/airtable/screenouts.ts` — CREATE: `Spam Screenouts` table access — types, `mapScreenOutRow`, `recordScreenOut`, `recordMarkedSpam`, `listScreenOutsSince`, `screenOutsSince` date helper. (Component 2 store)
- `src/forms/client.ts` — MODIFY: add `submitScreenOut`. (Component 2 beacon)
- `src/forms/action.ts`, `src/forms/endpoint.ts` — MODIFY: fire the beacon on screen-out. (Component 2 beacon wiring)
- `src/forms/ingest.ts` — MODIFY: add `parseScreenOut` + `ingestScreenOut`. (Component 2 routing)
- `netlify/functions/form-ingest.mts` — MODIFY: route a `screenOut` body to `ingestScreenOut`. (Component 2 routing)
- `src/dashboard/submission-status.ts` — MODIFY: optional `recordMarkedSpam` dep, called on transition→spam.
- `netlify/functions/submission-status.mts` — MODIFY: wire `recordMarkedSpam`.
- `src/dashboard/fleet-cockpit.ts`, `src/dashboard/fleet-render.ts` — MODIFY: cockpit roll-up.
- `netlify/functions/site-dashboard.mts`, `netlify/functions/fleet-homepage.mts` — MODIFY: read screen-outs (defensive).
- Tests alongside each, under `tests/`.

---

## Task 1: Expandable submission detail (Component 1)

**Files:**

- Modify: `src/dashboard/render.ts` (`submissionRow`, ~line 135; STYLES, ~line 277)
- Test: `tests/dashboard/render.test.ts` (the existing "submissions section" describe)

- [ ] **Step 1: Write failing tests** — append inside `tests/dashboard/render.test.ts`'s `renderSiteDashboardHtml — submissions section` describe (the `submission(n)` factory already exists there):

```ts
it("expands to show all stored fields for a submission", () => {
  const subs: SubmissionRow[] = [
    {
      id: "sub1",
      submissionId: 1423,
      siteId: "recSITE",
      formType: "contact",
      name: "Jane",
      email: "jane@example.com",
      phone: "555-0100",
      message: "Full message body",
      extraFields: JSON.stringify({ interest: "residential" }),
      sourceUrl: "https://acme.example.com/contact",
      utm: "google/cpc/spring",
      submittedAt: "2026-06-20T12:00:00Z",
      status: "new",
      notifyStatus: "sent",
      resendMessageId: "msg_abc",
    },
  ];
  const html = renderSiteDashboardHtml(siteRow(), [], subs);
  expect(html).toContain("<details");
  expect(html).toContain("555-0100");
  expect(html).toContain("Full message body");
  expect(html).toContain("google/cpc/spring");
  expect(html).toContain("interest");
  expect(html).toContain("residential");
  expect(html).toContain("msg_abc");
  expect(html).toContain("1423");
  expect(html).toContain('href="https://acme.example.com/contact"');
});

it("omits absent detail fields and falls back to raw extraFields when JSON is malformed", () => {
  const subs: SubmissionRow[] = [
    {
      id: "sub2",
      submissionId: null,
      siteId: "recSITE",
      formType: "contact",
      name: "No Extras",
      email: "x@example.com",
      phone: null,
      message: null,
      extraFields: "{not json",
      sourceUrl: null,
      utm: null,
      submittedAt: "2026-06-20T12:00:00Z",
      status: "new",
      notifyStatus: "sent",
      resendMessageId: null,
    },
  ];
  const html = renderSiteDashboardHtml(siteRow(), [], subs);
  expect(html).toContain("{not json"); // raw fallback, escaped, no throw
  expect(html).not.toMatch(/Phone:/i); // absent field omitted
});

it("escapes detail fields and neutralizes a javascript: source URL", () => {
  const subs: SubmissionRow[] = [
    {
      id: "sub3",
      submissionId: null,
      siteId: "recSITE",
      formType: "contact",
      name: "x",
      email: "x@example.com",
      phone: null,
      message: "<script>alert(1)</script>",
      extraFields: null,
      sourceUrl: "javascript:alert(1)",
      utm: null,
      submittedAt: "2026-06-20T12:00:00Z",
      status: "new",
      notifyStatus: "sent",
      resendMessageId: null,
    },
  ];
  const html = renderSiteDashboardHtml(siteRow(), [], subs);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toMatch(/href="javascript:/i);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/dashboard/render.test.ts -t "submissions section"`
Expected: FAIL (no `<details>`, fields not rendered).

- [ ] **Step 3: Implement** — in `src/dashboard/render.ts`, add an `extraFieldsList` helper above `submissionRow` and rewrite `submissionRow` to wrap detail in `<details>`. The current `submissionRow` is:

```ts
function submissionRow(s: SubmissionRow): string {
  const when = s.submittedAt ? escapeHtml(relativeTimeFromNow(s.submittedAt)) : "—";
  const type = escapeHtml(s.formType);
  const who = escapeHtml(s.name || "(no name)");
  const email = escapeHtml(s.email || "");
  const message = escapeHtml(s.message ?? "");
  const status = escapeHtml(s.status);
  const id = escapeHtml(s.id);
  const url = `/api/submissions/${encodeURIComponent(s.id)}/status`;
  const btn = (label: string, action: string) =>
    `<button class="subm-status" data-id="${id}" data-status="${action}" data-url="${url}">${label}</button>`;
  return `<li class="subm-item">
    <div class="subm-head"><strong>${type}</strong> · ${who} <span class="muted">${email}</span> <span class="pill subm-${status}">${status}</span> <span class="muted">${when}</span></div>
    ${message ? `<div class="subm-msg">${message}</div>` : ""}
    <div class="subm-actions">${btn("Read", "read")}${btn("Archive", "archived")}${btn("Spam", "spam")}</div>
  </li>`;
}
```

Replace it with:

```ts
/** Render a submission's `extraFields` JSON as a key/value list; on parse failure
 *  show the raw string (escaped) rather than dropping it. Returns "" when blank. */
function extraFieldsList(raw: string | null): string {
  if (!raw || raw.trim() === "") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `<div class="subm-kv"><span class="k">Extra fields</span> <code>${escapeHtml(raw)}</code></div>`;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `<div class="subm-kv"><span class="k">Extra fields</span> <code>${escapeHtml(raw)}</code></div>`;
  }
  const rows = Object.entries(parsed as Record<string, unknown>)
    .map(
      ([k, v]) =>
        `<div class="subm-kv"><span class="k">${escapeHtml(k)}</span> ${escapeHtml(String(v))}</div>`,
    )
    .join("");
  return rows;
}

function submissionRow(s: SubmissionRow): string {
  const when = s.submittedAt ? escapeHtml(relativeTimeFromNow(s.submittedAt)) : "—";
  const type = escapeHtml(s.formType);
  const who = escapeHtml(s.name || "(no name)");
  const email = escapeHtml(s.email || "");
  const status = escapeHtml(s.status);
  const id = escapeHtml(s.id);
  const url = `/api/submissions/${encodeURIComponent(s.id)}/status`;
  const btn = (label: string, action: string) =>
    `<button class="subm-status" data-id="${id}" data-status="${action}" data-url="${url}">${label}</button>`;

  // One detail row per present field; absent fields are omitted (no blank rows).
  const kv = (label: string, value: string | number | null) =>
    value === null || value === ""
      ? ""
      : `<div class="subm-kv"><span class="k">${label}</span> ${escapeHtml(String(value))}</div>`;
  const sourceLink = s.sourceUrl
    ? `<div class="subm-kv"><span class="k">Source</span> <a href="${escapeHtml(safeUrl(s.sourceUrl))}" rel="noopener noreferrer">${escapeHtml(s.sourceUrl)}</a></div>`
    : "";
  const messageBlock = s.message
    ? `<div class="subm-kv"><span class="k">Message</span></div><div class="subm-msg">${escapeHtml(s.message)}</div>`
    : "";
  const details = [
    kv("Phone", s.phone),
    messageBlock,
    sourceLink,
    kv("UTM", s.utm),
    extraFieldsList(s.extraFields),
    kv("Notify", s.notifyStatus),
    kv("Resend ID", s.resendMessageId),
    kv("Submission #", s.submissionId),
  ].join("");

  return `<li class="subm-item">
    <details>
      <summary class="subm-head"><strong>${type}</strong> · ${who} <span class="muted">${email}</span> <span class="pill subm-${status}">${status}</span> <span class="muted">${when}</span></summary>
      <div class="subm-detail">${details}</div>
    </details>
    <div class="subm-actions">${btn("Read", "read")}${btn("Archive", "archived")}${btn("Spam", "spam")}</div>
  </li>`;
}
```

Add to the STYLES string (after the `.subm-msg` rule, ~line 282):

```css
.subm-detail {
  padding: 0.35rem 0 0.2rem;
}
.subm-kv {
  font-size: 0.9rem;
  margin: 0.15rem 0;
}
.subm-kv .k {
  color: #888;
  margin-right: 0.4rem;
}
summary.subm-head {
  cursor: pointer;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/dashboard/render.test.ts`
Expected: PASS (all submissions-section tests green; existing ones unaffected).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/dashboard/render.ts tests/dashboard/render.test.ts
git add src/dashboard/render.ts tests/dashboard/render.test.ts
git commit -m "feat(dashboard): expandable submission detail (all stored fields)"
```

---

## Task 2: `Spam Screenouts` daily-bucket store (Component 2)

**Prerequisite (controller, not the implementer):** the `Spam Screenouts` Airtable table exists with fields `Site` (link to Websites), `Date` (single line text, `YYYY-MM-DD`), `Honeypot` (number), `Too-fast` (number), `Marked spam` (number).

**Files:**

- Create: `src/reports/airtable/screenouts.ts`
- Test: `tests/reports/airtable/screenouts.test.ts`

- [ ] **Step 1: Write failing tests** — `tests/reports/airtable/screenouts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";
import {
  recordScreenOut,
  recordMarkedSpam,
  listScreenOutsSince,
} from "../../../src/reports/airtable/screenouts.js";

type Rec = { id: string; fields: Record<string, unknown> };

/** Fake base supporting select().eachPage / .all, create, update — enough for the
 *  get-or-create upsert and the windowed read. filterByFormula is IGNORED (like the
 *  real test fakes), so the code must confirm matches in JS. */
function makeFakeBase(seed: Rec[] = []) {
  const rows: Rec[] = seed.map((r) => ({ id: r.id, fields: { ...r.fields } }));
  let n = rows.length;
  const calls = { creates: 0, updates: 0 };
  const tableFn = (_t: string) => ({
    select: () => ({
      all: async () =>
        rows.map((r) => ({ id: r.id, fields: r.fields, get: (k: string) => r.fields[k] })),
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(
          rows.map((r) => ({ id: r.id, fields: r.fields })),
          () => {},
        );
      },
    }),
    create: async (recs: Array<{ fields: Record<string, unknown> }>) => {
      const created = recs.map((rc) => ({ id: `rec${++n}`, fields: { ...rc.fields } }));
      rows.push(...created);
      calls.creates++;
      return created;
    },
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      for (const u of recs) {
        const row = rows.find((r) => r.id === u.id);
        if (row) Object.assign(row.fields, u.fields);
      }
      calls.updates++;
      return recs;
    },
  });
  return { base: tableFn as unknown as AirtableBase, rows, calls };
}

describe("recordScreenOut", () => {
  it("creates a bucket with the reason count = 1 when none exists", async () => {
    const { base, rows } = makeFakeBase();
    await recordScreenOut(base, "recSITE", "honeypot", "2026-06-22");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields).toMatchObject({
      Site: ["recSITE"],
      Date: "2026-06-22",
      Honeypot: 1,
    });
  });

  it("increments the existing bucket's reason count", async () => {
    const { base, rows, calls } = makeFakeBase([
      { id: "recB", fields: { Site: ["recSITE"], Date: "2026-06-22", Honeypot: 3, "Too-fast": 1 } },
    ]);
    await recordScreenOut(base, "recSITE", "too-fast", "2026-06-22");
    expect(calls.creates).toBe(0);
    expect(rows[0]!.fields["Too-fast"]).toBe(2);
    expect(rows[0]!.fields["Honeypot"]).toBe(3);
  });
});

describe("recordMarkedSpam", () => {
  it("increments Marked spam on the day's bucket (creating it if needed)", async () => {
    const { base, rows } = makeFakeBase();
    await recordMarkedSpam(base, "recSITE", "2026-06-22");
    expect(rows[0]!.fields["Marked spam"]).toBe(1);
  });
});

describe("listScreenOutsSince", () => {
  it("sums per site across buckets in the window (incl. duplicate same-day buckets)", async () => {
    const { base } = makeFakeBase([
      {
        id: "r1",
        fields: {
          Site: ["recA"],
          Date: "2026-06-20",
          Honeypot: 2,
          "Too-fast": 1,
          "Marked spam": 0,
        },
      },
      {
        id: "r2",
        fields: {
          Site: ["recA"],
          Date: "2026-06-21",
          Honeypot: 3,
          "Too-fast": 0,
          "Marked spam": 2,
        },
      },
      {
        id: "r3",
        fields: {
          Site: ["recB"],
          Date: "2026-06-21",
          Honeypot: 1,
          "Too-fast": 0,
          "Marked spam": 0,
        },
      },
      {
        id: "r4",
        fields: {
          Site: ["recA"],
          Date: "2026-05-01",
          Honeypot: 9,
          "Too-fast": 9,
          "Marked spam": 9,
        },
      }, // before window
    ]);
    const map = await listScreenOutsSince(base, "2026-06-01");
    expect(map.get("recA")).toEqual({ honeypot: 5, tooFast: 1, markedSpam: 2 });
    expect(map.get("recB")).toEqual({ honeypot: 1, tooFast: 0, markedSpam: 0 });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/reports/airtable/screenouts.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/reports/airtable/screenouts.ts`:

```ts
import type { FieldSet } from "airtable";
import type { AirtableBase } from "./client.js";

export const SCREENOUTS_TABLE = "Spam Screenouts";

export type ScreenOutReason = "honeypot" | "too-fast";
export type ScreenOutTotals = { honeypot: number; tooFast: number; markedSpam: number };

const REASON_FIELD: Record<ScreenOutReason, "Honeypot" | "Too-fast"> = {
  honeypot: "Honeypot",
  "too-fast": "Too-fast",
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function siteIdOf(fields: Record<string, unknown>): string {
  const link = fields["Site"] as string[] | undefined;
  return link?.[0] ?? "";
}

/** Find the (site, date) bucket via filterByFormula and confirm in JS (the test fake
 *  ignores the formula). Returns the first matching record id + fields, or null. */
async function findBucket(
  base: AirtableBase,
  siteId: string,
  date: string,
): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  const rows: { id: string; fields: Record<string, unknown> }[] = [];
  await base(SCREENOUTS_TABLE)
    .select({ filterByFormula: `{Date} = ${JSON.stringify(date)}`, pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push({ id: rec.id, fields: rec.fields });
      fetchNextPage();
    });
  return rows.find((r) => r.fields["Date"] === date && siteIdOf(r.fields) === siteId) ?? null;
}

async function bumpField(
  base: AirtableBase,
  siteId: string,
  date: string,
  field: "Honeypot" | "Too-fast" | "Marked spam",
): Promise<void> {
  const existing = await findBucket(base, siteId, date);
  if (existing) {
    const next = num(existing.fields[field]) + 1;
    await base(SCREENOUTS_TABLE).update([
      { id: existing.id, fields: { [field]: next } as FieldSet },
    ]);
  } else {
    await base(SCREENOUTS_TABLE).create([
      { fields: { Site: [siteId], Date: date, [field]: 1 } as FieldSet },
    ]);
  }
}

/** Upsert-increment the caught counter for a screen reason on the (site, date) bucket. */
export async function recordScreenOut(
  base: AirtableBase,
  siteId: string,
  reason: ScreenOutReason,
  date: string,
): Promise<void> {
  await bumpField(base, siteId, date, REASON_FIELD[reason]);
}

/** Upsert-increment the "got through, marked spam" counter on the (site, date) bucket. */
export async function recordMarkedSpam(
  base: AirtableBase,
  siteId: string,
  date: string,
): Promise<void> {
  await bumpField(base, siteId, date, "Marked spam");
}

/** Sum buckets with Date >= since, per site. Duplicate same-day buckets sum naturally,
 *  so the create-race in the upsert can never corrupt the totals. */
export async function listScreenOutsSince(
  base: AirtableBase,
  sinceDate: string,
): Promise<Map<string, ScreenOutTotals>> {
  const out = new Map<string, ScreenOutTotals>();
  await base(SCREENOUTS_TABLE)
    .select({ filterByFormula: `{Date} >= ${JSON.stringify(sinceDate)}`, pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) {
        const f = rec.fields;
        const date = typeof f["Date"] === "string" ? (f["Date"] as string) : "";
        if (date < sinceDate) continue; // JS-confirm the window (fake ignores the formula)
        const siteId = siteIdOf(f);
        if (!siteId) continue;
        const cur = out.get(siteId) ?? { honeypot: 0, tooFast: 0, markedSpam: 0 };
        cur.honeypot += num(f["Honeypot"]);
        cur.tooFast += num(f["Too-fast"]);
        cur.markedSpam += num(f["Marked spam"]);
        out.set(siteId, cur);
      }
      fetchNextPage();
    });
  return out;
}

/** The ISO date (YYYY-MM-DD) `days` before `now`, for the window queries. */
export function screenOutsSince(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/reports/airtable/screenouts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/reports/airtable/screenouts.ts tests/reports/airtable/screenouts.test.ts
git add src/reports/airtable/screenouts.ts tests/reports/airtable/screenouts.test.ts
git commit -m "feat(forms): Spam Screenouts daily-bucket store (caught + marked-spam counters)"
```

---

## Task 3: `submitScreenOut` beacon (Component 2)

**Files:**

- Modify: `src/forms/client.ts` (after `submitToIngest`, ~line 69)
- Test: `tests/forms/screen-out-beacon.test.ts`

- [ ] **Step 1: Write failing tests** — `tests/forms/screen-out-beacon.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { submitScreenOut } from "../../src/forms/client.js";

describe("submitScreenOut", () => {
  it("POSTs the reason with the token header to the ingest URL", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await submitScreenOut({
      url: "https://dash/api/forms/acme",
      token: "T",
      reason: "honeypot",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(res.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/acme");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "x-forms-token": "T" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ screenOut: "honeypot" });
  });

  it("never throws on a network error", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    const res = await submitScreenOut({
      url: "https://dash/api/forms/acme",
      token: "T",
      reason: "too-fast",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/forms/screen-out-beacon.test.ts`
Expected: FAIL (no `submitScreenOut`).

- [ ] **Step 3: Implement** — in `src/forms/client.ts`, add after `submitToIngest`:

```ts
export type SubmitScreenOutOptions = {
  /** Same ingest endpoint the site already posts submissions to. */
  url: string;
  token: string;
  reason: "honeypot" | "too-fast";
  fetch?: typeof fetch;
  /** Abort budget so a slow/hung beacon can't delay the (already-successful) response. */
  timeoutMs?: number;
};

/**
 * Best-effort screen-out beacon: tells the central ingest "a bot was screened here"
 * (no PII) so caught-vs-delivered is observable. Never throws — a failure is returned
 * as { ok: false } and the caller ignores it (the visitor already saw success).
 */
export async function submitScreenOut(
  opts: SubmitScreenOutOptions,
): Promise<{ ok: boolean; status: number }> {
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 1500);
  try {
    const res = await doFetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forms-token": opts.token },
      body: JSON.stringify({ screenOut: opts.reason }),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/forms/screen-out-beacon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/forms/client.ts tests/forms/screen-out-beacon.test.ts
git add src/forms/client.ts tests/forms/screen-out-beacon.test.ts
git commit -m "feat(forms): submitScreenOut best-effort screen-out beacon"
```

---

## Task 4: Fire the beacon from the site helpers (Component 2)

**Files:**

- Modify: `src/forms/action.ts` (the `if (!screen.ok)` branch, ~line 65)
- Modify: `src/forms/endpoint.ts` (the `if (!screen.ok)` branch, ~line 67-68)
- Test: `tests/forms/action.test.ts`, `tests/forms/endpoint.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests** — add to `tests/forms/action.test.ts` (mirror the existing harness there; it injects `getConfig`/`fetch`). Assert that a honeypot-filled submit still returns `{ success: true }` AND issues a beacon POST with `{ screenOut: "honeypot" }`; and that a clean submit issues NO screen-out beacon (only the normal ingest POST). Read the existing test file first to reuse its event/fetch mock shape; add:

```ts
it("beacons a screen-out (and still succeeds) when the honeypot is filled", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const action = createIngestAction({
    formType: "contact",
    getConfig: () => ({ url: "https://dash/api/forms/acme", token: "T" }),
    buildPayload: () => ({}),
  });
  const form = new FormData();
  form.set("bot-field", "i am a bot");
  const event = makeEvent(form, fetch); // helper in this file; passes event.fetch = fetch
  const res = await action(event);
  expect(res).toEqual({ success: true });
  const screenBeacon = fetch.mock.calls.find(
    ([, init]) => init && JSON.parse((init as RequestInit).body as string).screenOut === "honeypot",
  );
  expect(screenBeacon).toBeTruthy();
});

it("does not beacon a screen-out for a clean submit", async () => {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ ok: true, id: "x" }), { status: 200 }),
  );
  const action = createIngestAction({
    formType: "contact",
    getConfig: () => ({ url: "https://dash/api/forms/acme", token: "T" }),
    buildPayload: () => ({ name: "Jane" }),
    now: () => 10_000,
  });
  const form = new FormData();
  form.set("ts", "0"); // elapsed huge → not too-fast
  const res = await action(makeEvent(form, fetch));
  expect(res).toEqual({ success: true });
  const anyScreen = fetch.mock.calls.some(
    ([, init]) => init && "screenOut" in JSON.parse((init as RequestInit).body as string),
  );
  expect(anyScreen).toBe(false);
});
```

If `makeEvent` doesn't exist in the file, add a minimal one matching the existing tests' event construction (a `RequestEvent`-like object with `.request.formData()` returning `form` and `.fetch = fetch`).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/forms/action.test.ts`
Expected: FAIL (no beacon on screen-out).

- [ ] **Step 3: Implement** — in `src/forms/action.ts`, import `submitScreenOut` and replace the screen-out early return:

```ts
import {
  submitToIngest,
  screenSubmission,
  submitScreenOut,
  type SubmissionPayload,
} from "./client.js";
```

```ts
const screen = screenSubmission({
  botField: form.get(botFieldName)?.toString() ?? null,
  elapsedMs: elapsedMs(form.get(tsFieldName), now),
});
if (!screen.ok) {
  // Best-effort screen-out beacon (no PII) so catch-rate is observable, then
  // succeed exactly as before — the bot/visitor still sees success.
  const cfg = opts.getConfig();
  if (cfg.url && cfg.token) {
    await submitScreenOut({
      url: cfg.url,
      token: cfg.token,
      reason: screen.reason,
      fetch: event.fetch,
    });
  }
  return succeed();
}
```

In `src/forms/endpoint.ts`, import `submitScreenOut` and do the same in its `if (!screen.ok)` branch (it returns `json({ ok: true })`; read its `getConfig`/env shape from the file first — beacon only when url+token present), then return the success JSON.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/forms/action.test.ts tests/forms/endpoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/forms/action.ts src/forms/endpoint.ts tests/forms/action.test.ts tests/forms/endpoint.test.ts
git add src/forms/action.ts src/forms/endpoint.ts tests/forms/action.test.ts tests/forms/endpoint.test.ts
git commit -m "feat(forms): fire screen-out beacon from action + endpoint on bot screen"
```

---

## Task 5: Route the beacon centrally — `parseScreenOut` + `ingestScreenOut` (Component 2)

**Files:**

- Modify: `src/forms/ingest.ts` (add exports; extend `IngestDeps`)
- Modify: `netlify/functions/form-ingest.mts` (branch on a `screenOut` body)
- Test: `tests/forms/ingest-screenout.test.ts`

- [ ] **Step 1: Write failing tests** — `tests/forms/ingest-screenout.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { parseScreenOut, ingestScreenOut } from "../../src/forms/ingest.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

describe("parseScreenOut", () => {
  it("accepts the two valid reasons, rejects anything else", () => {
    expect(parseScreenOut({ screenOut: "honeypot" })).toBe("honeypot");
    expect(parseScreenOut({ screenOut: "too-fast" })).toBe("too-fast");
    expect(parseScreenOut({ screenOut: "nope" })).toBeNull();
    expect(parseScreenOut({ name: "Jane" })).toBeNull();
    expect(parseScreenOut(null)).toBeNull();
  });
});

describe("ingestScreenOut", () => {
  it("resolves the site and records the screen-out", async () => {
    const recorded: Array<{ siteId: string; reason: string }> = [];
    const site = makeWebsiteRow({ id: "recSITE" });
    const res = await ingestScreenOut(
      {
        getWebsiteBySlug: async (_s: string): Promise<WebsiteRow | null> => site,
        recordScreenOut: async (siteId, reason) => {
          recorded.push({ siteId, reason });
        },
      },
      "acme",
      "honeypot",
    );
    expect(res.status).toBe("recorded");
    expect(recorded).toEqual([{ siteId: "recSITE", reason: "honeypot" }]);
  });

  it("returns unknown-site without throwing when the slug is unmatched", async () => {
    const res = await ingestScreenOut(
      { getWebsiteBySlug: async () => null, recordScreenOut: vi.fn() },
      "ghost",
      "honeypot",
    );
    expect(res.status).toBe("unknown-site");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/forms/ingest-screenout.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement** — in `src/forms/ingest.ts`, add near the top exports:

```ts
export type ScreenOutDeps = {
  getWebsiteBySlug: (slug: string) => Promise<WebsiteRow | null>;
  recordScreenOut: (siteId: string, reason: "honeypot" | "too-fast") => Promise<void>;
};

export type ScreenOutResult =
  | { status: "recorded"; slug: string }
  | { status: "unknown-site"; slug: string };

/** Extract the screen-out reason from a beacon body, or null if it isn't one. */
export function parseScreenOut(payload: unknown): "honeypot" | "too-fast" | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)["screenOut"];
  return v === "honeypot" || v === "too-fast" ? v : null;
}

/** Resolve the site and record a caught screen-out. Best-effort: a record failure is
 *  the caller's to swallow — a missed count must never error a screened bot. */
export async function ingestScreenOut(
  deps: ScreenOutDeps,
  slug: string,
  reason: "honeypot" | "too-fast",
): Promise<ScreenOutResult> {
  const site = await deps.getWebsiteBySlug(slug);
  if (!site) return { status: "unknown-site", slug };
  await deps.recordScreenOut(site.id, reason);
  return { status: "recorded", slug };
}
```

In `netlify/functions/form-ingest.mts`, after the payload is parsed and BEFORE the `ingestSubmission` call, add the branch (import `parseScreenOut`, `ingestScreenOut` from `../../src/forms/ingest.js`; `recordScreenOut`, `screenOutsSince` not needed here; `recordScreenOut` from `../../src/reports/airtable/screenouts.js`; `new Date()` for the bucket date):

```ts
const screenOutReason = parseScreenOut(payload);
if (screenOutReason) {
  const date = new Date().toISOString().slice(0, 10);
  const r = await ingestScreenOut(
    {
      getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
      recordScreenOut: (siteId, reason) => recordScreenOut(base, siteId, reason, date),
    },
    slug,
    screenOutReason,
  );
  if (r.status === "unknown-site") return json({ ok: false, error: "unknown-site" }, 404);
  return json({ ok: true }, 200);
}
```

(The `base` is already constructed just above the `ingestSubmission` call; move the `parseScreenOut` branch inside the same `try` after `const base = openBase(...)`.)

- [ ] **Step 4: Run to verify pass + handler resolves**

Run: `npx vitest run tests/forms/ingest-screenout.test.ts && pnpm build && pnpm test:dist`
Expected: PASS; `form-ingest.mts resolves all its src/ imports`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/forms/ingest.ts netlify/functions/form-ingest.mts tests/forms/ingest-screenout.test.ts
git add src/forms/ingest.ts netlify/functions/form-ingest.mts tests/forms/ingest-screenout.test.ts
git commit -m "feat(forms): route screen-out beacon to the Spam Screenouts counter"
```

---

## Task 6: Increment `Marked spam` on the Spam triage action (Component 2)

**Files:**

- Modify: `src/dashboard/submission-status.ts` (`SubmissionStatusDeps`, `setSubmissionStatus`)
- Modify: `netlify/functions/submission-status.mts` (wire the dep)
- Test: `tests/dashboard/submission-status.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests** — add to `tests/dashboard/submission-status.test.ts`:

```ts
it("records marked-spam (with the row's siteId) only on a real transition to spam", async () => {
  const marked: string[] = [];
  const deps = {
    getSubmissionById: async (id: string) => ({ id, siteId: "recSITE", status: "new" }) as never,
    setSubmissionStatusRow: async () => {},
    recordMarkedSpam: async (siteId: string) => {
      marked.push(siteId);
    },
  };
  const res = await setSubmissionStatus(deps, "sub1", "spam");
  expect(res.status).toBe("updated");
  expect(marked).toEqual(["recSITE"]);
});

it("does not record marked-spam for a non-spam transition or a no-op", async () => {
  const marked: string[] = [];
  const recordMarkedSpam = async (siteId: string) => {
    marked.push(siteId);
  };
  await setSubmissionStatus(
    {
      getSubmissionById: async (id) => ({ id, siteId: "recSITE", status: "new" }) as never,
      setSubmissionStatusRow: async () => {},
      recordMarkedSpam,
    },
    "sub1",
    "read",
  );
  await setSubmissionStatus(
    {
      getSubmissionById: async (id) => ({ id, siteId: "recSITE", status: "spam" }) as never,
      setSubmissionStatusRow: async () => {},
      recordMarkedSpam,
    },
    "sub1",
    "spam", // already spam → no-op
  );
  expect(marked).toEqual([]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/dashboard/submission-status.test.ts`
Expected: FAIL (no `recordMarkedSpam` behavior).

- [ ] **Step 3: Implement** — in `src/dashboard/submission-status.ts`:

```ts
export type SubmissionStatusDeps = {
  getSubmissionById: (id: string) => Promise<SubmissionRow | null>;
  setSubmissionStatusRow: (id: string, status: SubmissionStatus) => Promise<void>;
  /** Optional: increment the per-site/day "marked spam" counter on a real →spam transition.
   *  Best-effort — a failure is swallowed so triage never errors. */
  recordMarkedSpam?: (siteId: string) => Promise<void>;
};
```

In `setSubmissionStatus`, after the successful write and before the return:

```ts
await deps.setSubmissionStatusRow(submissionId, requested);
if (requested === "spam" && deps.recordMarkedSpam) {
  try {
    await deps.recordMarkedSpam(row.siteId);
  } catch (err) {
    console.error(`[submission-status] recordMarkedSpam failed: ${String(err)}`);
  }
}
return { status: "updated", submissionId, newStatus: requested };
```

In `netlify/functions/submission-status.mts`, import `recordMarkedSpam`, `screenOutsSince` (only `recordMarkedSpam` needed) from `../../src/reports/airtable/screenouts.js`, and add the dep:

```ts
        recordMarkedSpam: (siteId) =>
          recordMarkedSpam(base, siteId, new Date().toISOString().slice(0, 10)),
```

- [ ] **Step 4: Run to verify pass + handler resolves**

Run: `npx vitest run tests/dashboard/submission-status.test.ts && pnpm build && pnpm test:dist`
Expected: PASS; `submission-status.mts resolves all its src/ imports`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/dashboard/submission-status.ts netlify/functions/submission-status.mts tests/dashboard/submission-status.test.ts
git add src/dashboard/submission-status.ts netlify/functions/submission-status.mts tests/dashboard/submission-status.test.ts
git commit -m "feat(dashboard): count marked-spam into the Spam Screenouts bucket on triage"
```

---

## Task 7: Per-site "Spam screen (30d)" panel (Component 2)

**Files:**

- Modify: `src/dashboard/render.ts` (add `spamScreenSection`; add param to `renderSiteDashboardHtml`; place after Site Health; add CSS)
- Modify: `netlify/functions/site-dashboard.mts` (read `listScreenOutsSince`, pass totals + now)
- Test: `tests/dashboard/render.test.ts`

- [ ] **Step 1: Write failing tests** — add a `renderSiteDashboardHtml — spam screen panel` describe:

```ts
it("renders caught honeypot/too-fast, marked spam, and delivered (30d)", () => {
  const subs: SubmissionRow[] = [
    {
      id: "s1",
      submissionId: 1,
      siteId: "recSITE",
      formType: "contact",
      name: "a",
      email: "a@x.com",
      phone: null,
      message: null,
      extraFields: null,
      sourceUrl: null,
      utm: null,
      submittedAt: new Date().toISOString(),
      status: "new",
      notifyStatus: "sent",
      resendMessageId: null,
    },
  ];
  const html = renderSiteDashboardHtml(
    siteRow({ id: "recSITE" }),
    [],
    subs,
    { honeypot: 280, tooFast: 30, markedSpam: 9 },
    new Date("2026-06-22T12:00:00Z"),
  );
  expect(html).toContain("Spam screen (30d)");
  expect(html).toContain("280");
  expect(html).toContain("30");
  expect(html).toContain("9");
  expect(html).toMatch(/delivered/i);
});

it("omits the spam panel when there is no screen-out data and no submissions", () => {
  const html = renderSiteDashboardHtml(siteRow(), [], [], null, new Date());
  expect(html).not.toContain("Spam screen (30d)");
});
```

Update the existing `renderSiteDashboardHtml(...)` calls that pass `submissions` — the new params are optional with safe defaults, so existing 2- and 3-arg calls keep compiling.

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/dashboard/render.test.ts -t "spam screen panel"`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/dashboard/render.ts`:

```ts
import type { ScreenOutTotals } from "../reports/airtable/screenouts.js";
```

Add `spamScreenSection` (place near `submissionsSection`):

```ts
const SPAM_WINDOW_DAYS = 30;

/** The per-site spam panel: caught (honeypot/too-fast) + marked-spam from the screen-out
 *  buckets, and delivered counted from the submissions loaded for this page within the
 *  window. Omitted when there's nothing to show. `delivered` undercounts only if the site
 *  exceeds the 200-row submissions fetch within the window (rare at fleet scale). */
function spamScreenSection(
  totals: ScreenOutTotals | null,
  submissions: SubmissionRow[],
  now: Date,
): string {
  const sinceMs = now.getTime() - SPAM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const delivered = submissions.filter(
    (s) => s.submittedAt !== null && Date.parse(s.submittedAt) >= sinceMs,
  ).length;
  const t = totals ?? { honeypot: 0, tooFast: 0, markedSpam: 0 };
  if (delivered === 0 && t.honeypot === 0 && t.tooFast === 0 && t.markedSpam === 0) return "";
  const row = (label: string, n: number) =>
    `<div class="spam-kv"><span class="k">${label}</span> ${escapeHtml(String(n))}</div>`;
  return `<div class="section spam-screen">
    <h2>Spam screen (30d)</h2>
    ${row("Caught — honeypot", t.honeypot)}
    ${row("Caught — too-fast", t.tooFast)}
    ${row("Delivered", delivered)}
    ${row("Marked spam", t.markedSpam)}
  </div>`;
}
```

Change the signature and the body of `renderSiteDashboardHtml`:

```ts
export function renderSiteDashboardHtml(
  site: WebsiteRow,
  reports: ReportRow[],
  submissions: SubmissionRow[] = [],
  spamTotals: ScreenOutTotals | null = null,
  now: Date = new Date(),
): string {
```

Place the panel right after the Site Health section block:

```ts
  ${securitySection(site)}

  ${spamScreenSection(spamTotals, submissions, now)}

  <div class="section">
    <h2>Reports</h2>
```

Add CSS (near `.subm-*`):

```css
.spam-screen .spam-kv {
  font-size: 0.95rem;
  margin: 0.2rem 0;
}
.spam-screen .spam-kv .k {
  color: #888;
  display: inline-block;
  min-width: 11rem;
}
```

In `netlify/functions/site-dashboard.mts`, after `submissions` is loaded, add a defensive screen-out read and pass it (import `listScreenOutsSince`, `screenOutsSince` from `../../src/reports/airtable/screenouts.js`):

```ts
let spamTotals: import("../../src/reports/airtable/screenouts.js").ScreenOutTotals | null = null;
try {
  const since = screenOutsSince(new Date(), 30);
  spamTotals = (await listScreenOutsSince(base, since)).get(site.id) ?? null;
} catch {
  // panel simply absent — never blank the page
}
```

and update the render call to `renderSiteDashboardHtml(site, reports, submissions, spamTotals, new Date())`.

- [ ] **Step 4: Run to verify pass + handler resolves**

Run: `npx vitest run tests/dashboard/render.test.ts && pnpm build && pnpm test:dist`
Expected: PASS; `site-dashboard.mts resolves all its src/ imports`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/dashboard/render.ts netlify/functions/site-dashboard.mts tests/dashboard/render.test.ts
git add src/dashboard/render.ts netlify/functions/site-dashboard.mts tests/dashboard/render.test.ts
git commit -m "feat(dashboard): per-site Spam screen (30d) panel"
```

---

## Task 8: Cockpit spam roll-up (Component 2)

**Files:**

- Modify: `src/dashboard/fleet-cockpit.ts` (`CockpitModel` + `buildCockpitModel` accept fleet spam totals)
- Modify: `src/dashboard/fleet-render.ts` (render the one-line roll-up)
- Modify: `netlify/functions/fleet-homepage.mts` (defensive `listScreenOutsSince` read, summed fleet-wide)
- Test: `tests/dashboard/fleet-render.test.ts`

- [ ] **Step 1: Write failing test** — add to `tests/dashboard/fleet-render.test.ts`:

```ts
describe("renderCockpitHtml — spam roll-up", () => {
  it("shows fleet caught + through totals when spam data is present", () => {
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme Co" })],
      [],
      {},
      BASE,
      NOW,
      [],
      {
        honeypot: 560,
        tooFast: 52,
        markedSpam: 24,
      },
    );
    const html = renderCockpitHtml(m);
    expect(html).toMatch(/spam/i);
    expect(html).toContain("612"); // caught = honeypot + too-fast
    expect(html).toContain("24"); // through = marked spam
  });

  it("omits the roll-up when there is no spam data", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).not.toMatch(/spam caught/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts -t "spam roll-up"`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/dashboard/fleet-cockpit.ts`:

Add to the `CockpitModel` type an optional field:

```ts
  /** Fleet spam totals over the window (optional; populated by buildCockpitModel). */
  spam?: { caught: number; through: number } | null;
```

Add a 7th param to `buildCockpitModel` (after `newSubmissions`) and set the field:

```ts
export function buildCockpitModel(
  websites: WebsiteRow[],
  reports: ReportRow[],
  priorSnapshot: DigestSnapshot,
  baseUrl: string,
  now: Date,
  newSubmissions: SubmissionRow[] = [],
  spamTotals: { honeypot: number; tooFast: number; markedSpam: number } | null = null,
): CockpitModel {
```

In the returned object, add:

```ts
    spam: spamTotals
      ? { caught: spamTotals.honeypot + spamTotals.tooFast, through: spamTotals.markedSpam }
      : null,
```

In `src/dashboard/fleet-render.ts`, add a `spamRollup(model)` returning "" when `!model.spam`, else a one-line `<div>`:

```ts
function spamRollup(model: CockpitModel): string {
  const s = model.spam;
  if (!s || (s.caught === 0 && s.through === 0)) return "";
  return `<div class="spam-rollup muted">🛡 Spam (30d) — caught ${s.caught} · through ${s.through}</div>`;
}
```

and render `${spamRollup(model)}` near the top of the cockpit body (e.g. just below the summary header — match the existing layout when you read the file).

In `netlify/functions/fleet-homepage.mts`, after `newSubmissions`, add a defensive fleet-summed read and pass it to `buildCockpitModel` (import `listScreenOutsSince`, `screenOutsSince`):

```ts
let spamTotals: { honeypot: number; tooFast: number; markedSpam: number } | null = null;
try {
  const since = screenOutsSince(new Date(), 30);
  const map = await listScreenOutsSince(base, since);
  spamTotals = { honeypot: 0, tooFast: 0, markedSpam: 0 };
  for (const t of map.values()) {
    spamTotals.honeypot += t.honeypot;
    spamTotals.tooFast += t.tooFast;
    spamTotals.markedSpam += t.markedSpam;
  }
} catch {
  // roll-up simply absent — never blank the cockpit
}
const model = buildCockpitModel(
  websites,
  reports,
  prior,
  baseUrl,
  new Date(),
  newSubmissions,
  spamTotals,
);
```

- [ ] **Step 4: Run to verify pass + handler resolves**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts && pnpm build && pnpm test:dist`
Expected: PASS; `fleet-homepage.mts resolves all its src/ imports`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/dashboard/fleet-cockpit.ts src/dashboard/fleet-render.ts netlify/functions/fleet-homepage.mts tests/dashboard/fleet-render.test.ts
git add src/dashboard/fleet-cockpit.ts src/dashboard/fleet-render.ts netlify/functions/fleet-homepage.mts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): cockpit spam roll-up (fleet caught + through, 30d)"
```

---

## Task 9: Changesets + full gate

**Files:**

- Create: `.changeset/submission-detail-view.md`, `.changeset/spam-catch-rate-observability.md`

- [ ] **Step 1: Write changesets**

`.changeset/submission-detail-view.md`:

```markdown
---
"@reddoorla/maintenance": patch
---

The per-site dashboard now lets you inspect a submission, not just triage it. Each submission is an
expandable row revealing all stored fields — phone, full message, source URL, UTM, the per-site extra
fields, notify status, Resend message ID, and submission number — all HTML-escaped, with the source
URL run through `safeUrl`.
```

`.changeset/spam-catch-rate-observability.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Spam catch-rate is now observable. The honeypot/timing screen runs on each fleet site and silently
drops bots before they reach the dashboard, so the catch count was invisible. The site form helpers
now fire a best-effort, no-PII screen-out beacon (`{ screenOut: honeypot|too-fast }`) to the existing
ingest endpoint when they reject a submission; the ingest routes it to a compact per-site/per-day
`Spam Screenouts` bucket. Marking a submission "spam" increments the same bucket's `Marked spam`
counter. The per-site page gains a "Spam screen (30d)" panel (caught honeypot/too-fast, delivered,
marked spam) and the cockpit gains a one-line fleet roll-up (caught + through) — so you can tell a
weaker screen (rising _through_) from more exposure (rising _caught_, steady _through_). Counts are
approximate under high concurrency (the read side sums duplicate same-day buckets); the beacon never
throws and is abort-bounded so a screened visitor never waits.
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm lint && npx tsc --noEmit -p tsconfig.json && pnpm test && pnpm build && pnpm test:dist`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
npx prettier --write .changeset/submission-detail-view.md .changeset/spam-catch-rate-observability.md
git add .changeset/submission-detail-view.md .changeset/spam-catch-rate-observability.md
git commit -m "chore: changesets for submission detail + spam observability"
```

---

## Final (controller): adversarial review + PR

After all tasks: dispatch a `code-reviewer` subagent over `git diff origin/main...HEAD` (focus: beacon never blocks/throws; XSS in submission detail + spam panel; counter race acceptability; no import cycle from `screenouts.ts`; handler import resolution). Then open a PR (human-gated merge per the release policy — this is a `feat`, auto-mergeable after build=success + review-clean via the SHA-gated squash).
