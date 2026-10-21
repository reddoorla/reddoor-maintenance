import { describe, it, expect } from "vitest";
import { sql } from "kysely";
import type { Client } from "@libsql/client";
import { kyselyOverClient } from "../../src/db/client.js";

/**
 * Kysely serialises every query on a libSQL `Db` unless told the dialect supports
 * multiple connections (`OpenDbOptions.concurrentReads`). A fake client whose
 * `execute` takes a fixed time shows it directly: the delay sits inside Kysely's
 * mutex, where a plugin's `transformResult` would not.
 */

const DELAY_MS = 40;

function slowClient() {
  const starts: number[] = [];
  const t0 = performance.now();
  const client = {
    async execute() {
      starts.push(performance.now() - t0);
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

async function threeAtOnce(concurrentReads: boolean) {
  const { client, starts } = slowClient();
  const db = await kyselyOverClient(client, { concurrentReads });
  await Promise.all([1, 2, 3].map(() => sql`select 1`.execute(db)));
  return starts;
}

describe("kyselyOverClient", () => {
  it("by default, Kysely runs three concurrent queries one after another (the mutex)", async () => {
    // The positive control: if Kysely ever drops the mutex, this fails and the
    // concurrentReads option has nothing left to do.
    const starts = await threeAtOnce(false);
    expect(starts).toHaveLength(3);
    expect(starts[2]).toBeGreaterThanOrEqual(2 * DELAY_MS - 5);
  });

  it("with concurrentReads, the same three queries all start at once", async () => {
    const starts = await threeAtOnce(true);
    expect(starts).toHaveLength(3);
    expect(Math.max(...starts)).toBeLessThan(DELAY_MS / 2);
  });
});
