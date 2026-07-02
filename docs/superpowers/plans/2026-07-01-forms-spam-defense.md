# Forms Spam Defense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Akismet-equivalent spam suppression on the fleet forms pipeline using free tooling — a central heuristic classifier plus per-site Cloudflare Turnstile verified centrally — marking auto-spam as a distinct, recoverable status.

**Architecture:** Two tiers on top of the unchanged honeypot/timing screen: (A) Cloudflare Turnstile at the site edge (public sitekey; token forwarded to central ingest), and (B) a pure heuristic classifier in the central ingest that folds content signals + the Turnstile verdict into a `spam_score`. Both fail open; both feed one decision in `ingestSubmission` that marks spam as `spam_auto` (distinct from operator-marked `spam`), suppresses notifications + newsletter fan-out, and persists a recoverable row.

**Tech Stack:** TypeScript (ES2022 + @types/node), SvelteKit form actions/endpoints, Netlify Functions (`.mts`), libSQL/Turso via Kysely, Airtable (Websites), Resend, vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-forms-spam-defense-design.md`

---

## Task order & shared modules

Tasks are ordered so each compiles and passes on top of the previous:

1. DB columns + `spam_auto` status + submission types (the foundation every later task consumes)
2. Turnstile verification (`src/forms/turnstile.ts`) — **before** the classifier, which type-imports `TurnstileOutcome`
3. Heuristic classifier (`src/forms/spam-classifier.ts`)
4. Wire-format `_meta` + **creates** `src/forms/meta.ts` (`SubmissionMeta` + `readMeta`)
5. Ingest decision + notify/fan-out suppression
6. Central handler wiring (`form-ingest.mts`) — **imports** `readMeta`, threads the Turnstile outcome as the 4th arg to `ingestSubmission`
7. Per-site `requireTurnstile` config
8. Site factories — **modifies** `src/forms/meta.ts` to add `buildSubmissionMeta`
9. Dashboard review surface + recovery + cockpit affordance
10. Starter rollout (SEPARATE repo — handoff checklist, not implemented here)
11. Final integration gate + changeset

**Shared module `src/forms/meta.ts`** is created in Task 4 (owns `SubmissionMeta` + `readMeta`) and modified in Task 8 (adds `buildSubmissionMeta`); Task 6 imports `readMeta`. It is NOT exported from `index.ts` (central/internal, like `turnstile.ts`).

**`ingestSubmission` seam:** Task 5 extends the signature to `ingestSubmission(deps, slug, rawPayload, turnstile: TurnstileOutcome = "unverifiable")`; Task 6 passes the computed outcome as that 4th argument. The `classifySpam` dep stays a pure `(n, turnstile) => SpamVerdict`.

**Test runner:** the targeted TDD loop uses `pnpm exec vitest run <file>` (no build). The full CI gate (`pnpm test`, which runs a `pretest` build; plus `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:dist`) is Task 11.

---

### Task 1: DB columns + spam_auto status + submission types

**Files:**

- Create: `tests/db/spam-columns-migration.test.ts`
- Modify: `src/db/migrations.ts:46-62` (append migrations `0003`/`0004` after the `0002_fleet_events` entry)
- Modify: `src/db/schema.ts:7-23` (`SubmissionsTable` gains `spam_score` / `spam_reason`)
- Modify: `src/reports/submission-row.ts:6` (`SUBMISSION_STATUSES`), `:30-47` (`SubmissionRow`), `:49-60` (`SubmissionInput`)
- Modify: `src/db/submissions.ts:29-47` (`rowFromDb`), `:59-90` (`createSubmission`), `:205-227` (`backfillSubmission`)
- Modify: `tests/_helpers/submission-row.ts:5-22` (`makeSubmissionRow` factory)
- Test: `tests/db/migrate.test.ts:9,26,47` (hard-coded migration id list)
- Test: `tests/reports/submission-row.test.ts` (`toStatus` accepts `spam_auto`)
- Test: `tests/db/submissions.test.ts` (`createSubmission` honors `input.status` + writes spam columns)

Notes on the runner (from `src/db/migrations.ts` header + `src/db/migrate.ts`): each migration is applied via non-transactional `executeMultiple` and tracked by `id` in `_migrations`. SQLite `ADD COLUMN` has no `IF NOT EXISTS`, so each `ALTER` is its OWN single-statement migration (no mid-script failure window; the per-id marker guards re-runs). Tests run through vitest which resolves the `.js` import specifiers to the `.ts` sources and does NOT type-check, so a not-yet-added type surfaces as a runtime failure, not a compile error — that is what makes the TDD "FAIL" steps observable.

- [ ] **Step 1: Write the failing migration round-trip test.** Create `tests/db/spam-columns-migration.test.ts` (mirrors `tests/db/fleet-events-migration.test.ts`'s in-memory `openDb` pattern):

  ```ts
  import { describe, it, expect } from "vitest";
  import { openDb } from "../../src/db/client.js";

  describe("0003/0004 spam-score migrations", () => {
    it("add spam_score/spam_reason columns and round-trip a scored row", async () => {
      const db = await openDb({ url: ":memory:" });
      await db
        .insertInto("submissions")
        .values({
          id: "sub_spam_1",
          submission_id: 1,
          site_id: "recSITE",
          form_type: "contact",
          name: "Spammy McBot",
          email: "bot@mailinator.com",
          phone: null,
          message: "buy now http://x http://y http://z",
          extra_fields: null,
          source_url: null,
          utm: null,
          submitted_at: "2026-07-01T00:00:00.000Z",
          status: "spam_auto",
          notify_status: "skipped",
          resend_message_id: null,
          spam_score: 120,
          spam_reason: "links:3,disposable-email",
        })
        .execute();

      const rows = await db.selectFrom("submissions").selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.spam_score).toBe(120);
      expect(rows[0]!.spam_reason).toBe("links:3,disposable-email");
    });
  });
  ```

- [ ] **Step 2: Run the test — confirm it FAILS.** `pnpm exec vitest run tests/db/spam-columns-migration.test.ts`. Expect a failure: the insert throws a LibsqlError `SQLITE_ERROR: table submissions has no column named spam_score` (the columns do not exist yet).

- [ ] **Step 3: Add migrations `0003`/`0004`.** In `src/db/migrations.ts`, append two entries to the `MIGRATIONS` array immediately after the `0002_fleet_events` object (before the closing `];`):

  ```ts
    {
      id: "0003_add_spam_score",
      // Single-statement migration: SQLite `ADD COLUMN` has no `IF NOT EXISTS`, and the
      // runner's `executeMultiple` is non-transactional — a lone statement has no
      // mid-script failure window, and the per-id `_migrations` marker guards re-runs.
      sql: `ALTER TABLE submissions ADD COLUMN spam_score REAL;`,
    },
    {
      id: "0004_add_spam_reason",
      sql: `ALTER TABLE submissions ADD COLUMN spam_reason TEXT;`,
    },
  ```

- [ ] **Step 4: Keep the Kysely schema in lockstep.** In `src/db/schema.ts`, add the two columns to `SubmissionsTable` right after `resend_message_id: string | null;` (line 22):

  ```ts
  resend_message_id: string | null;
  spam_score: number | null;
  spam_reason: string | null;
  ```

- [ ] **Step 5: Run the test — confirm it PASSES.** `pnpm exec vitest run tests/db/spam-columns-migration.test.ts`. Expect `Test Files 1 passed (1)` / `Tests 1 passed (1)`.

- [ ] **Step 6: Write the failing `toStatus("spam_auto")` test.** In `tests/reports/submission-row.test.ts`, add inside the existing `describe("submission-row validators", ...)` block (after the `toStatus falls back` test):

  ```ts
  it("toStatus accepts spam_auto", () => {
    expect(toStatus("spam_auto")).toBe("spam_auto");
  });
  ```

- [ ] **Step 7: Run it — confirm it FAILS.** `pnpm exec vitest run tests/reports/submission-row.test.ts`. Expect the new case to fail: `expected 'new' to be 'spam_auto'` (`spam_auto` is not yet an accepted status, so `toStatus` falls back to `new`).

- [ ] **Step 8: Add `spam_auto` to the status enum.** In `src/reports/submission-row.ts` line 6, change:

  ```ts
  export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam", "spam_auto"] as const;
  ```

  (`toStatus` already validates against `SUBMISSION_STATUSES`, so no other change is needed there.)

- [ ] **Step 9: Run it — confirm it PASSES.** `pnpm exec vitest run tests/reports/submission-row.test.ts`. Expect all validator tests green (`Tests 4 passed (4)`).

- [ ] **Step 10: Write the failing `createSubmission` status/columns test.** In `tests/db/submissions.test.ts`, add inside the existing `describe("db createSubmission / getSubmissionById", ...)` block (after the "returns null for a missing id" test, before its closing `});`):

  ```ts
  it("honors input.status and stores spam_score/spam_reason", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recSITE",
      formType: "contact",
      name: "Bot",
      email: "bot@x.com",
      submittedAt: new Date("2026-07-01T00:00:00.000Z"),
      status: "spam_auto",
      spamScore: 120,
      spamReason: "links:3,disposable-email",
    });
    expect(row.status).toBe("spam_auto");
    expect(row.spamScore).toBe(120);
    expect(row.spamReason).toBe("links:3,disposable-email");
    const fetched = await getSubmissionById(db, row.id);
    expect(fetched!.status).toBe("spam_auto");
    expect(fetched!.spamScore).toBe(120);
    expect(fetched!.spamReason).toBe("links:3,disposable-email");
  });

  it("defaults status to new and spam columns to null", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recSITE",
      formType: "contact",
      name: "Real",
      email: "real@x.com",
      submittedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(row.status).toBe("new");
    expect(row.spamScore).toBeNull();
    expect(row.spamReason).toBeNull();
  });
  ```

- [ ] **Step 11: Run it — confirm it FAILS.** `pnpm exec vitest run tests/db/submissions.test.ts`. Expect the "honors input.status" case to fail: `expected 'new' to be 'spam_auto'` (`createSubmission` still hard-codes `status: "new"` and does not write/return the spam columns).

- [ ] **Step 12: Extend the submission types.** In `src/reports/submission-row.ts`, add to `SubmissionRow` right after `resendMessageId: string | null;` (line 46):

  ```ts
    resendMessageId: string | null;
    /** Heuristic spam score at ingest time; null for pre-classifier / un-scored rows. */
    spamScore?: number | null;
    /** Comma-joined classifier reason codes (e.g. "links:3,disposable-email"); null when unscored. */
    spamReason?: string | null;
  ```

  and add to `SubmissionInput` right after `submittedAt: Date;` (line 59):

  ```ts
    submittedAt: Date;
    status?: SubmissionStatus;
    spamScore?: number | null;
    spamReason?: string | null;
  ```

  (`SubmissionStatus` is already declared in this file at line 7.)

- [ ] **Step 13: Wire the columns through `submissions.ts`.** In `src/db/submissions.ts`:
  - In `rowFromDb`, add after `resendMessageId: r.resend_message_id,` (line 45), defending the read the same way the enum validators do:
    ```ts
      resendMessageId: r.resend_message_id,
      spamScore: typeof r.spam_score === "number" ? r.spam_score : null,
      spamReason: r.spam_reason,
    ```
  - In `createSubmission`'s `.values({...})`, replace the hard-coded `status: "new",` and add the two columns:
    ```ts
      status: input.status ?? "new",
      notify_status: "skipped",
      resend_message_id: null,
      spam_score: input.spamScore ?? null,
      spam_reason: input.spamReason ?? null,
    ```
  - In `backfillSubmission`'s `.values({...})`, add after `resend_message_id: row.resendMessageId,` (line 223):
    ```ts
      resend_message_id: row.resendMessageId,
      spam_score: row.spamScore ?? null,
      spam_reason: row.spamReason ?? null,
    ```

- [ ] **Step 14: Update the shared test factory.** In `tests/_helpers/submission-row.ts`, add before `...over,` (line 21):

  ```ts
      resendMessageId: null,
      spamScore: null,
      spamReason: null,
      ...over,
  ```

- [ ] **Step 15: Run it — confirm it PASSES.** `pnpm exec vitest run tests/db/submissions.test.ts`. Expect all cases green including the two new ones (`Tests 9 passed (9)`).

- [ ] **Step 16: Update the migrate.test.ts id list.** In `tests/db/migrate.test.ts`, extend the two full-run assertions (line 9 and line 26) and the post-recovery marker assertion (line 47) from `["0001_init", "0002_fleet_events"]` to the full ascending list:

  ```ts
  ["0001_init", "0002_fleet_events", "0003_add_spam_score", "0004_add_spam_reason"];
  ```

  Leave the line-39 assertion `expect(ran).toEqual(["0001_init"])` UNCHANGED — that test drops only the `0001_init` marker, so only `0001_init` (which is `IF NOT EXISTS`-guarded and safe to re-apply) re-runs; the `0003`/`0004` markers survive, so their non-idempotent `ADD COLUMN` never re-executes.

- [ ] **Step 17: Run the migrate + full suite — confirm PASS.** `pnpm exec vitest run tests/db/migrate.test.ts tests/db/spam-columns-migration.test.ts tests/db/submissions.test.ts tests/reports/submission-row.test.ts`. Expect all green. Then run `pnpm typecheck` and expect it to exit 0 (both `tsc --noEmit` passes) — this proves the Kysely `SubmissionsTable`, `SubmissionRow`, and `SubmissionInput` edits are internally consistent.

- [ ] **Step 18: Commit.** `git add src/db/migrations.ts src/db/schema.ts src/db/submissions.ts src/reports/submission-row.ts tests/_helpers/submission-row.ts tests/db/spam-columns-migration.test.ts tests/db/migrate.test.ts tests/db/submissions.test.ts tests/reports/submission-row.test.ts` then `git commit -m "feat(db): spam_auto status + spam_score/spam_reason columns for forms spam defense"`.

---

### Task 2: Turnstile server-side verification

Create `src/forms/turnstile.ts`, a small pure-ish leaf module that calls Cloudflare's siteverify endpoint and folds every failure mode into a three-state `TurnstileOutcome`. It mirrors the never-throw + injected-fetch + `AbortController` timeout pattern from `src/forms/client.ts` (`submitScreenOut`). It is central-only and is **NOT** exported from `src/forms/index.ts`.

**Files:**

- Create: `src/forms/turnstile.ts`
- Test: `tests/forms/turnstile.test.ts`

Reference (read, do not modify):

- `src/forms/client.ts:86-105` — `submitScreenOut` is the exact DI + `AbortController` + `try/catch/finally clearTimeout` shape to copy.
- `tests/forms/client.test.ts:1-50` — the `vi.fn()` fetch-fake + `Response` helper conventions to match.

Steps:

- [ ] **Step 1: Write the failing test file.** Create `tests/forms/turnstile.test.ts` with the complete spec below. It imports from `../../src/forms/turnstile.js` (which does not exist yet), so the run will error on module resolution.

```ts
import { describe, it, expect, vi } from "vitest";
import { verifyTurnstile } from "../../src/forms/turnstile.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyTurnstile", () => {
  it("returns 'pass' and posts a form-encoded secret/response/remoteip body on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    const out = await verifyTurnstile({
      secret: "sk",
      token: "tok",
      remoteip: "1.2.3.4",
      fetch: fetchMock,
    });
    expect(out).toBe("pass");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const params = init.body as URLSearchParams;
    expect(params).toBeInstanceOf(URLSearchParams);
    expect(params.get("secret")).toBe("sk");
    expect(params.get("response")).toBe("tok");
    expect(params.get("remoteip")).toBe("1.2.3.4");
  });

  it("omits remoteip from the body when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0]!;
    const params = init.body as URLSearchParams;
    expect(params.has("remoteip")).toBe(false);
  });

  it("returns 'fail' on a definite Cloudflare negative (success:false)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["invalid-input-response"] }),
      );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("fail");
  });

  it("returns 'unverifiable' when fetch throws (network error) — and never throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock })).resolves.toBe(
      "unverifiable",
    );
  });

  it("returns 'unverifiable' when fetch throws synchronously (never throws)", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock })).resolves.toBe(
      "unverifiable",
    );
  });

  it("returns 'unverifiable' on timeout (abort fires)", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const out = await verifyTurnstile({
      secret: "sk",
      token: "tok",
      fetch: fetchMock,
      timeoutMs: 5,
    });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' and never calls fetch when the secret is unset", async () => {
    const fetchMock = vi.fn();
    const out = await verifyTurnstile({ secret: undefined, token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' and never calls fetch when the secret is blank", async () => {
    const fetchMock = vi.fn();
    const out = await verifyTurnstile({ secret: "   ", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' and never calls fetch when the token is absent or blank", async () => {
    const fetchMock = vi.fn();
    expect(await verifyTurnstile({ secret: "sk", token: undefined, fetch: fetchMock })).toBe(
      "unverifiable",
    );
    expect(await verifyTurnstile({ secret: "sk", token: null, fetch: fetchMock })).toBe(
      "unverifiable",
    );
    expect(await verifyTurnstile({ secret: "sk", token: "   ", fetch: fetchMock })).toBe(
      "unverifiable",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' on a non-JSON / malformed body", async () => {
    const nonJson = new Response("<html>gateway timeout</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const fetchMock = vi.fn().mockResolvedValue(nonJson);
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' when the JSON body lacks a boolean success field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { message: "unexpected" }));
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS.** Command: `pnpm exec vitest run tests/forms/turnstile.test.ts`. Expected: the run errors during collection with a module-resolution failure like `Failed to resolve import "../../src/forms/turnstile.js"` / `Cannot find module` — 0 tests pass.

- [ ] **Step 3: Implement `src/forms/turnstile.ts` (minimal, never-throws).** Create the file with the complete implementation below. It short-circuits before any fetch when the secret or token is unset/blank, uses an `AbortController` timeout (default 2000ms) exactly like `submitScreenOut`, and folds every non-`success:boolean` outcome into `"unverifiable"`.

```ts
/**
 * Server-side Cloudflare Turnstile verification. Central-only — NOT exported from
 * `src/forms/index.ts`. Never throws: every network failure, timeout, unset secret,
 * absent token, or malformed response collapses to `"unverifiable"` so the ingest
 * caller can fail open (never 502 an accepted lead). Only a definite Cloudflare
 * negative (`success: false`) is `"fail"`.
 */
export type TurnstileOutcome = "pass" | "fail" | "unverifiable";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(opts: {
  secret: string | undefined;
  token: string | null | undefined;
  remoteip?: string | undefined;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Abort budget so a slow/hung edge can't stall the ingest response. */
  timeoutMs?: number;
}): Promise<TurnstileOutcome> {
  const secret = opts.secret;
  const token = opts.token;
  // No secret configured (ships dark) or no token forwarded (cached page, JS-off
  // visitor): unverifiable, and we never even reach the network.
  if (!secret || secret.trim().length === 0) return "unverifiable";
  if (!token || token.trim().length === 0) return "unverifiable";

  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2000);

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (opts.remoteip) body.set("remoteip", opts.remoteip);

  try {
    const res = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      return "unverifiable";
    }
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    if (!obj || typeof obj.success !== "boolean") return "unverifiable";
    return obj.success ? "pass" : "fail";
  } catch {
    // Network error or aborted (timeout) — fail open, distinct from a "fail".
    return "unverifiable";
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run the test and confirm it PASSES.** Command: `pnpm exec vitest run tests/forms/turnstile.test.ts`. Expected: `Test Files 1 passed (1)` with `Tests 11 passed (11)`.

- [ ] **Step 5: Commit.** Run `git add src/forms/turnstile.ts tests/forms/turnstile.test.ts` then `git commit -m "feat(forms): server-side Turnstile verification (fail-open, three-state outcome)"`.

---

### Task 3: Heuristic spam classifier (pure module)

Create the pure, leaf-level content spam scorer. It takes the normalized submission fields plus the Turnstile outcome and returns `{ score, reasons }` from the fixed signal table in the design spec. No server-SDK imports — it only imports the `FormType` and `TurnstileOutcome` _types_. `SPAM_THRESHOLD` is exported so ingest (Task 6) can decide `spam_auto`.

Prerequisite: `src/forms/turnstile.ts` (Task 2) must already export `type TurnstileOutcome = "pass" | "fail" | "unverifiable"`. This task only imports that type.

**Files:**

- Create: `src/forms/spam-classifier.ts`
- Test: `tests/forms/spam-classifier.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test file.** Create `tests/forms/spam-classifier.test.ts` with the full body below. It mirrors the pure input→output style of `tests/forms/client.test.ts` (no mocks — direct calls, `toEqual`/`toBe` on the returned verdict). A shared `clean()` helper builds a neutral baseline so each test varies exactly one signal.

```ts
import { describe, it, expect } from "vitest";
import { classifySpam, SPAM_THRESHOLD } from "../../src/forms/spam-classifier.js";
import type { FormType } from "../../src/forms/types.js";
import type { TurnstileOutcome } from "../../src/forms/turnstile.js";

/** Neutral baseline: no signal fires. Override one field per test. */
function clean(over: Partial<Parameters<typeof classifySpam>[0]> = {}) {
  return classifySpam({
    name: "Jane Doe",
    email: "jane@example.com",
    message: "Hello, I would like some more information please.",
    formType: "contact" as FormType,
    extraFields: {},
    turnstile: "unverifiable" as TurnstileOutcome,
    ...over,
  });
}

describe("classifySpam", () => {
  it("exports SPAM_THRESHOLD = 100", () => {
    expect(SPAM_THRESHOLD).toBe(100);
  });

  it("scores a clean submission 0 with no reasons", () => {
    expect(clean()).toEqual({ score: 0, reasons: [] });
  });

  it("turnstile 'fail' adds 70 (turnstile-fail); pass/unverifiable/absent add 0", () => {
    expect(clean({ turnstile: "fail" as TurnstileOutcome })).toEqual({
      score: 70,
      reasons: ["turnstile-fail"],
    });
    expect(clean({ turnstile: "pass" as TurnstileOutcome })).toEqual({ score: 0, reasons: [] });
    expect(clean({ turnstile: "unverifiable" as TurnstileOutcome })).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it("counts each URL in the message at 30, reason links:N", () => {
    expect(clean({ message: "see http://a.com please" })).toEqual({
      score: 30,
      reasons: ["links:1"],
    });
  });

  it("caps link points at 90 (three bare links) but reports the real count", () => {
    expect(clean({ message: "http://a.com http://b.com http://c.com" })).toEqual({
      score: 90,
      reasons: ["links:3"],
    });
    // more than three URLs still caps points at 90; reason shows the actual count
    const five = clean({ message: "www.a.com www.b.com www.c.com www.d.com www.e.com" });
    expect(five.score).toBe(90);
    expect(five.reasons).toEqual(["links:5"]);
  });

  it("flags html/bbcode link markup at 40 (link-markup) without a bare-URL match", () => {
    // relative href: markup present, but no http(s)/www so links does NOT fire
    expect(clean({ message: 'click <a href="/contact">here</a>' })).toEqual({
      score: 40,
      reasons: ["link-markup"],
    });
    expect(clean({ message: "[url=/x]link[/url]" })).toEqual({
      score: 40,
      reasons: ["link-markup"],
    });
  });

  it("counts each spam keyword at 25 capped at 75, reason keywords:N", () => {
    expect(clean({ message: "buy viagra today" })).toEqual({
      score: 25,
      reasons: ["keywords:1"],
    });
    const many = clean({ message: "viagra casino porn crypto" });
    expect(many.score).toBe(75); // 4 hits -> capped
    expect(many.reasons).toEqual(["keywords:4"]);
  });

  it("flags >30% non-latin script in the message OR the name at 50 (non-latin)", () => {
    expect(clean({ message: "Привет это спам сообщение" })).toEqual({
      score: 50,
      reasons: ["non-latin"],
    });
    expect(clean({ name: "Привет" })).toEqual({ score: 50, reasons: ["non-latin"] });
  });

  it("flags a disposable-email domain at 45 (disposable-email)", () => {
    expect(clean({ email: "bot@mailinator.com" })).toEqual({
      score: 45,
      reasons: ["disposable-email"],
    });
  });

  it("flags a URL in the name field at 45 (url-in-name)", () => {
    expect(clean({ name: "http://spam.example" })).toEqual({
      score: 45,
      reasons: ["url-in-name"],
    });
  });

  it("flags degenerate content at 40 (message == name, or body is only a URL)", () => {
    expect(clean({ name: "Hello", message: "Hello" })).toEqual({
      score: 40,
      reasons: ["degenerate"],
    });
    // body is only a URL: links (30) + degenerate (40)
    expect(clean({ name: "Jane", message: "http://spam.example" })).toEqual({
      score: 70,
      reasons: ["links:1", "degenerate"],
    });
  });

  it("flags an all-caps shout (len>20 & >70% uppercase) at 15 (all-caps)", () => {
    expect(clean({ message: "THIS IS A HUGE SHOUTING MESSAGE" })).toEqual({
      score: 15,
      reasons: ["all-caps"],
    });
    // <=20 chars never fires
    expect(clean({ message: "SHORT SHOUT" })).toEqual({ score: 0, reasons: [] });
  });

  it("threshold boundaries: fail + one link = 100 -> at/over threshold; three bare links = 90 -> under", () => {
    const over = clean({ turnstile: "fail" as TurnstileOutcome, message: "visit http://a.com" });
    expect(over).toEqual({ score: 100, reasons: ["turnstile-fail", "links:1"] });
    expect(over.score >= SPAM_THRESHOLD).toBe(true);

    const under = clean({ message: "http://a.com http://b.com http://c.com" });
    expect(under.score).toBe(90);
    expect(under.score >= SPAM_THRESHOLD).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it FAILS.** Command:

```
pnpm exec vitest run tests/forms/spam-classifier.test.ts
```

Expected: the suite fails to collect because the module does not exist yet — vitest prints `Failed to resolve import "../../src/forms/spam-classifier.js"` (and reports `1 failed` / no tests passing). This is the expected red state.

- [ ] **Step 3: Write the implementation.** Create `src/forms/spam-classifier.ts` with the full contents below. It imports only the `FormType` and `TurnstileOutcome` _types_ (leaf module, no runtime deps), keeps the keyword and disposable-domain lists as maintained module constants, and evaluates signals in the exact table order so reason strings are deterministic.

```ts
import type { FormType } from "./types.js";
import type { TurnstileOutcome } from "./turnstile.js";

/** A submission at or above this score is classified auto-spam by ingest. */
export const SPAM_THRESHOLD = 100;

export type SpamVerdict = { score: number; reasons: string[] };

/**
 * Maintained spam-keyword list (case-insensitive substring match). Tunable from
 * the `spam_score` / `spam_reason` data the pipeline now records — a defensible
 * v1, not final. Keep entries specific enough to avoid false positives.
 */
export const SPAM_KEYWORDS: readonly string[] = [
  "viagra",
  "cialis",
  "casino",
  "porn",
  "payday loan",
  "crypto",
  "bitcoin",
  "backlinks",
  "seo services",
  "forex",
  "escort",
  "replica watches",
  "weight loss",
];

/** Maintained disposable / throwaway email domains. */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "trashmail.com",
  "yopmail.com",
  "sharklasers.com",
  "getnada.com",
  "throwawaymail.com",
  "maildrop.cc",
];

const URL_RE = /(https?:\/\/|www\.)/gi;
const LINK_MARKUP_RE = /<a\s[^>]*href|\[url[=\]]/i;
const ONLY_URL_RE = /^(https?:\/\/\S+|www\.\S+)$/i;

/** Count of bare http(s)/www URLs in a string. */
function countUrls(text: string): number {
  return (text.match(URL_RE) ?? []).length;
}

/** How many maintained keywords appear (each counted once). */
function countKeywordHits(text: string): number {
  const lower = text.toLowerCase();
  return SPAM_KEYWORDS.filter((kw) => lower.includes(kw)).length;
}

/** Fraction of letters that are outside the Latin script (0..1). */
function nonLatinRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return nonLatin / letters.length;
}

/** Domain part of an email, lowercased; "" when unparseable. */
function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1
    ? ""
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/** len > 20 and > 70% of its letters uppercase. */
function isAllCaps(text: string): boolean {
  if (text.length <= 20) return false;
  const letters = text.match(/[a-zA-Z]/g) ?? [];
  if (letters.length === 0) return false;
  const upper = letters.filter((c) => c >= "A" && c <= "Z").length;
  return upper / letters.length > 0.7;
}

/**
 * Pure content spam scorer. Folds message/name/email content signals plus the
 * Turnstile verdict into a numeric score with human-readable reason strings.
 * Never throws; `formType` is accepted for future per-type tuning.
 */
export function classifySpam(input: {
  name: string;
  email: string;
  message?: string;
  formType: FormType;
  extraFields: Record<string, unknown>;
  turnstile: TurnstileOutcome;
}): SpamVerdict {
  const name = input.name ?? "";
  const email = input.email ?? "";
  const message = input.message ?? "";
  const reasons: string[] = [];
  let score = 0;

  if (input.turnstile === "fail") {
    score += 70;
    reasons.push("turnstile-fail");
  }

  const urls = countUrls(message);
  if (urls > 0) {
    score += Math.min(urls, 3) * 30;
    reasons.push(`links:${urls}`);
  }

  if (LINK_MARKUP_RE.test(message)) {
    score += 40;
    reasons.push("link-markup");
  }

  const keywords = countKeywordHits(message);
  if (keywords > 0) {
    score += Math.min(keywords, 3) * 25;
    reasons.push(`keywords:${keywords}`);
  }

  if (nonLatinRatio(message) > 0.3 || nonLatinRatio(name) > 0.3) {
    score += 50;
    reasons.push("non-latin");
  }

  if (DISPOSABLE_EMAIL_DOMAINS.includes(emailDomain(email))) {
    score += 45;
    reasons.push("disposable-email");
  }

  if (countUrls(name) > 0) {
    score += 45;
    reasons.push("url-in-name");
  }

  const trimmedMsg = message.trim();
  const degenerate =
    (trimmedMsg.length > 0 && trimmedMsg === name.trim()) || ONLY_URL_RE.test(trimmedMsg);
  if (degenerate) {
    score += 40;
    reasons.push("degenerate");
  }

  if (isAllCaps(message)) {
    score += 15;
    reasons.push("all-caps");
  }

  return { score, reasons };
}
```

- [ ] **Step 4: Run the test and confirm it PASSES.** Command:

```
pnpm exec vitest run tests/forms/spam-classifier.test.ts
```

Expected: `Test Files 1 passed (1)` and all 12 tests passing (`Tests 12 passed (12)`).

- [ ] **Step 5: Commit.** Stage only the two new files and commit:

```
git add src/forms/spam-classifier.ts tests/forms/spam-classifier.test.ts
git commit -m "feat(forms): heuristic spam classifier (pure scoring module)"
```

---

### Task 4: Wire-format \_meta envelope + stripping

Creates the shared `src/forms/meta.ts` leaf module owning `SubmissionMeta` + the central-side `readMeta`, wires the optional `_meta` field into both `SubmissionPayload` copies (importing the type from `meta.ts`, never redefining it), and adds `"_meta"` to `payload.ts`'s `KNOWN_KEYS` so `normalizeSubmission` strips the whole envelope before the unknown-keys→`extraFields` merge — the token/IP/UA can never leak into stored lead data. `buildSubmissionMeta` is intentionally NOT added here (Task 8 adds it); `parseMeta` is intentionally NOT added to `payload.ts` (`readMeta` is the single reader).

**Files:**

- Create: `src/forms/meta.ts`
- Modify: `src/forms/payload.ts` (add import; add `_meta?` to `SubmissionPayload` after line 15; add `"_meta"` to `KNOWN_KEYS` at lines 33-44)
- Modify: `src/forms/client.ts` (add import after line 1; add `_meta?` to `SubmissionPayload` before the index signature at line 23)
- Test: `tests/forms/meta.test.ts` (new)
- Test: `tests/forms/payload.test.ts` (add one `_meta`-stripping case)

Steps:

- [ ] **Step 1: Write the failing test for `readMeta`.** Create `tests/forms/meta.test.ts` (matches the pure-module style of `tests/forms/client.test.ts` / `payload.test.ts` — `describe`/`it`/`expect`, no mocks needed):

  ```ts
  import { describe, it, expect } from "vitest";
  import { readMeta } from "../../src/forms/meta.js";

  describe("readMeta", () => {
    it("round-trips token/ip/ua from a well-formed _meta envelope", () => {
      const m = readMeta({
        email: "a@b.co",
        _meta: { turnstileToken: "tok", clientIp: "1.2.3.4", userAgent: "Mozilla/5.0" },
      });
      expect(m).toEqual({ turnstileToken: "tok", clientIp: "1.2.3.4", userAgent: "Mozilla/5.0" });
    });

    it("trims whitespace and drops blank string fields", () => {
      const m = readMeta({ _meta: { turnstileToken: "  tok  ", clientIp: "   ", userAgent: "" } });
      expect(m).toEqual({ turnstileToken: "tok" });
    });

    it("drops non-string fields (a bot can't smuggle a non-string clientIp/ua)", () => {
      const m = readMeta({ _meta: { turnstileToken: 123, clientIp: { x: 1 }, userAgent: null } });
      expect(m).toEqual({});
    });

    it("returns an empty object when _meta is absent, wrong-typed, or the payload is not an object", () => {
      expect(readMeta({ email: "a@b.co" })).toEqual({});
      expect(readMeta({ _meta: "nope" })).toEqual({});
      expect(readMeta(null)).toEqual({});
      expect(readMeta("nope")).toEqual({});
    });
  });
  ```

- [ ] **Step 2: Run the new test and confirm it FAILS.** Run:

  ```
  pnpm vitest run tests/forms/meta.test.ts
  ```

  Expected: the run FAILS to collect the file with a module-resolution error like `Failed to resolve import "../../src/forms/meta.js"` / `Cannot find module` — `src/forms/meta.ts` does not exist yet.

- [ ] **Step 3: Create `src/forms/meta.ts` (minimal implementation).** Write exactly:

  ```ts
  /** The reserved wire envelope a fleet site forwards alongside the lead fields. */
  export type SubmissionMeta = {
    turnstileToken?: string;
    clientIp?: string;
    userAgent?: string;
  };

  function str(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
  }

  /**
   * Defensively read the reserved `_meta` envelope off an untrusted ingest payload
   * (CENTRAL side, used by the ingest handler). Keeps only non-blank string fields,
   * dropping the rest, so a bot cannot smuggle a non-string clientIp/userAgent into
   * the transient scoring path. The token/IP/UA read here are used transiently
   * (Turnstile `remoteip` + scoring) and are NEVER persisted; the token is never
   * stored. The SITE-side writer (`buildSubmissionMeta`) is added by the
   * site-factory task; `readMeta` is the single reader (there is no `parseMeta`).
   */
  export function readMeta(payload: unknown): SubmissionMeta {
    const meta: SubmissionMeta = {};
    if (typeof payload !== "object" || payload === null) return meta;
    const raw = (payload as Record<string, unknown>)._meta;
    if (typeof raw !== "object" || raw === null) return meta;
    const m = raw as Record<string, unknown>;
    const token = str(m.turnstileToken);
    if (token) meta.turnstileToken = token;
    const ip = str(m.clientIp);
    if (ip) meta.clientIp = ip;
    const ua = str(m.userAgent);
    if (ua) meta.userAgent = ua;
    return meta;
  }
  ```

  Do NOT export `meta.ts` from `src/forms/index.ts` (central-only leaf, exactly like `turnstile.ts`).

- [ ] **Step 4: Run the `readMeta` test and confirm it PASSES.** Run:

  ```
  pnpm vitest run tests/forms/meta.test.ts
  ```

  Expected: `Test Files  1 passed (1)` with all 4 tests passing.

- [ ] **Step 5: Write the failing `_meta`-stripping test in `payload.test.ts`.** Add this `it` block inside the existing `describe("normalizeSubmission", ...)` in `tests/forms/payload.test.ts` (e.g. after the `"drops prototype-pollution keys"` case, before the closing `});`):

  ```ts
  it("strips the reserved _meta envelope wholesale (never lands in extraFields)", () => {
    // The forwarded { turnstileToken, clientIp, userAgent } envelope is transport
    // metadata, not lead data. It must be dropped BEFORE the unknown-keys→extraFields
    // merge so IP/UA/token can never leak into stored data or the operator email.
    const r = normalizeSubmission({
      email: "a@b.co",
      message: "hi",
      company: "Acme",
      _meta: { turnstileToken: "tok", clientIp: "1.2.3.4", userAgent: "Mozilla/5.0" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // a normal unknown key still lands…
      expect(r.value.extraFields).toEqual({ company: "Acme" });
      // …but _meta and its contents never do.
      expect("_meta" in r.value.extraFields).toBe(false);
      expect(r.value.extraFields.turnstileToken).toBeUndefined();
      expect(r.value.extraFields.clientIp).toBeUndefined();
      expect(r.value.extraFields.userAgent).toBeUndefined();
    }
  });
  ```

- [ ] **Step 6: Run the payload test and confirm the new case FAILS.** Run:

  ```
  pnpm vitest run tests/forms/payload.test.ts
  ```

  Expected: the new case FAILS — `normalizeSubmission` currently treats `_meta` as an unknown key and dumps it into `extraFields`, so `expect(r.value.extraFields).toEqual({ company: "Acme" })` fails with actual `{ company: "Acme", _meta: {...} }`. The other cases still pass.

- [ ] **Step 7: Wire `_meta` into `src/forms/payload.ts` (minimal implementation).** Three edits:
  1. Add the type import directly under the existing import on line 1:

     ```ts
     import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
     import type { SubmissionMeta } from "./meta.js";
     ```

  2. Add the optional `_meta` field to `SubmissionPayload`, right after the `extra?` field (after line 15):

     ```ts
       /** Any additional, site-specific fields. */
       extra?: Record<string, unknown>;
       /** Reserved transport envelope (token/IP/UA); stripped by normalizeSubmission, never persisted. */
       _meta?: SubmissionMeta;
     };
     ```

  3. Add `"_meta"` to `KNOWN_KEYS` so it is stripped wholesale before the merge (add after `"extra"` at line 43):

     ```ts
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
       "_meta",
     ]);
     ```

  (Do NOT add a `parseMeta` reader here — `readMeta` in `meta.ts` is the single reader.)

- [ ] **Step 8: Keep the `SubmissionPayload` copy in `client.ts` in sync.** Two edits to `src/forms/client.ts`:
  1. Add the type import under line 1:

     ```ts
     import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
     import type { SubmissionMeta } from "./meta.js";
     ```

  2. Add the optional `_meta` field to `SubmissionPayload` just before the index signature (line 23), matching the file's `| undefined` convention under `exactOptionalPropertyTypes`:

     ```ts
       sourceUrl?: string | undefined;
       utm?: string | undefined;
       /** Reserved transport envelope (token/IP/UA); stripped centrally, never persisted. */
       _meta?: SubmissionMeta | undefined;
       [key: string]: unknown;
     };
     ```

- [ ] **Step 9: Run both test files and confirm they PASS.** Run:

  ```
  pnpm vitest run tests/forms/payload.test.ts tests/forms/meta.test.ts
  ```

  Expected: `Test Files  2 passed (2)` — the stripping case now passes (`extraFields` is `{ company: "Acme" }`) and all `readMeta` cases pass.

- [ ] **Step 10: Typecheck and lint the changed surface.** Run:

  ```
  pnpm typecheck && pnpm lint
  ```

  Expected: both exit 0 (no `tsc` errors across the base + `tsconfig.netlify.json` projects, and `eslint . && prettier --check .` clean). This confirms the two `SubmissionPayload` copies still line up and the new module is formatted.

- [ ] **Step 11: Commit.** Stage exact paths and commit:

  ```
  git add src/forms/meta.ts src/forms/payload.ts src/forms/client.ts tests/forms/meta.test.ts tests/forms/payload.test.ts
  git commit -m "feat(forms): add _meta wire envelope + readMeta, strip it from extraFields"
  ```

---

### Task 5: Ingest spam decision + notify/fan-out suppression

Fold the Turnstile outcome + classifier verdict into ONE spam decision inside `ingestSubmission`, thread `status`/`spamScore`/`spamReason` into `createSubmission`, and make auto-spam (and operator-marked spam) silent: no operator email, no autoresponder, no newsletter fan-out — while always returning `{ ok: true }` so a bot gets no signal and the lead is still persisted for review.

**Seam decision (stated):** the Turnstile outcome is per-request data, not a dependency, so `ingestSubmission` gains a **4th parameter** `turnstile: TurnstileOutcome = "unverifiable"` (default = fail-open). The injected `classifySpam` dep is a pure function that RECEIVES that outcome as its 2nd argument — the handler verifies Turnstile once and passes the outcome in. Ingest itself also reads `turnstile === "fail"` for the `requireTurnstile` escalation.

**Prerequisites from earlier tasks (assumed present):** `src/forms/turnstile.ts` exports `TurnstileOutcome`; `src/forms/spam-classifier.ts` exports `SPAM_THRESHOLD` + `SpamVerdict`; `SUBMISSION_STATUSES`/`toStatus` include `"spam_auto"`; `SubmissionInput` has optional `status?`/`spamScore?`/`spamReason?`; `SubmissionRow` has `spamScore?`/`spamReason?`; `createSubmission` honors `input.status ?? "new"` and writes `spam_score`/`spam_reason`; `WebsiteRow` has `requireTurnstile: boolean` and `makeWebsiteRow` defaults it to `false`.

**Files:**

- Modify: `src/forms/ingest.ts:1-3` (imports), `src/forms/ingest.ts:5-27` (`IngestDeps`), `src/forms/ingest.ts:68-130` (`ingestSubmission` signature + body)
- Modify: `src/forms/notify.ts:129-147` (`buildPocNotification`), `src/forms/notify.ts:150-165` (`buildAutoresponder`)
- Test: `tests/forms/ingest.test.ts` (add a `describe("ingestSubmission — spam decision")` block)
- Test: `tests/forms/notify.test.ts` (add a `describe("spam suppression")` block)

Steps:

- [ ] **Step 1: Write the failing ingest spam-decision tests.** Append this block to `tests/forms/ingest.test.ts` (after the final `});` that closes the existing `describe("ingestSubmission", …)`). The existing `deps(over)` factory needs no change — `classifySpam` is optional and injected per-test via `over`; the 4th `turnstile` arg is passed only where relevant.

```ts
describe("ingestSubmission — spam decision", () => {
  it("stores spam_auto + score + reason, suppresses notify and newsletter fan-out on a spam verdict", async () => {
    const site = makeWebsiteRow({ id: "recSITE", newsletterWebhook: "https://hooks.zapier.com/x" });
    const row = makeSubmissionRow({ id: "recSUB", formType: "newsletter", status: "spam_auto" });
    const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      forwardNewsletter,
      classifySpam: () => ({ score: 130, reasons: ["links:3", "keywords:1"] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { formType: "newsletter", email: "a@b.co", message: "buy now http://x http://y http://z" },
      "unverifiable",
    );
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("skipped");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "spam_auto",
        spamScore: 130,
        spamReason: "links:3,keywords:1",
      }),
    );
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
    expect(forwardNewsletter).not.toHaveBeenCalled();
  });

  it("takes the normal notify + stamp path on a clean verdict", async () => {
    const d = deps({ classifySpam: () => ({ score: 0, reasons: [] }) });
    const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") expect(r.notifyStatus).toBe("sent");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", spamScore: 0, spamReason: null }),
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "sent", "msg_1");
  });

  it("forces spam_auto on a requireTurnstile site when Turnstile fails, even at score 0", async () => {
    const site = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const row = makeSubmissionRow({ id: "recSUB", status: "spam_auto" });
    const d = deps({
      getWebsiteBySlug: vi.fn().mockResolvedValue(site),
      createSubmission: vi.fn().mockResolvedValue(row),
      classifySpam: () => ({ score: 0, reasons: [] }),
    });
    const r = await ingestSubmission(
      d,
      "acme",
      { email: "a@b.co", message: "totally normal enquiry" },
      "fail",
    );
    expect(r.status).toBe("accepted");
    expect(d.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "spam_auto",
        spamScore: 0,
        spamReason: "turnstile-required-failed",
      }),
    );
    expect(d.notify).not.toHaveBeenCalled();
    expect(d.stampNotified).toHaveBeenCalledWith("recSUB", "skipped", null);
  });
});
```

- [ ] **Step 2: Run the ingest tests and confirm they FAIL.** Command: `pnpm exec vitest run tests/forms/ingest.test.ts`. Expected: the run reports `Test Files  1 failed (1)` with the three new cases failing — the spam case fails on `expect(d.notify).not.toHaveBeenCalled()` (current code always calls `deps.notify`) and on the `objectContaining({ status: "spam_auto", … })` assertion (current `createSubmission` call has no `status`/`spamScore`/`spamReason`). The existing 15 cases still pass.

- [ ] **Step 3: Implement the spam decision + suppression in `ingest.ts`.** Replace the imports block (lines 1-3) with:

```ts
import type { WebsiteRow } from "../reports/airtable/websites.js";
import type {
  SubmissionRow,
  SubmissionInput,
  NotifyStatus,
  SubmissionStatus,
} from "../reports/submission-row.js";
import { normalizeSubmission, type NormalizedSubmission } from "./payload.js";
import type { TurnstileOutcome } from "./turnstile.js";
import { SPAM_THRESHOLD, type SpamVerdict } from "./spam-classifier.js";
```

Add the optional `classifySpam` member to `IngestDeps` (insert immediately after the `now: () => Date;` line, before the `forwardNewsletter?` block):

```ts
  /** Optional spam classifier. When present, its verdict drives the stored
   *  status/score/reason; absent → every submission scores 0 (fail-open, clean).
   *  Injected so the classifier stays a pure, transport-agnostic leaf. */
  classifySpam?: (n: NormalizedSubmission, turnstile: TurnstileOutcome) => SpamVerdict;
```

Change the `ingestSubmission` signature to add the 4th param:

```ts
export async function ingestSubmission(
  deps: IngestDeps,
  slug: string,
  rawPayload: unknown,
  turnstile: TurnstileOutcome = "unverifiable",
): Promise<IngestResult> {
```

Replace the body from `const n = normalized.value;` (line 80) through the `createSubmission` call and the notify/fan-out section (down to the final `return`) with:

```ts
const n = normalized.value;

// Fold the content signals + the Turnstile verdict into ONE spam decision.
// Absent classifier → treat as clean (fail-open). A `requireTurnstile` site
// escalates an ACTUAL "fail" to auto-spam regardless of score (never an absent
// token or an "unverifiable" error — those stay neutral).
const verdict: SpamVerdict = deps.classifySpam
  ? deps.classifySpam(n, turnstile)
  : { score: 0, reasons: [] };
const reasons = [...verdict.reasons];
let status: SubmissionStatus = verdict.score >= SPAM_THRESHOLD ? "spam_auto" : "new";
if (site.requireTurnstile && turnstile === "fail") {
  status = "spam_auto";
  if (!reasons.includes("turnstile-required-failed")) reasons.push("turnstile-required-failed");
}
const spamReason = reasons.length > 0 ? reasons.join(",") : null;

const row = await deps.createSubmission({
  siteId: site.id,
  formType: n.formType,
  name: n.name,
  email: n.email,
  extraFields: n.extraFields,
  status,
  spamScore: verdict.score,
  spamReason,
  // Optional fields spread only when present — exactOptionalPropertyTypes
  // forbids assigning `undefined` to an optional `phone?: string` etc.
  ...(n.phone !== undefined ? { phone: n.phone } : {}),
  ...(n.message !== undefined ? { message: n.message } : {}),
  ...(n.sourceUrl !== undefined ? { sourceUrl: n.sourceUrl } : {}),
  ...(n.utm !== undefined ? { utm: n.utm } : {}),
  submittedAt: deps.now(),
});

// Auto-spam (and operator-marked spam) is captured but silent: no operator
// email, no autoresponder, no newsletter fan-out. Skip notify entirely and
// record the honest "skipped" stamp. notify.ts also nulls both builders for
// these statuses (defense in depth), but short-circuiting here means the
// injected notify dep is never even invoked for a spam row.
const isSpam = row.status === "spam_auto" || row.status === "spam";
let notify: { status: NotifyStatus; messageId: string | null };
if (isSpam) {
  notify = { status: "skipped", messageId: null };
} else {
  try {
    notify = await deps.notify(site, row);
  } catch (err) {
    console.error(`[ingest] notify threw: ${String(err)}`);
    notify = { status: "failed", messageId: null };
  }
}
try {
  await deps.stampNotified(row.id, notify.status, notify.messageId);
} catch (err) {
  console.error(`[ingest] stampNotified failed: ${String(err)}`);
}

// Newsletter fan-out: each configured destination fires best-effort and is
// swallowed+logged — the lead is already persisted; never turn it into a 502.
// Guarded on the row status so a spam signup is never forwarded to a site
// webhook or added to a Mailchimp audience.
if (n.formType === "newsletter" && !isSpam) {
  if (site.newsletterWebhook && deps.forwardNewsletter) {
    try {
      const fwd = await deps.forwardNewsletter(site.newsletterWebhook, row, site);
      if (!fwd.ok) console.error(`[ingest] newsletter webhook → ${fwd.status} for ${site.name}`);
    } catch (err) {
      console.error(`[ingest] newsletter webhook threw: ${String(err)}`);
    }
  }
  if (site.mailchimpApiKey && site.mailchimpAudienceId && deps.addToMailchimp) {
    try {
      const mc = await deps.addToMailchimp(site, row);
      if (!mc.ok) console.error(`[ingest] mailchimp add → ${mc.status} for ${site.name}`);
    } catch (err) {
      console.error(`[ingest] mailchimp add threw: ${String(err)}`);
    }
  }
}
return { status: "accepted", submissionId: row.id, notifyStatus: notify.status };
```

- [ ] **Step 4: Run the ingest tests and confirm they PASS.** Command: `pnpm exec vitest run tests/forms/ingest.test.ts`. Expected: `Test Files  1 passed (1)` and `Tests  18 passed` (15 existing + 3 new). If the clean-verdict case fails on `spamScore: 0`, confirm `createSubmission` is invoked with the literal `spamScore: verdict.score` (0), not omitted.

- [ ] **Step 5: Write the failing notify suppression test.** Append this block to `tests/forms/notify.test.ts` (after the `describe("buildAutoresponder", …)` block, around line 91):

```ts
describe("spam suppression", () => {
  it("returns null from BOTH builders for an auto-spam submission", () => {
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const sub = makeSubmissionRow({ email: "lead@x.com", status: "spam_auto" });
    expect(buildPocNotification(site, sub)).toBeNull();
    expect(buildAutoresponder(site, sub)).toBeNull();
  });

  it("also suppresses BOTH builders for operator-marked spam", () => {
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const sub = makeSubmissionRow({ email: "lead@x.com", status: "spam" });
    expect(buildPocNotification(site, sub)).toBeNull();
    expect(buildAutoresponder(site, sub)).toBeNull();
  });
});
```

- [ ] **Step 6: Run the notify tests and confirm they FAIL.** Command: `pnpm exec vitest run tests/forms/notify.test.ts`. Expected: `Test Files  1 failed (1)` — both new cases fail because `buildPocNotification` currently returns a real `ResendSendInput` (the site has a POC) and `buildAutoresponder` currently returns one (the submitter has an email), so neither is `null` yet.

- [ ] **Step 7: Implement the suppression guard in `notify.ts`.** In `buildPocNotification`, add the guard as the FIRST line of the body (before `const recipients = resolveRecipients(...)`):

```ts
if (submission.status === "spam_auto" || submission.status === "spam") return null;
```

In `buildAutoresponder`, add the same guard as the FIRST line of the body (before `if (!submission.email) return null;`):

```ts
if (submission.status === "spam_auto" || submission.status === "spam") return null;
```

- [ ] **Step 8: Run the notify tests and confirm they PASS.** Command: `pnpm exec vitest run tests/forms/notify.test.ts`. Expected: `Test Files  1 passed (1)` — the two new cases pass and every existing notify case (whose submissions default to `status: "new"` via `makeSubmissionRow`) is unaffected.

- [ ] **Step 9: Run typecheck and the full forms suite to confirm nothing regressed.** Commands: `pnpm typecheck` (expected: no output, exit 0 — the new 4th param, `classifySpam` dep, and threaded fields all type-check against the prerequisite types) and `pnpm exec vitest run tests/forms/` (expected: all forms test files pass, `Test Files  … passed`).

- [ ] **Step 10: Commit.** Command:

```
git add src/forms/ingest.ts src/forms/notify.ts tests/forms/ingest.test.ts tests/forms/notify.test.ts
git commit -m "feat(forms): fold spam verdict into ingest decision + suppress notify/fan-out on auto-spam"
```

---

### Task 6: Central handler wiring (form-ingest.mts)

Wire the Turnstile verify + heuristic classifier into the composition root. This task is **only** the `.mts` handler; the modules it imports (`turnstile.ts`, `spam-classifier.ts`, `meta.ts`) and the `ingestSubmission` 4th-argument / `classifySpam` dep are owned by their own tasks and must land first. Per the repo sweep finding, `.mts` handlers have **no unit-test harness** — they are covered by `tsconfig.netlify.json` typecheck (run by `pnpm typecheck`), so the loop here is: implement → typecheck → build → manual curl verification note.

**Files:**

- Modify: `netlify/functions/form-ingest.mts:1-10` (add imports)
- Modify: `netlify/functions/form-ingest.mts:21-35` (add warm-instance flag after `config`)
- Modify: `netlify/functions/form-ingest.mts:42-49` (add `TURNSTILE_SECRET_KEY` to GET health env block)
- Modify: `netlify/functions/form-ingest.mts:122-141` (verify Turnstile + thread outcome/classifier into `ingestSubmission`)

**Depends on:** the tasks that create `src/forms/turnstile.ts` (`verifyTurnstile`), `src/forms/spam-classifier.ts` (`classifySpam`), `src/forms/meta.ts` (`readMeta`), and the ingest task that adds the optional `classifySpam` dep to `IngestDeps` and the 4th `turnstile: TurnstileOutcome` parameter to `ingestSubmission`. Do NOT create those modules here — import them.

Steps:

- [ ] **Step 1: Add the three forms-module imports.**
      In `netlify/functions/form-ingest.mts`, immediately after the existing ingest import (`import { ingestSubmission, parseScreenOut, ingestScreenOut } from "../../src/forms/ingest.js";`, line 7) add:

  ```ts
  import { verifyTurnstile } from "../../src/forms/turnstile.js";
  import { classifySpam } from "../../src/forms/spam-classifier.js";
  import { readMeta } from "../../src/forms/meta.js";
  ```

  (These are `.js` specifiers per the repo's ESM/NodeNext convention, matching every other import in this file.)

- [ ] **Step 2: Add a warm-instance "secret unset" log flag.**
      Right after the `export const config: Config = { ... };` block (ends line 28) and before `function json(...)`, add a module-level flag so the fail-open breadcrumb logs once per warm Lambda instance, not per request:

  ```ts
  // Log the unset-secret fail-open path once per warm instance (not per request).
  // verifyTurnstile already returns "unverifiable" when the secret is missing, so
  // this is an operator breadcrumb only — it never blocks a lead.
  let warnedTurnstileUnset = false;
  ```

- [ ] **Step 3: Surface TURNSTILE_SECRET_KEY in the GET health env block.**
      In the `req.method === "GET"` branch, add a line to the `env` object (after the existing `FORMS_INGEST_TOKEN:` line inside `Response.json({ ..., env: { ... } })`) so the health check reports whether the secret is configured:

  ```ts
          FORMS_INGEST_TOKEN: typeof process.env.FORMS_INGEST_TOKEN === "string",
          TURNSTILE_SECRET_KEY: typeof process.env.TURNSTILE_SECRET_KEY === "string",
  ```

  (The first line is the existing one shown for anchoring; only the `TURNSTILE_SECRET_KEY` line is new.)

- [ ] **Step 4: Verify Turnstile and thread the outcome + classifier into ingestSubmission.**
      Replace the existing `const result = await ingestSubmission(...)` call (the block starting `const result = await ingestSubmission(` through its closing `);`, lines 122-141) with the verify block plus the augmented call. The preceding `send` try/catch stays unchanged; this replaces only the `ingestSubmission` invocation:

  ```ts
  // Tier A — verify the Cloudflare Turnstile token (fail-open). readMeta pulls
  // the forwarded { turnstileToken, clientIp, userAgent } envelope off the
  // payload; IP/UA are used transiently here (remoteip + scoring) and are
  // NEVER persisted. Unset secret / network error / timeout / absent token →
  // "unverifiable" (contributes 0 to the score), so verify never blocks a lead.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret && !warnedTurnstileUnset) {
    console.warn(
      "[form-ingest] TURNSTILE_SECRET_KEY unset; Turnstile verification disabled (fail-open)",
    );
    warnedTurnstileUnset = true;
  }
  const meta = readMeta(payload);
  const turnstile = await verifyTurnstile({
    secret: turnstileSecret,
    token: meta.turnstileToken,
    remoteip: meta.clientIp ?? undefined,
  });

  const result = await ingestSubmission(
    {
      getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
      createSubmission: (input) => createSubmission(db, input),
      notify: makeNotify(send),
      stampNotified: (id, status, messageId) => stampNotified(db, id, status, messageId),
      now: () => new Date(),
      forwardNewsletter: (url, submission, site) =>
        forwardNewsletterToWebhook(url, submission, site),
      addToMailchimp: (site, submission) =>
        addMailchimpMember({
          apiKey: site.mailchimpApiKey ?? "",
          audienceId: site.mailchimpAudienceId ?? "",
          email: submission.email,
          name: submission.name,
        }),
      // Tier B — pure heuristic classifier folded into the ingest decision.
      // ingestSubmission calls this with the SAME Turnstile outcome (the 4th
      // arg below) and derives status (+ requireTurnstile escalation, read off
      // the resolved site — no per-handler wiring needed).
      classifySpam: (n, outcome) =>
        classifySpam({
          name: n.name,
          email: n.email,
          // message is optional on NormalizedSubmission; exactOptionalPropertyTypes
          // forbids passing `undefined`, so spread only when present.
          ...(n.message !== undefined ? { message: n.message } : {}),
          formType: n.formType,
          extraFields: n.extraFields,
          turnstile: outcome,
        }),
    },
    slug,
    payload,
    turnstile,
  );
  ```

  Notes: the arrow param is named `outcome` (not `turnstile`) to avoid shadowing the outer `turnstile` const the linter would flag; `site.requireTurnstile` is NOT passed here — `ingestSubmission` reads it off the `WebsiteRow` it resolves internally. The `if (result.status === "unknown-site" ...)` / `rejected` / final `json({ ok: true, ... })` lines below this block are unchanged.

- [ ] **Step 5: Typecheck the handler (this is the automated gate for `.mts`).**
      Run:

  ```sh
  pnpm typecheck
  ```

  This runs `tsc --noEmit && tsc --noEmit -p tsconfig.netlify.json`; the second invocation is what type-checks `netlify/functions/**/*.mts` against the deep `src/` imports. Expected: exits 0 with no diagnostics. If it errors with `Cannot find module '../../src/forms/turnstile.js'` (or `spam-classifier`/`meta`), the prerequisite module tasks have not landed — do not proceed until they have. If it errors that `ingestSubmission` expects 3 arguments but got 4, or that `classifySpam` is not assignable to `IngestDeps`, the ingest-task changes have not landed.

- [ ] **Step 6: Build.**
      Run:

  ```sh
  pnpm build
  ```

  Expected: `tsup` completes with `⚡️ Build success` and a nonzero exit only on failure. (The `.mts` handler is bundled by Netlify at deploy, not by `tsup`; this step confirms the shared `src/forms/*` modules the handler imports still build cleanly.)

- [ ] **Step 7: Manual verification note (no `.mts` unit harness).**
      Because there is no unit-test runner for Netlify handlers, record the manual smoke steps in the PR description (run against `netlify dev` locally, or note as post-deploy verification):
  1. GET health shows the new secret flag:

     ```sh
     curl -s http://localhost:8888/api/forms/anyslug | jq '.env'
     ```

     Expected: the JSON includes `"TURNSTILE_SECRET_KEY": true` (or `false` if the local env has no secret — either proves the wiring reads it).

  2. POST a lead with a `_meta` envelope still returns `{ ok: true }` (fail-open when the secret is unset or the token is bogus — never a 502):

     ```sh
     curl -s -X POST http://localhost:8888/api/forms/<real-slug> \
       -H "x-forms-token: $FORMS_INGEST_TOKEN" \
       -H "content-type: application/json" \
       -d '{"formType":"contact","name":"Smoke Test","email":"smoke@example.com","message":"hello","_meta":{"turnstileToken":"dummy","clientIp":"203.0.113.7"}}'
     ```

     Expected: `{"ok":true,"id":"<uuid>","notify":"<sent|skipped|failed>"}`. Confirm the stored row (via `/submissions`) has NO `_meta`/token/IP in its fields (that stripping is enforced by the wire-format task's test, referenced here only as the acceptance bar).

- [ ] **Step 8: Commit.**

  ```sh
  git add netlify/functions/form-ingest.mts
  git commit -m "feat(forms): wire Turnstile verify + spam classifier into central ingest handler"
  ```

---

### Task 7: Per-site requireTurnstile config

Adds a per-site `requireTurnstile: boolean` to `WebsiteRow`, mapped from the Airtable Websites boolean column `"Require Turnstile"` using the same `typeof === "boolean"` guard as `crossbrowserOk`/`mobileOk`/`linksOk` — but defaulting to `false` (not `null`) when the column is absent or non-boolean, so the feature ships dark until the operator adds the column and checks it. This is a config-plumbing task only: the escalation logic that consumes `requireTurnstile` lives in the ingest task (see Notes). The Airtable source-of-truth here (recipients/policy never come from the submitting site) mirrors `notifyRouting`.

**Files:**

- Modify: `src/reports/airtable/websites.ts` (add `requireTurnstile: boolean` to the `WebsiteRow` type ~L120-126 near the other boolean audit fields; map it in `mapRow` ~L274-279 next to `crossbrowserOk`)
- Test: `tests/reports/airtable/websites-mapping.test.ts` (add a new `describe` block; mirrors the existing metric-field / boolean-guard tests)

**Steps:**

- [ ] **Step 1: Write the failing test.** Append this `describe` block to the end of `tests/reports/airtable/websites-mapping.test.ts` (it reuses the file's existing `row()` helper and `mapRow` import — no new imports needed):

```ts
describe("websites/mapRow → requireTurnstile (ships dark, boolean guard)", () => {
  it("maps Require Turnstile true when the column is boolean true", () => {
    expect(row({ "Require Turnstile": true }).requireTurnstile).toBe(true);
  });

  it("maps Require Turnstile false when the column is boolean false", () => {
    expect(row({ "Require Turnstile": false }).requireTurnstile).toBe(false);
  });

  it("defaults to false when the column is absent (ships dark)", () => {
    expect(row({}).requireTurnstile).toBe(false);
  });

  it("defaults to false for a non-boolean value (never coerces a truthy string)", () => {
    expect(row({ "Require Turnstile": "true" }).requireTurnstile).toBe(false);
    expect(row({ "Require Turnstile": 1 }).requireTurnstile).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — confirm it FAILS.** Run:

```
pnpm vitest run tests/reports/airtable/websites-mapping.test.ts
```

Expected: the suite fails. Because `requireTurnstile` is not yet on `WebsiteRow`, `mapRow` never sets it, so `r.requireTurnstile` is `undefined` — the first assertion fails with a message like `AssertionError: expected undefined to be true // Object.is equality`. (TypeScript may also flag `requireTurnstile` as unknown on the row type; either way the run is RED.)

- [ ] **Step 3: Add the field to the `WebsiteRow` type.** In `src/reports/airtable/websites.ts`, in the `WebsiteRow` type, immediately after the `browserCheckedAt: string | null;` line (end of the browser-probe block, ~L126) add:

```ts
/** Per-site spam policy: when true, a submission the ingest cannot positively verify with
 *  Cloudflare Turnstile ("fail"/"unverifiable") is escalated to auto-filtered. Source of truth
 *  is the Airtable Websites `Require Turnstile` boolean — never supplied by the submitting site.
 *  Defaults false when the column is absent (ships dark) so existing sites are unaffected. */
requireTurnstile: boolean;
```

- [ ] **Step 4: Map the field in `mapRow`.** In `src/reports/airtable/websites.ts`, inside `mapRow`, immediately after the `browserCheckedAt: (f["Browser checked at"] as string | undefined) ?? null,` line (~L279) add:

```ts
    // Boolean guard like crossbrowserOk, but defaults FALSE (not null) when absent: an
    // unset/unknown column must read as "not required" so the feature ships dark.
    requireTurnstile: typeof f["Require Turnstile"] === "boolean" ? (f["Require Turnstile"] as boolean) : false,
```

- [ ] **Step 5: Run the test — confirm it PASSES.** Run:

```
pnpm vitest run tests/reports/airtable/websites-mapping.test.ts
```

Expected: all tests pass, including the new `websites/mapRow → requireTurnstile (ships dark, boolean guard)` block (4 passing assertions). Terminal shows `Test Files  1 passed` and a `passed` count with no failures.

- [ ] **Step 6: Commit.** Run:

```
git add src/reports/airtable/websites.ts tests/reports/airtable/websites-mapping.test.ts
git commit -m "feat(websites): per-site requireTurnstile config (ships dark)"
```

---

### Task 8: Site factories: turnstileFieldName + \_meta threading

Adds `buildSubmissionMeta(event, turnstileToken)` to the shared `src/forms/meta.ts` leaf module (created by Task 4) and threads its result onto the payload forwarded by BOTH site factories. Each factory gains a `turnstileFieldName?: string` option (default `"cf-turnstile-response"`, Cloudflare's widget default) and sets `payload._meta = buildSubmissionMeta(event, <that field's value>)`. `buildSubmissionMeta` returns `undefined` when no field yields a value, so `JSON.stringify` drops `_meta` entirely and every existing exact `toEqual` payload assertion stays green. The honeypot/timing `screenSubmission` tier and `buildPayload` output are untouched.

**Files:**

- Modify: `src/forms/meta.ts` — ADD `buildSubmissionMeta` (and a local structural `MetaEvent` type); keep the existing `SubmissionMeta` type + `readMeta` from Task 4 intact. `buildSubmissionMeta` is NOT exported from `index.ts` (meta.ts is a central/site leaf, like `turnstile.ts`).
- Modify: `src/forms/action.ts:12-35` (add `turnstileFieldName?` to `CreateIngestActionOptions`), `:44-49` (resolve default), `:91-96` (thread `_meta` onto forwarded payload); add `import { buildSubmissionMeta } from "./meta.js";`.
- Modify: `src/forms/endpoint.ts:16-33` (add `turnstileFieldName?` to `CreateIngestEndpointOptions`), `:52-56` (resolve default), `:91-100` (thread `_meta` onto forwarded payload); add `import { buildSubmissionMeta } from "./meta.js";`.
- Test: `tests/forms/meta.test.ts` — ADD a `buildSubmissionMeta` describe block (direct unit tests for the guards).
- Test: `tests/forms/action.test.ts` — ADD `_meta` threading tests + a `fakeEventWithMeta` helper.
- Test: `tests/forms/endpoint.test.ts` — ADD `_meta` threading tests + a `fakeEventWithMeta` helper.

No `index.ts` change: `turnstileFieldName` is a new field on the already-exported `CreateIngestActionOptions` / `CreateIngestEndpointOptions`, and `buildSubmissionMeta` stays unexported (leaf).

Steps:

- [ ] **Step 1: Write failing unit tests for `buildSubmissionMeta` in `tests/forms/meta.test.ts`.** Append this block to the existing file (leave the Task 4 `readMeta` tests untouched). It exercises every guard branch so the new function stays above the coverage floor:

```ts
import { buildSubmissionMeta } from "../../src/forms/meta.js";

type MetaEvent = Parameters<typeof buildSubmissionMeta>[0];

function metaEvent(
  opts: {
    ip?: string | (() => string);
    userAgent?: string;
    omitGetter?: boolean;
  } = {},
): MetaEvent {
  const headers = new Headers();
  if (opts.userAgent) headers.set("user-agent", opts.userAgent);
  const getClientAddress =
    typeof opts.ip === "function" ? opts.ip : opts.ip ? () => opts.ip as string : undefined;
  return {
    request: { headers },
    ...(opts.omitGetter ? {} : { getClientAddress }),
  } as unknown as MetaEvent;
}

describe("buildSubmissionMeta", () => {
  it("returns turnstileToken, clientIp and userAgent when all are present", () => {
    const meta = buildSubmissionMeta(
      metaEvent({ ip: "203.0.113.7", userAgent: "Mozilla/5.0 (X)" }),
      "TOKEN123",
    );
    expect(meta).toEqual({
      turnstileToken: "TOKEN123",
      clientIp: "203.0.113.7",
      userAgent: "Mozilla/5.0 (X)",
    });
  });

  it("returns undefined when no field yields a value", () => {
    expect(buildSubmissionMeta(metaEvent(), null)).toBeUndefined();
    expect(buildSubmissionMeta(metaEvent(), undefined)).toBeUndefined();
  });

  it("trims values and drops a blank turnstile token", () => {
    const meta = buildSubmissionMeta(
      metaEvent({ ip: "  198.51.100.4 ", userAgent: "  UA-9 " }),
      "   ",
    );
    expect(meta).toEqual({ clientIp: "198.51.100.4", userAgent: "UA-9" });
  });

  it("swallows a throwing getClientAddress and still returns the other fields", () => {
    const meta = buildSubmissionMeta(
      metaEvent({
        ip: () => {
          throw new Error("adapter has no client address");
        },
        userAgent: "UA-throw",
      }),
      "TOK",
    );
    expect(meta).toEqual({ turnstileToken: "TOK", userAgent: "UA-throw" });
  });

  it("skips clientIp when getClientAddress is not a function", () => {
    const meta = buildSubmissionMeta(metaEvent({ omitGetter: true }), "TOK2");
    expect(meta).toEqual({ turnstileToken: "TOK2" });
  });
});
```

- [ ] **Step 2: Run the meta tests and confirm they FAIL.** Command: `pnpm exec vitest run tests/forms/meta.test.ts`. Expected: the file errors because `buildSubmissionMeta` is not exported by `src/forms/meta.ts` — vitest reports `TypeError: buildSubmissionMeta is not a function` (or a "No known export" resolution error) and the run ends with `Test Files 1 failed`.

- [ ] **Step 3: Implement `buildSubmissionMeta` in `src/forms/meta.ts`.** Add the structural event type and the function below the existing `SubmissionMeta` type + `readMeta` (do not touch those). Guards match the META MODULE CONTRACT — `typeof getClientAddress === "function"` + `try/catch`, UA via `event.request?.headers?.get?.("user-agent")`, and `undefined` when nothing lands:

```ts
/**
 * SITE-side event shape `buildSubmissionMeta` reads. Structural (not SvelteKit's
 * `RequestEvent`) so this leaf stays SDK-free; a real `RequestEvent` is
 * structurally assignable (`getClientAddress: () => string`, `request.headers`
 * is a `Headers` with a `get`).
 */
type MetaEvent = {
  getClientAddress?: () => string;
  request?: { headers?: { get?: (name: string) => string | null } };
};

/**
 * Build the transient `_meta` envelope a site forwards to central ingest:
 * `{ turnstileToken?, clientIp?, userAgent? }`. Returns `undefined` when no
 * field yields a value so callers can attach it unconditionally without
 * polluting the payload (an `undefined` value is dropped by `JSON.stringify`).
 * `getClientAddress` is guarded (some adapters lack a client address and can
 * throw); UA is read defensively. None of this is ever persisted.
 */
export function buildSubmissionMeta(
  event: MetaEvent,
  turnstileToken: string | null | undefined,
): SubmissionMeta | undefined {
  const meta: SubmissionMeta = {};

  const token = typeof turnstileToken === "string" ? turnstileToken.trim() : "";
  if (token) meta.turnstileToken = token;

  if (typeof event.getClientAddress === "function") {
    try {
      const ip = event.getClientAddress();
      if (typeof ip === "string" && ip.trim()) meta.clientIp = ip.trim();
    } catch {
      // Some adapters have no client address and throw; drop clientIp silently.
    }
  }

  const ua = event.request?.headers?.get?.("user-agent");
  if (typeof ua === "string" && ua.trim()) meta.userAgent = ua.trim();

  return Object.keys(meta).length > 0 ? meta : undefined;
}
```

- [ ] **Step 4: Run the meta tests and confirm they PASS.** Command: `pnpm exec vitest run tests/forms/meta.test.ts`. Expected: `Test Files 1 passed` with all `buildSubmissionMeta` cases green (existing `readMeta` cases still green).

- [ ] **Step 5: Commit the meta module + tests.** `git add src/forms/meta.ts tests/forms/meta.test.ts` then `git commit -m "feat(forms): add buildSubmissionMeta site-side envelope builder"`.

- [ ] **Step 6: Write failing `_meta` threading tests for the action factory.** In `tests/forms/action.test.ts`, add a `fakeEventWithMeta` helper just after the existing `fakeEvent` (line 22), then add the tests inside the `describe("createIngestAction", ...)` block:

```ts
// Like fakeEvent, but also exposes getClientAddress + request headers so the
// _meta threading can pick up an IP / user-agent.
function fakeEventWithMeta(
  entries: Record<string, string>,
  fetchImpl: typeof fetch,
  meta: { ip?: string | (() => string); userAgent?: string } = {},
): RequestEvent {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  const headers = new Headers();
  if (meta.userAgent) headers.set("user-agent", meta.userAgent);
  const getClientAddress =
    typeof meta.ip === "function" ? meta.ip : meta.ip ? () => meta.ip as string : undefined;
  return {
    request: { formData: async () => fd, headers },
    fetch: fetchImpl,
    url: new URL("https://site.test/contact"),
    getClientAddress,
  } as unknown as RequestEvent;
}
```

```ts
it("auto-threads _meta (turnstileToken/clientIp/userAgent) into the forwarded payload", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recM" }));
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: (form) => ({ email: form.get("email")?.toString() }),
    now,
  });
  const result = await action(
    fakeEventWithMeta(
      { email: "a@b.co", ts: goodTs, "cf-turnstile-response": "TOKEN123" },
      fetchMock,
      { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (X)" },
    ),
  );
  expect(result).toEqual({ success: true });
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect(body._meta).toEqual({
    turnstileToken: "TOKEN123",
    clientIp: "203.0.113.7",
    userAgent: "Mozilla/5.0 (X)",
  });
  // buildPayload output is still forwarded intact alongside _meta.
  expect(body.email).toBe("a@b.co");
  expect(body.formType).toBe("contact");
});

it("omits _meta entirely when no token/IP/UA are present", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recN" }));
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: (form) => ({ email: form.get("email")?.toString() }),
    now,
  });
  await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect("_meta" in body).toBe(false);
});

it("reads the turnstile token from a custom turnstileFieldName", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recC" }));
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: (form) => ({ email: form.get("email")?.toString() }),
    turnstileFieldName: "my-token",
    now,
  });
  await action(fakeEventWithMeta({ email: "a@b.co", ts: goodTs, "my-token": "T9" }, fetchMock));
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect(body._meta).toEqual({ turnstileToken: "T9" });
});

it("still screens out a filled honeypot even when a turnstile token is present", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(jsonResponse(200, { ok: true })) as unknown as typeof fetch;
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: () => ({}),
    now,
  });
  const result = await action(
    fakeEventWithMeta(
      { email: "a@b.co", ts: goodTs, "bot-field": "i am a bot", "cf-turnstile-response": "T" },
      fetchMock,
      { ip: "203.0.113.7" },
    ),
  );
  expect(result).toEqual({ success: true });
  // Honeypot tier is unchanged: the real submission is never forwarded.
  const forwarded = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.some(
    ([, init]) => init && !("screenOut" in JSON.parse((init as RequestInit).body as string)),
  );
  expect(forwarded).toBe(false);
});

it("still forwards (with just the token) when getClientAddress throws", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recT" }));
  const action = createIngestAction({
    formType: "contact",
    getConfig: okConfig,
    buildPayload: (form) => ({ email: form.get("email")?.toString() }),
    now,
  });
  await action(
    fakeEventWithMeta({ email: "a@b.co", ts: goodTs, "cf-turnstile-response": "TOK" }, fetchMock, {
      ip: () => {
        throw new Error("no address");
      },
    }),
  );
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect(body._meta).toEqual({ turnstileToken: "TOK" });
});
```

- [ ] **Step 7: Write failing `_meta` threading tests for the endpoint factory.** In `tests/forms/endpoint.test.ts`, add a `fakeEventWithMeta` helper just after `fakeEvent` (line 26), then add the tests inside the `describe("createIngestEndpoint", ...)` block:

```ts
// Like fakeEvent, but also exposes getClientAddress + request headers so the
// _meta threading can pick up an IP / user-agent.
function fakeEventWithMeta(
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  meta: { ip?: string; userAgent?: string } = {},
): RequestEvent {
  const headers = new Headers();
  if (meta.userAgent) headers.set("user-agent", meta.userAgent);
  return {
    request: { json: async () => body, headers },
    fetch: fetchImpl,
    url: new URL("https://site.test/api/forms"),
    getClientAddress: meta.ip ? () => meta.ip as string : undefined,
  } as unknown as RequestEvent;
}
```

```ts
it("auto-threads _meta (turnstileToken/clientIp/userAgent) into the forwarded payload", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recM" }));
  const endpoint = createIngestEndpoint({
    getConfig: okConfig,
    buildPayload: (body) => ({ formType: body.formType as string, email: body.email as string }),
  });
  await endpoint(
    fakeEventWithMeta(
      {
        formType: "contact",
        email: "a@b.co",
        "cf-turnstile-response": "TOKEN123",
      },
      fetchMock,
      { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (X)" },
    ),
  );
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect(body._meta).toEqual({
    turnstileToken: "TOKEN123",
    clientIp: "203.0.113.7",
    userAgent: "Mozilla/5.0 (X)",
  });
  // buildPayload output is still forwarded intact alongside _meta.
  expect(body.email).toBe("a@b.co");
  expect(body.formType).toBe("contact");
});

it("omits _meta entirely when no token/IP/UA are present", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recN" }));
  const endpoint = createIngestEndpoint({
    getConfig: okConfig,
    buildPayload: (body) => ({ formType: body.formType as string, email: body.email as string }),
  });
  await endpoint(fakeEvent({ formType: "contact", email: "a@b.co" }, fetchMock));
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect("_meta" in body).toBe(false);
});

it("reads the turnstile token from a custom turnstileFieldName", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recC" }));
  const endpoint = createIngestEndpoint({
    getConfig: okConfig,
    buildPayload: (body) => ({ formType: body.formType as string, email: body.email as string }),
    turnstileFieldName: "my-token",
  });
  await endpoint(
    fakeEventWithMeta({ formType: "contact", email: "a@b.co", "my-token": "T9" }, fetchMock),
  );
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  expect(body._meta).toEqual({ turnstileToken: "T9" });
});
```

- [ ] **Step 8: Run both factory test files and confirm they FAIL.** Command: `pnpm exec vitest run tests/forms/action.test.ts tests/forms/endpoint.test.ts`. Expected: the new threading cases fail with `AssertionError: expected undefined to deeply equal { turnstileToken: 'TOKEN123', … }` (the factories do not yet attach `_meta`), and the run ends with `Test Files 2 failed`. The existing exact-`toEqual` cases still pass (they use the plain `fakeEvent`, which yields no `_meta`).

- [ ] **Step 9: Add `turnstileFieldName` + `_meta` threading to `src/forms/action.ts`.** Add the import at the top alongside the existing imports:

```ts
import { buildSubmissionMeta } from "./meta.js";
```

Add the option to `CreateIngestActionOptions` (after `tsFieldName?`, before `unavailableMessage?`):

```ts
  /** Field carrying the Cloudflare Turnstile token. Default "cf-turnstile-response". */
  turnstileFieldName?: string;
```

Resolve the default in the factory body (next to `const tsFieldName = ...`):

```ts
const turnstileFieldName = opts.turnstileFieldName ?? "cf-turnstile-response";
```

Thread `_meta` onto the forwarded payload (the `submitToIngest` call at lines 91-96):

```ts
const result = await submitToIngest({
  url,
  token,
  fetch: event.fetch,
  payload: {
    ...opts.buildPayload(form, event),
    formType: opts.formType,
    _meta: buildSubmissionMeta(event, form.get(turnstileFieldName)?.toString()),
  },
});
```

- [ ] **Step 10: Add `turnstileFieldName` + `_meta` threading to `src/forms/endpoint.ts`.** Add the import alongside the existing imports:

```ts
import { buildSubmissionMeta } from "./meta.js";
```

Add the option to `CreateIngestEndpointOptions` (after `botFieldName?`, before `unavailableMessage?`):

```ts
  /** Field carrying the Cloudflare Turnstile token. Default "cf-turnstile-response". */
  turnstileFieldName?: string;
```

Resolve the default in the factory body (next to `const botFieldName = ...`):

```ts
const turnstileFieldName = opts.turnstileFieldName ?? "cf-turnstile-response";
```

Thread `_meta` into the payload built inside the existing `try` (lines 92-96) — the token comes from the JSON body via the existing `str` helper:

```ts
payload = {
  ...opts.buildPayload(body, event),
  ...(opts.formType ? { formType: opts.formType } : {}),
  _meta: buildSubmissionMeta(event, str(body[turnstileFieldName])),
};
```

- [ ] **Step 11: Run both factory test files and confirm they PASS.** Command: `pnpm exec vitest run tests/forms/action.test.ts tests/forms/endpoint.test.ts`. Expected: `Test Files 2 passed` — the new threading cases green AND every pre-existing case (clean forward exact-`toEqual`, honeypot, too-fast, fail(500)/(502), redirect, screen-out beacon) still green, proving the honeypot/timing tier and `buildPayload` output are undisturbed.

- [ ] **Step 12: Run the full forms suite + typecheck as a regression gate.** Commands: `pnpm exec vitest run tests/forms` (expected `Test Files … passed`, no failures) and `pnpm run typecheck` (expected no errors — confirms the new option and the `_meta` property satisfy `exactOptionalPropertyTypes` and `tsconfig.netlify.json`).

- [ ] **Step 13: Commit the factory changes + tests.** `git add src/forms/action.ts src/forms/endpoint.ts tests/forms/action.test.ts tests/forms/endpoint.test.ts` then `git commit -m "feat(forms): thread submission _meta (turnstile token/IP/UA) from site factories"`.

---

### Task 9: Dashboard: hide auto-spam from strip, review surface, recovery, cockpit affordance

**Depends on** the shared-contract foundation from earlier tasks being present: `"spam_auto"` in `SUBMISSION_STATUSES`/`toStatus` (`src/reports/submission-row.ts`), `spamScore?: number | null` / `spamReason?: string | null` on `SubmissionRow`, the `status?` option on `SubmissionInput`, and `createSubmission` honoring `input.status`. This task only touches the dashboard render/query surface.

**Files:**

- Modify: `src/db/submissions.ts` — add `countAutoSpamSince` (fleet-wide windowed count of `status = 'spam_auto'`).
- Modify: `src/dashboard/submission-view.ts:27-67` (`renderSubmissionRow`: provenance badge + "Not spam → new" recovery button) and `src/dashboard/submission-view.ts:84-88` (add `.pill.subm-spam_auto` + `.subm-provenance` CSS); add exported pure predicate `isVisibleInStrip`.
- Modify: `src/dashboard/render.ts:12-16` (import `isVisibleInStrip`) and `src/dashboard/render.ts:179-195` (`submissionsSection` filters `spam_auto` out of the per-site strip).
- Modify: `src/dashboard/fleet-cockpit.ts:193-204` (`CockpitModel` gains `autoFiltered?: number`) and `src/dashboard/fleet-cockpit.ts:331-476` (`buildCockpitModel` gains a trailing `autoFilteredCount = 0` param, sets `autoFiltered`).
- Modify: `src/dashboard/fleet-render.ts:250-288` (`renderInboxLane`: "N auto-filtered this week — review" affordance linking to `/submissions?status=spam_auto`).
- Modify: `netlify/functions/form-ingest.mts`? No — Modify: `netlify/functions/fleet-homepage.mts:108-150` (compute `countAutoSpamSince` over a 7-day window and thread it into `buildCockpitModel`).
- Test: `tests/db/auto-spam-count.test.ts` (new) — `countAutoSpamSince` via in-memory libSQL.
- Test: `tests/dashboard/submission-view.test.ts` — `isVisibleInStrip` predicate + provenance badge + recovery button + CSS pill.
- Test: `tests/dashboard/submissions-page-render.test.ts` — `spam_auto` present in the `/submissions` status filter dropdown.
- Test: `tests/dashboard/fleet-render-submissions.test.ts` — cockpit auto-filtered affordance render.

**Steps:**

- [ ] **Step 1: Write the failing `countAutoSpamSince` test.** Create `tests/db/auto-spam-count.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { openDb } from "../../src/db/client.js";
  import { createSubmission, countAutoSpamSince } from "../../src/db/submissions.js";
  import type { Db } from "../../src/db/client.js";

  let db: Db;

  beforeEach(async () => {
    db = await openDb({ url: ":memory:" });
    // two spam_auto rows in-window, one spam_auto out-of-window, one manual spam
    // in-window (must NOT count), one clean row.
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@x.com",
      submittedAt: new Date("2026-06-25T00:00:00.000Z"),
      status: "spam_auto",
    });
    await createSubmission(db, {
      siteId: "recB",
      formType: "contact",
      name: "B",
      email: "b@x.com",
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
      status: "spam_auto",
    });
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Old",
      email: "old@x.com",
      submittedAt: new Date("2026-06-01T00:00:00.000Z"),
      status: "spam_auto",
    });
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Manual",
      email: "m@x.com",
      submittedAt: new Date("2026-06-26T00:00:00.000Z"),
      status: "spam",
    });
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Clean",
      email: "c@x.com",
      submittedAt: new Date("2026-06-27T00:00:00.000Z"),
    });
  });

  describe("countAutoSpamSince", () => {
    it("counts only spam_auto rows on/after the window start, fleet-wide", async () => {
      expect(await countAutoSpamSince(db, "2026-06-20")).toBe(2);
    });
    it("returns 0 when nothing is in-window", async () => {
      expect(await countAutoSpamSince(db, "2026-07-01")).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run it and confirm it FAILS.** `pnpm exec vitest run tests/db/auto-spam-count.test.ts`. Expected FAIL: the module has no export named `countAutoSpamSince` (TypeError / `countAutoSpamSince is not a function`), so both cases error.

- [ ] **Step 3: Implement `countAutoSpamSince`.** Append to `src/db/submissions.ts` (after `countSubmissionsFiltered`, mirroring the `countAllX` + `Number(res.n)` shape already in the file):

  ```ts
  /** Fleet-wide count of auto-filtered spam (`status = 'spam_auto'`) submitted on/after
   *  `sinceDate` (ISO). Powers the cockpit "N auto-filtered this week — review" affordance;
   *  the caller picks the window (like `listScreenOutsSince`), keeping this query pure. */
  export async function countAutoSpamSince(db: Db, sinceDate: string): Promise<number> {
    const res = await db
      .selectFrom("submissions")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("status", "=", "spam_auto")
      .where("submitted_at", ">=", sinceDate)
      .executeTakeFirstOrThrow();
    return Number(res.n);
  }
  ```

- [ ] **Step 4: Run it and confirm it PASSES.** `pnpm exec vitest run tests/db/auto-spam-count.test.ts`. Expected: `Test Files  1 passed (1)` / `Tests  2 passed (2)`.

- [ ] **Step 5: Commit.** `git add src/db/submissions.ts tests/db/auto-spam-count.test.ts` then `git commit -m "feat(dashboard): countAutoSpamSince windowed auto-spam query"`.

- [ ] **Step 6: Write the failing strip-exclusion / render tests.** Append to `tests/dashboard/submission-view.test.ts` (the existing `row()` helper omits `spamScore`/`spamReason`, which are optional — pass them per-test):

  ```ts
  import { isVisibleInStrip, SUBMISSION_STYLES } from "../../src/dashboard/submission-view.js";

  describe("isVisibleInStrip", () => {
    it("hides auto-filtered spam from the per-site strip", () => {
      expect(isVisibleInStrip(row({ status: "spam_auto" }))).toBe(false);
    });
    it("keeps every other status in the strip", () => {
      for (const s of ["new", "read", "archived", "spam"] as const) {
        expect(isVisibleInStrip(row({ status: s }))).toBe(true);
      }
    });
  });

  describe("renderSubmissionRow — auto-spam provenance + recovery", () => {
    it("shows a provenance badge with score and reasons when scored", () => {
      const html = renderSubmissionRow(
        row({ status: "spam_auto", spamScore: 130, spamReason: "turnstile-fail,links:2" }),
      );
      expect(html).toContain("subm-provenance");
      expect(html).toContain("130");
      expect(html).toContain("turnstile-fail,links:2");
    });
    it("omits the provenance badge when there is no score", () => {
      const html = renderSubmissionRow(row({ status: "new", spamScore: null }));
      expect(html).not.toContain("subm-provenance");
    });
    it("offers a 'Not spam → new' recovery button only on auto-spam rows", () => {
      const auto = renderSubmissionRow(row({ status: "spam_auto", spamScore: 120 }));
      expect(auto).toContain("Not spam → new");
      expect(auto).toContain('data-status="new"');
      const clean = renderSubmissionRow(row({ status: "new" }));
      expect(clean).not.toContain("Not spam → new");
    });
    it("escapes hostile spamReason content in the badge title", () => {
      const html = renderSubmissionRow(
        row({ status: "spam_auto", spamScore: 100, spamReason: '"><img src=x>' }),
      );
      expect(html).not.toContain("<img src=x");
    });
  });

  describe("SUBMISSION_STYLES", () => {
    it("styles the spam_auto pill so a new status is not unstyled", () => {
      expect(SUBMISSION_STYLES).toContain(".pill.subm-spam_auto");
    });
  });
  ```

- [ ] **Step 7: Run it and confirm it FAILS.** `pnpm exec vitest run tests/dashboard/submission-view.test.ts`. Expected FAIL: `isVisibleInStrip` is not exported (import error) and the badge/button/pill substrings are absent.

- [ ] **Step 8: Implement the predicate, badge, recovery button, and CSS.** In `src/dashboard/submission-view.ts` add the exported predicate above `renderSubmissionRow`:

  ```ts
  /** A submission belongs in the per-site strip unless it was auto-filtered as spam
   *  (status "spam_auto"): auto-spam is reviewed only on /submissions, so it never
   *  crowds the real-lead window. PURE. */
  export function isVisibleInStrip(s: SubmissionRow): boolean {
    return s.status !== "spam_auto";
  }
  ```

  Inside `renderSubmissionRow`, after the `const status = ...` / `const url = ...` / `btn` setup, add the provenance badge and recovery button:

  ```ts
  const provenance =
    s.spamScore !== null && s.spamScore !== undefined
      ? ` <span class="subm-provenance" title="${escapeHtml(s.spamReason ?? "")}">auto-spam · ${escapeHtml(String(s.spamScore))}</span>`
      : "";
  const recover = s.status === "spam_auto" ? btn("Not spam → new", "new") : "";
  ```

  Insert `${provenance}` into the `<summary>` right after the status pill span, and prepend `${recover}` inside `.subm-actions`:

  ```ts
  return `<li class="subm-item">
      <details>
        <summary class="subm-head"><strong>${type}</strong> · ${who} <span class="muted">${email}</span> <span class="pill subm-${status}">${status}</span>${provenance} <span class="muted">${when}</span></summary>
        <div class="subm-detail">${details}</div>
      </details>
      <div class="subm-actions">${recover}${btn("Read", "read")}${btn("Archive", "archived")}${btn("Spam", "spam")}</div>
    </li>`;
  ```

  In `SUBMISSION_STYLES`, add the pill + badge rules next to the other `.pill.subm-*` lines (after `.pill.subm-spam { ... }`):

  ```
  .pill.subm-spam_auto { background: #fff4e5; color: #a65a00; }
  .subm-provenance { font-size: 0.72rem; border-radius: 0.25rem; padding: 0 0.35rem; white-space: nowrap; background: #fff4e5; color: #a65a00; }
  ```

- [ ] **Step 9: Apply the strip exclusion in `submissionsSection`.** In `src/dashboard/render.ts` add `isVisibleInStrip` to the `./submission-view.js` import block, then rewrite the head of `submissionsSection` so both the empty-guard and the count reflect only visible rows:

  ```ts
  function submissionsSection(submissions: SubmissionRow[], site: WebsiteRow): string {
    const visible = submissions.filter(isVisibleInStrip);
    if (visible.length === 0) return "";
    const recent = [...visible]
      .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
      .slice(0, SUBMISSIONS_PER_SITE_CAP);
    const note =
      visible.length > recent.length
        ? `<span class="muted"> — showing ${recent.length} of ${visible.length}</span>`
        : "";
    const viewAll = `<a class="subm-viewall" href="/submissions?site=${escapeHtml(siteSlug(site.name))}">View all for this site →</a>`;
    return `<div class="section submissions">
      <h2>Form submissions (${visible.length})${note} ${viewAll}</h2>
      <ul class="subm-list">${recent.map(renderSubmissionRow).join("")}</ul>
    </div>`;
  }
  ```

- [ ] **Step 10: Run and confirm PASS.** `pnpm exec vitest run tests/dashboard/submission-view.test.ts tests/dashboard/render.test.ts tests/dashboard/render-submissions.test.ts`. Expected: all files pass (the render suites still green — filtering only drops `spam_auto` rows, which no existing fixture uses).

- [ ] **Step 11: Commit.** `git add src/dashboard/submission-view.ts src/dashboard/render.ts tests/dashboard/submission-view.test.ts` then `git commit -m "feat(dashboard): hide auto-spam from strip + provenance badge + recovery button"`.

- [ ] **Step 12: Write the failing `/submissions` filter-inclusion guard test.** Append to `tests/dashboard/submissions-page-render.test.ts`:

  ```ts
  describe("renderSubmissionsPageHtml — status filter", () => {
    it("offers spam_auto as a selectable status so auto-spam is reviewable", () => {
      const html = renderSubmissionsPageHtml(model());
      expect(html).toContain('value="spam_auto"');
    });
    it("marks spam_auto selected when it is the active filter", () => {
      const html = renderSubmissionsPageHtml(
        model({ filter: { site: "", type: "", status: "spam_auto", q: "", from: "", to: "" } }),
      );
      expect(html).toContain('value="spam_auto" selected');
    });
  });
  ```

- [ ] **Step 13: Run it.** `pnpm exec vitest run tests/dashboard/submissions-page-render.test.ts`. Expected: PASS — the `<select name="status">` in `filterForm` maps over `SUBMISSION_STATUSES`, which already contains `spam_auto` from the foundation task, so the option renders with no code change. This is a regression guard proving the filter surface stays honest; if it FAILS, the enum change from the foundation task did not land — stop and fix that first. (No implementation/commit-of-src step here; guard only.)

- [ ] **Step 14: Commit the guard test.** `git add tests/dashboard/submissions-page-render.test.ts` then `git commit -m "test(dashboard): guard spam_auto in the /submissions status filter"`.

- [ ] **Step 15: Write the failing cockpit affordance test.** Append to `tests/dashboard/fleet-render-submissions.test.ts` (reuses the file's `model()` helper):

  ```ts
  describe("renderCockpitHtml — auto-filtered affordance", () => {
    it("omits the affordance when nothing was auto-filtered", () => {
      const html = renderCockpitHtml(model());
      expect(html).not.toContain("auto-filtered this week");
    });
    it("renders the count and links to /submissions filtered to spam_auto", () => {
      const html = renderCockpitHtml(model({ autoFiltered: 4 }));
      expect(html).toContain("4 auto-filtered this week");
      expect(html).toContain('href="/submissions?status=spam_auto"');
    });
  });
  ```

- [ ] **Step 16: Run it and confirm it FAILS.** `pnpm exec vitest run tests/dashboard/fleet-render-submissions.test.ts`. Expected FAIL: `autoFiltered` is not on `CockpitModel` (type error at build/pretest, or the substring is simply absent from the rendered HTML).

- [ ] **Step 17: Add `autoFiltered` to the model and thread it through `buildCockpitModel`.** In `src/dashboard/fleet-cockpit.ts`, add to the `CockpitModel` type (next to `recent?`):

  ```ts
    /** Fleet-wide count of submissions auto-filtered as spam in the affordance window
     *  (optional for back-compat). Drives the cockpit "N auto-filtered this week" line. */
    autoFiltered?: number;
  ```

  Add a trailing parameter to `buildCockpitModel` after `recentEvents`:

  ```ts
    recentEvents: FleetEvent[] = [],
    autoFilteredCount = 0,
  ```

  and set it on the returned object (next to `recent`):

  ```ts
    recent,
    autoFiltered: autoFilteredCount,
  ```

- [ ] **Step 18: Render the affordance in `renderInboxLane`.** In `src/dashboard/fleet-render.ts`, update `renderInboxLane` to read the count, include it in the render guard and summary, and emit a line:

  ```ts
  function renderInboxLane(model: CockpitModel): string {
    const subs: SubmissionEntry[] = model.submissions ?? [];
    const spam = model.spam;
    const hasSpam = !!spam && (spam.caught > 0 || spam.through > 0);
    const autoFiltered = model.autoFiltered ?? 0;
    const hasAutoFiltered = autoFiltered > 0;
    if (subs.length === 0 && !hasSpam && !hasAutoFiltered) return "";
    // ... (unchanged: shown / rows / overflow / more / spamLine / spamInSummary) ...
    const autoFilteredLine = hasAutoFiltered
      ? `<div class="spam-rollup muted">🚫 ${autoFiltered} auto-filtered this week — <a href="/submissions?status=spam_auto">review</a></div>`
      : "";
    return `<details class="inbox">
      <summary>📥 Submissions (${subs.length} new)${spamInSummary}</summary>
      ${rows}${subs.length > 0 ? more : ""}
      ${spamLine}
      ${autoFilteredLine}
    </details>`;
  }
  ```

  (`autoFiltered` is a small integer and the href/label are server-fixed, so no escaping is needed — consistent with the adjacent `spamLine`.)

- [ ] **Step 19: Run and confirm PASS.** `pnpm exec vitest run tests/dashboard/fleet-render-submissions.test.ts tests/dashboard/fleet-cockpit.test.ts tests/dashboard/cockpit-submissions.test.ts`. Expected: all pass (the new `buildCockpitModel` param has a default, so existing positional callers are unaffected).

- [ ] **Step 20: Wire the count into the live cockpit handler.** In `netlify/functions/fleet-homepage.mts`, add `countAutoSpamSince` to the existing `../../src/db/submissions.js` import, compute a 7-day ("this week") count with a fail-open guard alongside the other DB blocks, and pass it as the final `buildCockpitModel` argument:

  ```ts
  let autoFilteredCount = 0;
  if (db) {
    try {
      const since = screenOutsSince(new Date(), 7);
      autoFilteredCount = await countAutoSpamSince(db, since);
    } catch {
      // affordance simply absent — never blank the cockpit
    }
  }
  ```

  ```ts
  const model = buildCockpitModel(
    websites,
    reports,
    prior,
    baseUrl,
    new Date(),
    newSubmissions,
    spamTotals,
    recentEvents,
    autoFilteredCount,
  );
  ```

- [ ] **Step 21: Typecheck the handler + run the full dashboard suite.** `pnpm typecheck` (covers `tsconfig.netlify.json`, so the `.mts` handler wiring is checked) then `pnpm exec vitest run tests/dashboard tests/db`. Expected: typecheck exits 0; all dashboard + db suites pass.

- [ ] **Step 22: Commit.** `git add src/dashboard/fleet-cockpit.ts src/dashboard/fleet-render.ts netlify/functions/fleet-homepage.mts tests/dashboard/fleet-render-submissions.test.ts` then `git commit -m "feat(dashboard): cockpit auto-filtered-this-week review affordance"`.

---

### Task 10: Starter rollout — Cloudflare Turnstile widget (SEPARATE REPO)

> **This task is implemented in the `reddoor-starter` repo, NOT in `reddoor-maintenance`.** It is documented here so the plan is complete; no code in this repo changes. Because verification is central, the starter needs only the PUBLIC sitekey — no secret.

**Files (in `reddoor-starter`):**

- Modify: the shared contact/newsletter form component(s) — add the Turnstile widget
- Modify: `.env.example` / site env — add `PUBLIC_TURNSTILE_SITE_KEY`
- Modify: the CSP config — allowlist `https://challenges.cloudflare.com`
- Modify: `package.json` — bump `@reddoorla/maintenance` to the version shipping `turnstileFieldName`

- [ ] **Step 1: Add the Turnstile script + widget to the form.** Load the API script once (layout or the form's `<svelte:head>`), and place the widget inside the `<form>`:

```svelte
<svelte:head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</svelte:head>

<form method="POST" use:enhance>
  <!-- existing fields -->
  <div class="cf-turnstile" data-sitekey={PUBLIC_TURNSTILE_SITE_KEY}></div>
  <button type="submit">Send</button>
</form>
```

For a form-**action** form this is sufficient: the widget injects a hidden input named `cf-turnstile-response`, which `createIngestAction` reads via its `turnstileFieldName` option (default `cf-turnstile-response`) and forwards automatically.

- [ ] **Step 2: (endpoint/JSON forms only) include the token in the POST body.** A client-driven `createIngestEndpoint` form must send the token under the same key:

```ts
const token = window.turnstile?.getResponse() ?? "";
await fetch("/api/contact", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...fields, "cf-turnstile-response": token }),
});
```

- [ ] **Step 3: Add `PUBLIC_TURNSTILE_SITE_KEY`.** Add it to `.env.example` and the site's Netlify env. It is public (rendered into HTML) — safe to expose.

- [ ] **Step 4: Allowlist the Turnstile host in CSP.** Add `https://challenges.cloudflare.com` to `script-src` and `frame-src`.

- [ ] **Step 5: Bump the maintenance package + verify.** `pnpm add @reddoorla/maintenance@<new-version>`; build the site; submit the form; confirm the widget renders and a genuine submission still lands in the dashboard.

**No secret in the starter.** `TURNSTILE_SECRET_KEY` lives only in the dashboard's env (see Task 11 operator prerequisites).

---

### Task 11: Final integration gate + changeset

**Files:**

- Create: `.changeset/<name>.md`

- [ ] **Step 1: Run the full local gate, in order.**

```bash
pnpm lint        # eslint . && prettier --check .
pnpm typecheck   # incl. .mts handlers via tsconfig.netlify.json
pnpm test        # vitest (pretest build)
pnpm build
pnpm test:dist
```

Expected: all pass. Per the repo's pre-merge rule, `build` passing alone won't catch a renamed/removed public export — `test:dist` will, so do not skip it.

- [ ] **Step 2: Confirm the coverage floor holds.**

Run: `pnpm test:coverage`
Expected: statements ≥ 78, branches ≥ 67, functions ≥ 76, lines ≥ 80. The new pure modules (`spam-classifier.ts`, `turnstile.ts`, `meta.ts`) are small and fully covered; if the global number dipped, add the missing case rather than lowering the floor.

- [ ] **Step 3: Manual end-to-end verification (deploy preview).** Against a preview deploy of the dashboard function:
  - `GET /api/forms/<slug>` → health JSON shows `FORMS_INGEST_TOKEN: true` (and the function reads `TURNSTILE_SECRET_KEY` once set).
  - POST a spammy contact payload (message with 3+ links + a spam keyword) carrying the `x-forms-token` → response `{ ok: true }`; confirm the stored row has `status: 'spam_auto'` with a `spam_score` / `spam_reason`, and **no** operator email was sent.
  - POST a clean payload → `status: 'new'`, operator email sent as before.
  - (Once a site carries a Turnstile token) POST with a bad/expired token on a site whose `Require Turnstile` is checked → forced `spam_auto`.

- [ ] **Step 4: Add a changeset (minor).** Create `.changeset/<name>.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

feat(forms): heuristic spam classifier + Cloudflare Turnstile (central verify); auto-spam is a distinct, recoverable `spam_auto` status that suppresses notifications and newsletter fan-out
```

- [ ] **Step 5: Commit the changeset.**

```bash
git add .changeset/<name>.md
git commit -m "chore: changeset for forms spam defense"
```

**Operator prerequisites (configuration, not code — do before activation):**

- Create the Turnstile widget(s) in a Cloudflare account; set `TURNSTILE_SECRET_KEY` in the dashboard's Netlify env and `PUBLIC_TURNSTILE_SITE_KEY` per site. One free widget covers 10 hostnames; add widgets as the fleet approaches the 20-widget × 10-hostname (200-hostname) free ceiling (apex + `www` = two hostnames).
- Add the `Require Turnstile` boolean column to the Airtable **Websites** table (exact casing). Until it exists the mapping defaults to `false`, so the classifier still runs but no per-site hard-gate applies — the feature ships dark and safe.
