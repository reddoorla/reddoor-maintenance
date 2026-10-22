import type { Client, Config as LibsqlConfig, InStatement, ResultSet } from "@libsql/client";
import type { Kysely as KyselyType } from "kysely";
import { defaultCredentialsPath } from "../util/credentials.js";
import type { Database } from "./schema.js";
import { runMigrations } from "./migrate.js";

export type DbConfig = { url: string; authToken?: string };
export type Db = KyselyType<Database>;

function missing(name: string): Error {
  return Object.assign(
    new Error(
      `${name} not set. Export it in your shell or put it in ${defaultCredentialsPath()} as ${name}=...`,
    ),
    { exitCode: 2 },
  );
}

/** Read TURSO_DATABASE_URL (+ optional TURSO_AUTH_TOKEN) from the environment.
 *  The token is optional so a local `file:`/`:memory:` url works with no token. */
export function readDbConfig(): DbConfig {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw missing("TURSO_DATABASE_URL");
  const authToken = process.env.TURSO_AUTH_TOKEN;
  return authToken ? { url, authToken } : { url };
}

// Migrations are idempotent but cost two Turso round-trips (CREATE TABLE IF NOT EXISTS +
// SELECT applied ids). Running them on EVERY openDb — i.e. every warm Netlify invocation —
// is pure latency on the form-ingest hot path and every dashboard GET. Cache the run per
// database URL so a warm process migrates once. ":memory:" is deliberately EXCLUDED: each
// in-memory client is a brand-new, separate database, so a cached "already migrated" would
// hand the next openDb an empty db (file:/libsql:/https: all persist → safe to cache).
const migrationsByUrl = new Map<string, Promise<void>>();

function ensureMigrated(url: string, client: Client): Promise<void> {
  if (url === ":memory:") return runMigrations(client).then(() => undefined);
  const cached = migrationsByUrl.get(url);
  if (cached) return cached;
  const p = runMigrations(client)
    .then(() => undefined)
    .catch((err: unknown) => {
      // Don't poison the process: a transient first-call failure (a Turso blip) must not
      // leave a rejected promise cached for every future openDb. Evict so the next retries.
      migrationsByUrl.delete(url);
      throw err;
    });
  migrationsByUrl.set(url, p);
  return p;
}

/** Open a libSQL-backed Kysely. Builds ONE client, ensures migrations are applied on it
 *  (once per process per persistent url — see ensureMigrated), then wraps that exact client
 *  in the Kysely dialect — the shared client is required so an in-memory db (per-client) is
 *  the same database the queries see. The same code serves Turso (libsql:// url + token), a
 *  self-hosted sqld, a local file: url, and :memory: for tests — host portability is a
 *  connection-string swap. */
export async function openDb(cfg: DbConfig, opts: OpenDbOptions = {}): Promise<Db> {
  // Lazy-load the libSQL/kysely stack: these live in devDependencies (consuming fleet
  // sites do not install them), and tsup externalizes them, so a TOP-LEVEL import here
  // would make every entry that transitively reaches this module — notably the `audit`
  // CLI entry via fleet-events-writer — eager-require packages the consumer lacks
  // (crashing `reddoor-maint audit` on fleet sites). Importing them only inside openDb
  // (and kyselyOverClient) keeps the module graph dependency-free until an actual DB
  // connection is opened.
  const { createClient } = await import("@libsql/client");
  const clientConfig: LibsqlConfig = cfg.authToken
    ? { url: cfg.url, authToken: cfg.authToken }
    : { url: cfg.url };
  const client: Client = createClient(clientConfig);
  await ensureMigrated(cfg.url, client);
  if (opts.batchReads) {
    return kyselyOverClient(batchingReadClient(client), { ...opts, concurrentReads: true });
  }
  return kyselyOverClient(client, opts);
}

export type OpenDbOptions = {
  /** Let queries issued at the same time run at the same time. Off by default.
   *
   *  `@libsql/kysely-libsql` reports Kysely's `SqliteAdapter`, whose
   *  `supportsMultipleConnections` is false, so Kysely (0.29) puts a mutex around every
   *  query and a `Promise.all` of reads runs one round trip after another. The client
   *  itself sends concurrent requests (20 at once by default). Measured 2026-10-21 against
   *  production Turso: `/s/:slug`'s six reads took ~415 ms with the mutex and ~120 ms
   *  without (`scripts/probe-kysely-mutex/override.mts` re-measures it).
   *
   *  Only the cockpit's page reads ask for it (`cockpit/src/lib/server/db.ts`). The mutex
   *  matters only for queries one caller has in flight at once, so lifting it is safe
   *  where those are reads; it stays on everywhere else because a writer may rely on the
   *  order. A transaction on a local `file:`/`:memory:` client hands that client's
   *  connection away (see `site-create.ts`), so never open one on a concurrent `Db`. */
  concurrentReads?: boolean;
  /** Send every query issued in the same turn of the event loop as ONE
   *  `client.batch(…, "read")`: one HTTP request to Turso, run in one read transaction,
   *  however many statements it holds. Implies `concurrentReads`: with Kysely's mutex the
   *  queries would arrive one per turn, and each would be a batch of one.
   *
   *  For the cockpit's snapshot only (`src/dashboard/snapshot.ts`), which issues all of its
   *  reads at once. A batch fails as a whole, so when one does, each statement is run on
   *  its own and fails or succeeds by itself: the snapshot's defensive reads still degrade
   *  one at a time. Reads only: anything but a SELECT is refused before it is queued. */
  batchReads?: boolean;
};

/** Words only a write uses. A read that held one in a string literal would be
 *  refused too; the cockpit's reads are Kysely's, with every value a parameter. */
const WRITE_WORDS =
  /\b(insert|update|delete|replace|upsert|create|drop|alter|attach|detach|pragma|vacuum|reindex)\b/i;

/** A libSQL client whose `execute` queues statements and sends each turn's queue as one
 *  read batch (`OpenDbOptions.batchReads`). Kysely's libSQL driver calls nothing but
 *  `execute` outside a transaction, and a transaction is refused here. Exported so a
 *  test can count the batches on a fake client. */
export function batchingReadClient(client: Client): Client {
  type Pending = {
    stmt: InStatement;
    resolve: (r: ResultSet) => void;
    reject: (e: unknown) => void;
  };
  let queue: Pending[] = [];
  const flush = async () => {
    const run = queue;
    queue = [];
    let results: ResultSet[];
    try {
      results = await client.batch(
        run.map((p) => p.stmt),
        "read",
      );
    } catch {
      // One failing statement fails the whole batch; settle each on its own instead,
      // each as a read batch of one, which Turso runs read-only (a local file:
      // client does not; the guard in `execute` is what holds there). The
      // reads are then no longer one consistent snapshot of the store, so they
      // run one after another in the order they were issued: a caller that
      // issues a version read first (the cockpit snapshot) then holds a version
      // no newer than any row it read, and a write landing between them shows as
      // a change rather than hiding behind an unchanged version.
      for (const p of run) {
        await client.batch([p.stmt], "read").then((r) => p.resolve(r[0] as ResultSet), p.reject);
      }
      return;
    }
    run.forEach((p, i) => p.resolve(results[i] as ResultSet));
  };
  const execute = (stmt: InStatement): Promise<ResultSet> =>
    new Promise((resolve, reject) => {
      // Reads only, refused here as well as by the read batch: a statement that
      // starts as a read (`WITH … DELETE`) or names a write anywhere is refused.
      const text = typeof stmt === "string" ? stmt : stmt.sql;
      if (!/^\s*(select|with)\b/i.test(text) || WRITE_WORDS.test(text)) {
        reject(new Error(`batchReads: only reads may run here, not: ${text.slice(0, 40)}`));
        return;
      }
      // A timer, not a microtask: Kysely reaches `execute` through several awaits, and
      // every query started in this turn must be queued before the batch goes.
      if (queue.length === 0) setTimeout(() => void flush(), 0);
      queue.push({ stmt, resolve, reject });
    });
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "execute") return execute;
      if (prop === "transaction") {
        return () =>
          Promise.reject(new Error("batchReads: a read-batching Db opens no transaction"));
      }
      // Bound, because the client's methods read private fields off `this`.
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
}

/** The Kysely over one libSQL client, as `openDb` builds it. Exported so a test can put
 *  a fake client under it and see the mutex directly. */
export async function kyselyOverClient(client: Client, opts: OpenDbOptions = {}): Promise<Db> {
  const [{ Kysely, SqliteAdapter }, { LibsqlDialect }] = await Promise.all([
    import("kysely"),
    import("@libsql/kysely-libsql"),
  ]);
  if (!opts.concurrentReads) {
    return new Kysely<Database>({ dialect: new LibsqlDialect({ client }) });
  }
  class ConcurrentAdapter extends SqliteAdapter {
    override get supportsMultipleConnections(): boolean {
      return true;
    }
  }
  class ConcurrentLibsqlDialect extends LibsqlDialect {
    override createAdapter() {
      return new ConcurrentAdapter();
    }
  }
  return new Kysely<Database>({ dialect: new ConcurrentLibsqlDialect({ client }) });
}
