import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `withDb` opens the page's `Db` with `concurrentReads`, so a loader's
 * `Promise.all` really runs its reads together (see `OpenDbOptions` in
 * `src/db/client.ts`). Without it, Kysely serialises them and the parallel
 * loaders gain nothing.
 */

const openDb = vi.fn(async (..._args: unknown[]) => ({}) as never);
vi.mock("../../../src/db/client.js", () => ({
  openDb: (...args: unknown[]) => openDb(...args),
  readDbConfig: () => ({ url: "libsql://example.turso.io", authToken: "t" }),
}));

const { withDb } = await import("../../src/lib/server/db.js");

const ORIGINAL = process.env.TURSO_DATABASE_URL;
beforeEach(() => {
  process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";
  openDb.mockClear();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = ORIGINAL;
});

describe("withDb", () => {
  it("opens the page's Db with concurrentReads", async () => {
    await withDb("test", async () => "ok");
    expect(openDb).toHaveBeenCalledTimes(1);
    expect(openDb.mock.calls[0]?.[1]).toEqual({ concurrentReads: true });
  });
});
