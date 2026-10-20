import { describe, it, expect, vi, beforeEach } from "vitest";

const destroy = vi.fn(async () => {});
const openDb = vi.fn(async () => ({ destroy }));

vi.mock("../../src/db/client.js", () => ({
  openDb,
  readDbConfig: () => ({ url: "libsql://test", authToken: "t" }),
}));

const { lazyFleetDb } = await import("../../src/db/lazy-fleet-db.js");

beforeEach(() => {
  openDb.mockClear();
  destroy.mockClear();
});

describe("lazyFleetDb", () => {
  it("opens nothing, and closes nothing, when no read ever happens", async () => {
    const fleetDb = lazyFleetDb();
    await fleetDb.close();
    expect(openDb).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("opens one connection on first use, reuses it, and destroys it on close", async () => {
    const fleetDb = lazyFleetDb();
    const a = await fleetDb.get();
    const b = await fleetDb.get();
    expect(a).toBe(b);
    expect(openDb).toHaveBeenCalledTimes(1);
    await fleetDb.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
