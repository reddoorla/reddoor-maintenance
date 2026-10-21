import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient, type Client, type InStatement, type ResultSet } from "@libsql/client";
import { batchingReadClient, kyselyOverClient, openDb, type Db } from "../../../src/db/client.js";
import { runMigrations } from "../../../src/db/migrate.js";
import {
  loadCockpitSnapshot,
  SNAPSHOT_FIELD_MAX,
  SNAPSHOT_FREE_TEXT,
  SNAPSHOT_TEXT_BUDGET,
  TEXT_PAST_BUDGET,
} from "../../../src/dashboard/snapshot.js";
import { createRequire } from "node:module";
import {
  SnapshotGap,
  auditsFromSnapshot,
  cockpitModelFromSnapshot,
  siteDashboardFromSnapshot,
  submissionsPageFromSnapshot,
} from "../../../src/dashboard/snapshot-views.js";
import { isHttpError, type RequestEvent } from "@sveltejs/kit";
import { load as homeLoad } from "../../src/routes/+page.js";
import { handle } from "../../src/hooks.server.js";
import { runLayout, runPage } from "../_helpers/snapshot-load.js";

/**
 * The snapshot itself (home base `briefs/2026-10-21-cockpit-one-snapshot.md`, PR 1):
 * one batched Turso call, none of the three blob columns, the defensive reads still
 * degrading one at a time, and the layout load that carries it.
 */

/** A client method, bound to the real client: they read private fields off `this`. */
function bound(target: object, prop: string | symbol, receiver: unknown): unknown {
  const value: unknown = Reflect.get(target, prop, receiver);
  return typeof value === "function" ? (value as () => unknown).bind(target) : value;
}

// Every client `openDb` builds records the size of each batch it sends.
const lib = vi.hoisted(() => ({ batches: [] as number[] }));
vi.mock("@libsql/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@libsql/client")>();
  return {
    ...actual,
    createClient: (cfg: Parameters<typeof actual.createClient>[0]) => {
      const real = actual.createClient(cfg);
      return new Proxy(real, {
        get(t, p, r) {
          if (p === "batch") {
            return (stmts: InStatement[], mode: "read") => {
              lib.batches.push(stmts.length);
              return t.batch(stmts, mode);
            };
          }
          return bound(t, p, r);
        },
      });
    },
  };
});

const NOW = new Date("2026-10-20T12:00:00.000Z");
const ORIGINAL_ENV = { ...process.env };
let dir: string;
let url: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "snapshot-"));
  url = `file:${join(dir, "db.sqlite")}`;
  const db = await openDb({ url });
  await db
    .insertInto("sites")
    .values({ id: "recA", slug: "acme", name: "Acme", url: "https://a.example" } as never)
    .execute();
  await db.destroy();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** A real migrated libSQL client, with every batch and lone execute recorded. */
async function countingClient(failSql?: (sql: string) => boolean) {
  const real = createClient({ url });
  await runMigrations(real);
  const batches: string[][] = [];
  const executes: string[] = [];
  const results: ResultSet[] = [];
  const text = (s: InStatement) => (typeof s === "string" ? s : s.sql);
  const client = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "batch") {
        return async (stmts: InStatement[], mode: "read") => {
          batches.push(stmts.map(text));
          if (failSql && stmts.some((s) => failSql(text(s)))) throw new Error("injected");
          const out = await target.batch(stmts, mode);
          results.push(...out);
          return out;
        };
      }
      if (prop === "execute") {
        return async (stmt: InStatement) => {
          executes.push(text(stmt));
          if (failSql?.(text(stmt))) throw new Error("injected Turso blip");
          return target.execute(stmt);
        };
      }
      return bound(target, prop, receiver);
    },
  }) as Client;
  return { client, batches, executes, results };
}

async function batchedDb(client: Client): Promise<Db> {
  return kyselyOverClient(batchingReadClient(client), { concurrentReads: true });
}

describe("loadCockpitSnapshot on a batchReads Db", () => {
  it("is one batch to the store, holding every read", async () => {
    const c = await countingClient();
    const s = await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    expect(s.sites?.map((w) => w.name)).toEqual(["Acme"]);
    expect(s.gaps).toEqual([]);
    expect(c.batches).toHaveLength(1);
    expect(c.batches[0]?.length).toBeGreaterThanOrEqual(11);
    expect(c.executes).toEqual([]);
  });

  it("brings back none of the three blob columns, however a read is written", async () => {
    // Every table that holds one has a row with the blob set, so a read that
    // selected it (`select *`, `select "sites".*`, or by name) would return it as
    // a column of its result.
    const db = await openDb({ url });
    await db
      .updateTable("sites")
      .set({ header_image: new Uint8Array([1, 2, 3]) } as never)
      .execute();
    await db
      .insertInto("reports")
      .values({ id: "rep1", site_id: "recA", report_id: "r1", rendered_html: "<p>x</p>" } as never)
      .execute();
    await db
      .insertInto("prospect_audits")
      .values({
        id: "pa1",
        token: "t",
        url: "https://p.example/",
        created_at: NOW.toISOString(),
        status: "complete",
        result_json: '{"big":"blob"}',
      } as never)
      .execute();
    await db.destroy();
    const c = await countingClient();
    const s = await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    // Positive control: each of those tables was read, and its row came back.
    expect(s.reports?.map((r) => r.id)).toEqual(["rep1"]);
    expect(s.audits?.map((a) => a.id)).toEqual(["pa1"]);
    const columns = c.results.flatMap((r) => r.columns);
    expect(columns).toContain("header_image_filename");
    expect(
      columns.filter((col) => ["header_image", "result_json", "rendered_html"].includes(col)),
    ).toEqual([]);
    expect(JSON.stringify([...c.results.flatMap((r) => r.rows)])).not.toContain("big");
  });

  it("a failing read fails only itself: the batch is retried statement by statement", async () => {
    const c = await countingClient((sql) => sql.includes('from "fleet_events"'));
    const s = await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    // The batch, then each statement as a read batch of its own.
    expect(c.batches[0]?.length).toBeGreaterThanOrEqual(11);
    expect(c.batches.slice(1).every((b) => b.length === 1)).toBe(true);
    expect(c.batches.slice(1).length).toBe(c.batches[0]?.length);
    expect(c.executes).toEqual([]);
    expect(s.recentEvents).toEqual([]);
    expect(s.gaps).toEqual(["events"]);
    expect(s.sites).toHaveLength(1);
    expect(s.submissions).toEqual([]);
  });

  it("a failing site read leaves no sites, never '0 sites', and only /audits renders", async () => {
    const c = await countingClient((sql) => sql.includes('from "sites" left join'));
    const s = await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    expect(s.sites).toBeNull();
    expect(s.gaps).toEqual(["sites"]);
    expect(() => cockpitModelFromSnapshot(s, NOW)).toThrow(SnapshotGap);
    expect(() => siteDashboardFromSnapshot(s, "acme", NOW)).toThrow(SnapshotGap);
    expect(() => submissionsPageFromSnapshot(s, new URLSearchParams())).toThrow(SnapshotGap);
    expect(auditsFromSnapshot(s)).toEqual([]);
  });

  it("a failing slug read with the sites read fine still leaves no sites (both or neither)", async () => {
    const c = await countingClient((sql) => sql.startsWith('select "id", "slug" from "sites"'));
    const s = await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    expect(c.batches.slice(1).some((b) => b[0]?.startsWith('select "id", "slug"'))).toBe(true);
    expect(s.sites).toBeNull();
    expect(s.gaps).toEqual(["sites"]);
  });

  it("refuses anything but a read, before it is queued", async () => {
    const c = await countingClient();
    const client = batchingReadClient(c.client);
    for (const write of [
      "delete from sites",
      "insert into sites select * from sites",
      "WITH z AS (SELECT 1) DELETE FROM sites",
      "with z as (select 1) update sites set name = 'x'",
      " select 1; drop table sites",
    ]) {
      await expect(client.execute(write), write).rejects.toThrow(/only reads/);
    }
    await expect(client.execute({ sql: " SELECT 1", args: [] })).resolves.toBeDefined();
    expect(c.batches).toEqual([[" SELECT 1"]]);
  });

  it("cuts every free-text field a visitor oversized, and leaves a real-sized lead whole", async () => {
    const db = await openDb({ url });
    const huge = "x".repeat(1_000_000);
    const real = "y".repeat(7_924); // the longest real message, 2026-10-21
    const column: Record<string, string> = {
      name: "name",
      email: "email",
      phone: "phone",
      message: "message",
      extraFields: "extra_fields",
      sourceUrl: "source_url",
      utm: "utm",
      spamReason: "spam_reason",
      bounceMessage: "bounce_message",
    };
    expect(Object.keys(column).sort()).toEqual([...SNAPSHOT_FREE_TEXT].sort());
    const row = (id: string, text: string, at: string) =>
      db
        .insertInto("submissions")
        .values({
          id,
          site_id: "recA",
          form_type: "contact",
          status: "spam_auto",
          notify_status: "skipped",
          submitted_at: at,
          ...Object.fromEntries(Object.values(column).map((c) => [c, text])),
        } as never)
        .execute();
    await row("big", huge, "2026-10-19T10:00:00.000Z");
    await row("real", real, "2026-10-19T11:00:00.000Z");
    const s = await loadCockpitSnapshot(db, NOW, "https://dash.example");
    await db.destroy();
    const byId = new Map((s.submissions ?? []).map((r) => [r.id, r]));
    for (const field of SNAPSHOT_FREE_TEXT) {
      const get = (id: string) => (byId.get(id) as Record<string, unknown> | undefined)?.[field];
      expect(get("real"), field).toBe(real);
      const big = String(get("big"));
      expect(big.length, field).toBeLessThan(SNAPSHOT_FIELD_MAX + 200);
      expect(big.startsWith("x".repeat(SNAPSHOT_FIELD_MAX)), field).toBe(true);
      expect(big, field).toContain("980000 more characters cut by the cockpit");
    }
  });

  it("bounds the whole snapshot however many crafted leads arrive", async () => {
    // The shape round 2 of the review found: every free-text field full of `<`,
    // which the serialiser writes as six bytes, each field distinct so nothing is
    // deduplicated, on many rows.
    const db = await openDb({ url });
    for (let i = 0; i < 60; i++) {
      await db
        .insertInto("submissions")
        .values({
          id: `atk${i}`,
          site_id: "recA",
          form_type: "contact",
          status: "spam_auto",
          notify_status: "skipped",
          submitted_at: new Date(NOW.getTime() - i * 60_000).toISOString(),
          name: `${i}${"<".repeat(30_000)}`,
          email: `${i}e${"<".repeat(30_000)}@x.example`,
          phone: `${i}p${"<".repeat(30_000)}`,
          message: `${i}m${"<".repeat(30_000)}`,
          extra_fields: `${i}x${"<".repeat(30_000)}`,
          source_url: `${i}s${"<".repeat(30_000)}`,
          utm: `${i}u${"<".repeat(30_000)}`,
        } as never)
        .execute();
    }
    const s = await loadCockpitSnapshot(db, NOW, "https://dash.example");
    await db.destroy();
    const devalue = (await import(
      createRequire(createRequire(import.meta.url).resolve("@sveltejs/kit/package.json")).resolve(
        "devalue",
      )
    )) as { stringify(v: unknown): string };
    const bytes = Buffer.byteLength(devalue.stringify(s));
    expect(bytes).toBeLessThan(SNAPSHOT_TEXT_BUDGET + 500_000);
    // Every row is still there, so every count holds; the oldest carry the marker.
    expect(s.submissions).toHaveLength(60);
    expect(s.submissions?.at(-1)?.message).toBe(TEXT_PAST_BUDGET);
    expect(s.submissions?.[0]?.message?.startsWith("0m<")).toBe(true);
  });

  it("refuses a transaction, so no write can ride the read batch", async () => {
    const c = await countingClient();
    const db = await batchedDb(c.client);
    await expect(db.transaction().execute(async () => 1)).rejects.toThrow(/no transaction/);
  });
});

describe("the root layout's load", () => {
  beforeEach(() => {
    process.env.TURSO_DATABASE_URL = url;
    delete process.env.TURSO_AUTH_TOKEN;
  });

  it("depends on cockpit:snapshot and marks the response private, no-store", async () => {
    const run = await runLayout();
    expect(run.depends).toEqual(["cockpit:snapshot"]);
    expect(run.headers).toEqual({ "cache-control": "private, no-store" });
    expect(run.data.email).toBe("op@example.com");
    expect(run.data.snapshot.sites?.map((w) => w.id)).toEqual(["recA"]);
  });

  it("off every route (the error page for an unknown path) reads nothing", async () => {
    lib.batches.length = 0;
    const run = await runLayout("op@example.com", null);
    expect(run.data.snapshot).toBeNull();
    expect(run.headers).toEqual({ "cache-control": "private, no-store" });
    expect(lib.batches).toEqual([]);
  });

  it("a store failure is the page's own 500/502, answered inside the layout", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const run = await runLayout();
    expect(run.data.snapshot).toBeNull();
    expect(run.data.failure).toEqual({ status: 500, message: "Turso env missing" });
    try {
      await runPage(homeLoad, "/", {}, run);
      throw new Error("load returned");
    } catch (thrown) {
      expect(isHttpError(thrown) && thrown.status).toBe(500);
    }
  });

  it("goes to Turso as one batch", async () => {
    lib.batches.length = 0;
    await runLayout();
    // The migration check may run its own statements first; the snapshot is
    // exactly one multi-statement batch.
    expect(lib.batches.filter((n) => n > 1)).toHaveLength(1);
  });
});

describe("the snapshot is never served without the gate", () => {
  it("a signed-out data request is redirected to sign-in before any load runs", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      DASHBOARD_SESSION_SECRET: "test-session-secret-0123456789abcdef",
      DASHBOARD_ALLOWED_EMAILS: "op@example.com",
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    };
    const resolve = vi.fn(async () => new Response("snapshot"));
    const event = {
      request: new Request("https://cockpit.example/__data.json?x-sveltekit-invalidated=1"),
      url: new URL("https://cockpit.example/"),
      route: { id: "/" },
      locals: {} as App.Locals,
    } as unknown as RequestEvent;
    const res = await handle({ event, resolve });
    expect(resolve).not.toHaveBeenCalled();
    expect([302, 303, 401]).toContain(res.status);
    expect(await res.text()).not.toContain("snapshot");
  });
});

describe("no page reads the store on its own", () => {
  // A page's server load would be fetched (`__data.json`) on every navigation to
  // it; the pages derive from the layout's snapshot in a universal `+page.ts`.
  const ROUTES = join(import.meta.dirname, "../../src/routes");
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );

  it("only the root layout has a server load", () => {
    const serverLoads = files(ROUTES)
      .filter((f) => /\+(page|layout)\.server\.ts$/.test(f))
      .filter((f) =>
        /export const load\b|export (async )?function load\b|\bload\b[^;]*\}\s*from|as load\b/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => relative(ROUTES, f));
    expect(serverLoads).toEqual(["+layout.server.ts"]);
  });

  it("the root layout's server load reads nothing a navigation changes", () => {
    const src = readFileSync(join(ROUTES, "+layout.server.ts"), "utf8");
    // `route.id` is read once, untracked, to skip the snapshot off every route.
    const body = src
      .slice(src.indexOf("export const load"))
      .replace("untrack(() => route.id)", "")
      .replace(/\{[^}]*\broute, untrack \}/, "");
    // Reading any of these makes SvelteKit re-run the load (a server round trip)
    // whenever it changes.
    expect(body).not.toMatch(/\b(url|params|route|parent)\b/);
  });

  it("every page has a universal load", () => {
    const pages = files(ROUTES).filter((f) => f.endsWith("+page.svelte"));
    for (const p of pages) {
      const universal = p.replace("+page.svelte", "+page.ts");
      expect(files(ROUTES), relative(ROUTES, p)).toContain(universal);
      expect(readFileSync(universal, "utf8"), relative(ROUTES, universal)).toMatch(
        /export const load\b/,
      );
    }
  });
});
