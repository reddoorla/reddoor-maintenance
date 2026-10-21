/** Attempts `retryOnBusy` makes before letting SQLITE_BUSY through. */
export const BUSY_ATTEMPTS = 8;

/** SQLite's "another writer holds the lock" — including the WAL form, where a
 *  writer's snapshot went stale — as libSQL reports it. */
export function isBusy(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.startsWith("SQLITE_BUSY")) return true;
  return err instanceof Error && /SQLITE_BUSY|database is locked/i.test(err.message);
}

/**
 * Run a statement, retrying while the database says it is busy.
 *
 * SQLITE_BUSY is how SQLite refuses the SECOND of two concurrent writers
 * rather than letting it write on a stale read — the atomicity working, and it
 * arrives exactly when a burst does. Retried, the statement re-reads and gets
 * a real answer. Any other error throws at once, and BUSY itself throws after
 * `attempts` tries. Only for statements that are safe to run again: a retry
 * re-runs all of `run`.
 *
 * On the local-file driver, after a BUSY attempt the connection's affected-row
 * count can be stale (measured 2026-09-29), so a caller that needs to know
 * whether ITS statement wrote reads `RETURNING`, not `rowsAffected`.
 */
export async function retryOnBusy<T>(
  run: () => Promise<T>,
  attempts: number = BUSY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isBusy(err) || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, attempt * 25 + Math.random() * 25));
    }
  }
}
