import type { Db } from "./client.js";

/** One lazily-opened, once-closed libSQL connection for a command's reads (#646
 *  step 4). Lazy because the command that owns it may return before any read
 *  happens, and opening a database to do nothing is how a test — or a `--help`
 *  path — ends up needing `TURSO_DATABASE_URL`. */
export function lazyFleetDb(): { get: () => Promise<Db>; close: () => Promise<void> } {
  let db: Db | null = null;
  return {
    get: async () => {
      if (!db) {
        const { openDb, readDbConfig } = await import("./client.js");
        db = await openDb(readDbConfig());
      }
      return db;
    },
    close: async () => {
      if (db) await db.destroy();
    },
  };
}
