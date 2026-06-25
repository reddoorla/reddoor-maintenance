# Fleet Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record fleet self-maintenance as an idempotent libSQL event log and surface it as a collapsed "🔧 Recently" lane on the cockpit, so the operator can see what the fleet did for them.

**Architecture:** A new `fleet_events` libSQL table (migration `0002`), written by the existing nightly producers (security/lighthouse/github-signals sweeps + the launch-send path) via pure event **detectors** + a fail-safe best-effort **writer**, and read by the cockpit handler into a new `model.recent` lane. Detection is pure and table-tested; the db side-effect lives at the CLI/handler boundary. The feed ships **dark** until the Turso creds are added to the three workflows.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), libSQL/Turso via Kysely, vitest, Netlify Functions (`.mts`), GitHub Actions YAML.

---

## Design refinements vs the spec

The spec ([2026-06-25-fleet-activity-feed-design.md](../specs/2026-06-25-fleet-activity-feed-design.md)) is accurate on intent; these are the concrete code-reality adjustments this plan locks in:

1. **Detectors do not live in `security-airtable.ts` / `domain-airtable.ts`** — those are pure _extractors_ with no access to prior values. The read-before-write context (old vs new) exists in `writeAuditsToAirtable` (the `target` WebsiteRow is loaded _before_ the write) and in the `github-signals` command loop (`byRepo` holds the old row). So detection goes in a new pure module `src/audits/fleet-event-detectors.ts`, consumed at those two write sites + the launch-send path.
2. **`cert_renewed` excludes a null prior.** A null `certDaysRemaining` means "never measured / unresolved", not "expiring". Firing "renewed" on a first measurement is a false reassurance. Fire only on an observed `prev < 30 → new > 60` transition. (`vuln_cleared` is already symmetric: `?? 0` makes a never-audited site read 0, so it only fires on observed `>0 → 0`.)
3. **Events are recorded at the CLI/handler boundary**, not inside the pure writers, via `recordFleetEventsBestEffort` — which opens its own libSQL connection and swallows all errors (missing creds included). The pure writers/detectors stay db-free and unit-testable.
4. **`fleet-lighthouse.yml` needs Turso on TWO steps**: the audit step (for `cert_renewed`) and the `github-signals` step (for `pr_automerged` / `ci_recovered`).
5. **A lighthouse-miss throw in `writeAuditsToAirtable` discards that site's events** (it returns via `throw`, collected as `failed`). This only affects the rare miss+transition-on-the-same-run combo for `cert_renewed`; `vuln_cleared` comes from the `--only security` sweep which has no lighthouse leg, so it is never affected. Accepted.

## File structure

- `src/db/migrations.ts` — **modify**: append `0002_fleet_events`.
- `src/db/schema.ts` — **modify**: add `FleetEventsTable` + `Database.fleet_events`.
- `src/db/fleet-events.ts` — **create**: `FleetEvent`/`FleetEventType` types + `recordFleetEvent`, `listFleetEvents`, `pruneFleetEvents` (db-injected, pure I/O).
- `src/audits/fleet-event-detectors.ts` — **create**: pure `cleanRenovateTitle`, `detectAuditEvents`, `detectSignalEvents`, `fleetSweptEvent`.
- `src/audits/fleet-events-writer.ts` — **create**: `recordFleetEventsBestEffort` (boundary; injectable opener; fail-safe).
- `src/github/gh.ts` — **modify**: add `mergedRenovatePullRequests` to the `GitHub` type + impl.
- `src/audits/write-audits-to-airtable.ts` — **modify**: `WriteSummary.events?` + compute via `detectAuditEvents`.
- `src/cli/commands/audit.ts` — **modify**: record audit events + `fleet_swept` after the fleet write-back.
- `src/cli/commands/github-signals.ts` — **modify**: record `pr_automerged`/`ci_recovered` + `fleet_swept`.
- `src/reports/send/orchestrate.ts` — **modify**: record `site_launched` after the launch flip.
- `src/dashboard/fleet-cockpit.ts` — **modify**: `RecentEntry` type, `recentEvents` param, `model.recent` mapping.
- `src/dashboard/fleet-render.ts` — **modify**: `renderRecentlyLane` + wire into `renderCockpitHtml`.
- `netlify/functions/fleet-homepage.mts` — **modify**: fetch + pass `recentEvents`.
- `.github/workflows/{fleet-security,fleet-lighthouse,daily-reports}.yml` — **modify**: add Turso env.
- `.changeset/<name>.md` — **create**: one `minor`.

Tests (one file per new unit):

- `tests/db/fleet-events-migration.test.ts`, `tests/db/fleet-events.test.ts`
- `tests/audits/fleet-event-detectors.test.ts`
- `tests/audits/fleet-events-writer.test.ts`
- `tests/github/merged-renovate-prs.test.ts`
- `tests/audits/write-audits-events.test.ts`
- `tests/dashboard/cockpit-recent.test.ts`, `tests/dashboard/recently-lane.test.ts`

---

## Task 1: Schema + migration `0002_fleet_events`

**Files:**

- Modify: `src/db/migrations.ts`
- Modify: `src/db/schema.ts`
- Test: `tests/db/fleet-events-migration.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/db/fleet-events-migration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";

describe("0002_fleet_events migration", () => {
  it("creates the fleet_events table with all columns and round-trips a row", async () => {
    const db = await openDb({ url: ":memory:" });
    await db
      .insertInto("fleet_events")
      .values({
        id: "fleet_swept:security:2026-06-25",
        ts: "2026-06-25T07:00:00.000Z",
        type: "fleet_swept",
        site_id: null,
        site_name: null,
        summary: "security-swept 11 sites",
        data: JSON.stringify({ sweep: "security", count: 11 }),
        created_at: "2026-06-25T07:00:01.000Z",
      })
      .execute();

    const rows = await db.selectFrom("fleet_events").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("fleet_swept:security:2026-06-25");
    expect(rows[0]!.site_id).toBeNull();
    expect(rows[0]!.summary).toBe("security-swept 11 sites");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/db/fleet-events-migration.test.ts`
Expected: FAIL — TypeScript error `'fleet_events' is not assignable` (no such table on `Database`) / runtime `no such table: fleet_events`.

- [ ] **Step 3: Add the migration**

In `src/db/migrations.ts`, append a second entry to the `MIGRATIONS` array (after the `0001_init` object, inside the array):

```ts
  {
    id: "0002_fleet_events",
    sql: `
      CREATE TABLE IF NOT EXISTS fleet_events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        site_id TEXT,
        site_name TEXT,
        summary TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_events_ts ON fleet_events (ts);
    `,
  },
```

- [ ] **Step 4: Add the schema type**

In `src/db/schema.ts`, add the interface (after `SpamScreenoutsTable`) and the `Database` member:

```ts
export interface FleetEventsTable {
  id: string;
  ts: string;
  type: string;
  site_id: string | null;
  site_name: string | null;
  summary: string;
  data: string | null;
  created_at: string;
}
```

Then add to the `Database` interface:

```ts
export interface Database {
  submissions: SubmissionsTable;
  spam_screenouts: SpamScreenoutsTable;
  fleet_events: FleetEventsTable;
  _migrations: MigrationsTable;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/db/fleet-events-migration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations.ts src/db/schema.ts tests/db/fleet-events-migration.test.ts
git commit -m "feat(db): fleet_events table + 0002 migration"
```

---

## Task 2: `fleet-events.ts` DB helpers

**Files:**

- Create: `src/db/fleet-events.ts`
- Test: `tests/db/fleet-events.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/db/fleet-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  recordFleetEvent,
  listFleetEvents,
  pruneFleetEvents,
  type FleetEvent,
} from "../../src/db/fleet-events.js";

function ev(over: Partial<FleetEvent> & { id: string; ts: string }): FleetEvent {
  return {
    type: "pr_automerged",
    siteId: "recSITE",
    siteName: "Caltex",
    summary: "auto-merged vite→7.3.5",
    data: { url: "https://example.test/pr/1", repo: "reddoorla/caltex", number: 1 },
    ...over,
  };
}

describe("fleet-events db helpers", () => {
  it("records, lists newest-first, and round-trips JSON data", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "a", ts: "2026-06-20T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "b", ts: "2026-06-22T00:00:00.000Z" }));

    const rows = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]); // newest first
    expect(rows[0]!.data).toEqual({
      url: "https://example.test/pr/1",
      repo: "reddoorla/caltex",
      number: 1,
    });
  });

  it("is idempotent on the deterministic id (INSERT OR IGNORE)", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "dup", ts: "2026-06-22T00:00:00.000Z", summary: "first" }));
    await recordFleetEvent(
      db,
      ev({ id: "dup", ts: "2026-06-22T00:00:00.000Z", summary: "second" }),
    );
    const rows = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe("first"); // the first write wins; the second is ignored
  });

  it("filters by sinceIso and respects limit", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "old", ts: "2026-05-01T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "new1", ts: "2026-06-22T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "new2", ts: "2026-06-23T00:00:00.000Z" }));

    const since = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(since.map((r) => r.id)).toEqual(["new2", "new1"]); // "old" excluded

    const limited = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 1 });
    expect(limited.map((r) => r.id)).toEqual(["new2"]);
  });

  it("prunes events strictly before the cutoff", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "old", ts: "2026-05-01T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "keep", ts: "2026-06-22T00:00:00.000Z" }));
    await pruneFleetEvents(db, "2026-06-01T00:00:00.000Z");
    const rows = await listFleetEvents(db, { sinceIso: "2026-01-01T00:00:00.000Z", limit: 10 });
    expect(rows.map((r) => r.id)).toEqual(["keep"]);
  });

  it("handles null data and null site fields", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, {
      id: "fleet_swept:security:2026-06-25",
      ts: "2026-06-25T07:00:00.000Z",
      type: "fleet_swept",
      siteId: null,
      siteName: null,
      summary: "security-swept 11 sites",
      data: null,
    });
    const rows = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(rows[0]!.siteId).toBeNull();
    expect(rows[0]!.data).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/db/fleet-events.test.ts`
Expected: FAIL — cannot find module `../../src/db/fleet-events.js`.

- [ ] **Step 3: Implement `src/db/fleet-events.ts`**

```ts
import type { Selectable } from "kysely";
import type { Db } from "./client.js";
import type { FleetEventsTable } from "./schema.js";

export type FleetEventType =
  | "pr_automerged"
  | "vuln_cleared"
  | "ci_recovered"
  | "site_launched"
  | "fleet_swept"
  | "cert_renewed";

/** One recorded fleet activity event. `id` is deterministic (see the detectors)
 *  so re-runs INSERT OR IGNORE without duplicating. `siteId`/`siteName` are null
 *  for fleet-wide rollups; `data` is optional structured detail (e.g. the PR url). */
export type FleetEvent = {
  id: string;
  ts: string;
  type: FleetEventType;
  siteId: string | null;
  siteName: string | null;
  summary: string;
  data: unknown | null;
};

/** Tolerant JSON parse for the stored `data` column — a malformed value (should
 *  never happen, we wrote it) degrades to null rather than throwing the read. */
function parseData(raw: string | null): unknown | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToEvent(r: Selectable<FleetEventsTable>): FleetEvent {
  return {
    id: r.id,
    ts: r.ts,
    type: r.type as FleetEventType,
    siteId: r.site_id,
    siteName: r.site_name,
    summary: r.summary,
    data: parseData(r.data),
  };
}

/** Idempotent append: INSERT OR IGNORE on the deterministic primary key, so an
 *  overlapping/re-run sweep never duplicates an event. The first write wins. */
export async function recordFleetEvent(db: Db, e: FleetEvent): Promise<void> {
  await db
    .insertInto("fleet_events")
    .values({
      id: e.id,
      ts: e.ts,
      type: e.type,
      site_id: e.siteId,
      site_name: e.siteName,
      summary: e.summary,
      data: e.data == null ? null : JSON.stringify(e.data),
      created_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

/** Recent events at/after `sinceIso`, newest-first, capped at `limit`. */
export async function listFleetEvents(
  db: Db,
  opts: { sinceIso: string; limit: number },
): Promise<FleetEvent[]> {
  const rows = await db
    .selectFrom("fleet_events")
    .selectAll()
    .where("ts", ">=", opts.sinceIso)
    .orderBy("ts", "desc")
    .limit(opts.limit)
    .execute();
  return rows.map(rowToEvent);
}

/** Retention prune: delete events strictly older than `beforeIso`. */
export async function pruneFleetEvents(db: Db, beforeIso: string): Promise<void> {
  await db.deleteFrom("fleet_events").where("ts", "<", beforeIso).execute();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/db/fleet-events.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/fleet-events.ts tests/db/fleet-events.test.ts
git commit -m "feat(db): recordFleetEvent / listFleetEvents / pruneFleetEvents"
```

---

## Task 3: Pure event detectors

**Files:**

- Create: `src/audits/fleet-event-detectors.ts`
- Test: `tests/audits/fleet-event-detectors.test.ts`

Context types this task consumes (already defined elsewhere — do not redefine):

- `WebsiteRow` from `../reports/airtable/websites.js` — fields used: `id`, `name`, `securityVulnsCritical: number | null`, `securityVulnsHigh: number | null`, `certDaysRemaining: number | null`, `defaultBranchCi: string | null`.
- `SecurityCounts` = `{ critical: number; high: number; moderate: number; low: number }` and `DomainResult` = `{ certDaysRemaining: number | null; checkedAt: string }` from `../reports/airtable/websites.js`.
- `GitHubSignalsRow` from `./github-signals.js` — fields used: `repo: string`, `ciState: CiState`.
- `FleetEvent`/`FleetEventType` from `../db/fleet-events.js`.

- [ ] **Step 1: Write the failing test**

`tests/audits/fleet-event-detectors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import {
  cleanRenovateTitle,
  detectAuditEvents,
  detectSignalEvents,
  fleetSweptEvent,
} from "../../src/audits/fleet-event-detectors.js";

const AT = "2026-06-25T07:00:00.000Z";

// Minimal WebsiteRow factory — only the fields the detectors read matter.
function site(over: Partial<WebsiteRow>): WebsiteRow {
  return {
    id: "recSITE",
    name: "Caltex",
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    certDaysRemaining: null,
    defaultBranchCi: null,
  } as WebsiteRow & typeof over;
}

describe("cleanRenovateTitle", () => {
  it("strips the conventional-commit + update-dependency prefix and arrows the version", () => {
    expect(cleanRenovateTitle("chore(deps): update dependency vite to v7.3.5 [security]")).toBe(
      "vite→7.3.5 [security]",
    );
    expect(cleanRenovateTitle("fix(deps): update dependency @sveltejs/kit to v2.68.0")).toBe(
      "@sveltejs/kit→2.68.0",
    );
  });
  it("leaves a grouped/no-version title readable", () => {
    expect(cleanRenovateTitle("chore(deps): update all non-major dependencies")).toBe(
      "all non-major dependencies",
    );
  });
});

describe("detectAuditEvents — vuln_cleared", () => {
  it("fires on >0 → 0 (critical+high)", () => {
    const events = detectAuditEvents(
      site({ securityVulnsCritical: 1, securityVulnsHigh: 2 }),
      { security: { critical: 0, high: 0, moderate: 3, low: 4 } },
      AT,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("vuln_cleared");
    expect(events[0]!.id).toBe("vuln_cleared:recSITE:2026-06-25");
    expect(events[0]!.summary).toContain("3"); // 1 critical + 2 high
  });
  it("does NOT fire on 5 → 2 (still vulnerable)", () => {
    const events = detectAuditEvents(
      site({ securityVulnsCritical: 2, securityVulnsHigh: 3 }),
      { security: { critical: 1, high: 1, moderate: 0, low: 0 } },
      AT,
    );
    expect(events).toHaveLength(0);
  });
  it("does NOT fire on 0 → 0 or never-audited (null) → 0", () => {
    expect(
      detectAuditEvents(
        site({ securityVulnsCritical: 0, securityVulnsHigh: 0 }),
        { security: { critical: 0, high: 0, moderate: 0, low: 0 } },
        AT,
      ),
    ).toHaveLength(0);
    expect(
      detectAuditEvents(site({}), { security: { critical: 0, high: 0, moderate: 0, low: 0 } }, AT),
    ).toHaveLength(0);
  });
});

describe("detectAuditEvents — cert_renewed", () => {
  it("fires on <30 → >60", () => {
    const events = detectAuditEvents(
      site({ certDaysRemaining: 12 }),
      { domain: { certDaysRemaining: 89, checkedAt: AT } },
      AT,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("cert_renewed");
    expect(events[0]!.id).toBe("cert_renewed:recSITE:2026-06-25");
  });
  it("does NOT fire on healthy → healthy (80 → 90)", () => {
    expect(
      detectAuditEvents(
        site({ certDaysRemaining: 80 }),
        { domain: { certDaysRemaining: 90, checkedAt: AT } },
        AT,
      ),
    ).toHaveLength(0);
  });
  it("does NOT fire on a null prior (first measurement, not a renewal)", () => {
    expect(
      detectAuditEvents(site({}), { domain: { certDaysRemaining: 89, checkedAt: AT } }, AT),
    ).toHaveLength(0);
  });
});

describe("detectSignalEvents", () => {
  const row = { repo: "reddoorla/caltex", ciState: "passing" as const };

  it("emits one pr_automerged per merged PR with a deterministic id", () => {
    const events = detectSignalEvents(
      site({ defaultBranchCi: "passing" }),
      { ...row },
      [
        {
          number: 14,
          title: "chore(deps): update dependency vite to v7.3.5 [security]",
          url: "https://github.com/reddoorla/caltex/pull/14",
          mergedAt: "2026-06-24T09:00:00.000Z",
        },
      ],
      AT,
    );
    const pr = events.find((e) => e.type === "pr_automerged")!;
    expect(pr.id).toBe("pr_automerged:reddoorla/caltex#14");
    expect(pr.ts).toBe("2026-06-24T09:00:00.000Z");
    expect(pr.summary).toBe("auto-merged vite→7.3.5 [security]");
    expect(pr.data).toEqual({
      url: "https://github.com/reddoorla/caltex/pull/14",
      repo: "reddoorla/caltex",
      number: 14,
    });
  });

  it("emits ci_recovered only on failing → passing", () => {
    const recovered = detectSignalEvents(site({ defaultBranchCi: "failing" }), { ...row }, [], AT);
    expect(recovered.some((e) => e.type === "ci_recovered")).toBe(true);
    const stayedGreen = detectSignalEvents(
      site({ defaultBranchCi: "passing" }),
      { ...row },
      [],
      AT,
    );
    expect(stayedGreen.some((e) => e.type === "ci_recovered")).toBe(false);
  });
});

describe("fleetSweptEvent", () => {
  it("builds a per-day rollup id and a human summary", () => {
    const e = fleetSweptEvent("security", 11, AT);
    expect(e.id).toBe("fleet_swept:security:2026-06-25");
    expect(e.type).toBe("fleet_swept");
    expect(e.siteId).toBeNull();
    expect(e.summary).toBe("security-swept 11 sites");
    expect(fleetSweptEvent("lighthouse", 1, AT).summary).toBe("re-audited 1 site");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/audits/fleet-event-detectors.test.ts`
Expected: FAIL — cannot find module `../../src/audits/fleet-event-detectors.js`.

- [ ] **Step 3: Implement `src/audits/fleet-event-detectors.ts`**

```ts
import type { WebsiteRow, SecurityCounts, DomainResult } from "../reports/airtable/websites.js";
import type { GitHubSignalsRow } from "./github-signals.js";
import type { FleetEvent } from "../db/fleet-events.js";

/** YYYY-MM-DD slice of an ISO timestamp, for per-site-per-day deterministic ids. */
function ymd(iso: string): string {
  return iso.slice(0, 10);
}

/** Compact a verbose Renovate PR title to "<pkg>→<version> [tags]".
 *  "chore(deps): update dependency vite to v7.3.5 [security]" → "vite→7.3.5 [security]".
 *  A grouped/no-version title ("update all non-major dependencies") is left readable. */
export function cleanRenovateTitle(title: string): string {
  let t = title.trim();
  t = t.replace(/^[a-z]+(\([^)]*\))?:\s*/i, ""); // strip "chore(deps): "
  t = t.replace(/^update dependency\s+/i, "");
  t = t.replace(/^update\s+/i, "");
  t = t.replace(/^pin dependencies?\s+/i, "");
  t = t.replace(/\s+to\s+v?/i, "→"); // " to v7.3.5" → "→7.3.5"
  return t.trim();
}

/** vuln_cleared (critical+high >0 → 0) and cert_renewed (<30 → >60) from a single
 *  site's prior WebsiteRow vs the freshly-audited values. PURE. A null prior count
 *  reads as 0 (vuln) or "not a renewal" (cert) — both fire only on a real transition. */
export function detectAuditEvents(
  prev: WebsiteRow,
  audits: { security?: SecurityCounts; domain?: DomainResult },
  at: string,
): FleetEvent[] {
  const events: FleetEvent[] = [];

  if (audits.security) {
    const prevCH = (prev.securityVulnsCritical ?? 0) + (prev.securityVulnsHigh ?? 0);
    const newCH = audits.security.critical + audits.security.high;
    if (prevCH > 0 && newCH === 0) {
      events.push({
        id: `vuln_cleared:${prev.id}:${ymd(at)}`,
        ts: at,
        type: "vuln_cleared",
        siteId: prev.id,
        siteName: prev.name,
        summary: `cleared ${prevCH} critical/high vuln${prevCH === 1 ? "" : "s"}`,
        data: { from: prevCH },
      });
    }
  }

  if (audits.domain) {
    const prevDays = prev.certDaysRemaining;
    const newDays = audits.domain.certDaysRemaining;
    // Null prior = never measured / unresolved → first measurement, not a renewal.
    if (prevDays !== null && prevDays < 30 && newDays !== null && newDays > 60) {
      events.push({
        id: `cert_renewed:${prev.id}:${ymd(at)}`,
        ts: at,
        type: "cert_renewed",
        siteId: prev.id,
        siteName: prev.name,
        summary: `TLS cert renewed (${newDays}d remaining)`,
        data: { days: newDays },
      });
    }
  }

  return events;
}

/** pr_automerged (one per merged Renovate PR) + ci_recovered (failing → passing)
 *  from a site's prior WebsiteRow, its fresh signals row, and the merged-PR list
 *  found since the watermark. PURE. */
export function detectSignalEvents(
  prev: WebsiteRow,
  row: GitHubSignalsRow,
  mergedPRs: Array<{ number: number; title: string; url: string; mergedAt: string }>,
  at: string,
): FleetEvent[] {
  const events: FleetEvent[] = [];

  for (const pr of mergedPRs) {
    events.push({
      id: `pr_automerged:${row.repo}#${pr.number}`,
      ts: pr.mergedAt,
      type: "pr_automerged",
      siteId: prev.id,
      siteName: prev.name,
      summary: `auto-merged ${cleanRenovateTitle(pr.title)}`,
      data: { url: pr.url, repo: row.repo, number: pr.number },
    });
  }

  if (prev.defaultBranchCi === "failing" && row.ciState === "passing") {
    events.push({
      id: `ci_recovered:${prev.id}:${ymd(at)}`,
      ts: at,
      type: "ci_recovered",
      siteId: prev.id,
      siteName: prev.name,
      summary: "CI recovered (default branch green)",
      data: null,
    });
  }

  return events;
}

/** A fleet-wide rollup event: one per sweep per day. */
export function fleetSweptEvent(
  sweep: "lighthouse" | "security" | "github-signals",
  count: number,
  at: string,
): FleetEvent {
  const verb =
    sweep === "security"
      ? "security-swept"
      : sweep === "github-signals"
        ? "signals-swept"
        : "re-audited";
  return {
    id: `fleet_swept:${sweep}:${ymd(at)}`,
    ts: at,
    type: "fleet_swept",
    siteId: null,
    siteName: null,
    summary: `${verb} ${count} site${count === 1 ? "" : "s"}`,
    data: { sweep, count },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/audits/fleet-event-detectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audits/fleet-event-detectors.ts tests/audits/fleet-event-detectors.test.ts
git commit -m "feat(audits): pure fleet-event detectors (vuln/cert/pr/ci/swept)"
```

---

## Task 4: `mergedRenovatePullRequests` on the GitHub client

**Files:**

- Modify: `src/github/gh.ts`
- Test: `tests/github/merged-renovate-prs.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/github/merged-renovate-prs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeGitHub } from "../../src/github/gh.js";

function fakeSpawn(stdout: string) {
  return async () => ({ code: 0, stdout, stderr: "" });
}

const SINCE = "2026-06-20T00:00:00.000Z";

const PRS = JSON.stringify([
  {
    number: 14,
    title: "chore(deps): update dependency vite to v7.3.5 [security]",
    html_url: "https://github.com/reddoorla/caltex/pull/14",
    merged_at: "2026-06-24T09:00:00.000Z",
    head: { ref: "renovate/vite-7.x" },
  },
  {
    number: 13,
    title: "chore(deps): update dependency old to v1",
    html_url: "https://github.com/reddoorla/caltex/pull/13",
    merged_at: "2026-06-10T09:00:00.000Z", // before SINCE → excluded
    head: { ref: "renovate/old" },
  },
  {
    number: 12,
    title: "fix: a human PR",
    html_url: "https://github.com/reddoorla/caltex/pull/12",
    merged_at: "2026-06-24T09:00:00.000Z",
    head: { ref: "feat/thing" }, // not renovate/* → excluded
  },
  {
    number: 11,
    title: "chore(deps): closed unmerged",
    html_url: "https://github.com/reddoorla/caltex/pull/11",
    merged_at: null, // closed, never merged → excluded
    head: { ref: "renovate/unmerged" },
  },
]);

describe("mergedRenovatePullRequests", () => {
  it("returns only renovate/* PRs merged at/after the watermark", async () => {
    const gh = makeGitHub({ token: "t", spawn: fakeSpawn(PRS) });
    const merged = await gh.mergedRenovatePullRequests("reddoorla/caltex", SINCE);
    expect(merged).toEqual([
      {
        number: 14,
        title: "chore(deps): update dependency vite to v7.3.5 [security]",
        url: "https://github.com/reddoorla/caltex/pull/14",
        mergedAt: "2026-06-24T09:00:00.000Z",
      },
    ]);
  });

  it("rejects a malformed repo string", async () => {
    const gh = makeGitHub({ token: "t", spawn: fakeSpawn("[]") });
    await expect(gh.mergedRenovatePullRequests("not-a-repo", SINCE)).rejects.toThrow(/owner\/repo/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/merged-renovate-prs.test.ts`
Expected: FAIL — `gh.mergedRenovatePullRequests is not a function`.

- [ ] **Step 3: Add to the `GitHub` type**

In `src/github/gh.ts`, inside the `export type GitHub = { ... }` block, add (after `defaultBranchStatus`'s declaration, before `dispatchWorkflow`):

```ts
/** Renovate PRs (head `renovate/*`) merged at/after `sinceIso`, newest unspecified.
 *  Used to record `pr_automerged` fleet events. gh-shell (Actions only). */
mergedRenovatePullRequests: (repo: string, sinceIso: string) =>
  Promise<Array<{ number: number; title: string; url: string; mergedAt: string }>>;
```

- [ ] **Step 4: Implement the method**

In `src/github/gh.ts`, inside the `return { ... }` object of `makeGitHub`, add (after the `defaultBranchStatus` method, before `dispatchWorkflow`):

```ts
    async mergedRenovatePullRequests(repo, sinceIso) {
      const [owner, name, ...rest] = repo.split("/");
      if (!owner || !name || rest.length > 0) {
        throw new Error(`mergedRenovatePullRequests: expected "owner/repo", got "${repo}"`);
      }
      // per_page=50: comfortably covers a week of Renovate merges on one repo. The
      // list endpoint returns merged_at + head.ref, so the filter is local.
      const out = await gh([
        "api",
        `repos/${owner}/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
      ]);
      const arr = JSON.parse(out) as Array<{
        number: number;
        title: string;
        html_url: string;
        merged_at: string | null;
        head?: { ref?: string };
      }>;
      return arr
        .filter(
          (p) =>
            p.merged_at !== null &&
            p.merged_at >= sinceIso && // ISO8601 UTC strings sort lexicographically
            (p.head?.ref ?? "").startsWith("renovate/"),
        )
        .map((p) => ({
          number: p.number,
          title: p.title,
          url: p.html_url,
          mergedAt: p.merged_at as string,
        }));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/github/merged-renovate-prs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/github/gh.ts tests/github/merged-renovate-prs.test.ts
git commit -m "feat(github): mergedRenovatePullRequests for pr_automerged events"
```

---

## Task 5: Best-effort event writer

**Files:**

- Create: `src/audits/fleet-events-writer.ts`
- Test: `tests/audits/fleet-events-writer.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/audits/fleet-events-writer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { listFleetEvents, type FleetEvent } from "../../src/db/fleet-events.js";
import { recordFleetEventsBestEffort } from "../../src/audits/fleet-events-writer.js";

const NOW = new Date("2026-06-25T07:00:00.000Z");

function ev(id: string, ts: string): FleetEvent {
  return { id, ts, type: "fleet_swept", siteId: null, siteName: null, summary: id, data: null };
}

describe("recordFleetEventsBestEffort", () => {
  it("writes all events and prunes the 30-day window via the injected opener", async () => {
    const db = await openDb({ url: ":memory:" });
    const open = () => Promise.resolve(db);
    await recordFleetEventsBestEffort(
      [ev("keep", "2026-06-24T00:00:00.000Z"), ev("old", "2026-05-01T00:00:00.000Z")],
      NOW,
      open,
    );
    const rows = await listFleetEvents(db, { sinceIso: "2026-01-01T00:00:00.000Z", limit: 50 });
    // "old" (>30d before NOW) is pruned; "keep" survives.
    expect(rows.map((r) => r.id)).toEqual(["keep"]);
  });

  it("is a no-op (resolves, never throws) on an empty list", async () => {
    let opened = false;
    await recordFleetEventsBestEffort([], NOW, () => {
      opened = true;
      return Promise.reject(new Error("should not open"));
    });
    expect(opened).toBe(false);
  });

  it("swallows an opener failure (missing creds) without throwing", async () => {
    await expect(
      recordFleetEventsBestEffort([ev("a", "2026-06-24T00:00:00.000Z")], NOW, () =>
        Promise.reject(new Error("TURSO_DATABASE_URL not set")),
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/audits/fleet-events-writer.test.ts`
Expected: FAIL — cannot find module `../../src/audits/fleet-events-writer.js`.

- [ ] **Step 3: Implement `src/audits/fleet-events-writer.ts`**

```ts
import { openDb, readDbConfig, type Db } from "../db/client.js";
import { recordFleetEvent, pruneFleetEvents, type FleetEvent } from "../db/fleet-events.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Persist a batch of fleet events + prune the 30-day window — best-effort.
 *  Opens its OWN libSQL connection (the producers carry only Airtable creds today).
 *  A missing TURSO_* (creds not yet added to the workflow) or any write error is
 *  swallowed with a console.error: recording fleet activity must NEVER fail the
 *  sweep that produced it. The feed ships dark until the creds are present.
 *  `open` is injectable for tests. */
export async function recordFleetEventsBestEffort(
  events: FleetEvent[],
  now: Date,
  open: () => Promise<Db> = () => openDb(readDbConfig()),
): Promise<void> {
  if (events.length === 0) return;
  let db: Db;
  try {
    db = await open();
  } catch (e) {
    console.error(`[fleet-events] skipped ${events.length} event(s): no libSQL (${String(e)})`);
    return;
  }
  try {
    for (const e of events) await recordFleetEvent(db, e);
    await pruneFleetEvents(db, new Date(now.getTime() - RETENTION_MS).toISOString());
  } catch (e) {
    console.error(`[fleet-events] write failed: ${String(e)}`);
  }
}
```

Note: `Db` must be exported from `src/db/client.ts` — it already is (`export type Db = Kysely<Database>;`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/audits/fleet-events-writer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audits/fleet-events-writer.ts tests/audits/fleet-events-writer.test.ts
git commit -m "feat(audits): fail-safe recordFleetEventsBestEffort boundary"
```

---

## Task 6: Wire audit events into the write-back + record on the fleet path

**Files:**

- Modify: `src/audits/write-audits-to-airtable.ts:24-30` (WriteSummary type), `:153` (return), plus the detector call after `:134`
- Modify: `src/cli/commands/audit.ts:323-333` (fleet write block)
- Test: `tests/audits/write-audits-events.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/audits/write-audits-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { writeAuditsToAirtable } from "../../src/audits/write-audits-to-airtable.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { AuditResult } from "../../src/types.js";

// A fake Airtable base: the only call writeAuditsToAirtable makes is base(table).update(...).
function fakeBase() {
  return (() => ({ update: async () => [] })) as never;
}

function siteRow(over: Partial<WebsiteRow>): WebsiteRow {
  return {
    id: "recSITE",
    name: "Caltex",
    securityVulnsCritical: 1,
    securityVulnsHigh: 1,
    certDaysRemaining: 80,
  } as WebsiteRow & typeof over;
}

const securityClean: AuditResult = {
  site: "caltex",
  audit: "security",
  status: "pass",
  summary: "clean",
  details: { counts: { critical: 0, high: 0, moderate: 0, low: 0 } },
} as AuditResult;

describe("writeAuditsToAirtable attaches detected events", () => {
  it("emits vuln_cleared when prior critical+high cleared to 0", async () => {
    const summary = await writeAuditsToAirtable({
      base: fakeBase(),
      websites: [siteRow({})],
      slug: "caltex",
      results: [securityClean],
    });
    expect(summary.events?.map((e) => e.type)).toContain("vuln_cleared");
  });

  it("emits no events when nothing transitioned", async () => {
    const summary = await writeAuditsToAirtable({
      base: fakeBase(),
      websites: [siteRow({ securityVulnsCritical: 0, securityVulnsHigh: 0 })],
      slug: "caltex",
      results: [securityClean],
    });
    expect(summary.events ?? []).toHaveLength(0);
  });
});
```

(Confirm the `AuditResult` shape against `src/types.ts` while writing — if `details.counts` differs, mirror the real shape. The fields read are only those `hasSecurityCounts`/`securityCountsFromResult` use.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/audits/write-audits-events.test.ts`
Expected: FAIL — `summary.events` is `undefined` (property does not exist on the type).

- [ ] **Step 3: Add `events` to `WriteSummary` + import the detector**

In `src/audits/write-audits-to-airtable.ts`, add the import (with the other imports near the top):

```ts
import { detectAuditEvents } from "./fleet-event-detectors.js";
import type { FleetEvent } from "../db/fleet-events.js";
```

Change the `WriteSummary` type (currently lines 24-30) to add the optional `events`:

```ts
type WriteSummary = {
  siteName: string;
  writes: Array<{
    audit: "lighthouse" | "a11y" | "deps" | "security" | "github-signals" | "domain" | "browser";
    counts: object;
  }>;
  /** Fleet-activity events detected from this site's prior row vs the fresh audits.
   *  Optional: only the fleet path records them; the single-site path ignores them. */
  events?: FleetEvent[];
};
```

- [ ] **Step 4: Compute the events and return them**

In `writeAuditsToAirtable`, after the `updateAuditFields` block (currently ends at line 134, `}`) and BEFORE the lighthouse-miss throw (currently line 136 comment / 139 `if`), add:

```ts
// Detect fleet-activity transitions from the prior row (`target`, loaded before this
// write) vs the fresh audits. Computed here where both are in hand; recorded by the
// caller (fleet path) — single-site callers simply ignore `events`.
const events = detectAuditEvents(
  target,
  { security: audits.security, domain: audits.domain },
  new Date().toISOString(),
);
```

Change the final return (currently line 153 `return { siteName: target.name, writes };`) to:

```ts
return { siteName: target.name, writes, events };
```

- [ ] **Step 5: Record events on the fleet write path**

In `src/cli/commands/audit.ts`, add imports near the other dynamic imports at the top of the fleet block, or as static imports at the top of the file (static is fine — they are small):

```ts
import { recordFleetEventsBestEffort } from "../../audits/fleet-events-writer.js";
import { fleetSweptEvent } from "../../audits/fleet-event-detectors.js";
```

Then, inside the `if (opts.fleet !== undefined) { ... }` block (currently lines 323-333), after the line `if (fleetWrite.failed.length > 0) writeBackFailed = true;` (line 329), add:

```ts
// Record fleet-activity events (vuln_cleared / cert_renewed rode along on each
// WriteSummary) plus a per-sweep rollup. Best-effort: a missing Turso cred no-ops.
const sweep = which.includes("security") ? "security" : "lighthouse";
const now = new Date();
const auditEvents = fleetWrite.written.flatMap((w) => w.events ?? []);
await recordFleetEventsBestEffort(
  [...auditEvents, fleetSweptEvent(sweep, fleetWrite.written.length, now.toISOString())],
  now,
);
```

(`which` is in scope — `const which = parseOnly(opts.only) ?? ALL_AUDIT_NAMES;` at line 256. The two real workflows pass `--only security` → `"security"`, and `--only lighthouse,domain,browser` → `"lighthouse"`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run tests/audits/write-audits-events.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/audits/write-audits-to-airtable.ts src/cli/commands/audit.ts tests/audits/write-audits-events.test.ts
git commit -m "feat(audits): record vuln_cleared/cert_renewed + fleet_swept on fleet audits"
```

---

## Task 7: Wire signal events into the github-signals command

**Files:**

- Modify: `src/cli/commands/github-signals.ts`

(The event _detection_ is already covered by Task 3's pure tests and `mergedRenovatePullRequests` by Task 4. This task is the integration wiring; the command opens a real Airtable base so it is not unit-tested — typecheck + the underlying pure coverage guard it.)

- [ ] **Step 1: Add imports**

In `src/cli/commands/github-signals.ts`, add to the imports:

```ts
import { detectSignalEvents, fleetSweptEvent } from "../../audits/fleet-event-detectors.js";
import { recordFleetEventsBestEffort } from "../../audits/fleet-events-writer.js";
import type { FleetEvent } from "../../db/fleet-events.js";
```

- [ ] **Step 2: Accumulate events in the write loop**

In `runGitHubSignalsCommand`, declare an accumulator just before the `for (const row of rows)` loop (currently line 62), next to `const result: FleetWriteResult = ...`:

```ts
const events: FleetEvent[] = [];
const sweptMs = Date.parse(sweptAt);
const since24h = new Date(sweptMs - 24 * 60 * 60 * 1000).toISOString();
```

Inside the loop, in the `try { ... }` block, AFTER the `result.written.push({ ... })` call (currently lines 75-78) and before the closing `}` of the try, add:

```ts
// Fleet-activity events for this repo: merged Renovate PRs since the last sweep
// (watermark = the row's prior GitHub Signals At, else a 24h fallback) + a
// CI-recovered transition. A PR-fetch hiccup drops only this repo's PR events.
const since = target.githubSignalsAt ?? since24h;
let merged: Awaited<ReturnType<typeof gh.mergedRenovatePullRequests>> = [];
try {
  merged = await gh.mergedRenovatePullRequests(row.repo, since);
} catch {
  // PR list unavailable this run — skip pr_automerged for this repo, keep ci_recovered
}
events.push(...detectSignalEvents(target, row, merged, sweptAt));
```

- [ ] **Step 3: Record after the loop**

After the loop and the `for (const repo of skipped)` line (currently line 83), before the `return { ... }` (currently line 89), add:

```ts
events.push(fleetSweptEvent("github-signals", result.written.length, sweptAt));
await recordFleetEventsBestEffort(events, new Date());
```

- [ ] **Step 4: Typecheck + run the existing github-signals tests**

Run: `pnpm typecheck && pnpm vitest run tests/cli tests/audits/github-signals.test.ts 2>/dev/null; pnpm vitest run tests/github`
Expected: typecheck clean; existing tests still green (the new code is additive).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/github-signals.ts
git commit -m "feat(cli): record pr_automerged/ci_recovered + fleet_swept on github-signals sweep"
```

---

## Task 8: Record `site_launched` on the launch-send path

**Files:**

- Modify: `src/reports/send/orchestrate.ts:104-111`

- [ ] **Step 1: Add imports**

In `src/reports/send/orchestrate.ts`, add:

```ts
import { recordFleetEventsBestEffort } from "../../audits/fleet-events-writer.js";
```

- [ ] **Step 2: Record the event after the launch flip succeeds**

In `sendApprovedReports`, inside the `if (report.reportType === "Launch") { try { ... } ... }` block, after the existing `lines.push(\` ↳ launched: ...\`);`(currently line 107) and before the`} catch (e) {`, add:

```ts
await recordFleetEventsBestEffort(
  [
    {
      id: `site_launched:${site.id}`,
      ts: new Date().toISOString(),
      type: "site_launched",
      siteId: site.id,
      siteName: site.name,
      summary: "launched — now in maintenance",
      data: null,
    },
  ],
  new Date(),
);
```

(`site_launched:<site.id>` is the once-ever deterministic id; a re-send of a Launch report won't duplicate it.)

- [ ] **Step 3: Typecheck + run the orchestrate tests**

Run: `pnpm typecheck && pnpm vitest run tests/reports/send 2>/dev/null || pnpm vitest run tests/reports`
Expected: typecheck clean; existing send/orchestrate tests green (additive change; `recordFleetEventsBestEffort` no-ops without Turso creds in tests).

- [ ] **Step 4: Commit**

```bash
git add src/reports/send/orchestrate.ts
git commit -m "feat(reports): record site_launched fleet event on launch send"
```

---

## Task 9: Cockpit model — `RecentEntry` + `recentEvents` → `model.recent`

**Files:**

- Modify: `src/dashboard/fleet-cockpit.ts` (CockpitModel type ~133-142, buildCockpitModel signature ~255-263, return ~369-377)
- Test: `tests/dashboard/cockpit-recent.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/dashboard/cockpit-recent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";

const events: FleetEvent[] = [
  {
    id: "pr_automerged:reddoorla/caltex#14",
    ts: "2026-06-24T09:00:00.000Z",
    type: "pr_automerged",
    siteId: "recCALTEX",
    siteName: "Caltex Landing",
    summary: "auto-merged vite→7.3.5",
    data: {
      url: "https://github.com/reddoorla/caltex/pull/14",
      repo: "reddoorla/caltex",
      number: 14,
    },
  },
  {
    id: "fleet_swept:security:2026-06-25",
    ts: "2026-06-25T07:00:00.000Z",
    type: "fleet_swept",
    siteId: null,
    siteName: null,
    summary: "security-swept 11 sites",
    data: { sweep: "security", count: 11 },
  },
];

describe("buildCockpitModel — recent lane", () => {
  it("maps events into model.recent with slug + external url", () => {
    const model = buildCockpitModel([], [], {}, "https://d.test", new Date(), [], null, events);
    expect(model.recent).toHaveLength(2);
    const pr = model.recent!.find((r) => r.type === "pr_automerged")!;
    expect(pr.slug).toBe("caltex-landing");
    expect(pr.url).toBe("https://github.com/reddoorla/caltex/pull/14");
    const sweep = model.recent!.find((r) => r.type === "fleet_swept")!;
    expect(sweep.slug).toBeNull();
    expect(sweep.url).toBeNull();
  });

  it("defaults to an empty recent array when omitted (back-compat)", () => {
    const model = buildCockpitModel([], [], {}, "https://d.test", new Date());
    expect(model.recent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/dashboard/cockpit-recent.test.ts`
Expected: FAIL — `buildCockpitModel` takes 7 params (8th rejected) / `model.recent` undefined.

- [ ] **Step 3: Add the type + import**

In `src/dashboard/fleet-cockpit.ts`, add the import (with the other type imports at the top):

```ts
import type { FleetEvent, FleetEventType } from "../db/fleet-events.js";
```

Add the `RecentEntry` type (near `CockpitModel`):

```ts
/** A render-ready row for the cockpit "Recently" lane. `url` is an external link
 *  (PR) when present; `slug` links to `/s/<slug>` when the event names a site. */
export type RecentEntry = {
  type: FleetEventType;
  summary: string;
  siteName: string | null;
  slug: string | null;
  url: string | null;
  ts: string;
};
```

Add `recent` to `CockpitModel` (after `spam`):

```ts
  /** Recent fleet-activity events for the "Recently" lane (optional for back-compat). */
  recent?: RecentEntry[];
```

- [ ] **Step 4: Add the param + mapping**

Change the `buildCockpitModel` signature (currently ends `spamTotals: ... = null,\n): CockpitModel {`) to add the 8th param:

```ts
  spamTotals: { honeypot: number; tooFast: number; markedSpam: number } | null = null,
  recentEvents: FleetEvent[] = [],
): CockpitModel {
```

Before the final `return { summary, cards, pending, submissions, spam: ... };`, add the mapping:

```ts
const recent: RecentEntry[] = recentEvents.map((e) => {
  const url =
    e.type === "pr_automerged" &&
    e.data !== null &&
    typeof e.data === "object" &&
    "url" in e.data &&
    typeof (e.data as { url: unknown }).url === "string"
      ? (e.data as { url: string }).url
      : null;
  return {
    type: e.type,
    summary: e.summary,
    siteName: e.siteName,
    slug: e.siteName ? siteSlug(e.siteName) : null,
    url,
    ts: e.ts,
  };
});
```

Add `recent` to the returned object:

```ts
return {
  summary,
  cards,
  pending,
  submissions,
  spam: spamTotals
    ? { caught: spamTotals.honeypot + spamTotals.tooFast, through: spamTotals.markedSpam }
    : null,
  recent,
};
```

(`siteSlug` is already imported in this file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/dashboard/cockpit-recent.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts tests/dashboard/cockpit-recent.test.ts
git commit -m "feat(dashboard): map fleet events into cockpit model.recent"
```

---

## Task 10: `renderRecentlyLane` + wire into the cockpit

**Files:**

- Modify: `src/dashboard/fleet-render.ts` (imports ~1-11, new function near `renderInboxLane` ~150, wire into `renderCockpitHtml` ~332)
- Test: `tests/dashboard/recently-lane.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/dashboard/recently-lane.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";

function modelWith(events: FleetEvent[]) {
  return buildCockpitModel([], [], {}, "https://d.test", new Date(), [], null, events);
}

describe("renderRecentlyLane (via renderCockpitHtml)", () => {
  it("renders a collapsed details.recently with a count and per-type icons", () => {
    const html = renderCockpitHtml(
      modelWith([
        {
          id: "pr_automerged:reddoorla/caltex#14",
          ts: "2026-06-24T09:00:00.000Z",
          type: "pr_automerged",
          siteId: "recC",
          siteName: "Caltex",
          summary: "auto-merged vite→7.3.5",
          data: { url: "https://github.com/reddoorla/caltex/pull/14" },
        },
        {
          id: "fleet_swept:security:2026-06-25",
          ts: "2026-06-25T07:00:00.000Z",
          type: "fleet_swept",
          siteId: null,
          siteName: null,
          summary: "security-swept 11 sites",
          data: null,
        },
      ]),
    );
    expect(html).toContain('<details class="recently">');
    expect(html).toContain("🔧 Recently (2)");
    expect(html).toContain("🔧"); // pr_automerged icon
    expect(html).toContain("🔄"); // fleet_swept icon
    // PR row links externally; fleet_swept row has no link
    expect(html).toContain('href="https://github.com/reddoorla/caltex/pull/14"');
    expect(html).toContain("Caltex");
  });

  it("links a site-scoped non-PR event to /s/<slug>", () => {
    const html = renderCockpitHtml(
      modelWith([
        {
          id: "vuln_cleared:recC:2026-06-25",
          ts: "2026-06-25T07:00:00.000Z",
          type: "vuln_cleared",
          siteId: "recC",
          siteName: "Caltex",
          summary: "cleared 2 critical/high vulns",
          data: { from: 2 },
        },
      ]),
    );
    expect(html).toContain("🛡"); // vuln_cleared icon
    expect(html).toContain('href="/s/caltex"');
  });

  it("renders nothing when there are no recent events", () => {
    const html = renderCockpitHtml(modelWith([]));
    expect(html).not.toContain('class="recently"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/dashboard/recently-lane.test.ts`
Expected: FAIL — no `details class="recently"` in output.

- [ ] **Step 3: Add imports**

In `src/dashboard/fleet-render.ts`, extend the type import from `./fleet-cockpit.js` to include `RecentEntry`:

```ts
import type {
  CockpitModel,
  SubmissionEntry,
  NeedsYouItem,
  NeedsYouGroup,
  RecentEntry,
} from "./fleet-cockpit.js";
```

Add the `FleetEventType` import:

```ts
import type { FleetEventType } from "../db/fleet-events.js";
```

- [ ] **Step 4: Add the icon map + render function**

In `src/dashboard/fleet-render.ts`, add (just before `renderInboxLane`, after the `SUBMISSIONS_STRIP_CAP` const / around line 147):

```ts
const RECENT_ICON: Record<FleetEventType, string> = {
  pr_automerged: "🔧",
  vuln_cleared: "🛡",
  ci_recovered: "✅",
  site_launched: "🚀",
  cert_renewed: "🔒",
  fleet_swept: "🔄",
};

/** The calm "Recently" lane: what the fleet did for you, collapsed by default
 *  (reassurance, not an alarm). One row per event: icon · site + summary · when ·
 *  optional link (PR url, else /s/<slug>). Returns "" when there is nothing. */
function renderRecentlyLane(model: CockpitModel): string {
  const events: RecentEntry[] = model.recent ?? [];
  if (events.length === 0) return "";
  const rows = events
    .map((e) => {
      const icon = RECENT_ICON[e.type] ?? "•";
      const when = escapeHtml(relativeTimeFromNow(e.ts));
      const site = e.siteName ? `<strong>${escapeHtml(e.siteName)}</strong> — ` : "";
      const link = e.url
        ? `<a href="${escapeHtml(e.url)}">view ▸</a>`
        : e.slug
          ? `<a href="/s/${escapeHtml(e.slug)}">open ▸</a>`
          : "";
      return `<div class="recent-row" data-type="${e.type}">
        <span class="recent-icon">${icon}</span>
        <span class="recent-what">${site}${escapeHtml(e.summary)}</span>
        <span class="muted">${when}</span>
        ${link}
      </div>`;
    })
    .join("");
  return `<details class="recently">
    <summary>🔧 Recently (${events.length})</summary>
    ${rows}
  </details>`;
}
```

- [ ] **Step 5: Wire it into `renderCockpitHtml`**

In `renderCockpitHtml`, between `${renderFleetBrowsePanel(model)}` and `${renderInboxLane(model)}` (currently lines 332-333), add the call:

```ts
  ${renderFleetBrowsePanel(model)}
  ${renderRecentlyLane(model)}
  ${renderInboxLane(model)}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/dashboard/recently-lane.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/recently-lane.test.ts
git commit -m "feat(dashboard): Recently lane on the cockpit"
```

---

## Task 11: Handler — fetch + pass `recentEvents`

**Files:**

- Modify: `netlify/functions/fleet-homepage.mts`

(`.mts` handlers are typechecked via `tsconfig.netlify.json` (`pnpm typecheck`), not unit-tested — matches the existing handler. Verification is typecheck + the dark-ship soak.)

- [ ] **Step 1: Add the import**

In `netlify/functions/fleet-homepage.mts`, add (with the other `src/db` imports):

```ts
import { listFleetEvents } from "../../src/db/fleet-events.js";
```

- [ ] **Step 2: Fetch recent events (guarded like the other libSQL panels)**

After the `spamTotals` block (currently ends ~line 129) and before `const baseUrl = ...` (line 130), add:

```ts
let recentEvents: Awaited<ReturnType<typeof listFleetEvents>> = [];
if (db) {
  try {
    const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    recentEvents = await listFleetEvents(db, { sinceIso, limit: 20 });
  } catch {
    // Recently lane simply absent — the cockpit still renders.
  }
}
```

- [ ] **Step 3: Pass it into `buildCockpitModel`**

Change the `buildCockpitModel(...)` call (currently lines 131-139) to add the 8th argument:

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
);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean (covers the `.mts` handler via tsconfig.netlify.json).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/fleet-homepage.mts
git commit -m "feat(dashboard): fetch recent fleet events into the cockpit handler"
```

---

## Task 12: Workflow Turso env (operator activates by adding the secrets)

**Files:**

- Modify: `.github/workflows/fleet-security.yml` (the "Fleet security audit" step env, ~line 45)
- Modify: `.github/workflows/fleet-lighthouse.yml` (the "Fleet Lighthouse…" step env ~line 50 AND the "Sweep GitHub signals" step env ~line 120)
- Modify: `.github/workflows/daily-reports.yml` (the "Send approved reports" step env, ~line 64)

The two repo secrets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are added once by the operator (same values the dashboard Netlify env uses). Until then, `recordFleetEventsBestEffort` no-ops and the feed stays dark.

- [ ] **Step 1: fleet-security.yml**

Under the `env:` of the "Fleet security audit + Airtable write-back" step (currently the two `AIRTABLE_*` lines at ~46-47), add:

```yaml
TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

- [ ] **Step 2: fleet-lighthouse.yml (both steps)**

Under the `env:` of "Fleet Lighthouse + domain + browser audit…" (the `AIRTABLE_*` at ~51-52) AND under the `env:` of "Sweep GitHub signals to Airtable" (the block at ~121-123, alongside `RENOVATE_TOKEN`), add the same two lines to each:

```yaml
TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

- [ ] **Step 3: daily-reports.yml**

Under the `env:` of the "Send approved reports" step (the `AIRTABLE_*` + `RESEND_API_KEY` at ~65-67), add:

```yaml
TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
```

- [ ] **Step 4: Validate YAML + prettier**

Run: `pnpm lint`
Expected: prettier clean (it checks YAML too — match the existing 2-space / step indentation exactly).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/fleet-security.yml .github/workflows/fleet-lighthouse.yml .github/workflows/daily-reports.yml
git commit -m "ci: pass Turso creds to fleet-event producers (activates the feed)"
```

---

## Task 13: Changeset + full verification

**Files:**

- Create: `.changeset/<random-name>.md`

- [ ] **Step 1: Write the changeset**

`.changeset/fleet-activity-feed.md`:

```md
---
"@reddoorla/maintenance": minor
---

Fleet activity feed: a recorded `fleet_events` log (libSQL) written by the nightly
producers (auto-merged Renovate PRs, cleared vulns, recovered CI, renewed certs,
launches, per-sweep rollups) and surfaced as a collapsed "Recently" lane on the
cockpit. Ships dark until `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` are added to the
fleet workflows.
```

- [ ] **Step 2: Full local gate (the pre-merge gate)**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all green. (`test:dist` catches a renamed/removed public export that `build` alone misses — required per the repo's pre-merge rule.)

- [ ] **Step 3: Commit**

```bash
git add .changeset/fleet-activity-feed.md
git commit -m "chore: changeset for fleet activity feed"
```

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch (verify tests → push → PR). The PR body should note the operator step (add the two Turso secrets to `reddoorla/reddoor-maintenance`) and that the feed ships dark until then. Merge only on a green `ci / ci` check-run per the repo's merge-authority rule; the Version Packages release PR stays human.

---

## Self-Review

**1. Spec coverage:**

- `fleet_events` table + idempotent deterministic ids → Tasks 1, 2 ✓
- DB helpers `recordFleetEvent`/`listFleetEvents`/`pruneFleetEvents` → Task 2 ✓
- `pr_automerged` + `cleanTitle` + watermark/24h fallback → Tasks 3, 4, 7 ✓
- `ci_recovered` → Tasks 3, 7 ✓
- `vuln_cleared` (read-before-write) → Tasks 3, 6 ✓
- `cert_renewed` → Tasks 3, 6 (refinement: null prior excluded — documented) ✓
- `site_launched` → Task 8 ✓
- `fleet_swept` rollup + prune-once-per-run → Tasks 3, 5 (prune in writer), 6, 7 ✓
- Cockpit `recentEvents` → `model.recent` + `renderRecentlyLane` placed Fleet→Recently→Inbox → Tasks 9, 10 ✓
- Handler fetch 7d/limit 20 → Task 11 ✓
- Turso creds in 3 workflows (lighthouse needs 2 steps) → Task 12 ✓
- Store 30d / render 7d → writer RETENTION_MS (Task 5) + handler since (Task 11) ✓
- Fail-safe writes → Task 5 ✓
- One minor changeset → Task 13 ✓
- Out-of-scope (no last-seen marker, no reports-sent, no /s history, no backfill) → respected (not implemented) ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; every test shows assertions. ✓

**3. Type consistency:** `FleetEvent`/`FleetEventType` defined once (Task 2) and imported everywhere; `RecentEntry` defined once (Task 9), consumed in Task 10; `detectAuditEvents`/`detectSignalEvents`/`fleetSweptEvent`/`cleanRenovateTitle` signatures match across Tasks 3, 6, 7; `recordFleetEventsBestEffort(events, now, open?)` signature consistent across Tasks 5–8; `mergedRenovatePullRequests(repo, sinceIso)` return shape matches `detectSignalEvents`' `mergedPRs` param; `buildCockpitModel` 8th param `recentEvents` matches the handler call. ✓
