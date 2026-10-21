import { error, isHttpError, isRedirect } from "@sveltejs/kit";
import { openDb, readDbConfig, type Db } from "../../../../src/db/client.js";

/**
 * Run a page's reads against Turso, with the page functions' guards. A missing
 * `TURSO_DATABASE_URL` is a 500, reached only after the auth hook, so an
 * unauthenticated probe never learns which env is unset. A thrown store
 * failure is a 502 with `handlerError`'s wording, rather than a page that
 * pretends the fleet is empty. An `error()` or `redirect()` thrown by `read`
 * passes through untouched.
 *
 * The `Db` lets concurrent reads run concurrently (`OpenDbOptions`), which the
 * loaders' parallel waves rely on. `markSubmissionsRead` writes through here
 * too; it awaits its two queries one after the other, so the lifted lock never
 * reorders them.
 */
export async function withDb<T>(page: string, read: (db: Db) => Promise<T>): Promise<T> {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error(`[cockpit:${page}] TURSO_DATABASE_URL missing`);
    error(500, "Turso env missing");
  }
  try {
    return await read(await openDb(readDbConfig(), { concurrentReads: true }));
  } catch (err) {
    if (isHttpError(err) || isRedirect(err)) throw err;
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[cockpit:${page}] unexpected failure: ${detail}`);
    error(502, "Temporarily unavailable — please retry in a moment.");
  }
}
