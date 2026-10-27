# Report Edits A — The Override Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store a per-report override map beside a prospect audit, serve it with the report, and apply it everywhere the report renders — with no editing UI yet.

**Architecture:** Three new columns on `prospect_audits` in reddoor-maintenance. The JSON route wraps the stored report and its overrides into one response by string concatenation, never parsing `result_json`. In reddoor-website, `toReportView` applies payload overrides and carries the map on the view, so every composed-sentence function already has it without a signature change.

**Tech Stack:** TypeScript, Kysely over libSQL/Turso, Netlify Functions, SvelteKit 2 + Svelte 5 runes, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-prospect-report-operator-edits-design.md`

---

## Two corrections to the spec, already applied below

1. **Three migrations, not one with three statements.** SQLite `ADD COLUMN` has no `IF NOT EXISTS`, so the runner recognises `duplicate column name` as already-applied. That recovery is only sound for a single statement: if a three-statement migration adds column one and then loses its marker, the re-run throws on statement one, the runner marks the whole migration applied, and columns two and three never exist. Migration `0013` states this rule explicitly. So: `0015`, `0016`, `0017`.
2. **The override map rides on `ReportView`.** Every composed function already takes `view: ReportView` (`openingSummary`, `headlineFinding`, `passes`, `collisionFix`, `healthFixes`, `healthRows`). Adding `overrides` to the view means none of their signatures change.

## Ordering, which is not optional

**Task 1 ships and deploys before Task 4.** Task 4 changes the response shape of the maintenance API. Task 1 teaches the website to accept both shapes. Reversed, every prospect report 500s until the website catches up.

## File Structure

**reddoor-maintenance**

| File                                             | Responsibility                                 |
| ------------------------------------------------ | ---------------------------------------------- |
| `src/db/migrations.ts`                           | Modify: three `ADD COLUMN` migrations          |
| `src/db/schema.ts`                               | Modify: three fields on `ProspectAuditsTable`  |
| `src/db/prospect-audits.ts`                      | Modify: two writers, two widened selects       |
| `netlify/functions/audit-report-json.mts`        | Modify: wrapped body, `no-store`, opened stamp |
| `netlify/functions/audit-report-overrides.mts`   | Create: the save endpoint                      |
| `src/dashboard/prospect-audits-render.ts`        | Modify: show edited/opened                     |
| `tests/db/prospect-audit-overrides.test.ts`      | Create                                         |
| `tests/dashboard/audit-report-overrides.test.ts` | Create                                         |

**reddoor-website**

| File                                          | Responsibility                                   |
| --------------------------------------------- | ------------------------------------------------ |
| `src/lib/report/fetch.ts`                     | Modify: accept both response shapes              |
| `src/lib/report/load.ts`                      | Modify: return `overrides` alongside `report`    |
| `src/lib/report/overrides.ts`                 | Create: the whole override mechanism             |
| `src/lib/report/model.ts`                     | Modify: `toReportView` applies + carries the map |
| `src/lib/report/narrative.ts`                 | Modify: composed sentences consult the map       |
| `src/lib/report/health.ts`                    | Modify: composed rows consult the map            |
| `src/routes/audit/[token]/+page.svelte`       | Modify: pass overrides through                   |
| `src/routes/audit/[token]/print/+page.svelte` | Modify: pass overrides through                   |

---

## Task 1: Website accepts both response shapes

**Repo:** reddoor-website. **Ships and deploys before Task 4.**

**Files:**

- Modify: `src/lib/report/fetch.ts`
- Test: `src/lib/report/fetch.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/report/fetch.test.ts`:

```ts
describe("fetchReport — response shapes", () => {
  const TOKEN = "aB3-_xY9zQ1rS2tU4vW6xY";
  const opts = (body: unknown) => ({
    baseUrl: "https://ops.test",
    fetch: (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch,
  });

  it("reads a bare report body, the shape served before overrides existed", async () => {
    const got = await fetchReport(TOKEN, opts({ url: "https://acme.test/", scores: {} }));
    expect(got).toEqual({ report: { url: "https://acme.test/", scores: {} }, overrides: {} });
  });

  it("reads a wrapped body and returns its overrides", async () => {
    const got = await fetchReport(
      TOKEN,
      opts({
        report: { url: "https://acme.test/" },
        overrides: { "composed:headlineFinding": { original: "a", text: "b" } },
        editedAt: "2026-09-09T00:00:00.000Z",
        openedAt: null,
      }),
    );
    expect(got).toEqual({
      report: { url: "https://acme.test/" },
      overrides: { "composed:headlineFinding": { original: "a", text: "b" } },
    });
  });

  it("treats a wrapped body with null overrides as no overrides", async () => {
    const got = await fetchReport(
      TOKEN,
      opts({ report: { url: "https://acme.test/" }, overrides: null }),
    );
    expect(got?.overrides).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd ~/Documents/GitHub/reddoor-website && pnpm vitest run src/lib/report/fetch.test.ts
```

Expected: FAIL. `fetchReport` currently resolves to the raw body, so the first case returns the bare object rather than `{ report, overrides }`.

- [ ] **Step 3: Change the return type and the parse**

In `src/lib/report/fetch.ts`, add above `fetchReport`:

```ts
/** One replaced string, with the generated text it replaced. `original` is kept
 *  so the cockpit can show what changed, and so an override can be withheld if
 *  it no longer matches what it claims to replace. */
export type Override = { original: string; text: string };
export type OverrideMap = Record<string, Override>;

/** What one report fetch yields. `overrides` is always an object, never null,
 *  so no caller has to branch on absence. */
export type FetchedReport = { report: AuditReport; overrides: OverrideMap };

/**
 * The maintenance API served a bare report before overrides existed and serves
 * `{ report, overrides, editedAt, openedAt }` after. Both are accepted, on
 * purpose: the two repos deploy independently, and a website that only
 * understood the new shape would 500 every report until maintenance caught up.
 *
 * The discriminator is a `report` key, which a bare `ProspectAuditResult` never
 * has — its top level is url/businessName/scores/crawl/checks and the rest.
 */
function unwrap(body: unknown): FetchedReport {
  const b = body as Record<string, unknown>;
  if (b && typeof b === "object" && "report" in b) {
    const overrides = b.overrides;
    return {
      report: b.report as AuditReport,
      overrides: overrides && typeof overrides === "object" ? (overrides as OverrideMap) : {},
    };
  }
  return { report: body as AuditReport, overrides: {} };
}
```

Then change the signature and the final line:

```ts
export async function fetchReport(
  token: string,
  opts: FetchReportOptions,
): Promise<FetchedReport | null> {
```

```ts
return unwrap(await res.json());
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm vitest run src/lib/report/fetch.test.ts
```

Expected: PASS, including every test that already existed in the file.

- [ ] **Step 5: Update the one caller**

In `src/lib/report/load.ts`, change the return type and the destructure:

```ts
export async function loadReport({
  params,
  fetch,
  setHeaders,
}: LoadLike): Promise<{ report: AuditReport; overrides: OverrideMap; meta_referrer: string }> {
```

```ts
const fetched = await fetchReport(params.token, {
  baseUrl: env.PROSPECT_REPORT_URL ?? "",
  fetch,
});

// Only a genuine 404 lands here as null. An upstream outage throws out of
// fetchReport and becomes a 500, deliberately: "your report is gone" and "we
// are broken" must not look the same to the person holding the link.
if (!fetched) throw error(404, "Not found");

return {
  report: fetched.report,
  overrides: fetched.overrides,
  meta_referrer: "no-referrer",
};
```

Add `OverrideMap` to the existing import from `./fetch`.

- [ ] **Step 6: Run the whole report suite and the type check**

```bash
pnpm vitest run src/lib/report/ src/routes/audit/ && pnpm check
```

Expected: all green, 0 svelte-check errors. `toReportView(data.report)` in both pages still compiles because `report` is still on the returned object.

- [ ] **Step 7: Commit**

```bash
git add src/lib/report/fetch.ts src/lib/report/fetch.test.ts src/lib/report/load.ts
git commit -m "feat(report): accept both audit-report response shapes

The maintenance API is about to serve { report, overrides } instead of a
bare report. Accepting both lets the two repos deploy independently."
```

- [ ] **Step 8: Ship it before starting Task 4**

Open the PR against `staging`, get `ci` green on the head SHA, merge, and confirm `https://staging.reddoorla.com/audit/<a real token>` still renders. This task is a deliberate no-op in behaviour; if anything about the report changes, stop.

---

## Task 2: The three columns

**Repo:** reddoor-maintenance.

**Files:**

- Modify: `src/db/migrations.ts` (append to the array that ends at `0014_prospect_audits_site_key_index`)
- Modify: `src/db/schema.ts` (`ProspectAuditsTable`)

- [ ] **Step 1: Write the failing test**

Create `tests/db/prospect-audit-overrides.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openDb, readDbConfig } from "../../src/db/client.js";

describe("prospect_audits — override columns", () => {
  it("has overrides_json, edited_at and opened_at after migration", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const rows = await db.introspection.getTables();
    const table = rows.find((t) => t.name === "prospect_audits");
    const names = (table?.columns ?? []).map((c) => c.name);
    expect(names).toContain("overrides_json");
    expect(names).toContain("edited_at");
    expect(names).toContain("opened_at");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/Documents/GitHub/reddoor-maintenance && pnpm vitest run tests/db/prospect-audit-overrides.test.ts
```

Expected: FAIL, `expected [ ... ] to contain 'overrides_json'`.

- [ ] **Step 3: Add the three migrations**

In `src/db/migrations.ts`, append three entries after `0014_prospect_audits_site_key_index`:

```ts
  {
    // Operator edits on a prospect report. One JSON blob rather than a side
    // table: the map is always read and written whole, and no query wants a
    // single override in isolation. Same shape of decision as `result_json`.
    //
    // THREE MIGRATIONS, NOT ONE. SQLite ADD COLUMN has no IF NOT EXISTS, so
    // migrate.ts treats "duplicate column name" as already-applied. That
    // recovery is only sound one statement at a time: a three-statement
    // migration that added column one and then lost its marker would throw on
    // the re-run's first statement, be marked applied, and leave the other two
    // columns permanently missing. Same rule as 0003 and 0013.
    id: "0015_prospect_audits_overrides",
    sql: `ALTER TABLE prospect_audits ADD COLUMN overrides_json TEXT;`,
  },
  {
    id: "0016_prospect_audits_edited_at",
    sql: `ALTER TABLE prospect_audits ADD COLUMN edited_at TEXT;`,
  },
  {
    id: "0017_prospect_audits_opened_at",
    sql: `ALTER TABLE prospect_audits ADD COLUMN opened_at TEXT;`,
  },
```

- [ ] **Step 4: Add the fields to the table type**

In `src/db/schema.ts`, inside `ProspectAuditsTable`, after `result_json: string;`:

```ts
/** Operator edits, `{ "<key>": { original, text } }` as JSON. Null on every
 *  row written before migration 0015, and on any report never edited. */
overrides_json: string | null;
/** ISO-8601 of the last override write. Null when never edited. */
edited_at: string | null;
/** ISO-8601 of the last fetch that did NOT carry an edit session. Null when
 *  nobody outside the edit flow has opened it. */
opened_at: string | null;
```

- [ ] **Step 5: Run it and watch it pass**

```bash
pnpm vitest run tests/db/prospect-audit-overrides.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full db suite, including the query-plan gate**

```bash
pnpm vitest run tests/db/
```

Expected: all green. Nothing indexes the new columns, so no query plan changes.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations.ts src/db/schema.ts tests/db/prospect-audit-overrides.test.ts
git commit -m "feat(db): columns for prospect-report operator edits

Three separate ADD COLUMN migrations, not one: the runner's duplicate-column
recovery is only sound a statement at a time."
```

---

## Task 3: Reading and writing overrides

**Repo:** reddoor-maintenance.

**Files:**

- Modify: `src/db/prospect-audits.ts`
- Test: `tests/db/prospect-audit-overrides.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/prospect-audit-overrides.test.ts`, and add the imports it needs at the top of the file:

```ts
import {
  createProspectAudit,
  getProspectAuditByToken,
  setProspectAuditOverrides,
  touchProspectAuditOpened,
} from "../../src/db/prospect-audits.js";

async function seed() {
  process.env.TURSO_DATABASE_URL = ":memory:";
  const db = await openDb(readDbConfig());
  const { token } = await createProspectAudit(db, {
    url: "https://acme.test/",
    business: "Acme",
    resultJson: JSON.stringify({ url: "https://acme.test/" }),
  });
  return { db, token };
}

describe("setProspectAuditOverrides", () => {
  it("stores the map and stamps edited_at", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      "composed:headlineFinding": { original: "a", text: "b" },
    });
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual({
      "composed:headlineFinding": { original: "a", text: "b" },
    });
    expect(row!.edited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses a map that is not an object of {original,text} strings", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      bad: { original: 1, text: "b" } as unknown as { original: string; text: string },
    });
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("reports not-found for an absent token without writing", async () => {
    const { db } = await seed();
    const res = await setProspectAuditOverrides(db, "aB3-_xY9zQ1rS2tU4vW6xY", {});
    expect(res.status).toBe("not-found");
  });

  it("an empty map clears the overrides", async () => {
    const { db, token } = await seed();
    await setProspectAuditOverrides(db, token, { k: { original: "a", text: "b" } });
    await setProspectAuditOverrides(db, token, {});
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual({});
  });
});

describe("touchProspectAuditOpened", () => {
  it("stamps opened_at", async () => {
    const { db, token } = await seed();
    await touchProspectAuditOpened(db, token);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm vitest run tests/db/prospect-audit-overrides.test.ts
```

Expected: FAIL, `setProspectAuditOverrides is not a function`.

- [ ] **Step 3: Implement**

In `src/db/prospect-audits.ts`, extend `ProspectAuditRow`:

```ts
export type ProspectAuditRow = {
  id: string;
  url: string;
  business: string | null;
  created_at: string;
  status: string;
  result_json: string;
  overrides_json: string | null;
  edited_at: string | null;
  opened_at: string | null;
};
```

Add the three columns to the select in `getProspectAuditByToken`:

```ts
    .select([
      "id",
      "url",
      "business",
      "created_at",
      "status",
      "result_json",
      "overrides_json",
      "edited_at",
      "opened_at",
    ])
```

Add `edited_at` and `opened_at` to `ProspectAuditListItem` and to the select in `listRecentProspectAudits`:

```ts
export type ProspectAuditListItem = {
  id: string;
  token: string;
  url: string;
  business: string | null;
  status: string;
  created_at: string;
  edited_at: string | null;
  opened_at: string | null;
};
```

```ts
    .select([
      "id",
      "token",
      "url",
      "business",
      "status",
      "created_at",
      "edited_at",
      "opened_at",
    ])
```

Then append the two writers:

```ts
/** One replaced string and the generated text it replaced. */
export type Override = { original: string; text: string };
export type OverrideMap = Record<string, Override>;

export type SetOverridesResult =
  | { status: "updated"; token: string }
  | { status: "invalid"; token: string }
  | { status: "not-found"; token: string };

/**
 * Reject anything that is not a flat map of `{ original, text }` string pairs.
 *
 * This runs BEFORE the read, the same order `setReportCommentary` uses, so a
 * malformed body costs no round trip. It is also the only thing standing
 * between a hand-crafted POST and a stored value that would corrupt the JSON
 * route's response: that route concatenates `overrides_json` into a body
 * WITHOUT parsing it, so a non-JSON value stored here would break every
 * subsequent fetch of the report. Validate on the way in, once.
 */
function isOverrideMap(v: unknown): v is OverrideMap {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (e) =>
      e !== null &&
      typeof e === "object" &&
      !Array.isArray(e) &&
      typeof (e as Override).original === "string" &&
      typeof (e as Override).text === "string",
  );
}

/**
 * Replace one report's override map wholesale and stamp `edited_at`.
 *
 * Whole-map rather than per-key: the caller always holds the complete map, and
 * a partial write has no way to express a deletion. An empty map is legitimate
 * and clears every override — an editor that can set but not unset traps the
 * operator in the first thing they typed.
 *
 * `result_json` stays untouched. There is still no way to write it.
 */
export async function setProspectAuditOverrides(
  db: Db,
  token: string,
  overrides: OverrideMap,
): Promise<SetOverridesResult> {
  if (!isOverrideMap(overrides)) return { status: "invalid", token };

  const existing = await getProspectAuditByToken(db, token);
  if (!existing) return { status: "not-found", token };

  await db
    .updateTable("prospect_audits")
    .set({ overrides_json: JSON.stringify(overrides), edited_at: new Date().toISOString() })
    .where("token", "=", token)
    .execute();
  return { status: "updated", token };
}

/**
 * Record that a report was opened by someone who is not editing it.
 *
 * Best effort by contract: the caller must not let a failure here fail the
 * response. Knowing when a prospect last looked is useful; it is not worth
 * turning a read route into one that can 500.
 */
export async function touchProspectAuditOpened(db: Db, token: string): Promise<void> {
  await db
    .updateTable("prospect_audits")
    .set({ opened_at: new Date().toISOString() })
    .where("token", "=", token)
    .execute();
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm vitest run tests/db/prospect-audit-overrides.test.ts
```

Expected: PASS, six tests.

- [ ] **Step 5: Prove the validator actually rejects**

Mutation test. Temporarily change `isOverrideMap`'s final `every(...)` to `return true;`, re-run, and confirm the "refuses a map that is not an object" test REDS. Then restore it and confirm green again. A validator that has only ever passed is not a validator.

```bash
pnpm vitest run tests/db/prospect-audit-overrides.test.ts
```

- [ ] **Step 6: Run the whole suite**

```bash
pnpm vitest run
```

Expected: all green. `listRecentProspectAudits` gained two columns, so the cockpit adapter tests exercise the widened row.

- [ ] **Step 7: Commit**

```bash
git add src/db/prospect-audits.ts tests/db/prospect-audit-overrides.test.ts
git commit -m "feat(db): read and write prospect-report overrides

Validate on the way in: the JSON route concatenates overrides_json into its
response without parsing, so a malformed stored value would break every
later fetch of that report."
```

---

## Task 4: The JSON route serves report and overrides together

**Repo:** reddoor-maintenance. **Task 1 must be deployed first.**

**Files:**

- Modify: `netlify/functions/audit-report-json.mts`
- Test: `tests/dashboard/audit-report-json.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dashboard/audit-report-json.test.ts`, inside the existing describe or a new one, reusing the file's existing mocks and `ctxFor`:

```ts
describe("audit-report-json — overrides", () => {
  it("wraps the stored report and its overrides in one body", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: "Acme Roofing",
      resultJson: JSON.stringify({ url: "https://acme.example/", businessName: "Acme Roofing" }),
    });
    await setProspectAuditOverrides(db, token, {
      "composed:headlineFinding": { original: "a", text: "b" },
    });

    const res = await auditReportJson(req(), ctxFor(token));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.report).toEqual({ url: "https://acme.example/", businessName: "Acme Roofing" });
    expect(body.overrides).toEqual({ "composed:headlineFinding": { original: "a", text: "b" } });
    expect(body.editedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("serves overrides as null when the report has never been edited", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    const body = await (await auditReportJson(req(), ctxFor(token))).json();
    expect(body.overrides).toBeNull();
    expect(body.editedAt).toBeNull();
  });

  it("never caches: an edit must not wait out a max-age", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    const res = await auditReportJson(req(), ctxFor(token));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("stamps opened_at on a plain fetch", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    await auditReportJson(req(), ctxFor(token));
    const row = await getProspectAuditByToken(db, token);
    expect(row!.opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does NOT stamp opened_at when the caller declares an edit session", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://acme.example/",
      business: null,
      resultJson: JSON.stringify({ url: "https://acme.example/" }),
    });

    const editing = new Request("https://ops.reddoor.test/api/audit-report/x", {
      method: "GET",
      headers: { "x-reddoor-edit-session": "1" },
    });
    await auditReportJson(editing, ctxFor(token));
    const row = await getProspectAuditByToken(db, token);
    expect(row!.opened_at).toBeNull();
  });
});
```

Add to the file's imports:

```ts
import {
  createProspectAudit,
  getProspectAuditByToken,
  setProspectAuditOverrides,
} from "../../src/db/prospect-audits.js";
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run tests/dashboard/audit-report-json.test.ts
```

Expected: FAIL. `body.report` is undefined because the route still returns the bare stored string.

- [ ] **Step 3: Implement**

In `netlify/functions/audit-report-json.mts`, replace the `return new Response(row.result_json, ...)` block:

```ts
// Wrapped WITHOUT parsing. The reasoning that used to justify passing
// `result_json` through untouched still holds: parsing and re-serialising
// adds a failure mode between the database and the consumer for no gain.
// So the wrapper is built by concatenation and the stored report is never
// deserialised here. `overrides_json` is validated on the way IN
// (`setProspectAuditOverrides`), which is what makes this safe.
//
// The website accepts both this shape and a bare report, so the two repos
// can deploy in either order without a broken window.
const body =
  `{"report":${row.result_json},` +
  `"overrides":${row.overrides_json ?? "null"},` +
  `"editedAt":${JSON.stringify(row.edited_at)},` +
  `"openedAt":${JSON.stringify(row.opened_at)}}`;

// Best effort, and deliberately not awaited into the failure path: knowing
// when a prospect last opened the report is useful, but not worth turning a
// read route into one that can 500. An edit session says so in a header and
// is skipped, so the operator's own previews do not drown the signal.
if (req.headers.get("x-reddoor-edit-session") !== "1") {
  try {
    await touchProspectAuditOpened(db, token);
  } catch (err) {
    console.error("[audit-report-json] could not stamp opened_at", err);
  }
}

return new Response(body, {
  status: 200,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "x-robots-tag": "noindex",
    // `private`, never `public`: the document names one business and
    // enumerates its weaknesses. A CDN or corporate proxy on the path must
    // not retain a copy. `no-store` rather than the old max-age=300,
    // because an operator edit that takes five minutes to appear reads as
    // a save that did not work.
    "cache-control": "private, no-store",
  },
});
```

Add `touchProspectAuditOpened` to the import from `../../src/db/prospect-audits.js`.

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm vitest run tests/dashboard/audit-report-json.test.ts
```

Expected: PASS, including the tests already in the file.

- [ ] **Step 5: Prove the edit-session skip actually skips**

Mutation test. Change the guard to `if (true)`, re-run, and confirm the "does NOT stamp opened_at" test REDS. Restore and confirm green. Written this way round because that test passes on first write, which proves nothing.

- [ ] **Step 6: Run the full suite, lint and build**

```bash
pnpm vitest run && pnpm lint && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/audit-report-json.mts tests/dashboard/audit-report-json.test.ts
git commit -m "feat(api): serve a report with its operator overrides

Built by concatenation so result_json is still never parsed here. Cache
drops to no-store: an edit that takes five minutes to show reads as a save
that failed."
```

---

## Task 5: The save endpoint

**Repo:** reddoor-maintenance.

**Files:**

- Create: `netlify/functions/audit-report-overrides.mts`
- Test: `tests/dashboard/audit-report-overrides.test.ts`

The website proxies operator saves here. Authentication is a shared token, not an operator session: the caller is the marketing site's server, which has already checked the edit cookie. There is no operator session to inspect on a server-to-server call, exactly as the read route notes.

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard/audit-report-overrides.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

vi.mock("../../src/reports/airtable/client.js", () => ({ openBase: vi.fn(() => ({}) as unknown) }));

let sharedDb: Awaited<ReturnType<typeof import("../../src/db/client.js").openDb>> | null = null;
vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  return {
    ...actual,
    openDb: vi.fn(async (cfg: Parameters<typeof actual.openDb>[0]) => {
      sharedDb ??= await actual.openDb(cfg);
      return sharedDb;
    }),
  };
});

import { openDb, readDbConfig } from "../../src/db/client.js";
import { createProspectAudit, getProspectAuditByToken } from "../../src/db/prospect-audits.js";
import saveOverrides from "../../netlify/functions/audit-report-overrides.mjs";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

const ctxFor = (token: string) => ({ params: { token } }) as unknown as Context;

function post(body: unknown, token?: string): Request {
  return new Request("https://ops.reddoor.test/api/audit-report/x/overrides", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function seed() {
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.PROSPECT_EDIT_TOKEN = "s3cret";
  const db = await openDb(readDbConfig());
  const { token } = await createProspectAudit(db, {
    url: "https://acme.test/",
    business: "Acme",
    resultJson: JSON.stringify({ url: "https://acme.test/" }),
  });
  return { db, token };
}

const MAP = { "composed:headlineFinding": { original: "a", text: "b" } };

describe("audit-report-overrides", () => {
  it("stores the map for a correct token", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor(token));
    expect(res.status).toBe(200);
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual(MAP);
  });

  it("fails closed when PROSPECT_EDIT_TOKEN is unset", async () => {
    const { db, token } = await seed();
    delete process.env.PROSPECT_EDIT_TOKEN;
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor(token));
    expect(res.status).toBe(503);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses a wrong shared token, and says nothing about the report", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "wrong"), ctxFor(token));
    expect(res.status).toBe(404);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses a missing authorization header", async () => {
    const { token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }), ctxFor(token));
    expect(res.status).toBe(404);
  });

  it("rejects a malformed override map with 400", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(
      post({ overrides: { k: { original: 1, text: "b" } } }, "s3cret"),
      ctxFor(token),
    );
    expect(res.status).toBe(400);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses GET", async () => {
    const { token } = await seed();
    const res = await saveOverrides(
      new Request("https://ops.reddoor.test/x", { method: "GET" }),
      ctxFor(token),
    );
    expect(res.status).toBe(405);
  });

  it("404s a malformed report token", async () => {
    await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor("nope"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run tests/dashboard/audit-report-overrides.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `netlify/functions/audit-report-overrides.mts`:

```ts
import type { Context, Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  isValidToken,
  setProspectAuditOverrides,
  type OverrideMap,
} from "../../src/db/prospect-audits.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Where an operator's edits to one prospect report land.
//
// NOT operator-gated, and not CSRF-gated, because neither applies: the caller
// is the marketing site's SERVER, which has already checked the operator's edit
// cookie before forwarding. There is no browser session here to protect. What
// guards this route is a shared token, and it FAILS CLOSED — an unset
// PROSPECT_EDIT_TOKEN refuses everything rather than falling back to open.
//
// Note the asymmetry with the read route beside it: reading a report needs only
// the 128-bit URL token, because anyone holding the link is the intended
// audience. WRITING to somebody's report is not something a link should permit.
export const config: Config = {
  path: ["/api/audit-report/:token/overrides"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

/** Constant-time compare that does not leak length through an early return. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  const expected = process.env.PROSPECT_EDIT_TOKEN;
  if (!expected) {
    console.error("[audit-report-overrides] PROSPECT_EDIT_TOKEN not set — refusing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }

  const auth = req.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  // The same answer as a missing report. An authorised caller always arrives
  // with the token, so nobody legitimate sees this.
  if (!given || !tokenMatches(given, expected)) return json({ ok: false, error: "not-found" }, 404);

  const token = ctx.params?.token;
  if (!token || !isValidToken(token)) return json({ ok: false, error: "not-found" }, 404);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[audit-report-overrides] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad-json" }, 400);
  }

  const overrides = (body as { overrides?: unknown })?.overrides;

  try {
    const db = await openDb(readDbConfig());
    const res = await setProspectAuditOverrides(db, token, overrides as OverrideMap);
    if (res.status === "invalid") return json({ ok: false, error: "bad-overrides" }, 400);
    if (res.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    return json({ ok: true }, 200);
  } catch (err) {
    return handlerError("audit-report-overrides", err);
  }
};
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm vitest run tests/dashboard/audit-report-overrides.test.ts
```

Expected: PASS, seven tests.

- [ ] **Step 5: Prove the fail-closed branch is real**

Mutation test. Change `if (!expected)` to `if (false)`, re-run, and confirm the "fails closed" test REDS with a 404 or 200 instead of 503. Restore and confirm green.

- [ ] **Step 6: Full suite, lint, build**

```bash
pnpm vitest run && pnpm lint && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/audit-report-overrides.mts tests/dashboard/audit-report-overrides.test.ts
git commit -m "feat(api): endpoint to save operator overrides on a report

Shared-token gated and fails closed. Reading a report needs only the URL
token; writing to somebody's report is not something a link should permit."
```

---

## Task 6: The cockpit shows edited and opened

**Repo:** reddoor-maintenance.

**Files:**

- Modify: `src/dashboard/prospect-audits-render.ts` (the `auditRow` function, around line 163)
- Test: the existing prospect-audits render test in `tests/dashboard/`

- [ ] **Step 1: Find the test file and read `auditRow`**

```bash
ls tests/dashboard/ | grep -i prospect
sed -n '150,195p' src/dashboard/prospect-audits-render.ts
```

- [ ] **Step 2: Write the failing tests**

Append to the prospect-audits render test file, matching how it already builds a `ProspectAuditsPageModel`:

```ts
describe("prospect audits list — edit state", () => {
  const base = {
    id: "pa_1",
    token: "aB3-_xY9zQ1rS2tU4vW6xY",
    url: "https://acme.test/",
    business: "Acme",
    status: "complete",
    created_at: "2026-09-01T00:00:00.000Z",
  };

  it("says nothing about editing on an untouched report", () => {
    const html = renderProspectAuditsPageHtml({
      audits: [{ ...base, edited_at: null, opened_at: null }],
      now: new Date("2026-09-09T00:00:00.000Z"),
    });
    expect(html).not.toContain("Edited");
    expect(html).not.toContain("Opened");
  });

  it("shows when a report was edited and when it was last opened", () => {
    const html = renderProspectAuditsPageHtml({
      audits: [
        {
          ...base,
          edited_at: "2026-09-08T10:00:00.000Z",
          opened_at: "2026-09-09T09:00:00.000Z",
        },
      ],
      now: new Date("2026-09-09T12:00:00.000Z"),
    });
    expect(html).toContain("Edited");
    expect(html).toContain("Opened");
  });

  it("warns when a report was opened AFTER it was edited", () => {
    const html = renderProspectAuditsPageHtml({
      audits: [
        {
          ...base,
          edited_at: "2026-09-09T09:00:00.000Z",
          opened_at: "2026-09-09T11:00:00.000Z",
        },
      ],
      now: new Date("2026-09-09T12:00:00.000Z"),
    });
    expect(html).toContain("read since you edited");
  });
});
```

- [ ] **Step 3: Run and watch them fail**

```bash
pnpm vitest run tests/dashboard/
```

Expected: the second and third FAIL; the first passes trivially today, which is why it is not the interesting one.

- [ ] **Step 4: Implement**

In `src/dashboard/prospect-audits-render.ts`, add above `auditRow`:

```ts
/**
 * The edit state of one report, as a line the operator can act on.
 *
 * There is no lock on this feature: a report stays editable after the link goes
 * out (operator ruling, 2026-09-09). What replaces a lock is this — showing
 * whether the prospect has already read what you are about to change. "Opened
 * after edited" is the case worth flagging, because it is the one where a
 * further edit rewrites a document somebody has already formed a view on.
 */
function editState(a: ProspectAuditListItem): string {
  if (!a.edited_at && !a.opened_at) return "";
  const bits: string[] = [];
  if (a.edited_at) bits.push(`Edited ${escapeHtml(a.edited_at.slice(0, 10))}`);
  if (a.opened_at) bits.push(`Opened ${escapeHtml(a.opened_at.slice(0, 10))}`);
  const stale = a.edited_at && a.opened_at && a.opened_at > a.edited_at;
  if (stale) bits.push("read since you edited");
  return `<div class="edit-state">${bits.join(" · ")}</div>`;
}
```

Import `escapeHtml` from `../util/html.js` if the file does not already. Then call `editState(a)` inside `auditRow`'s returned markup, after the existing meta line, and add a style rule beside the others in `STYLES`:

```css
.edit-state {
  color: #666;
  font-size: 0.85rem;
  margin-top: 0.2rem;
}
```

- [ ] **Step 5: Run and watch them pass**

```bash
pnpm vitest run tests/dashboard/
```

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/prospect-audits-render.ts tests/dashboard/
git commit -m "feat(cockpit): show when a report was edited and last opened

There is no lock on report edits by design. This is what replaces one:
whether the prospect has already read what you are about to change."
```

---

## Task 7: The override mechanism

**Repo:** reddoor-website.

**Files:**

- Create: `src/lib/report/overrides.ts`
- Test: `src/lib/report/overrides.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/report/overrides.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyOverrides, composed, type OverrideMap } from "./overrides";

describe("composed", () => {
  const map: OverrideMap = {
    "composed:headlineFinding": { original: "Generated line.", text: "Edited line." },
  };

  it("returns the override when the original still matches", () => {
    expect(composed(map, "composed:headlineFinding", "Generated line.")).toBe("Edited line.");
  });

  it("returns the generated text when there is no override", () => {
    expect(composed(map, "composed:openingSummary", "Generated line.")).toBe("Generated line.");
  });

  it("WITHHOLDS an override whose original no longer matches", () => {
    expect(composed(map, "composed:headlineFinding", "Something else entirely.")).toBe(
      "Something else entirely.",
    );
  });

  it("passes an empty map through untouched", () => {
    expect(composed({}, "composed:headlineFinding", "Generated line.")).toBe("Generated line.");
  });
});

describe("applyOverrides", () => {
  const raw = {
    url: "https://acme.test/",
    siteChecks: {
      ok: true,
      data: [{ key: "dead-links", label: "Links that go nowhere", why: "Generated why." }],
    },
    analyze: { ok: true, data: { fixes: [{ title: "Fix one", why: "Because." }] } },
  };

  it("replaces a value addressed through a stage wrapper", () => {
    const out = applyOverrides(raw, {
      "siteChecks.data[0].why": { original: "Generated why.", text: "Edited why." },
    }) as typeof raw;
    expect(out.siteChecks.data[0].why).toBe("Edited why.");
  });

  it("replaces a nested array value", () => {
    const out = applyOverrides(raw, {
      "analyze.data.fixes[0].title": { original: "Fix one", text: "Fix one, reworded" },
    }) as typeof raw;
    expect(out.analyze.data.fixes[0].title).toBe("Fix one, reworded");
  });

  it("WITHHOLDS an override whose original no longer matches", () => {
    const out = applyOverrides(raw, {
      "siteChecks.data[0].why": { original: "Stale text.", text: "Edited why." },
    }) as typeof raw;
    expect(out.siteChecks.data[0].why).toBe("Generated why.");
  });

  it("ignores a path that does not resolve, rather than throwing", () => {
    expect(() =>
      applyOverrides(raw, { "nope.data[9].why": { original: "x", text: "y" } }),
    ).not.toThrow();
  });

  it("ignores composed: keys, which are not payload paths", () => {
    const out = applyOverrides(raw, {
      "composed:headlineFinding": { original: "a", text: "b" },
    }) as typeof raw;
    expect(out.siteChecks.data[0].why).toBe("Generated why.");
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(raw);
    applyOverrides(raw, {
      "siteChecks.data[0].why": { original: "Generated why.", text: "Edited why." },
    });
    expect(JSON.stringify(raw)).toBe(before);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd ~/Documents/GitHub/reddoor-website && pnpm vitest run src/lib/report/overrides.test.ts
```

Expected: FAIL, cannot resolve `./overrides`.

- [ ] **Step 3: Implement**

Create `src/lib/report/overrides.ts`:

```ts
import type { AuditReport, Override, OverrideMap } from "./fetch";

export type { Override, OverrideMap };

/**
 * Operator edits, applied to a generated report.
 *
 * Two families of key, because rendered copy comes from two places:
 *
 *  - a JSON path into the stored payload, e.g. `siteChecks.data[0].why`. Note
 *    the `.data`: every pipeline stage is a StageResult, so the payload nests
 *    one level deeper than the view components see.
 *  - `composed:<name>`, for sentences this repo writes from data and which do
 *    not exist in the payload at all — the opening summary, the headline
 *    finding, the health rows.
 *
 * WHY POSITIONAL PATHS ARE SAFE HERE. Normally `fixes[2].why` is a fragile key,
 * because a regeneration reorders the list. A stored audit never changes:
 * `result_json` is written once, and re-auditing a site mints a NEW token with
 * no overrides at all. So there is no drift for a key to survive.
 *
 * The `original` check below guards that reasoning rather than the data. It
 * should never fire. That is exactly why it is tested with a deliberate
 * mismatch — a guard that has only ever passed is not a guard.
 */

/** Split `a.b[0].c` into ["a","b",0,"c"]. Returns null for anything that is not
 *  a payload path, which is how `composed:` keys are skipped. */
function parsePath(key: string): (string | number)[] | null {
  if (key.startsWith("composed:")) return null;
  const parts: (string | number)[] = [];
  for (const seg of key.split(".")) {
    const m = /^([A-Za-z_$][\w$]*)((?:\[\d+\])*)$/.exec(seg);
    if (!m) return null;
    parts.push(m[1]!);
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) parts.push(Number(idx[1]));
  }
  return parts;
}

/**
 * Replace payload-resident strings named by the map.
 *
 * Returns a structurally-shared copy: only the objects along an overridden path
 * are cloned, so a report with no overrides costs one shallow clone. Never
 * mutates its input, because `toReportView` is a `$derived` and must stay pure.
 */
export function applyOverrides(raw: AuditReport, map: OverrideMap): AuditReport {
  const entries = Object.entries(map);
  if (entries.length === 0) return raw;

  let out: AuditReport = raw;
  let cloned = false;

  for (const [key, ov] of entries) {
    const path = parsePath(key);
    if (!path || path.length === 0) continue;

    // Walk first WITHOUT cloning, so a path that does not resolve, or an
    // override that is withheld, costs nothing and changes nothing.
    let probe: unknown = out;
    for (const seg of path) {
      if (probe === null || typeof probe !== "object") {
        probe = undefined;
        break;
      }
      probe = (probe as Record<string | number, unknown>)[seg];
    }
    if (typeof probe !== "string" || probe !== ov.original) continue;

    if (!cloned) {
      out = { ...out };
      cloned = true;
    }
    // Clone each container on the way down, then write the leaf.
    let node = out as Record<string | number, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i]!;
      const child = node[seg];
      node[seg] = Array.isArray(child) ? [...child] : { ...(child as object) };
      node = node[seg] as Record<string | number, unknown>;
    }
    node[path[path.length - 1]!] = ov.text;
  }

  return out;
}

/**
 * The override for one composed sentence, or the generated text.
 *
 * Called at the point a sentence is written rather than after, so the generated
 * value is available to compare against `original`.
 */
export function composed(map: OverrideMap, key: string, generated: string): string {
  const ov = map[key];
  if (!ov || ov.original !== generated) return generated;
  return ov.text;
}
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm vitest run src/lib/report/overrides.test.ts
```

Expected: PASS, eleven tests.

- [ ] **Step 5: Prove the stale-original guard, both halves**

Mutation test, and this is the one the spec calls out by name.

1. In `composed`, change `if (!ov || ov.original !== generated)` to `if (!ov)`. Re-run. Expected: "WITHHOLDS an override whose original no longer matches" REDS in the `composed` block.
2. Restore. In `applyOverrides`, change `if (typeof probe !== "string" || probe !== ov.original)` to `if (typeof probe !== "string")`. Re-run. Expected: the `applyOverrides` withholding test REDS.
3. Restore both and confirm all eleven green.

Verify each mutation actually landed with `grep -n` on the changed line before trusting the red.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report/overrides.ts src/lib/report/overrides.test.ts
git commit -m "feat(report): apply operator overrides to a generated report

Positional payload paths are safe because a stored audit never changes. The
original-text check guards that reasoning, and is mutation-tested because it
should never fire in production."
```

---

## Task 8: The view carries the map

**Repo:** reddoor-website.

**Files:**

- Modify: `src/lib/report/model.ts` (`ReportView` type, `toReportView`, `openingSummary`, `goalVerdict`)
- Modify: `src/routes/audit/[token]/+page.svelte`
- Modify: `src/routes/audit/[token]/print/+page.svelte`
- Modify: `src/routes/dev/audit-report/+page.svelte`
- Test: `src/lib/report/model.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/report/model.test.ts`:

```ts
describe("toReportView — overrides", () => {
  const raw = {
    url: "https://acme.test/",
    siteChecks: {
      ok: true,
      data: [
        {
          key: "dead-links",
          label: "Links that go nowhere",
          status: "fail",
          evidence: "3 of 40",
          why: "Generated why.",
          scope: "quick",
        },
      ],
    },
  };

  it("defaults to an empty map when no overrides are passed", () => {
    expect(toReportView(raw).overrides).toEqual({});
  });

  it("applies a payload override before the view is built", () => {
    const view = toReportView(raw, {
      "siteChecks.data[0].why": { original: "Generated why.", text: "Edited why." },
    });
    expect(view.siteChecks?.[0]?.why).toBe("Edited why.");
  });

  it("carries the map onto the view for the composed sentences", () => {
    const map = { "composed:headlineFinding": { original: "a", text: "b" } };
    expect(toReportView(raw, map).overrides).toEqual(map);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run src/lib/report/model.test.ts
```

Expected: FAIL, `view.overrides` is undefined.

- [ ] **Step 3: Implement**

In `src/lib/report/model.ts`, add the import:

```ts
import { applyOverrides, composed, type OverrideMap } from "./overrides";
```

Add to the `ReportView` type, at the end of its fields:

```ts
/** The operator's edits, carried on the view so every composed-sentence
 *  function already has them without a signature change. Payload-resident
 *  overrides are applied before the view is built and are NOT re-applied
 *  from here. Empty when the report has never been edited. */
overrides: OverrideMap;
```

Change the signature and first line of `toReportView`:

```ts
export function toReportView(raw: AuditReport, overrides: OverrideMap = {}): ReportView {
  const r = applyOverrides(raw, overrides) as Record<string, unknown>;
```

Add to the returned object, beside `narrative`:

```ts
    overrides,
```

Make `openingSummary` override-aware. It returns `string | null`, so guard the null:

```ts
export function openingSummary(view: ReportView): string | null {
  const generated = openingSummaryText(view);
  if (generated === null) return null;
  return composed(view.overrides, "composed:openingSummary", generated);
}
```

Rename the existing body to `function openingSummaryText(view: ReportView): string | null` and leave it otherwise untouched.

`goalVerdict(missing, judged)` takes no view, so it cannot consult the map. Leave it alone here; its output is consumed by `GoalFit.svelte`, which does have the view. Wrap at that call site in Task 9.

- [ ] **Step 4: Pass overrides through on all three pages**

`src/routes/audit/[token]/+page.svelte` and `print/+page.svelte`:

```svelte
  const view = $derived(toReportView(data.report, data.overrides));
```

`src/routes/dev/audit-report/+page.svelte` has no overrides to pass, so leave its call as it is; the parameter defaults to `{}`.

- [ ] **Step 5: Run and watch them pass**

```bash
pnpm vitest run src/lib/report/ && pnpm check
```

Expected: PASS, 0 svelte-check errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/report/model.ts src/lib/report/model.test.ts src/routes/audit/
git commit -m "feat(report): build the view with operator overrides applied

The map rides on ReportView, so the composed-sentence functions need no
signature change."
```

---

## Task 9: The composed sentences consult the map

**Repo:** reddoor-website.

**Files:**

- Modify: `src/lib/report/narrative.ts` (`headlineFinding`, `passes`, `collisionFix`, `healthFixes`)
- Modify: `src/lib/report/health.ts` (`healthRows`)
- Test: `src/lib/report/narrative.test.ts`, `src/lib/report/health.test.ts` if present

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/report/narrative.test.ts`, reusing whatever view fixture that file already builds:

```ts
describe("composed sentences honour operator overrides", () => {
  it("overrides the headline finding", () => {
    const view = { ...someView, overrides: {} } as ReportView;
    const generated = headlineFinding(view).text;
    const edited = headlineFinding({
      ...view,
      overrides: { "composed:headlineFinding": { original: generated, text: "Reworded." } },
    });
    expect(edited.text).toBe("Reworded.");
    expect(edited.kind).toBe(headlineFinding(view).kind);
  });

  it("withholds a headline override whose original is stale", () => {
    const view = { ...someView, overrides: {} } as ReportView;
    const generated = headlineFinding(view).text;
    const edited = headlineFinding({
      ...view,
      overrides: { "composed:headlineFinding": { original: "not what we say", text: "Reworded." } },
    });
    expect(edited.text).toBe(generated);
  });

  it("overrides a pass-group title by index", () => {
    const view = { ...someView, overrides: {} } as ReportView;
    const groups = passes(view);
    if (groups.length === 0) return;
    const edited = passes({
      ...view,
      overrides: {
        "composed:passes[0].title": { original: groups[0]!.title, text: "Reworded group" },
      },
    });
    expect(edited[0]!.title).toBe("Reworded group");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run src/lib/report/narrative.test.ts
```

Expected: FAIL, the edited text still equals the generated text.

- [ ] **Step 3: Implement**

In `src/lib/report/narrative.ts`, import the helper:

```ts
import { composed } from "./overrides";
```

`headlineFinding` returns `{ kind, text }`. Rename its existing body to `headlineFindingGenerated` and wrap:

```ts
export function headlineFinding(view: ReportView): Headline {
  const h = headlineFindingGenerated(view);
  return { ...h, text: composed(view.overrides, "composed:headlineFinding", h.text) };
}
```

The `kind` is deliberately NOT overridable: it drives which branch of the report renders, not what it says. An operator rewording the sentence must not silently move the reader into a different section.

`passes` returns `PassGroup[]` of `{ title, items }`. Wrap its return:

```ts
export function passes(view: ReportView): PassGroup[] {
  return passesGenerated(view).map((g, i) => ({
    title: composed(view.overrides, `composed:passes[${i}].title`, g.title),
    items: g.items.map((item, j) =>
      composed(view.overrides, `composed:passes[${i}].items[${j}]`, item),
    ),
  }));
}
```

Rename the existing body to `passesGenerated`.

`collisionFix` returns `Fix | null`. Wrap:

```ts
export function collisionFix(view: ReportView): Fix | null {
  const f = collisionFixGenerated(view);
  if (!f) return null;
  return {
    ...f,
    title: composed(view.overrides, "composed:collisionFix.title", f.title),
    why: composed(view.overrides, "composed:collisionFix.why", f.why),
  };
}
```

`healthFixes` returns `Fix[]` built from the `HEALTH_FIXES` table. Wrap, keyed by the table entry's own key rather than by index, since that table is a fixed set:

```ts
export function healthFixes(view: ReportView): Fix[] {
  return healthFixesGenerated(view).map((f, i) => ({
    ...f,
    title: composed(view.overrides, `composed:healthFix[${i}].title`, f.title),
    why: composed(view.overrides, `composed:healthFix[${i}].why`, f.why),
  }));
}
```

In `src/lib/report/health.ts`, import `composed` and wrap `healthRows`, keyed by each row's own `key`, which is stable:

```ts
export function healthRows(view: ReportView): HealthRow[] {
  return healthRowsGenerated(view).map((r) => ({
    ...r,
    label: composed(view.overrides, `composed:health[${r.key}].label`, r.label),
    value: composed(view.overrides, `composed:health[${r.key}].value`, r.value),
    detail: composed(view.overrides, `composed:health[${r.key}].detail`, r.detail),
  }));
}
```

Rename each existing body to the `...Generated` name used above.

- [ ] **Step 4: Wrap the goal verdict at its call site**

In `src/lib/report/GoalFit.svelte`, find where `goalVerdict(...)` is rendered and wrap it:

```svelte
  import { composed } from "$lib/report/overrides";
  const verdict = $derived(
    composed(view.overrides, "composed:goalVerdict", goalVerdict(missing, judged)),
  );
```

Render `{verdict}` where `goalVerdict(...)` was rendered before.

- [ ] **Step 5: Run and watch them pass**

```bash
pnpm vitest run src/lib/report/ && pnpm check
```

- [ ] **Step 6: Prove one of them is real**

Mutation test. In `headlineFinding`, drop the `composed(...)` wrap and return `h` unchanged. Re-run and confirm "overrides the headline finding" REDS. Restore, confirm green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/report/narrative.ts src/lib/report/health.ts src/lib/report/GoalFit.svelte src/lib/report/narrative.test.ts
git commit -m "feat(report): composed sentences honour operator overrides

The headline's `kind` stays fixed: rewording a sentence must not move the
reader into a different section of the report."
```

---

## Task 10: Report and print cannot drift

**Repo:** reddoor-website.

**Files:**

- Test: `src/lib/report/report-copy.test.ts`

The PDF leave-behind is a headless capture of the print page, so if print ignores an override the emailed artefact silently disagrees with the web report.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/report/report-copy.test.ts`:

```ts
describe("print inherits every override the report applies", () => {
  const PRINT = "src/routes/audit/[token]/print/+page.svelte";
  const PAGE = "src/routes/audit/[token]/+page.svelte";

  it("both pages build the view with the overrides from load", () => {
    expect(code(PAGE)).toMatch(/toReportView\(\s*data\.report\s*,\s*data\.overrides\s*\)/);
    expect(code(PRINT)).toMatch(/toReportView\(\s*data\.report\s*,\s*data\.overrides\s*\)/);
  });
});
```

`code()` is the helper this file already uses to read a source file.

- [ ] **Step 2: Run and watch it fail, then pass**

```bash
pnpm vitest run src/lib/report/report-copy.test.ts
```

If Task 8 is already done this passes on first write, which proves nothing. Mutation-test it: remove `, data.overrides` from the print page, confirm RED, restore, confirm GREEN.

- [ ] **Step 3: Full gates**

```bash
pnpm vitest run && pnpm check && pnpm lint
```

- [ ] **Step 4: End-to-end proof against a real report**

Deploy the branch preview, then with a real audit token:

```bash
curl -s -X POST "$PROSPECT_REPORT_URL/api/audit-report/$TOKEN/overrides" \
  -H "authorization: Bearer $PROSPECT_EDIT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"overrides":{"composed:headlineFinding":{"original":"<the exact generated line>","text":"An edited headline."}}}'
```

Load the preview's `/audit/$TOKEN` and confirm the headline changed. Load `/audit/$TOKEN/print` and confirm it changed there too. Then clear it:

```bash
curl -s -X POST "$PROSPECT_REPORT_URL/api/audit-report/$TOKEN/overrides" \
  -H "authorization: Bearer $PROSPECT_EDIT_TOKEN" \
  -H "content-type: application/json" -d '{"overrides":{}}'
```

**Get the `original` by reading the rendered page, not by guessing.** An override whose original does not match is withheld by design, and a withheld override looks exactly like a feature that does not work.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/report-copy.test.ts
git commit -m "test(report): print must build its view with overrides too

The PDF is a capture of the print page, so a print that ignores an override
puts a different document in the prospect's inbox than on their screen."
```

---

## Self-review notes

**Spec coverage.** Storage (Task 2), read/write (Task 3), wrapped serving without parsing and the cache change (Task 4), the save endpoint failing closed (Task 5), cockpit timestamps (Task 6), the override mechanism and the stale-original guard (Task 7), application in the model layer (Tasks 8 and 9), print parity (Task 10). The spec's "deploy order: website first" is Task 1 and is restated at Task 4.

**Deferred to plan B, by design:** the edit route and its key-to-cookie exchange, the click-to-edit affordance, and the website's save proxy. Those are the spec's section 4 and 5. Until plan B lands, overrides are written by `curl` against the endpoint from Task 5, which is exactly what Task 10 step 4 does.

**Not in either plan, and not in the spec:** versioning, editing the copy shared across all reports, and Prismic.
