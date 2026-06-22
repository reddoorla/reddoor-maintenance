# Hybrid DB migration — Submissions + spam counters to libSQL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the two high-volume data sets — form **Submissions** and the **spam screen-out counters** — off Airtable to a libSQL (Turso-hosted) SQL database, leaving Websites / Reports / Digest State in Airtable as the human back office.

**Architecture:** The migration rides the existing dependency-injection seam. Every submission/screen-out access already flows through small `(base, …)` functions composed into deps at four Netlify handlers. New `src/db/*` modules provide libSQL-backed equivalents with **identical return shapes** (`SubmissionRow`, `ScreenOutTotals`), taking a `Kysely<Database>` handle instead of an `AirtableBase`. Cutover is an import swap at the four composition roots — `ingest.ts`, `submission-status.ts`, and the render code never change. A brief dual-write soak keeps Airtable as best-effort rollback insurance before the Airtable code paths are retired.

**Tech Stack:** TypeScript ESM (NodeNext, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); `@libsql/client` (HTTP-per-statement, no pool); `kysely` + `@libsql/kysely-libsql` (typed queries); standard-SQL migrations as template-string constants; vitest against in-memory libSQL; tsup bundle; changesets.

---

## Deviation from spec (one mechanism change, flagged)

The spec's Architecture section lists migrations as separate `src/db/migrations/NNNN_*.sql` files shipped via the `import.meta.url` walk-up asset pattern, and flags "`.sql` must resolve inside the Netlify function bundle" as the #1 implementation risk. **This plan inlines the migrations as standard-SQL template-string constants in `src/db/migrations.ts` instead.** Rationale: the asset walk-up pattern is proven for the CLI/dist path but has never been used for a Netlify function bundle in this repo; inlining keeps the SQL hand-owned and portable (paste any string into `sqlite3`/Turso) while letting tsup *and* Netlify's esbuild bundle it automatically — eliminating the shipping risk entirely with zero loss of the spec's intent (plain SQL, not Kysely's DSL). Everything else follows the spec exactly.

## File structure

**New files:**

- `src/db/schema.ts` — the hand-written `Database` interface (one type per table) Kysely types queries from. No runtime code.
- `src/db/migrations.ts` — `MIGRATIONS`: an ordered array of `{ id, sql }` standard-SQL scripts.
- `src/db/migrate.ts` — `runMigrations(client)`: ~30-line idempotent runner tracked in a `_migrations` table.
- `src/db/client.ts` — `readDbConfig()` + `openDb(cfg)` → creates one libSQL client, migrates it, returns a `Kysely<Database>` over that same client. `Db` type alias.
- `src/db/submissions.ts` — `createSubmission` / `listNewSubmissions` / `listSubmissionsForSite` / `getSubmissionById` / `setSubmissionStatusRow` / `stampNotified` + `newSubmissionId` + `backfillSubmission` (Kysely queries; same return shapes as the Airtable module).
- `src/db/screenouts.ts` — `recordScreenOut` / `recordMarkedSpam` (atomic upsert) / `listScreenOutsSince` / `screenOutsSince` + `backfillScreenoutBucket` + `ScreenOutReason` / `ScreenOutTotals`.
- `src/db/backfill.ts` — one-off Airtable → libSQL copy (`backfillSubmissions`, `backfillScreenouts`) + `reconcile`.
- `src/reports/submission-row.ts` — neutral, Airtable-free module holding `SubmissionRow`, `SubmissionInput`, the status/notify enums, and the `toFormType`/`toStatus`/`toNotifyStatus` validators. Both the Airtable module and the db module import from here (single source of truth).
- `src/cli/commands/db.ts` — `runDbCommand(action)` dispatching `migrate` / `backfill` / `reconcile`.
- `tests/db/*.test.ts` — one suite per `src/db/*` module, against in-memory libSQL with real migrations applied.

**Modified files:**

- `package.json` — three new deps.
- `src/reports/airtable/submissions.ts` — import the row shape + validators from `submission-row.ts`; `export *` from it for back-compat.
- `netlify/functions/form-ingest.mts`, `submission-status.mts`, `site-dashboard.mts`, `fleet-homepage.mts` — composition-root flips (Phase 3).
- `src/cli/bin.ts` — register the `db` command.
- `scripts/smoke-dist.mjs` — add `db` to the expected-subcommands list.

---

## Task 0: Provision the Turso database and wire env (operator prerequisite — no code)

This is the "DB-first" analog of the field-first rule: the database and its two secrets must exist before any backfill, reconcile, or handler flip can run. Do this once, up front. No code, no commit.

- [ ] **Step 1: Create the Turso database**

Create a Turso database (e.g. `reddoor-fleet`) and capture its libSQL URL (`libsql://…turso.io`) and an auth token. Standard SQL only — do not enable any Turso-specific feature.

- [ ] **Step 2: Set the two secrets in all three locations**

The same two values, mirroring how `AIRTABLE_PAT` + `AIRTABLE_BASE_ID` are handled. **Never** put these in the repo or any `.env` committed to git.

- Netlify site env (the dashboard site that serves the four handlers): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
- `~/.config/reddoor-maint/credentials.env` (for the CLI backfill/reconcile run): add `TURSO_DATABASE_URL=…` and `TURSO_AUTH_TOKEN=…`.
- GitHub Actions secrets (for parity / any future scheduled db job): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.

- [ ] **Step 3: Confirm the credentials file parses**

The CLI loads `~/.config/reddoor-maint/credentials.env` at startup. Confirm the two new lines are `KEY=value` with no stray quotes issues. (No command yet — `db migrate` in Task 10 is the first to read them.)

---

## Task 1: Add deps, schema, migrations, and the migration runner

**Files:**
- Modify: `package.json` (dependencies)
- Create: `src/db/schema.ts`
- Create: `src/db/migrations.ts`
- Create: `src/db/migrate.ts`
- Test: `tests/db/migrate.test.ts`

- [ ] **Step 1: Install the three runtime deps**

Run:
```bash
pnpm add @libsql/client kysely @libsql/kysely-libsql
```
Expected: `package.json#dependencies` gains `@libsql/client`, `kysely`, `@libsql/kysely-libsql`; lockfile updates.

- [ ] **Step 2: Write the `Database` schema interface**

Create `src/db/schema.ts`:
```ts
// The hand-written shape Kysely types every query from. SQLite stores TEXT/INTEGER
// only, so these are the column *shapes* — the value domains (form_type, status,
// notify_status) are still narrowed at read time by the validators in
// src/reports/submission-row.ts. Keep this in lockstep with src/db/migrations.ts;
// drift is caught by the in-memory tests in tests/db/, not by codegen.

export interface SubmissionsTable {
  id: string;
  submission_id: number | null;
  site_id: string;
  form_type: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  extra_fields: string | null;
  source_url: string | null;
  utm: string | null;
  submitted_at: string | null;
  status: string;
  notify_status: string;
  resend_message_id: string | null;
}

export interface SpamScreenoutsTable {
  site_id: string;
  date: string;
  honeypot: number;
  too_fast: number;
  marked_spam: number;
}

export interface MigrationsTable {
  id: string;
  applied_at: string;
}

export interface Database {
  submissions: SubmissionsTable;
  spam_screenouts: SpamScreenoutsTable;
  _migrations: MigrationsTable;
}
```

- [ ] **Step 3: Write the migrations constant**

Create `src/db/migrations.ts`:
```ts
/** Ordered, append-only list of standard-SQL migration scripts. Each runs once,
 *  tracked by `id` in the `_migrations` table (see migrate.ts). Statements use
 *  IF NOT EXISTS so even a partial re-apply is safe. Never edit a shipped script —
 *  add a new one. Standard SQLite SQL only (no Turso-specific syntax) so the host
 *  stays a connection-string swap. */
export type Migration = { id: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        submission_id INTEGER,
        site_id TEXT NOT NULL,
        form_type TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        message TEXT,
        extra_fields TEXT,
        source_url TEXT,
        utm TEXT,
        submitted_at TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        notify_status TEXT NOT NULL DEFAULT 'skipped',
        resend_message_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_submissions_site_submitted
        ON submissions (site_id, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_submissions_status
        ON submissions (status);
      CREATE TABLE IF NOT EXISTS spam_screenouts (
        site_id TEXT NOT NULL,
        date TEXT NOT NULL,
        honeypot INTEGER NOT NULL DEFAULT 0,
        too_fast INTEGER NOT NULL DEFAULT 0,
        marked_spam INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (site_id, date)
      );
    `,
  },
];
```

- [ ] **Step 4: Write the failing migration-runner test**

Create `tests/db/migrate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";

describe("runMigrations", () => {
  it("creates the tables on a fresh in-memory db and reports what it ran", async () => {
    const client = createClient({ url: ":memory:" });
    const ran = await runMigrations(client);
    expect(ran).toEqual(["0001_init"]);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.rows.map((r) => String(r.name));
    expect(names).toContain("submissions");
    expect(names).toContain("spam_screenouts");
    expect(names).toContain("_migrations");
  });

  it("is idempotent — a second run applies nothing", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    const ranAgain = await runMigrations(client);
    expect(ranAgain).toEqual([]);
    const applied = await client.execute("SELECT id FROM _migrations");
    expect(applied.rows.map((r) => String(r.id))).toEqual(["0001_init"]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/migrate.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/migrate.js'`.

- [ ] **Step 6: Write the migration runner**

Create `src/db/migrate.ts`:
```ts
import type { Client } from "@libsql/client";
import { MIGRATIONS } from "./migrations.js";

/** Apply every not-yet-applied migration in order against a raw libSQL client,
 *  tracking applied ids in `_migrations`. Idempotent: ids already present are
 *  skipped, and the DDL uses IF NOT EXISTS. Returns the ids applied this run.
 *  Runs on every openDb() — cheap (one indexed SELECT) and the gate every fresh
 *  Turso database needs before its first write. */
export async function runMigrations(client: Client): Promise<string[]> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const existing = await client.execute("SELECT id FROM _migrations");
  const applied = new Set(existing.rows.map((r) => String(r.id)));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await client.executeMultiple(m.sql);
    await client.execute({
      sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
      args: [m.id, new Date().toISOString()],
    });
    ran.push(m.id);
  }
  return ran;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/migrate.test.ts`
Expected: PASS (both cases).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/db/schema.ts src/db/migrations.ts src/db/migrate.ts tests/db/migrate.test.ts
git commit -m "feat(db): libSQL schema + idempotent migration runner"
```

---

## Task 2: The db client — openDb returns a migrated Kysely

**Files:**
- Create: `src/db/client.ts`
- Test: `tests/db/client.test.ts`

- [ ] **Step 1: Write the failing client test**

`openDb` must construct a single client, migrate it, and hand that *same* client to Kysely — otherwise an in-memory db migrated on one client is invisible to a Kysely on another. This test proves the round-trip end to end.

Create `tests/db/client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sql } from "kysely";
import { openDb } from "../../src/db/client.js";

describe("openDb", () => {
  it("returns a Kysely whose connection already has the migrations applied", async () => {
    const db = await openDb({ url: ":memory:" });
    // Insert through Kysely, read it back — proves the dialect uses the migrated client.
    await db
      .insertInto("submissions")
      .values({
        id: "sub_test",
        submission_id: 1,
        site_id: "recSITE",
        form_type: "contact",
        name: "Ada",
        email: "ada@example.com",
        phone: null,
        message: null,
        extra_fields: null,
        source_url: null,
        utm: null,
        submitted_at: "2026-06-22T00:00:00.000Z",
        status: "new",
        notify_status: "skipped",
        resend_message_id: null,
      })
      .execute();
    const row = await db
      .selectFrom("submissions")
      .selectAll()
      .where("id", "=", "sub_test")
      .executeTakeFirst();
    expect(row?.name).toBe("Ada");
    // _migrations exists too (proves runMigrations ran on the same connection).
    const m = await sql<{ id: string }>`SELECT id FROM _migrations`.execute(db);
    expect(m.rows.map((r) => r.id)).toEqual(["0001_init"]);
    await db.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/client.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/client.js'`.

- [ ] **Step 3: Write the client**

Create `src/db/client.ts`:
```ts
import { createClient, type Client, type Config as LibsqlConfig } from "@libsql/client";
import { Kysely } from "kysely";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { defaultCredentialsPath } from "../util/credentials.js";
import type { Database } from "./schema.js";
import { runMigrations } from "./migrate.js";

export type DbConfig = { url: string; authToken?: string };
export type Db = Kysely<Database>;

function missing(name: string): Error {
  return Object.assign(
    new Error(
      `${name} not set. Export it in your shell or put it in ${defaultCredentialsPath()} as ${name}=...`,
    ),
    { exitCode: 2 },
  );
}

/** Read TURSO_DATABASE_URL (+ optional TURSO_AUTH_TOKEN) from the environment,
 *  mirroring readAirtableConfig. The token is optional so a local `file:`/`:memory:`
 *  url works with no token. */
export function readDbConfig(): DbConfig {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw missing("TURSO_DATABASE_URL");
  const authToken = process.env.TURSO_AUTH_TOKEN;
  return authToken ? { url, authToken } : { url };
}

/** Open a libSQL-backed Kysely. Builds ONE client, applies migrations on it, then
 *  wraps that exact client in the Kysely dialect — the shared client is required so
 *  an in-memory db (per-client) is the same database the queries see. The same code
 *  serves Turso (libsql:// url + token), a self-hosted sqld, a local file: url, and
 *  :memory: for tests — host portability is a connection-string swap. */
export async function openDb(cfg: DbConfig): Promise<Db> {
  const clientConfig: LibsqlConfig = cfg.authToken
    ? { url: cfg.url, authToken: cfg.authToken }
    : { url: cfg.url };
  const client: Client = createClient(clientConfig);
  await runMigrations(client);
  return new Kysely<Database>({ dialect: new LibsqlDialect({ client }) });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/client.test.ts`
Expected: PASS.

> If this test fails because `LibsqlDialect({ client })` is unsupported by the installed `@libsql/kysely-libsql` version, the fix is localized to `openDb`: construct the dialect from a shared `file:` temp url instead of `:memory:` and have the tests pass that url through `openDb`. Do not scatter the workaround — keep it inside `openDb`/a test helper.

- [ ] **Step 5: Commit**

```bash
git add src/db/client.ts tests/db/client.test.ts
git commit -m "feat(db): openDb — migrated Kysely over a shared libSQL client"
```

---

## Task 3: Extract the neutral submission-row module (single source of truth)

The `SubmissionRow`/`SubmissionInput` shapes and the `toFormType`/`toStatus`/`toNotifyStatus` validators currently live (validators un-exported) inside `src/reports/airtable/submissions.ts`. The db module must reuse the *exact same* validators (spec: "carry the enum validators verbatim"). Extract them to an Airtable-free module and re-export for back-compat so no call site changes its import path.

**Files:**
- Create: `src/reports/submission-row.ts`
- Modify: `src/reports/airtable/submissions.ts`
- Test: `tests/reports/airtable/submissions.test.ts` (existing — must stay green), `tests/reports/submission-row.test.ts` (new)

- [ ] **Step 1: Create the neutral module**

Create `src/reports/submission-row.ts` (copy the types + validators **verbatim** from the current `airtable/submissions.ts`):
```ts
import { SUBMISSION_FORM_TYPES, type FormType } from "../forms/types.js";

export { SUBMISSION_FORM_TYPES };
export type { FormType };

export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const NOTIFY_STATUSES = ["sent", "failed", "skipped"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

export function toFormType(raw: string | undefined): FormType {
  if (raw && (SUBMISSION_FORM_TYPES as readonly string[]).includes(raw)) return raw as FormType;
  if (raw)
    console.warn(`[submissions] unknown Form type ${JSON.stringify(raw)} — treating as contact`);
  return "contact";
}

export function toStatus(raw: string | undefined): SubmissionStatus {
  if (raw && (SUBMISSION_STATUSES as readonly string[]).includes(raw))
    return raw as SubmissionStatus;
  return "new";
}

export function toNotifyStatus(raw: string | undefined): NotifyStatus {
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
```

- [ ] **Step 2: Rewrite the head of `airtable/submissions.ts` to import + re-export**

In `src/reports/airtable/submissions.ts`, delete the local declarations of `SUBMISSION_STATUSES`, `SubmissionStatus`, `NOTIFY_STATUSES`, `NotifyStatus`, `toFormType`, `toStatus`, `toNotifyStatus`, `SubmissionRow`, `SubmissionInput`, and the `SUBMISSION_FORM_TYPES`/`FormType` re-export. Replace the top of the file (keep `SUBMISSIONS_TABLE`, `mapRow`, and all the `(base, …)` functions) with:
```ts
import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "./client.js";
import { escapeFormulaString } from "./reports.js";
import {
  SUBMISSION_FORM_TYPES,
  type FormType,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
  NOTIFY_STATUSES,
  type NotifyStatus,
  toFormType,
  toStatus,
  toNotifyStatus,
  type SubmissionRow,
  type SubmissionInput,
} from "../submission-row.js";

export const SUBMISSIONS_TABLE = "Submissions";

// Re-export the row shape + validators so existing importers (forms/ingest.ts,
// dashboard/submission-status.ts, the render code) keep importing from
// airtable/submissions.js unchanged.
export {
  SUBMISSION_FORM_TYPES,
  SUBMISSION_STATUSES,
  NOTIFY_STATUSES,
  toFormType,
  toStatus,
  toNotifyStatus,
};
export type { FormType, SubmissionStatus, NotifyStatus, SubmissionRow, SubmissionInput };
```
Leave `mapRow`, `createSubmission`, `listNewSubmissions`, `listSubmissionsForSite`, `getSubmissionById`, `setSubmissionStatusRow`, and `stampNotified` exactly as they are below that.

- [ ] **Step 3: Write a small test for the extracted validators**

Create `tests/reports/submission-row.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toFormType, toStatus, toNotifyStatus } from "../../src/reports/submission-row.js";

describe("submission-row validators", () => {
  it("toStatus falls back to new on bad input", () => {
    expect(toStatus("read")).toBe("read");
    expect(toStatus("garbage")).toBe("new");
    expect(toStatus(undefined)).toBe("new");
  });
  it("toNotifyStatus falls back to skipped", () => {
    expect(toNotifyStatus("sent")).toBe("sent");
    expect(toNotifyStatus("nope")).toBe("skipped");
  });
  it("toFormType falls back to contact", () => {
    expect(toFormType("newsletter")).toBe("newsletter");
    expect(toFormType("weird")).toBe("contact");
  });
});
```

- [ ] **Step 4: Run the full suite to confirm the move is behavior-neutral**

Run: `pnpm vitest run tests/reports/submission-row.test.ts tests/reports/airtable/submissions.test.ts`
Expected: PASS — the extraction changed no behavior; the existing submissions suite is unaffected because the re-exports preserve every import path.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no broken imports anywhere in src or the handlers).

- [ ] **Step 6: Commit**

```bash
git add src/reports/submission-row.ts src/reports/airtable/submissions.ts tests/reports/submission-row.test.ts
git commit -m "refactor(submissions): extract row shape + enum validators to a neutral module"
```

---

## Task 4: db submissions — createSubmission + getSubmissionById

**Files:**
- Create: `src/db/submissions.ts`
- Test: `tests/db/submissions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/submissions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createSubmission, getSubmissionById } from "../../src/db/submissions.js";

describe("db createSubmission / getSubmissionById", () => {
  it("inserts a row with an opaque id, display number 1, and round-trips it", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recSITE",
      formType: "contact",
      name: "Ada",
      email: "ada@example.com",
      phone: "555",
      message: "hi",
      extraFields: { artwork: "Sunset" },
      sourceUrl: "https://acme.test/contact",
      utm: "utm_source=google",
      submittedAt: new Date("2026-06-22T12:00:00.000Z"),
    });
    expect(row.id).toMatch(/^sub_/);
    expect(row.submissionId).toBe(1);
    expect(row.status).toBe("new");
    expect(row.notifyStatus).toBe("skipped");
    expect(row.extraFields).toBe(JSON.stringify({ artwork: "Sunset" }));
    expect(row.phone).toBe("555");

    const fetched = await getSubmissionById(db, row.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.email).toBe("ada@example.com");
    expect(fetched!.submittedAt).toBe("2026-06-22T12:00:00.000Z");
  });

  it("assigns monotonically increasing display numbers", async () => {
    const db = await openDb({ url: ":memory:" });
    const a = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    const b = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "B",
      email: "b@example.com",
      submittedAt: new Date("2026-06-22T00:00:01.000Z"),
    });
    expect(a.submissionId).toBe(1);
    expect(b.submissionId).toBe(2);
  });

  it("omits extra_fields when empty", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      extraFields: {},
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    expect(row.extraFields).toBeNull();
  });

  it("returns null for a missing id", async () => {
    const db = await openDb({ url: ":memory:" });
    expect(await getSubmissionById(db, "sub_nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/submissions.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/submissions.js'`.

- [ ] **Step 3: Write the module (create + read mapper + getById)**

Create `src/db/submissions.ts`:
```ts
import { sql } from "kysely";
import type { Selectable } from "kysely";
import type { Db } from "./client.js";
import type { SubmissionsTable } from "./schema.js";
import {
  type SubmissionRow,
  type SubmissionInput,
  toFormType,
  toStatus,
  toNotifyStatus,
} from "../reports/submission-row.js";

/** Map a raw DB row to the canonical SubmissionRow, narrowing the enum columns
 *  with the SAME validators the Airtable mapRow uses — SQLite stores TEXT, so a
 *  bad stored value must still be defended against. */
function rowFromDb(r: Selectable<SubmissionsTable>): SubmissionRow {
  return {
    id: r.id,
    submissionId: r.submission_id,
    siteId: r.site_id,
    formType: toFormType(r.form_type),
    name: r.name,
    email: r.email,
    phone: r.phone,
    message: r.message,
    extraFields: r.extra_fields,
    sourceUrl: r.source_url,
    utm: r.utm,
    submittedAt: r.submitted_at,
    status: toStatus(r.status),
    notifyStatus: toNotifyStatus(r.notify_status),
    resendMessageId: r.resend_message_id,
  };
}

/** Opaque, collision-free id. crypto is a Node 20 global — no new dep. */
export function newSubmissionId(): string {
  return `sub_${crypto.randomUUID()}`;
}

export async function getSubmissionById(db: Db, id: string): Promise<SubmissionRow | null> {
  const r = await db
    .selectFrom("submissions")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return r ? rowFromDb(r) : null;
}

export async function createSubmission(db: Db, input: SubmissionInput): Promise<SubmissionRow> {
  const id = newSubmissionId();
  const extra =
    input.extraFields !== undefined && Object.keys(input.extraFields).length > 0
      ? JSON.stringify(input.extraFields)
      : null;
  await db
    .insertInto("submissions")
    .values({
      id,
      // Display number: MAX+1 in a single statement. libSQL is single-writer, so
      // writes serialize and this is race-free.
      submission_id: sql<number>`(SELECT COALESCE(MAX(submission_id), 0) + 1 FROM submissions)`,
      site_id: input.siteId,
      form_type: input.formType,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      message: input.message ?? null,
      extra_fields: extra,
      source_url: input.sourceUrl ?? null,
      utm: input.utm ?? null,
      submitted_at: input.submittedAt.toISOString(),
      status: "new",
      notify_status: "skipped",
      resend_message_id: null,
    })
    .execute();
  const created = await getSubmissionById(db, id);
  if (!created) throw new Error("createSubmission: row vanished after insert");
  return created;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/submissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/submissions.ts tests/db/submissions.test.ts
git commit -m "feat(db): createSubmission + getSubmissionById on libSQL"
```

---

## Task 5: db submissions — list, status, stamp

**Files:**
- Modify: `src/db/submissions.ts`
- Test: `tests/db/submissions.test.ts` (extend)

- [ ] **Step 1: Add the failing tests**

Append to `tests/db/submissions.test.ts`:
```ts
import {
  listNewSubmissions,
  listSubmissionsForSite,
  setSubmissionStatusRow,
  stampNotified,
} from "../../src/db/submissions.js";

async function seed(db: Awaited<ReturnType<typeof openDb>>) {
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Old A",
    email: "olda@example.com",
    submittedAt: new Date("2026-06-20T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "New A",
    email: "newa@example.com",
    submittedAt: new Date("2026-06-22T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recB",
    formType: "contact",
    name: "B",
    email: "b@example.com",
    submittedAt: new Date("2026-06-21T00:00:00.000Z"),
  });
}

describe("db list / status / stamp", () => {
  it("listNewSubmissions returns only new rows, newest first", async () => {
    const db = await openDb({ url: ":memory:" });
    await seed(db);
    const all = await listNewSubmissions(db);
    expect(all.map((s) => s.name)).toEqual(["New A", "B", "Old A"]);
    // Flip one out of "new" and confirm it drops from the queue.
    const first = all[0]!;
    await setSubmissionStatusRow(db, first.id, "read");
    const rest = await listNewSubmissions(db);
    expect(rest.find((s) => s.id === first.id)).toBeUndefined();
  });

  it("listSubmissionsForSite narrows by site id, newest first, honoring max", async () => {
    const db = await openDb({ url: ":memory:" });
    await seed(db);
    const a = await listSubmissionsForSite(db, { id: "recA", name: "Acme" });
    expect(a.map((s) => s.name)).toEqual(["New A", "Old A"]);
    const capped = await listSubmissionsForSite(db, { id: "recA", name: "Acme" }, 1);
    expect(capped.map((s) => s.name)).toEqual(["New A"]);
  });

  it("setSubmissionStatusRow updates status", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    await setSubmissionStatusRow(db, row.id, "spam");
    expect((await getSubmissionById(db, row.id))!.status).toBe("spam");
  });

  it("stampNotified sets notify status, and the message id only when present", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    await stampNotified(db, row.id, "sent", "re_123");
    let got = (await getSubmissionById(db, row.id))!;
    expect(got.notifyStatus).toBe("sent");
    expect(got.resendMessageId).toBe("re_123");

    await stampNotified(db, row.id, "failed", null);
    got = (await getSubmissionById(db, row.id))!;
    expect(got.notifyStatus).toBe("failed");
    expect(got.resendMessageId).toBe("re_123"); // unchanged when messageId is null
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/submissions.test.ts`
Expected: FAIL — `listNewSubmissions` (and the others) are not exported.

- [ ] **Step 3: Add the implementations**

Append to `src/db/submissions.ts`:
```ts
import type { SubmissionStatus, NotifyStatus } from "../reports/submission-row.js";

export async function listNewSubmissions(db: Db): Promise<SubmissionRow[]> {
  const rows = await db
    .selectFrom("submissions")
    .selectAll()
    .where("status", "=", "new")
    .orderBy("submitted_at", "desc")
    .execute();
  return rows.map(rowFromDb);
}

/** Same signature shape as the Airtable version (takes `{ id, name }`) so the
 *  composition-root swap is import-only — but here we filter by id directly, with
 *  no linked-field/primary-field workaround and no JS-confirm pass. */
export async function listSubmissionsForSite(
  db: Db,
  site: { id: string; name: string },
  max = 200,
): Promise<SubmissionRow[]> {
  const rows = await db
    .selectFrom("submissions")
    .selectAll()
    .where("site_id", "=", site.id)
    .orderBy("submitted_at", "desc")
    .limit(max)
    .execute();
  return rows.map(rowFromDb);
}

export async function setSubmissionStatusRow(
  db: Db,
  id: string,
  status: SubmissionStatus,
): Promise<void> {
  await db.updateTable("submissions").set({ status }).where("id", "=", id).execute();
}

export async function stampNotified(
  db: Db,
  id: string,
  status: NotifyStatus,
  messageId: string | null,
): Promise<void> {
  const patch =
    messageId !== null
      ? { notify_status: status, resend_message_id: messageId }
      : { notify_status: status };
  await db.updateTable("submissions").set(patch).where("id", "=", id).execute();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/submissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/submissions.ts tests/db/submissions.test.ts
git commit -m "feat(db): list/status/stamp submission queries on libSQL"
```

---

## Task 6: db screenouts — atomic upsert counters + windowed read

**Files:**
- Create: `src/db/screenouts.ts`
- Test: `tests/db/screenouts.test.ts`

- [ ] **Step 1: Write the failing test (incl. the concurrency proof)**

The atomic `ON CONFLICT … DO UPDATE … + 1` clause is the whole reason for the move — its exactness must be proven under concurrent calls.

Create `tests/db/screenouts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  recordScreenOut,
  recordMarkedSpam,
  listScreenOutsSince,
  screenOutsSince,
} from "../../src/db/screenouts.js";

describe("db recordScreenOut (atomic upsert)", () => {
  it("creates the bucket at 1 then increments in place", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordScreenOut(db, "recSITE", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recSITE", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recSITE", "too-fast", "2026-06-22");
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals).toEqual({ honeypot: 2, tooFast: 1, markedSpam: 0 });
  });

  it("counts exactly under concurrent calls for the same (site, date)", async () => {
    const db = await openDb({ url: ":memory:" });
    const N = 50;
    await Promise.all(
      Array.from({ length: N }, () => recordScreenOut(db, "recSITE", "honeypot", "2026-06-22")),
    );
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals.honeypot).toBe(N);
  });
});

describe("db recordMarkedSpam", () => {
  it("increments marked_spam on the day's bucket", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordMarkedSpam(db, "recSITE", "2026-06-22");
    await recordMarkedSpam(db, "recSITE", "2026-06-22");
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals.markedSpam).toBe(2);
  });
});

describe("db listScreenOutsSince", () => {
  it("sums per site across the window and excludes earlier dates", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordScreenOut(db, "recA", "honeypot", "2026-06-20");
    await recordScreenOut(db, "recA", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recB", "too-fast", "2026-06-21");
    await recordScreenOut(db, "recA", "honeypot", "2026-05-01"); // before the window
    const map = await listScreenOutsSince(db, "2026-06-15");
    expect(map.get("recA")).toEqual({ honeypot: 2, tooFast: 0, markedSpam: 0 });
    expect(map.get("recB")).toEqual({ honeypot: 0, tooFast: 1, markedSpam: 0 });
  });
});

describe("screenOutsSince", () => {
  it("returns the YYYY-MM-DD `days` before now", () => {
    expect(screenOutsSince(new Date("2026-06-22T00:00:00.000Z"), 30)).toBe("2026-05-23");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/screenouts.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/screenouts.js'`.

- [ ] **Step 3: Write the module**

Create `src/db/screenouts.ts`:
```ts
import { sql } from "kysely";
import type { Db } from "./client.js";

export type ScreenOutReason = "honeypot" | "too-fast";
export type ScreenOutTotals = { honeypot: number; tooFast: number; markedSpam: number };

const COLUMN: Record<ScreenOutReason, "honeypot" | "too_fast"> = {
  honeypot: "honeypot",
  "too-fast": "too_fast",
};

/** Atomically increment the caught counter for a reason on the (site, date) bucket.
 *  ON CONFLICT keeps the count exact — no read-modify-write race, no duplicate
 *  buckets. A swallowed failure must never error a screened bot (caller's job). */
export async function recordScreenOut(
  db: Db,
  siteId: string,
  reason: ScreenOutReason,
  date: string,
): Promise<void> {
  const col = COLUMN[reason];
  await sql`
    INSERT INTO spam_screenouts (site_id, date, ${sql.ref(col)})
    VALUES (${siteId}, ${date}, 1)
    ON CONFLICT (site_id, date) DO UPDATE SET ${sql.ref(col)} = ${sql.ref(col)} + 1
  `.execute(db);
}

/** Atomically increment the "got through, marked spam" counter on the (site, date) bucket. */
export async function recordMarkedSpam(db: Db, siteId: string, date: string): Promise<void> {
  await sql`
    INSERT INTO spam_screenouts (site_id, date, marked_spam)
    VALUES (${siteId}, ${date}, 1)
    ON CONFLICT (site_id, date) DO UPDATE SET marked_spam = marked_spam + 1
  `.execute(db);
}

/** Sum each counter per site over buckets with date >= sinceDate — a single
 *  indexed GROUP BY, replacing the full-table scan + JS windowing. */
export async function listScreenOutsSince(
  db: Db,
  sinceDate: string,
): Promise<Map<string, ScreenOutTotals>> {
  const rows = await db
    .selectFrom("spam_screenouts")
    .select((eb) => [
      "site_id",
      eb.fn.sum<number>("honeypot").as("honeypot"),
      eb.fn.sum<number>("too_fast").as("too_fast"),
      eb.fn.sum<number>("marked_spam").as("marked_spam"),
    ])
    .where("date", ">=", sinceDate)
    .groupBy("site_id")
    .execute();
  const out = new Map<string, ScreenOutTotals>();
  for (const r of rows) {
    out.set(r.site_id, {
      honeypot: Number(r.honeypot) || 0,
      tooFast: Number(r.too_fast) || 0,
      markedSpam: Number(r.marked_spam) || 0,
    });
  }
  return out;
}

/** The ISO date (YYYY-MM-DD) `days` before `now`, for the window queries.
 *  Verbatim from the Airtable module so the windows match exactly. */
export function screenOutsSince(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/screenouts.test.ts`
Expected: PASS — including the 50-way concurrency case.

- [ ] **Step 5: Commit**

```bash
git add src/db/screenouts.ts tests/db/screenouts.test.ts
git commit -m "feat(db): exact spam-screenout counters via atomic upsert on libSQL"
```

---

## Task 7: Backfill — submissions (id-preserving, idempotent)

**Files:**
- Modify: `src/db/submissions.ts` (add `backfillSubmission`)
- Create: `src/db/backfill.ts`
- Test: `tests/db/backfill-submissions.test.ts`

- [ ] **Step 1: Add the failing test for `backfillSubmission`**

Create `tests/db/backfill-submissions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { backfillSubmission, getSubmissionById, listNewSubmissions } from "../../src/db/submissions.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";

const ROW: SubmissionRow = {
  id: "recAIRTABLE1",
  submissionId: 42,
  siteId: "recSITE",
  formType: "contact",
  name: "Ada",
  email: "ada@example.com",
  phone: null,
  message: "hi",
  extraFields: null,
  sourceUrl: null,
  utm: null,
  submittedAt: "2026-06-20T00:00:00.000Z",
  status: "read",
  notifyStatus: "sent",
  resendMessageId: "re_1",
};

describe("backfillSubmission", () => {
  it("inserts preserving the Airtable id and display number", async () => {
    const db = await openDb({ url: ":memory:" });
    await backfillSubmission(db, ROW);
    const got = await getSubmissionById(db, "recAIRTABLE1");
    expect(got).toEqual(ROW);
    // It is NOT forced into the new queue — status is preserved.
    expect(await listNewSubmissions(db)).toHaveLength(0);
  });

  it("is idempotent — re-inserting the same id is a no-op", async () => {
    const db = await openDb({ url: ":memory:" });
    await backfillSubmission(db, ROW);
    await backfillSubmission(db, { ...ROW, name: "Changed" });
    const got = await getSubmissionById(db, "recAIRTABLE1");
    expect(got!.name).toBe("Ada"); // first write wins; no duplicate
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/backfill-submissions.test.ts`
Expected: FAIL — `backfillSubmission` is not exported.

- [ ] **Step 3: Add `backfillSubmission`**

Append to `src/db/submissions.ts`:
```ts
/** Insert a SubmissionRow verbatim, preserving its id, display number, and status.
 *  ON CONFLICT(id) DO NOTHING makes the whole backfill re-runnable. */
export async function backfillSubmission(db: Db, row: SubmissionRow): Promise<void> {
  await db
    .insertInto("submissions")
    .values({
      id: row.id,
      submission_id: row.submissionId,
      site_id: row.siteId,
      form_type: row.formType,
      name: row.name,
      email: row.email,
      phone: row.phone,
      message: row.message,
      extra_fields: row.extraFields,
      source_url: row.sourceUrl,
      utm: row.utm,
      submitted_at: row.submittedAt,
      status: row.status,
      notify_status: row.notifyStatus,
      resend_message_id: row.resendMessageId,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}
```

- [ ] **Step 4: Add the failing test for the Airtable→libSQL submission copy**

Create the orchestration test in `tests/db/backfill-submissions.test.ts` (append). It uses a tiny fake base that pages a seeded `Submissions` table (mirroring the existing fake-base style in `tests/reports/airtable/screenouts.test.ts`):
```ts
import { backfillSubmissions } from "../../src/db/backfill.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";

type Rec = { id: string; fields: Record<string, unknown> };
function fakeBase(rows: Rec[]) {
  const tableFn = (_t: string) => ({
    select: () => ({
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(rows, () => {});
      },
    }),
  });
  return tableFn as unknown as AirtableBase;
}

describe("backfillSubmissions (Airtable → libSQL)", () => {
  it("copies every Airtable submission, preserving ids", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([
      {
        id: "recX",
        fields: {
          "Submission ID": 7,
          Site: ["recSITE"],
          "Form type": "contact",
          Name: "Grace",
          Email: "grace@example.com",
          "Submitted at": "2026-06-19T00:00:00.000Z",
          Status: "archived",
          "Notify status": "sent",
        },
      },
    ]);
    const n = await backfillSubmissions(base, db);
    expect(n).toBe(1);
    const got = await getSubmissionById(db, "recX");
    expect(got!.name).toBe("Grace");
    expect(got!.submissionId).toBe(7);
    expect(got!.status).toBe("archived");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/backfill-submissions.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/backfill.js'`.

- [ ] **Step 6: Write `backfillSubmissions` in `src/db/backfill.ts`**

Create `src/db/backfill.ts`:
```ts
import type { AirtableBase } from "../reports/airtable/client.js";
import { SUBMISSIONS_TABLE, mapRow } from "../reports/airtable/submissions.js";
import type { Db } from "./client.js";
import { backfillSubmission } from "./submissions.js";

/** Page the entire Airtable Submissions table and insert each row into libSQL,
 *  preserving ids/numbers/status. Re-runnable (backfillSubmission is idempotent).
 *  Returns the number of source rows processed. */
export async function backfillSubmissions(base: AirtableBase, db: Db): Promise<number> {
  let count = 0;
  await base(SUBMISSIONS_TABLE)
    .select({ pageSize: 100 })
    .eachPage(async (records, fetchNextPage) => {
      for (const rec of records) {
        await backfillSubmission(db, mapRow({ id: rec.id, fields: rec.fields }));
        count++;
      }
      fetchNextPage();
    });
  return count;
}
```

> Note on the `eachPage` callback being `async`: the Airtable SDK awaits nothing between pages, but the real fake/SDK calls `fetchNextPage()` synchronously. Inserts within a page are awaited sequentially here. This is a one-off backfill; throughput is not a concern (libSQL is single-writer regardless).

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/backfill-submissions.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/submissions.ts src/db/backfill.ts tests/db/backfill-submissions.test.ts
git commit -m "feat(db): backfill submissions from Airtable, id-preserving + idempotent"
```

---

## Task 8: Backfill — spam screen-out buckets (aggregate dupes, idempotent)

**Files:**
- Modify: `src/db/screenouts.ts` (add `backfillScreenoutBucket`)
- Modify: `src/db/backfill.ts` (add `backfillScreenouts`)
- Test: `tests/db/backfill-screenouts.test.ts`

- [ ] **Step 1: Add the failing test**

Create `tests/db/backfill-screenouts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { listScreenOutsSince } from "../../src/db/screenouts.js";
import { backfillScreenouts } from "../../src/db/backfill.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";

type Rec = { id: string; fields: Record<string, unknown> };
function fakeBase(rows: Rec[]) {
  const tableFn = (_t: string) => ({
    select: () => ({
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(rows, () => {});
      },
    }),
  });
  return tableFn as unknown as AirtableBase;
}

describe("backfillScreenouts (Airtable → libSQL)", () => {
  it("merges duplicate same-day buckets and is idempotent on re-run", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([
      { id: "r1", fields: { Site: ["recA"], Date: "2026-06-20", Honeypot: 2, "Too-fast": 1 } },
      { id: "r2", fields: { Site: ["recA"], Date: "2026-06-20", Honeypot: 3 } }, // dup same day
      { id: "r3", fields: { Site: ["recB"], Date: "2026-06-21", "Marked spam": 4 } },
    ]);
    await backfillScreenouts(base, db);
    let map = await listScreenOutsSince(db, "2026-06-01");
    expect(map.get("recA")).toEqual({ honeypot: 5, tooFast: 1, markedSpam: 0 });
    expect(map.get("recB")).toEqual({ honeypot: 0, tooFast: 0, markedSpam: 4 });

    // Re-run: counts must NOT double (replace-upsert on a pre-aggregated value).
    await backfillScreenouts(base, db);
    map = await listScreenOutsSince(db, "2026-06-01");
    expect(map.get("recA")).toEqual({ honeypot: 5, tooFast: 1, markedSpam: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/backfill-screenouts.test.ts`
Expected: FAIL — `backfillScreenouts` is not exported.

- [ ] **Step 3: Add `backfillScreenoutBucket` (replace-upsert)**

Append to `src/db/screenouts.ts`:
```ts
/** Set the (site, date) bucket to exact totals. Replace-upsert (DO UPDATE SET col
 *  = excluded.col) so re-running the backfill is idempotent. The caller pre-sums
 *  duplicate same-day Airtable buckets in JS before calling this. */
export async function backfillScreenoutBucket(
  db: Db,
  b: { siteId: string; date: string; honeypot: number; tooFast: number; markedSpam: number },
): Promise<void> {
  await sql`
    INSERT INTO spam_screenouts (site_id, date, honeypot, too_fast, marked_spam)
    VALUES (${b.siteId}, ${b.date}, ${b.honeypot}, ${b.tooFast}, ${b.markedSpam})
    ON CONFLICT (site_id, date) DO UPDATE SET
      honeypot = excluded.honeypot,
      too_fast = excluded.too_fast,
      marked_spam = excluded.marked_spam
  `.execute(db);
}
```

- [ ] **Step 4: Add `backfillScreenouts` to `src/db/backfill.ts`**

Append to `src/db/backfill.ts`:
```ts
import { SCREENOUTS_TABLE } from "../reports/airtable/screenouts.js";
import { backfillScreenoutBucket } from "./screenouts.js";

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Read every Airtable Spam Screenouts bucket, pre-sum duplicate (site, date)
 *  buckets in JS, then replace-upsert each aggregated bucket into libSQL. Returns
 *  the number of aggregated (site, date) buckets written. */
export async function backfillScreenouts(base: AirtableBase, db: Db): Promise<number> {
  const agg = new Map<string, { siteId: string; date: string; honeypot: number; tooFast: number; markedSpam: number }>();
  await base(SCREENOUTS_TABLE)
    .select({ pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) {
        const f = rec.fields;
        const siteId = (f["Site"] as string[] | undefined)?.[0] ?? "";
        const date = typeof f["Date"] === "string" ? (f["Date"] as string) : "";
        if (!siteId || !date) continue;
        const key = `${siteId} ${date}`;
        const cur = agg.get(key) ?? { siteId, date, honeypot: 0, tooFast: 0, markedSpam: 0 };
        cur.honeypot += num(f["Honeypot"]);
        cur.tooFast += num(f["Too-fast"]);
        cur.markedSpam += num(f["Marked spam"]);
        agg.set(key, cur);
      }
      fetchNextPage();
    });
  for (const bucket of agg.values()) await backfillScreenoutBucket(db, bucket);
  return agg.size;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/backfill-screenouts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/screenouts.ts src/db/backfill.ts tests/db/backfill-screenouts.test.ts
git commit -m "feat(db): backfill spam-screenout buckets, dup-merging + idempotent"
```

---

## Task 9: Reconcile — gate the cutover on parity

**Files:**
- Modify: `src/db/backfill.ts` (add `reconcile`)
- Test: `tests/db/reconcile.test.ts`

- [ ] **Step 1: Add the failing test**

Create `tests/db/reconcile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { backfillSubmissions, backfillScreenouts, reconcile } from "../../src/db/backfill.js";
import { createSubmission } from "../../src/db/submissions.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";

type Rec = { id: string; fields: Record<string, unknown> };
function fakeBase(submissions: Rec[], screenouts: Rec[]) {
  const tableFn = (t: string) => ({
    select: () => ({
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(t === "Submissions" ? submissions : screenouts, () => {});
      },
    }),
  });
  return tableFn as unknown as AirtableBase;
}

const SUB: Rec = {
  id: "recX",
  fields: { Site: ["recA"], "Form type": "contact", Name: "G", Email: "g@example.com", "Submitted at": "2026-06-19T00:00:00.000Z", Status: "new" },
};
const SCREEN: Rec = { id: "s1", fields: { Site: ["recA"], Date: "2026-06-20", Honeypot: 2 } };

describe("reconcile", () => {
  it("reports ok when libSQL matches Airtable after a full backfill", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([SUB], [SCREEN]);
    await backfillSubmissions(base, db);
    await backfillScreenouts(base, db);
    const report = await reconcile(base, db);
    expect(report.ok).toBe(true);
    expect(report.submissions).toEqual({ airtable: 1, libsql: 1 });
  });

  it("reports a mismatch when libSQL has extra/fewer rows", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([SUB], [SCREEN]);
    await backfillSubmissions(base, db);
    await backfillScreenouts(base, db);
    // Add a row only to libSQL → counts diverge.
    await createSubmission(db, { siteId: "recA", formType: "contact", name: "Z", email: "z@example.com", submittedAt: new Date("2026-06-22T00:00:00.000Z") });
    const report = await reconcile(base, db);
    expect(report.ok).toBe(false);
    expect(report.submissions).toEqual({ airtable: 1, libsql: 2 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/db/reconcile.test.ts`
Expected: FAIL — `reconcile` is not exported.

- [ ] **Step 3: Add `reconcile`**

Append to `src/db/backfill.ts`:
```ts
import { sql } from "kysely";
import { listScreenOutsSince } from "./screenouts.js";
import { listScreenOutsSince as airtableListScreenOutsSince } from "../reports/airtable/screenouts.js";

export type ReconcileReport = {
  ok: boolean;
  submissions: { airtable: number; libsql: number };
  screenouts: {
    airtable: { honeypot: number; tooFast: number; markedSpam: number };
    libsql: { honeypot: number; tooFast: number; markedSpam: number };
  };
};

/** Count submissions on both sides and sum the all-time screen-out totals on both
 *  sides; ok only when both match. A mismatch must ABORT the cutover. */
export async function reconcile(base: AirtableBase, db: Db): Promise<ReconcileReport> {
  // Submissions: count Airtable by paging, count libSQL with COUNT(*).
  let airtableSubs = 0;
  await base(SUBMISSIONS_TABLE)
    .select({ pageSize: 100, fields: [] })
    .eachPage((records, fetchNextPage) => {
      airtableSubs += records.length;
      fetchNextPage();
    });
  const libCountRow = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM submissions`.execute(db);
  const libsqlSubs = Number(libCountRow.rows[0]?.n ?? 0);

  // Screen-outs: sum all-time fleet totals on each side (since "0001-01-01").
  const aMap = await airtableListScreenOutsSince(base, "0001-01-01");
  const lMap = await listScreenOutsSince(db, "0001-01-01");
  const sumOf = (m: Map<string, { honeypot: number; tooFast: number; markedSpam: number }>) => {
    const t = { honeypot: 0, tooFast: 0, markedSpam: 0 };
    for (const v of m.values()) {
      t.honeypot += v.honeypot;
      t.tooFast += v.tooFast;
      t.markedSpam += v.markedSpam;
    }
    return t;
  };
  const aScreen = sumOf(aMap);
  const lScreen = sumOf(lMap);

  const ok =
    airtableSubs === libsqlSubs &&
    aScreen.honeypot === lScreen.honeypot &&
    aScreen.tooFast === lScreen.tooFast &&
    aScreen.markedSpam === lScreen.markedSpam;

  return {
    ok,
    submissions: { airtable: airtableSubs, libsql: libsqlSubs },
    screenouts: { airtable: aScreen, libsql: lScreen },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/db/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/backfill.ts tests/db/reconcile.test.ts
git commit -m "feat(db): reconcile — parity gate over submission + screen-out counts"
```

---

## Task 10: CLI `db` command — migrate / backfill / reconcile

**Files:**
- Create: `src/cli/commands/db.ts`
- Modify: `src/cli/bin.ts`
- Modify: `scripts/smoke-dist.mjs`
- Test: `tests/cli/db-command.test.ts`

- [ ] **Step 1: Write the failing command test**

Create `tests/cli/db-command.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runDbCommand } from "../../src/cli/commands/db.js";

describe("runDbCommand", () => {
  it("rejects an unknown action with a non-zero code", async () => {
    const r = await runDbCommand("frobnicate", {});
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/unknown db action/i);
  });

  it("migrate against a :memory: url reports the applied migrations", async () => {
    // Force the in-memory url so the command needs no real Turso creds.
    const r = await runDbCommand("migrate", { url: ":memory:" });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0001_init/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/cli/db-command.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/commands/db.js'`.

- [ ] **Step 3: Write the command**

Create `src/cli/commands/db.ts`:
```ts
export type DbCommandOptions = {
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  cwd?: string;
  verbose?: boolean;
};

/** `db <action>` — migrate | backfill | reconcile. The db/Airtable layers are
 *  imported dynamically so a non-db CLI invocation (and `--help`) never loads
 *  @libsql/client or the airtable SDK. */
export async function runDbCommand(
  action: string,
  opts: DbCommandOptions,
): Promise<{ output: string; code: number }> {
  const { openDb, readDbConfig } = await import("../../db/client.js");
  const cfg = opts.url ? { url: opts.url } : readDbConfig();

  if (action === "migrate") {
    const { runMigrations } = await import("../../db/migrate.js");
    const { createClient } = await import("@libsql/client");
    const client = createClient(cfg.url === ":memory:" ? { url: ":memory:" } : cfg);
    const ran = await runMigrations(client);
    return {
      output: ran.length ? `Applied migrations: ${ran.join(", ")}` : "Already up to date.",
      code: 0,
    };
  }

  if (action === "backfill") {
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { backfillSubmissions, backfillScreenouts } = await import("../../db/backfill.js");
    const base = openBase(readAirtableConfig());
    const db = await openDb(cfg);
    const subs = await backfillSubmissions(base, db);
    const buckets = await backfillScreenouts(base, db);
    return { output: `Backfilled ${subs} submissions, ${buckets} screen-out buckets.`, code: 0 };
  }

  if (action === "reconcile") {
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { reconcile } = await import("../../db/backfill.js");
    const base = openBase(readAirtableConfig());
    const db = await openDb(cfg);
    const r = await reconcile(base, db);
    const lines = [
      `submissions: airtable=${r.submissions.airtable} libsql=${r.submissions.libsql}`,
      `screenouts:  airtable=${JSON.stringify(r.screenouts.airtable)} libsql=${JSON.stringify(r.screenouts.libsql)}`,
      r.ok ? "OK — parity confirmed." : "MISMATCH — do not cut over.",
    ];
    return { output: lines.join("\n"), code: r.ok ? 0 : 1 };
  }

  return {
    output: `unknown db action '${action}'. Use: migrate | backfill | reconcile.`,
    code: 1,
  };
}
```

- [ ] **Step 4: Run the command test to verify it passes**

Run: `pnpm vitest run tests/cli/db-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the command in `bin.ts`**

Add the import near the other command imports in `src/cli/bin.ts`:
```ts
import { runDbCommand } from "./commands/db.js";
```
Add the command registration just before `cli.help();`:
```ts
cli
  .command("db <action>", "Migrate / backfill / reconcile the libSQL store (migrate | backfill | reconcile).")
  .action(async (action: string, opts: { cwd?: string; verbose?: boolean }) =>
    runOrExit(() => runDbCommand(action, opts), opts),
  );
```

- [ ] **Step 6: Add `db` to the smoke-dist subcommand list**

In `scripts/smoke-dist.mjs`, add `"db"` to the `expectedSubcommands` array (after `"github-signals"`). `db <action>` mirrors `launch <site>`: cac short-circuits `db --help` to exit 0, so it does NOT need to be added to the `upgrade` skip filter.

- [ ] **Step 7: Run the built-artifact gate**

Run: `pnpm build && pnpm test:dist`
Expected: PASS — `db` appears in `--help`, `db --help` exits 0, and the handler-import checks still pass.

> If `db --help` exits non-zero (cac validates the required `<action>` first, like `upgrade`), instead add `"db"` to the `.filter((c) => c !== "upgrade")` skip list in `scripts/smoke-dist.mjs` so the per-command `--help` loop skips it (the top-level `--help` already asserts it is registered).

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/db.ts src/cli/bin.ts scripts/smoke-dist.mjs tests/cli/db-command.test.ts
git commit -m "feat(cli): db migrate|backfill|reconcile command"
```

- [ ] **Step 9: Add a changeset for the new db capability**

Create `.changeset/hybrid-db-libsql-store.md`:
```md
---
"@reddoorla/maintenance": minor
---

Add a libSQL-backed store for the two high-volume data sets — form submissions and
spam screen-out counters — behind the existing dependency-injection seam, plus a
`reddoor-maint db migrate|backfill|reconcile` CLI. Screen-out counters are now exact
(atomic upsert) instead of approximate daily buckets, and per-site submission reads are
indexed server-side. Airtable remains the human back office for Websites, Reports, and
Digest State. Handlers are not yet switched — that lands in the cutover.
```

```bash
git add .changeset/hybrid-db-libsql-store.md
git commit -m "chore: changeset for the libSQL store"
```

---

## Task 11: Run the production backfill + reconcile (operational gate — no code)

Do this against the real Turso DB before any handler flip. The package is already built from Task 10.

- [ ] **Step 1: Migrate the production database**

Run: `node dist/cli/bin.js db migrate`
Expected: `Applied migrations: 0001_init` (or `Already up to date.` on re-run). Reads `TURSO_*` from `~/.config/reddoor-maint/credentials.env`.

- [ ] **Step 2: Backfill from Airtable**

Run: `node dist/cli/bin.js db backfill`
Expected: `Backfilled N submissions, M screen-out buckets.`

- [ ] **Step 3: Reconcile — must be OK before cutover**

Run: `node dist/cli/bin.js db reconcile`
Expected: `OK — parity confirmed.` (exit 0). If it prints `MISMATCH`, STOP — investigate before flipping any handler. (Re-running backfill is safe; both backfills are idempotent.)

---

## Task 12: Flip `form-ingest.mts` (writes + screen-out beacon; dual-write soak)

**Files:**
- Modify: `netlify/functions/form-ingest.mts`

- [ ] **Step 1: Swap the write deps to libSQL, keep Airtable for the website lookup + dual-write**

Edit the imports at the top of `netlify/functions/form-ingest.mts`. Keep `openBase` and `getWebsiteBySlug`. Change the submission/screen-out imports to the db modules, and add aliased Airtable imports for the dual-write shadow:
```ts
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { createSubmission, stampNotified } from "../../src/db/submissions.js";
import { recordScreenOut } from "../../src/db/screenouts.js";
import { createSubmission as airtableCreateSubmission } from "../../src/reports/airtable/submissions.js";
import { recordScreenOut as airtableRecordScreenOut } from "../../src/reports/airtable/screenouts.js";
import { ingestSubmission, parseScreenOut, ingestScreenOut } from "../../src/forms/ingest.js";
// ...unchanged: webhook, mailchimp, notify, token, resend, handler-helpers imports
```

- [ ] **Step 2: Require the Turso env alongside Airtable, open both, and gate dual-write on a flag**

In the GET health-check `env` object, add `TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string"`. After the existing Airtable env check, add:
```ts
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[form-ingest] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }
```
Inside the `try`, replace `const base = openBase({ apiKey, baseId });` with:
```ts
    const base = openBase({ apiKey, baseId });
    const db = await openDb(readDbConfig());
    // Brief cutover soak: when DUAL_WRITE_AIRTABLE=1, also shadow-write captured
    // leads + screen-outs to Airtable (best-effort, swallowed) as rollback
    // insurance. libSQL is the source of truth. Removed after the soak.
    const dualWrite = process.env.DUAL_WRITE_AIRTABLE === "1";
```

- [ ] **Step 3: Point the screen-out branch at libSQL (+ optional shadow)**

Replace the `recordScreenOut` dep in the screen-out branch:
```ts
      const r = await ingestScreenOut(
        {
          getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
          recordScreenOut: async (siteId, reason) => {
            await recordScreenOut(db, siteId, reason, date);
            if (dualWrite) {
              try {
                await airtableRecordScreenOut(base, siteId, reason, date);
              } catch (e) {
                console.error(`[form-ingest] dual-write screen-out failed: ${String(e)}`);
              }
            }
          },
        },
        slug,
        screenOutReason,
      );
```

- [ ] **Step 4: Point the submission ingest at libSQL (+ optional shadow create)**

In the `ingestSubmission` deps, replace the `createSubmission` and `stampNotified` lines:
```ts
        createSubmission: async (input) => {
          const row = await createSubmission(db, input);
          if (dualWrite) {
            try {
              await airtableCreateSubmission(base, input);
            } catch (e) {
              console.error(`[form-ingest] dual-write submission failed: ${String(e)}`);
            }
          }
          return row;
        },
        notify: makeNotify(send),
        stampNotified: (id, status, messageId) => stampNotified(db, id, status, messageId),
```
(The shadow Airtable row is intentionally left unstamped — it is rollback insurance for the lead content, not a perfectly mirrored record.)

- [ ] **Step 5: Typecheck the handlers**

Run: `pnpm typecheck`
Expected: PASS (covers `tsconfig.netlify.json`).

- [ ] **Step 6: Built-artifact gate (handler imports resolve)**

Run: `pnpm build && pnpm test:dist`
Expected: PASS — the smoke-dist handler-import check confirms every `../../src/...` import in `form-ingest.mts` resolves to an existing, exported symbol.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/form-ingest.mts
git commit -m "feat(forms): ingest writes submissions + screen-outs to libSQL (Airtable dual-write behind flag)"
```

---

## Task 13: Flip `submission-status.mts` (libSQL only)

The only data this handler touches — submissions and the marked-spam counter — both move to libSQL, so it needs no Airtable at all after the flip. (Triage state is not dual-written; the brief-soak rollback caveat is that triage performed during the soak would not be reflected in the Airtable shadow rows. Acceptable for a short soak — documented in the spec.)

**Files:**
- Modify: `netlify/functions/submission-status.mts`

- [ ] **Step 1: Replace the Airtable imports with db imports**

In `netlify/functions/submission-status.mts`, replace:
```ts
import { openBase } from "../../src/reports/airtable/client.js";
import {
  getSubmissionById,
  setSubmissionStatusRow,
} from "../../src/reports/airtable/submissions.js";
import { setSubmissionStatus, verifyBasicAuth } from "../../src/dashboard/index.js";
import { recordMarkedSpam } from "../../src/reports/airtable/screenouts.js";
```
with:
```ts
import { openDb, readDbConfig } from "../../src/db/client.js";
import { getSubmissionById, setSubmissionStatusRow } from "../../src/db/submissions.js";
import { setSubmissionStatus, verifyBasicAuth } from "../../src/dashboard/index.js";
import { recordMarkedSpam } from "../../src/db/screenouts.js";
```

- [ ] **Step 2: Swap the env check from Airtable to Turso**

In the GET health-check `env` object, replace the two `AIRTABLE_*` booleans with `TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string"`. Replace the Airtable env block:
```ts
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[submission-status] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }
```
with:
```ts
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[submission-status] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }
```

- [ ] **Step 3: Open the db and rewire the deps**

Replace the `try` body's `const base = openBase({ apiKey, baseId });` + `setSubmissionStatus(...)` deps with:
```ts
    const db = await openDb(readDbConfig());
    const result = await setSubmissionStatus(
      {
        getSubmissionById: (sid) => getSubmissionById(db, sid),
        setSubmissionStatusRow: (sid, status) => setSubmissionStatusRow(db, sid, status),
        recordMarkedSpam: (siteId) =>
          recordMarkedSpam(db, siteId, new Date().toISOString().slice(0, 10)),
      },
      id,
      requested,
    );
```

- [ ] **Step 4: Typecheck + built-artifact gate**

Run: `pnpm typecheck && pnpm build && pnpm test:dist`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/submission-status.mts
git commit -m "feat(dashboard): submission status + marked-spam now read/write libSQL"
```

---

## Task 14: Flip the read handlers — `site-dashboard.mts` + `fleet-homepage.mts`

Both keep Airtable for the back-office data they still own (websites/reports/digest) and switch the submission + screen-out reads to libSQL.

**Files:**
- Modify: `netlify/functions/site-dashboard.mts`
- Modify: `netlify/functions/fleet-homepage.mts`

- [ ] **Step 1: site-dashboard — switch the submission + screen-out reads**

In `netlify/functions/site-dashboard.mts`, replace these two imports:
```ts
import { listSubmissionsForSite } from "../../src/reports/airtable/submissions.js";
import { listScreenOutsSince, screenOutsSince } from "../../src/reports/airtable/screenouts.js";
```
with:
```ts
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listSubmissionsForSite } from "../../src/db/submissions.js";
import { listScreenOutsSince, screenOutsSince } from "../../src/db/screenouts.js";
```
Inside the `try`, right after `const base = openBase({ apiKey, baseId });`, add:
```ts
    const db = await openDb(readDbConfig());
```
Change the two read calls from `base` to `db`:
- `submissions = await listSubmissionsForSite(db, { id: site.id, name: site.name });`
- `spamTotals = (await listScreenOutsSince(db, since)).get(site.id) ?? null;`

Also update the `import("...").ScreenOutTotals` type annotation on `spamTotals` to point at the db module:
```ts
    let spamTotals: import("../../src/db/screenouts.js").ScreenOutTotals | null = null;
```
Add `TURSO_DATABASE_URL` to the GET health-check `env` object, and add the Turso env guard alongside the existing Airtable one:
```ts
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[site-dashboard] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }
```

- [ ] **Step 2: fleet-homepage — switch the new-submissions + screen-out roll-up reads**

In `netlify/functions/fleet-homepage.mts`, replace:
```ts
import { listNewSubmissions } from "../../src/reports/airtable/submissions.js";
import { listScreenOutsSince, screenOutsSince } from "../../src/reports/airtable/screenouts.js";
```
with:
```ts
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listNewSubmissions } from "../../src/db/submissions.js";
import { listScreenOutsSince, screenOutsSince } from "../../src/db/screenouts.js";
```
Inside the `try`, right after `const base = openBase({ apiKey, baseId });`, add:
```ts
    const db = await openDb(readDbConfig());
```
Change `newSubmissions = await listNewSubmissions(base);` → `listNewSubmissions(db)`, and in the spam roll-up block change `await listScreenOutsSince(base, since)` → `await listScreenOutsSince(db, since)`.
Add the Turso env guard alongside the Airtable one near the top of the handler:
```ts
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[fleet-homepage] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }
```

- [ ] **Step 3: Typecheck + built-artifact gate + full suite**

Run: `pnpm typecheck && pnpm build && pnpm test:dist && pnpm test`
Expected: PASS — handlers typecheck, every handler `src/` import resolves, and the full vitest suite is green.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/site-dashboard.mts netlify/functions/fleet-homepage.mts
git commit -m "feat(dashboard): submission + spam reads served from libSQL"
```

- [ ] **Step 5: Add the cutover changeset**

Create `.changeset/hybrid-db-cutover.md`:
```md
---
"@reddoorla/maintenance": minor
---

Cut the dashboard handlers over to the libSQL store: form ingest writes submissions and
exact spam screen-out counters to libSQL (with an optional `DUAL_WRITE_AIRTABLE=1` soak
that also shadow-writes to Airtable for rollback insurance), submission triage reads/writes
libSQL, and the per-site page + cockpit read submissions and spam totals from libSQL.
Requires `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` in the dashboard site env.
```

```bash
git add .changeset/hybrid-db-cutover.md
git commit -m "chore: changeset for the libSQL cutover"
```

---

## Task 15: Soak, then drop the dual-write flag (operational — no code)

- [ ] **Step 1: Deploy and soak with dual-write on**

Merge to main (handlers deploy on the Netlify redeploy of main, not on an npm publish) with `DUAL_WRITE_AIRTABLE=1` set in the dashboard site env. Over the soak window, submit a real test lead per the existing verify method (flip a site's Status so notify routes to the operator), confirm it appears on the dashboard (served from libSQL), and confirm `node dist/cli/bin.js db reconcile` still reports OK.

- [ ] **Step 2: Turn off dual-write**

Once satisfied, remove (or set to `0`) `DUAL_WRITE_AIRTABLE` in the dashboard site env. Writes now go to libSQL only. Airtable's `Submissions` + `Spam Screenouts` tables stop receiving new rows. Leave the existing rows in place — they are retired in code next, archived/deleted out-of-band later.

---

## Task 16: Retire the Airtable submission + screen-out code paths

**Files:**
- Modify: `netlify/functions/form-ingest.mts` (remove dual-write)
- Delete: `src/reports/airtable/submissions.ts`, `src/reports/airtable/screenouts.ts`
- Delete: `tests/reports/airtable/submissions.test.ts`, `tests/reports/airtable/screenouts.test.ts`, `tests/reports/airtable/get-website-by-slug.test.ts` only if it depends on the deleted module (check; it tests websites, so leave it)
- Modify: `src/db/backfill.ts` (inline the two raw Airtable readers it needs, since the Airtable modules are going away), or delete backfill + the `db backfill`/`reconcile` actions
- Modify: `src/cli/commands/db.ts` (keep `migrate`; drop `backfill`/`reconcile` if backfill is deleted)

Decision for this task: the backfill/reconcile scaffolding has served its purpose by now (production was backfilled + reconciled in Task 11 and soaked in Task 15). **Delete it** so removing the Airtable modules is clean, and keep only `db migrate` for future schema changes.

- [ ] **Step 1: Remove the dual-write from `form-ingest.mts`**

Delete the `dualWrite` const, the two aliased Airtable imports (`airtableCreateSubmission`, `airtableRecordScreenOut`), and the two `if (dualWrite) { … }` shadow-write blocks, restoring the `createSubmission`/`recordScreenOut` deps to their plain libSQL-only form:
```ts
          recordScreenOut: (siteId, reason) => recordScreenOut(db, siteId, reason, date),
```
```ts
        createSubmission: (input) => createSubmission(db, input),
```

- [ ] **Step 2: Delete the backfill scaffolding and its tests**

```bash
git rm src/db/backfill.ts tests/db/backfill-submissions.test.ts tests/db/backfill-screenouts.test.ts tests/db/reconcile.test.ts
```

- [ ] **Step 3: Reduce the `db` command to `migrate` only**

In `src/cli/commands/db.ts`, delete the `backfill` and `reconcile` branches (and their dynamic imports), keeping `migrate` and the unknown-action fallback. Update `tests/cli/db-command.test.ts` to drop any backfill/reconcile expectations (the `migrate` + unknown-action tests stay).

- [ ] **Step 4: Delete the Airtable submission + screen-out modules and their tests**

```bash
git rm src/reports/airtable/submissions.ts src/reports/airtable/screenouts.ts \
       tests/reports/airtable/submissions.test.ts tests/reports/airtable/screenouts.test.ts
```

- [ ] **Step 5: Resolve dangling imports**

Search for any remaining importers of the deleted modules:
```bash
grep -rn "airtable/submissions\|airtable/screenouts" src netlify tests
```
Expected after the flip: only `src/reports/submission-row.ts` holds the row shape (still imported by `src/db/submissions.ts` and any renderer that needs the type). The dashboard render + `forms/ingest.ts` + `dashboard/submission-status.ts` import `SubmissionRow`/`SubmissionStatus` types — repoint those imports from `../reports/airtable/submissions.js` to `../reports/submission-row.js` (type-only; behavior-neutral). Also confirm `mapRow`/`SUBMISSIONS_TABLE`/`SCREENOUTS_TABLE` have no remaining importers (they were only used by the deleted backfill).

- [ ] **Step 6: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: PASS. The submission/screen-out behavior is now entirely libSQL; no Airtable code remains for these two data sets.

- [ ] **Step 7: Commit + changeset**

```bash
git add -A
git commit -m "refactor(db): retire Airtable submission + screen-out code paths after libSQL soak"
```
Create `.changeset/retire-airtable-submissions.md`:
```md
---
"@reddoorla/maintenance": patch
---

Retire the Airtable-backed submission and spam-screen-out code paths now that the dashboard
runs on libSQL. Removes the dual-write soak shadow, the one-off backfill/reconcile scaffolding
(kept `reddoor-maint db migrate`), and the Airtable `Submissions`/`Spam Screenouts` modules.
The Airtable tables themselves can be archived out-of-band; the row shape + enum validators
live in `src/reports/submission-row.ts`.
```
```bash
git add .changeset/retire-airtable-submissions.md
git commit -m "chore: changeset for retiring the Airtable submission paths"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** Engine/portability (Task 1–2, `:memory:`/`file:`/Turso via one `openDb`); Kysely typed queries + plain-SQL migrations + retained validators (Tasks 1, 3–6); atomic-upsert exactness incl. concurrency proof (Task 6); schema + indexes (Task 1); cross-store join by `site_id` string (db queries filter by `site.id`); backfill/reconcile/flip/soak/retire cutover (Tasks 7–16); error handling preserved (write-before-notify order + swallowed notify/stamp unchanged in `ingest.ts`; defensive read try/catch unchanged in the handlers); security (TURSO secrets in env/credentials only, Task 0); opaque `sub_<uuid>` id with preserved backfill ids (Tasks 4, 7).
- **Required tests from the spec's risk section:** atomic-upsert concurrency (Task 6 Step 1), migration double-apply (Task 1 Step 4), enum validators carried verbatim (Task 3) and used in the db read mapper (Task 4), `Database`↔schema drift caught by in-memory tests (every `tests/db/*`). The `.sql`-shipping risk is eliminated by inlining (see "Deviation").
- **Type consistency:** `SubmissionRow`/`SubmissionInput`/`SubmissionStatus`/`NotifyStatus` come from the single `src/reports/submission-row.ts`; `ScreenOutTotals`/`ScreenOutReason` are structurally identical between the Airtable and db modules so the renderers (which take the type) need no change until retire; the db functions keep the same parameter *shapes* as the Airtable ones (`listSubmissionsForSite(handle, {id,name}, max)`, `recordScreenOut(handle, siteId, reason, date)`) so each composition-root swap is import-only.
