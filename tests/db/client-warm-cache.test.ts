import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the migration runner so we can COUNT how often openDb runs it. (Kept in its own
// file — the sibling client.test.ts asserts REAL migrations applied, which a mock would break.)
vi.mock("../../src/db/migrate.js", () => ({ runMigrations: vi.fn() }));
import { runMigrations } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/client.js";

beforeEach(() => {
  vi.mocked(runMigrations).mockReset();
  vi.mocked(runMigrations).mockResolvedValue([]);
});

describe("openDb migration warm-cache", () => {
  it("runs migrations ONCE per process for a persistent url (warm invocations skip the round-trips)", async () => {
    const url = "libsql://warm-once.test"; // unique per test → no cross-test cache hit
    await openDb({ url });
    await openDb({ url });
    await openDb({ url });
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it("always migrates a fresh :memory: db (cache excluded — each is a separate database)", async () => {
    await openDb({ url: ":memory:" });
    await openDb({ url: ":memory:" });
    expect(runMigrations).toHaveBeenCalledTimes(2);
  });

  it("evicts the cache on a failed migration so the next openDb retries (no poisoned process)", async () => {
    const url = "libsql://retry.test";
    vi.mocked(runMigrations).mockRejectedValueOnce(new Error("turso blip")).mockResolvedValue([]);
    await expect(openDb({ url })).rejects.toThrow("turso blip");
    await openDb({ url }); // cache was evicted → this retries rather than replaying the rejection
    expect(runMigrations).toHaveBeenCalledTimes(2);
  });
});
