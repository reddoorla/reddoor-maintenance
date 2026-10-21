import { describe, it, expect } from "vitest";
import { sql } from "kysely";
import type { Client } from "@libsql/client";
import { kyselyOverClient, openDb } from "../../src/db/client.js";

/**
 * Kysely serialises every query on a libSQL `Db` unless told the dialect supports
 * multiple connections (`OpenDbOptions.concurrentReads`). A fake client whose
 * `execute` takes a fixed time shows it directly: the delay sits inside Kysely's
 * mutex, where a plugin's `transformResult` would not.
 *
 * Times are measured from the FIRST `execute`, never from before the call: the
 * first `kyselyOverClient` in a process pays ~100 ms of dynamic imports, which
 * once let a mutex-free run pass the mutex test.
 */

const DELAY_MS = 40;

function slowClient() {
  const starts: number[] = [];
  const client = {
    async execute() {
      starts.push(performance.now());
      await new Promise((r) => setTimeout(r, DELAY_MS));
      return {
        rows: [],
        columns: [],
        columnTypes: [],
        rowsAffected: 0,
        lastInsertRowid: undefined,
      };
    },
    close() {},
  } as unknown as Client;
  return { client, starts };
}

/** How long after the first query the last of three concurrent ones started. */
async function spreadOfThree(concurrentReads: boolean): Promise<number> {
  const { client, starts } = slowClient();
  const db = await kyselyOverClient(client, { concurrentReads });
  await Promise.all([1, 2, 3].map(() => sql`select 1`.execute(db)));
  expect(starts).toHaveLength(3);
  return Math.max(...starts) - Math.min(...starts);
}

describe("kyselyOverClient", () => {
  it("by default, Kysely runs three concurrent queries one after another (the mutex)", async () => {
    // The positive control: if Kysely ever drops the mutex, this fails and the
    // concurrentReads option has nothing left to do.
    expect(await spreadOfThree(false)).toBeGreaterThanOrEqual(2 * DELAY_MS - 5);
  });

  it("with concurrentReads, the same three queries all start at once", async () => {
    expect(await spreadOfThree(true)).toBeLessThan(DELAY_MS / 2);
  });
});

describe("openDb", () => {
  // The adapter is the one switch the mutex reads (kysely RuntimeDriver), so this
  // pins that openDb hands its option through rather than building the default.
  const adapterOf = async (opts?: { concurrentReads?: boolean }) =>
    (await openDb({ url: ":memory:" }, opts)).getExecutor().adapter.supportsMultipleConnections;

  it("passes concurrentReads through to the dialect", async () => {
    expect(await adapterOf({ concurrentReads: true })).toBe(true);
  });

  it("keeps the mutex by default", async () => {
    expect(await adapterOf()).toBe(false);
  });
});
