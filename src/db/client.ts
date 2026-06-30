import type { Client, Config as LibsqlConfig } from "@libsql/client";
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

/** Read TURSO_DATABASE_URL (+ optional TURSO_AUTH_TOKEN) from the environment,
 *  mirroring readAirtableConfig. The token is optional so a local `file:`/`:memory:`
 *  url works with no token. */
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
export async function openDb(cfg: DbConfig): Promise<Db> {
  // Lazy-load the libSQL/kysely stack: these live in devDependencies (consuming fleet
  // sites do not install them), and tsup externalizes them, so a TOP-LEVEL import here
  // would make every entry that transitively reaches this module — notably the `audit`
  // CLI entry via fleet-events-writer — eager-require packages the consumer lacks
  // (crashing `reddoor-maint audit` on fleet sites). Importing them only inside openDb
  // keeps the module graph dependency-free until an actual DB connection is opened.
  const [{ createClient }, { Kysely }, { LibsqlDialect }] = await Promise.all([
    import("@libsql/client"),
    import("kysely"),
    import("@libsql/kysely-libsql"),
  ]);
  const clientConfig: LibsqlConfig = cfg.authToken
    ? { url: cfg.url, authToken: cfg.authToken }
    : { url: cfg.url };
  const client: Client = createClient(clientConfig);
  await ensureMigrated(cfg.url, client);
  return new Kysely<Database>({ dialect: new LibsqlDialect({ client }) });
}
