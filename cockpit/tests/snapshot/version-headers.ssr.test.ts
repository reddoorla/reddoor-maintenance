import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/db/client.js";
import { readCockpitVersion } from "../../../src/db/cockpit-version.js";
import { endpoint, withVersionHeaders } from "../../src/lib/server/endpoints/route.js";
import { VERSION_AFTER_HEADER, VERSION_BEFORE_HEADER } from "../../src/lib/freshness.js";
import { authHeader } from "../../../tests/_helpers/basic-auth.js";

/**
 * #1700, the operator's answer (a): an operator's POST under `/api/` answers with
 * the change counter just before and just after its handler ran, so the open
 * cockpit can tell its own change from anyone else's. Only on 2xx, only for an
 * operator, and never at the cost of the post itself.
 */

const ORIGINAL_ENV = { ...process.env };
let dir: string;
let url: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "version-headers-"));
  url = `file:${join(dir, "db.sqlite")}`;
  process.env = { ...ORIGINAL_ENV, TURSO_DATABASE_URL: url, DASHBOARD_PASSWORD: "s3cret" };
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.CONTEXT;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  rmSync(dir, { recursive: true, force: true });
});

const req = (
  path: string,
  method = "POST",
  headers: Record<string, string> = authHeader("s3cret"),
) => new Request(`https://cockpit.example${path}`, { method, headers });

/** A handler that writes `rows` rows the counter sees, then answers `status`. */
async function writing(rows: number, status = 200) {
  const db = await openDb({ url });
  return vi.fn(async () => {
    for (let i = 0; i < rows; i++) {
      await db
        .insertInto("sites")
        .values({ id: `rec${Math.random()}`, slug: `s${Math.random()}`, name: "S" } as never)
        .execute();
    }
    return new Response(JSON.stringify({ ok: status < 300 }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });
}

describe("withVersionHeaders", () => {
  it("an operator's POST answers with the counter before and after its own write", async () => {
    const db = await openDb({ url });
    const start = await readCockpitVersion(db);
    const run = await writing(3);
    const res = await withVersionHeaders(req("/api/submissions/x/status"), run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get(VERSION_BEFORE_HEADER)).toBe(String(start));
    expect(res.headers.get(VERSION_AFTER_HEADER)).toBe(String(start + 3));
  });

  it("every cockpit endpoint route answers through it (endpoint())", async () => {
    const db = await openDb({ url });
    const start = await readCockpitVersion(db);
    const run = await writing(1);
    const route = endpoint(run as never);
    const res = (await route({ request: req("/api/x"), params: {} } as never)) as Response;
    expect(res.headers.get(VERSION_BEFORE_HEADER)).toBe(String(start));
    expect(res.headers.get(VERSION_AFTER_HEADER)).toBe(String(start + 1));
  });

  it("a refused or failed POST carries no counter", async () => {
    for (const status of [400, 403, 409, 500]) {
      const res = await withVersionHeaders(req("/api/x"), await writing(0, status));
      expect(res.status).toBe(status);
      expect(res.headers.get(VERSION_BEFORE_HEADER)).toBeNull();
      expect(res.headers.get(VERSION_AFTER_HEADER)).toBeNull();
    }
  });

  it("a stranger's POST carries no counter, and the handler still answers it", async () => {
    // A handler that (wrongly) answered a stranger 200 still gets no counter.
    const run = await writing(0, 200);
    const res = await withVersionHeaders(req("/api/x", "POST", {}), run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.headers.get(VERSION_BEFORE_HEADER)).toBeNull();
  });

  it("a GET, and a POST outside /api/, are passed through untouched", async () => {
    for (const r of [req("/api/cockpit/version", "GET"), req("/auth/login")]) {
      const answer = new Response("x");
      const res = await withVersionHeaders(r, async () => answer);
      expect(res).toBe(answer);
    }
  });

  it("a counter it cannot read never costs the post", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const answer = new Response("ok");
    const res = await withVersionHeaders(req("/api/x"), async () => answer);
    expect(res).toBe(answer);
  });
});
