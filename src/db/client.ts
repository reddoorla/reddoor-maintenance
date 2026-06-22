import { createClient, type Client, type Config as LibsqlConfig } from "@libsql/client";
import { Kysely } from "kysely";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { defaultCredentialsPath } from "../util/credentials.js";
import type { Database } from "./schema.js";
import { runMigrations } from "./migrate.js";

export type DbConfig = { url: string; authToken?: string };
export type Db = Kysely<Database>;

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

/** Open a libSQL-backed Kysely. Builds ONE client, applies migrations on it, then
 *  wraps that exact client in the Kysely dialect — the shared client is required so
 *  an in-memory db (per-client) is the same database the queries see. The same code
 *  serves Turso (libsql:// url + token), a self-hosted sqld, a local file: url, and
 *  :memory: for tests — host portability is a connection-string swap. */
export async function openDb(cfg: DbConfig): Promise<Db> {
  const clientConfig: LibsqlConfig = cfg.authToken
    ? { url: cfg.url, authToken: cfg.authToken }
    : { url: cfg.url };
  const client: Client = createClient(clientConfig);
  await runMigrations(client);
  return new Kysely<Database>({ dialect: new LibsqlDialect({ client }) });
}
