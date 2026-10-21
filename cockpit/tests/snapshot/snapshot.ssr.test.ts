import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient, type Client, type InStatement } from "@libsql/client";
import type { RequestEvent } from "@sveltejs/kit";
import { batchingReadClient, kyselyOverClient, openDb, type Db } from "../../../src/db/client.js";
import { runMigrations } from "../../../src/db/migrate.js";
import { loadCockpitSnapshot } from "../../../src/dashboard/snapshot.js";
import { handle } from "../../src/hooks.server.js";
import { runLayout } from "../_helpers/snapshot-load.js";

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
  const text = (s: InStatement) => (typeof s === "string" ? s : s.sql);
  const client = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "batch") {
        return async (stmts: InStatement[], mode: "read") => {
          batches.push(stmts.map(text));
          if (failSql && stmts.some((s) => failSql(text(s)))) throw new Error("injected");
          return target.batch(stmts, mode);
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
  return { client, batches, executes };
}

async function batchedDb(client: Client): Promise<Db> {
  return kyselyOverClient(batchingReadClient(client), { concurrentReads: true });
}

describe("loadCockpitSnapshot on a batchReads Db", () => {
  it("is one batch to the store, holding every read", async () => {
    const c = await countingClient();
    const s = await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    expect(s.sites.map((w) => w.name)).toEqual(["Acme"]);
    expect(c.batches).toHaveLength(1);
    expect(c.batches[0]?.length).toBeGreaterThanOrEqual(11);
    expect(c.executes).toEqual([]);
  });

  it("selects none of the three blob columns", async () => {
    const c = await countingClient();
    await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    const all = (c.batches[0] ?? []).join("\n");
    // Positive control: the reads that sit next to each blob are in the batch.
    expect(all).toContain('from "sites"');
    expect(all).toContain('from "prospect_audits"');
    expect(all).toContain("(rendered_html is not null)");
    expect(all).not.toMatch(/"header_image"|header_image"? *,|\.header_image\b(?!_)/);
    expect(all).not.toContain("result_json");
    expect(all).not.toContain("select *, ");
    // `rendered_html` appears only inside the null test.
    expect(all.replaceAll('(rendered_html is not null) as "has_rendered_html"', "")).not.toContain(
      "rendered_html",
    );
    expect(all).not.toMatch(/select \* from "(sites|reports|prospect_audits)"/);
  });

  it("a failing read fails only itself: the batch is retried statement by statement", async () => {
    const c = await countingClient((sql) => sql.includes('from "fleet_events"'));
    const s = await loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example");
    expect(c.batches).toHaveLength(1);
    expect(c.executes.some((q) => q.includes('from "fleet_events"'))).toBe(true);
    expect(s.recentEvents).toEqual([]);
    expect(s.sites).toHaveLength(1);
    expect(s.submissions).toEqual([]);
  });

  it("a failing site read still fails the snapshot (a 502, never '0 sites')", async () => {
    const c = await countingClient((sql) => sql.includes('from "sites" left join'));
    await expect(
      loadCockpitSnapshot(await batchedDb(c.client), NOW, "https://dash.example"),
    ).rejects.toThrow("injected Turso blip");
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
    expect(run.data.snapshot.sites.map((w) => w.id)).toEqual(["recA"]);
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
        /export const load\b|export (async )?function load\b/.test(readFileSync(f, "utf8")),
      )
      .map((f) => relative(ROUTES, f));
    expect(serverLoads).toEqual(["+layout.server.ts"]);
  });

  it("the root layout's server load reads nothing a navigation changes", () => {
    const src = readFileSync(join(ROUTES, "+layout.server.ts"), "utf8");
    const body = src.slice(src.indexOf("export const load"));
    // Reading any of these makes SvelteKit re-run the load (a server round trip)
    // whenever it changes.
    expect(body).not.toMatch(/\b(url|params|route|parent)\b/);
  });

  it("every page has a universal load", () => {
    const pages = files(ROUTES).filter((f) => f.endsWith("+page.svelte"));
    for (const p of pages) {
      expect(files(ROUTES), relative(ROUTES, p)).toContain(p.replace("+page.svelte", "+page.ts"));
    }
  });
});
